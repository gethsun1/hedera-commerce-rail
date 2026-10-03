import { expect } from "chai";
import { ethers } from "hardhat";

describe("HTS association diagnostic", function () {
  it("isolates HIP-719 self-association return data for a fork-created HTS token", async function () {
    const creator = await (await ethers.getContractFactory("HtsTokenCreator")).deploy();
    await creator.waitForDeployment();

    const initialSupply = ethers.parseUnits("10", 6);
    const creation = await creator.createToken("Association Diagnostic", "ADG", initialSupply, 6, {
      value: 100_000_000n,
    });
    const receipt = await creation.wait();
    const parsed = receipt!.logs
      .map(log => {
        try {
          return creator.interface.parseLog({ topics: [...log.topics], data: log.data });
        } catch {
          return null;
        }
      })
      .find(event => event?.name === "TokenCreated");
    const tokenAddress = parsed!.args.tokenAddress as string;

    const diagnostic = await (await ethers.getContractFactory("MinimalHtsAssociation")).deploy();
    await diagnostic.waitForDeployment();
    const escrow = await (await ethers.getContractFactory("TokenPaymentEscrow")).deploy();
    await escrow.waitForDeployment();

    const hts = new ethers.Interface(["function getAccountId(address) view returns (uint32 accountId, bool exists)"]);
    const htsContract = new ethers.Contract("0x0000000000000000000000000000000000000167", hts, ethers.provider);
    const [localContractNum, localContractExists] = await htsContract.getAccountId(await diagnostic.getAddress());
    expect(localContractNum).to.be.greaterThan(0n);
    expect(localContractExists).to.equal(false);

    const tokenService = new ethers.Contract(
      "0x0000000000000000000000000000000000000167",
      ["function getTokenType(address) view returns (int64 responseCode, int32 tokenType)"],
      ethers.provider,
    );
    expect(await tokenService.getTokenType(tokenAddress)).to.deep.equal([22n, 0n]);
    const tokenFacade = new ethers.Contract(
      tokenAddress,
      ["function getTokenType(address token) view returns (int64 responseCode, int32 tokenType)"],
      ethers.provider,
    );
    await expect(tokenFacade.getTokenType(tokenAddress)).to.be.revertedWith("redirectForToken: not supported");

    // This call site has no escrow logic. The fork's HIP-719 facade looks up the
    // caller's Hedera entity ID and reverts without data because a local deployment
    // has no corresponding Testnet contract/account entity.
    await expect(diagnostic.associate(tokenAddress)).to.be.revertedWithoutReason();
    await expect(escrow.associateToken(tokenAddress)).to.be.revertedWithoutReason();
  });
});
