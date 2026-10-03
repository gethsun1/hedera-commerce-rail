import { expect } from "chai";
import { ethers, network } from "hardhat";

describe("TokenPaymentEscrow", function () {
  const AMOUNT = 1_000_000n;

  async function fixture() {
    const [payer, payee, arbiter, other] = await ethers.getSigners();
    const escrow = await (await ethers.getContractFactory("MockTokenPaymentEscrow")).deploy();
    await escrow.waitForDeployment();
    const token = await (await ethers.getContractFactory("MockFungibleToken")).deploy(AMOUNT * 10n);
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();
    const block = await ethers.provider.getBlock("latest");
    const deadline = BigInt(block!.timestamp + 3600);
    await escrow.associateToken(tokenAddress);
    await token.connect(payee).associate();
    return { payer, payee, arbiter, other, escrow, token, tokenAddress, deadline };
  }

  async function createAndFund(f: Awaited<ReturnType<typeof fixture>>) {
    await f.escrow.createPayment(f.tokenAddress, f.payee.address, f.arbiter.address, AMOUNT, f.deadline);
    await f.token.approve(await f.escrow.getAddress(), AMOUNT);
    await f.escrow.connect(f.payer).fundPayment(1);
  }

  it("creates, associates, funds and releases the exact recorded fungible token amount", async function () {
    const f = await fixture();
    const startPayeeBalance = await f.token.balanceOf(f.payee.address);
    await f.escrow.createPayment(f.tokenAddress, f.payee.address, f.arbiter.address, AMOUNT, f.deadline);
    expect((await f.escrow.getPayment(1)).token).to.equal(f.tokenAddress);
    await f.token.approve(await f.escrow.getAddress(), AMOUNT);
    await expect(f.escrow.connect(f.payer).fundPayment(1))
      .to.emit(f.escrow, "TokenPaymentFunded")
      .withArgs(1, f.tokenAddress, f.payer.address, AMOUNT);
    expect(await f.token.balanceOf(await f.escrow.getAddress())).to.equal(AMOUNT);
    expect(await f.escrow.totalEscrowed(f.tokenAddress)).to.equal(AMOUNT);
    await expect(f.escrow.connect(f.arbiter).releasePayment(1))
      .to.emit(f.escrow, "TokenPaymentReleased")
      .withArgs(1, f.tokenAddress, f.payee.address, f.arbiter.address, AMOUNT);
    expect(await f.token.balanceOf(f.payee.address)).to.equal(startPayeeBalance + AMOUNT);
    expect(await f.escrow.totalEscrowed(f.tokenAddress)).to.equal(0);
    expect((await f.escrow.getPayment(1)).state).to.equal(2);
    await expect(f.escrow.releasePayment(1)).to.be.revertedWithCustomError(f.escrow, "InvalidState");
  });

  it("refunds the exact token amount after the deadline and blocks duplicate settlement", async function () {
    const f = await fixture();
    await createAndFund(f);
    const payerBefore = await f.token.balanceOf(f.payer.address);
    await network.provider.send("evm_setNextBlockTimestamp", [Number(f.deadline) + 1]);
    await expect(f.escrow.connect(f.payer).refundPayment(1))
      .to.emit(f.escrow, "TokenPaymentRefunded")
      .withArgs(1, f.tokenAddress, f.payer.address, f.payer.address, AMOUNT);
    expect(await f.token.balanceOf(f.payer.address)).to.equal(payerBefore + AMOUNT);
    expect(await f.escrow.totalEscrowed(f.tokenAddress)).to.equal(0);
    expect((await f.escrow.getPayment(1)).state).to.equal(3);
    await expect(f.escrow.connect(f.payer).refundPayment(1)).to.be.revertedWithCustomError(f.escrow, "InvalidState");
  });

  it("enforces payer, arbiter, token validation, amount and allowance requirements", async function () {
    const f = await fixture();
    await expect(
      f.escrow.createPayment(ethers.ZeroAddress, f.payee.address, ethers.ZeroAddress, AMOUNT, f.deadline),
    ).to.be.revertedWithCustomError(f.escrow, "InvalidToken");
    await expect(
      f.escrow.createPayment(f.tokenAddress, f.payee.address, ethers.ZeroAddress, 0, f.deadline),
    ).to.be.revertedWithCustomError(f.escrow, "InvalidAmount");
    await expect(
      f.escrow.createPayment(f.tokenAddress, f.payee.address, ethers.ZeroAddress, 1n << 63n, f.deadline),
    ).to.be.revertedWithCustomError(f.escrow, "InvalidAmount");
    await f.escrow.createPayment(f.tokenAddress, f.payee.address, f.arbiter.address, AMOUNT, f.deadline);
    await expect(f.escrow.connect(f.other).fundPayment(1)).to.be.revertedWithCustomError(f.escrow, "Unauthorized");
    await expect(f.escrow.connect(f.payer).fundPayment(1)).to.be.revertedWithCustomError(
      f.escrow,
      "TokenTransferFailed",
    );
    expect((await f.escrow.getPayment(1)).state).to.equal(0);
    expect(await f.escrow.totalEscrowed(f.tokenAddress)).to.equal(0);
    await f.token.approve(await f.escrow.getAddress(), AMOUNT);
    await f.escrow.connect(f.payer).fundPayment(1);
    await expect(f.escrow.connect(f.other).releasePayment(1)).to.be.revertedWithCustomError(f.escrow, "Unauthorized");
    await expect(f.escrow.connect(f.other).refundPayment(1)).to.be.revertedWithCustomError(f.escrow, "Unauthorized");
  });

  it("allows arbiter refund and rejects invalid addresses and unfunded transitions", async function () {
    const f = await fixture();
    await expect(
      f.escrow.createPayment(f.tokenAddress, f.payer.address, ethers.ZeroAddress, AMOUNT, f.deadline),
    ).to.be.revertedWithCustomError(f.escrow, "InvalidAddress");
    await f.escrow.createPayment(f.tokenAddress, f.payee.address, f.arbiter.address, AMOUNT, f.deadline);
    await expect(f.escrow.connect(f.payer).releasePayment(1)).to.be.revertedWithCustomError(f.escrow, "InvalidState");
    await f.token.approve(await f.escrow.getAddress(), AMOUNT);
    await f.escrow.connect(f.payer).fundPayment(1);
    await f.escrow.connect(f.arbiter).refundPayment(1);
    expect((await f.escrow.getPayment(1)).state).to.equal(3);
  });
});
