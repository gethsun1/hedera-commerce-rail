import type { HardhatRuntimeEnvironment } from "hardhat/types";
import hre from "hardhat";
import { getAddress, Wallet, ZeroAddress, parseEther, parseUnits } from "ethers";

const TESTNET_CHAIN_ID = 296;
// The contract-create surcharge is about USD 1.20; at the current Testnet exchange rate,
// 13 HBAR covers that service fee. The legacy 1 HBAR emulator example is insufficient.
const HTS_CREATION_VALUE = parseEther("13");
const AMOUNT = parseUnits("1", 6);
const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";

async function main(hre: HardhatRuntimeEnvironment) {
  if (
    hre.network.name !== "hederaTestnet" ||
    (await hre.ethers.provider.getNetwork()).chainId !== BigInt(TESTNET_CHAIN_ID)
  ) {
    throw new Error("This diagnostic is restricted to Hedera Testnet (chain ID 296).");
  }

  const accountId = process.env.HEDERA_ACCOUNT_ID;
  const privateKey = process.env.HEDERA_PRIVATE_KEY;
  if (!accountId || !privateKey) throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY are required.");

  const [signer] = await hre.ethers.getSigners();
  const derivedAddress = new Wallet(privateKey).address.toLowerCase();
  if (signer.address.toLowerCase() !== derivedAddress)
    throw new Error("Configured signer does not match the ECDSA key.");

  const deployment = await hre.deployments.getOrNull("TokenPaymentEscrow");
  if (!deployment) throw new Error("Deploy TokenPaymentEscrow to Testnet with the TokenPaymentEscrow tag first.");

  const report: Record<string, unknown> = {
    network: hre.network.name,
    chainId: TESTNET_CHAIN_ID,
    accountId,
    signer: signer.address,
    escrowAddress: deployment.address,
    transactions: {},
  };
  const txReport = report.transactions as Record<string, { hash: string; blockNumber: number }>;

  async function record(label: string, tx: Awaited<ReturnType<typeof signer.sendTransaction>>) {
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error(`${label} transaction failed: ${tx.hash}`);
    txReport[label] = { hash: tx.hash, blockNumber: receipt.blockNumber };
    return receipt;
  }

  const escrow = await hre.ethers.getContractAt("TokenPaymentEscrow", deployment.address, signer);
  const existingPayeeAddress = process.env.M41_PAYEE_ADDRESS;
  let payeeAddress: string;
  if (existingPayeeAddress) {
    payeeAddress = getAddress(existingPayeeAddress);
    if ((await hre.ethers.provider.getCode(payeeAddress)) === "0x")
      throw new Error("M41_PAYEE_ADDRESS has no Testnet contract code.");
    report.reusedTestnetRecipient = true;
  } else {
    const payeeFactory = await hre.ethers.getContractFactory("MinimalHtsAssociation", signer);
    const payee = await payeeFactory.deploy();
    const payeeReceipt = await payee.deploymentTransaction()!.wait();
    if (!payeeReceipt || payeeReceipt.status !== 1) throw new Error("Temporary HTS recipient deployment failed.");
    payeeAddress = await payee.getAddress();
    txReport.deployRecipient = { hash: payeeReceipt.hash, blockNumber: payeeReceipt.blockNumber };
  }
  const payee = await hre.ethers.getContractAt("MinimalHtsAssociation", payeeAddress, signer);
  report.payeeContractAddress = payeeAddress;

  const suffix = Date.now().toString().slice(-6);
  const name = `M41 Association ${suffix}`;
  const symbol = `M${suffix}`;
  const tokenService = await hre.ethers.getContractAt("IHederaTokenService", HTS_ADDRESS, signer);
  const tokenProperties = {
    name,
    symbol,
    treasury: signer.address,
    memo: "Temporary M4.1 association diagnostic",
    tokenSupplyType: false,
    maxSupply: 0,
    freezeDefault: false,
    tokenKeys: [],
    expiry: { second: 0, autoRenewAccount: signer.address, autoRenewPeriod: 7_890_000 },
  };
  let tokenAddress: string;
  let tokenId: string;
  const existingTokenId = process.env.M41_TOKEN_ID;
  if (existingTokenId) {
    const match = /^0\.0\.(\d+)$/.exec(existingTokenId);
    if (!match) throw new Error("M41_TOKEN_ID must be a Testnet token ID in 0.0.x format.");
    tokenId = existingTokenId;
    tokenAddress = getAddress(`0x${BigInt(match[1]).toString(16).padStart(40, "0")}`);
    report.reusedPrecreatedDiagnosticToken = true;
  } else {
    const initialSupply = parseUnits("100", 6);
    const [createResponse, predictedTokenAddress] = await tokenService.createFungibleToken.staticCall(
      tokenProperties,
      initialSupply,
      6,
      { value: HTS_CREATION_VALUE },
    );
    if (BigInt(createResponse) !== 22n)
      throw new Error(`HTS token creation preview returned response ${createResponse}.`);
    const creation = await tokenService.createFungibleToken(tokenProperties, initialSupply, 6, {
      value: HTS_CREATION_VALUE,
      gasLimit: 2_000_000,
    });
    const tokenReceipt = await creation.wait();
    if (!tokenReceipt || tokenReceipt.status !== 1) throw new Error(`HTS token creation failed: ${creation.hash}`);
    txReport.createToken = { hash: creation.hash, blockNumber: tokenReceipt.blockNumber };
    tokenAddress = getAddress(predictedTokenAddress as string);
    tokenId = `0.0.${BigInt(tokenAddress).toString()}`;
  }
  report.tokenAddress = tokenAddress;
  report.tokenId = tokenId;
  report.tokenName = name;
  report.tokenSymbol = symbol;

  const mirrorResponse = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/tokens/${tokenId}`);
  const mirrorToken = (await mirrorResponse.json()) as {
    token_id?: string;
    type?: string;
    decimals?: string;
    treasury_account_id?: string;
    supply_key?: unknown;
    name?: string;
    symbol?: string;
  };
  if (!mirrorResponse.ok || mirrorToken.token_id !== tokenId)
    throw new Error(`Mirror Node cannot find test token ${tokenId}.`);
  if (
    mirrorToken.type !== "FUNGIBLE_COMMON" ||
    mirrorToken.treasury_account_id !== accountId ||
    mirrorToken.supply_key != null
  ) {
    throw new Error("Mirror Node token properties do not match the no-key fungible diagnostic token.");
  }
  report.tokenName = mirrorToken.name;
  report.tokenSymbol = mirrorToken.symbol;
  report.mirrorTokenProperties = {
    tokenId: mirrorToken.token_id,
    type: mirrorToken.type,
    decimals: mirrorToken.decimals,
    treasury: mirrorToken.treasury_account_id,
    supplyKeyPresent: mirrorToken.supply_key != null,
  };

  const token = await hre.ethers.getContractAt(
    [
      "function associate() returns (uint256 responseCode)",
      "function isAssociated() view returns (bool associated)",
      "function approve(address spender, uint256 amount) returns (bool)",
      "function balanceOf(address account) view returns (uint256)",
    ],
    tokenAddress,
    signer,
  );
  const typeResult = await tokenService.getTokenType(tokenAddress);
  if (BigInt(typeResult.responseCode) !== 22n || BigInt(typeResult.tokenType) !== 0n) {
    throw new Error("Token is not a valid HTS fungible token.");
  }
  report.tokenType = { responseCode: typeResult.responseCode.toString(), tokenType: typeResult.tokenType.toString() };

  await record("associateEscrow", await escrow.associateToken(tokenAddress, { gasLimit: 2_000_000 }));
  report.escrowAssociationCallSucceeded = true;

  await record("associatePayee", await payee.associate(tokenAddress, { gasLimit: 2_000_000 }));
  if ((await payee.isAssociated(tokenAddress)) !== true)
    throw new Error("Recipient contract association did not persist.");

  const initialPayerBalance = await token.balanceOf(signer.address);
  const initialPayeeBalance = await token.balanceOf(payeeAddress);
  const block = await hre.ethers.provider.getBlock("latest");
  if (!block) throw new Error("Latest Testnet block unavailable.");
  const releaseDeadline = BigInt(block.timestamp + 3600);
  await record(
    "createReleasePayment",
    await escrow.createPayment(tokenAddress, payeeAddress, ZeroAddress, AMOUNT, releaseDeadline),
  );
  await record("approveReleasePayment", await token.approve(deployment.address, AMOUNT, { gasLimit: 2_000_000 }));
  await record("fundReleasePayment", await escrow.fundPayment(1, { gasLimit: 2_000_000 }));
  const escrowFundedBalance = await token.balanceOf(deployment.address);
  if (escrowFundedBalance !== AMOUNT)
    throw new Error(`Unexpected escrow balance after funding: ${escrowFundedBalance}`);
  await record("releasePayment", await escrow.releasePayment(1, { gasLimit: 2_000_000 }));
  const releaseBalance = await token.balanceOf(payeeAddress);
  if (BigInt(releaseBalance) - BigInt(initialPayeeBalance) !== AMOUNT) {
    throw new Error("Recipient did not receive the exact release amount.");
  }
  if ((await token.balanceOf(deployment.address)) !== 0n) throw new Error("Escrow retained tokens after release.");

  const refundBlock = await hre.ethers.provider.getBlock("latest");
  if (!refundBlock) throw new Error("Latest Testnet block unavailable.");
  const refundDeadline = BigInt(refundBlock.timestamp + 90);
  await record(
    "createRefundPayment",
    await escrow.createPayment(tokenAddress, payeeAddress, ZeroAddress, AMOUNT, refundDeadline),
  );
  await record("approveRefundPayment", await token.approve(deployment.address, AMOUNT, { gasLimit: 2_000_000 }));
  await record("fundRefundPayment", await escrow.fundPayment(2, { gasLimit: 2_000_000 }));
  const waitSeconds = Number(refundDeadline - BigInt(refundBlock.timestamp) + 5n);
  if (waitSeconds > 0) await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
  await record("refundPaymentAfterDeadline", await escrow.refundPayment(2, { gasLimit: 2_000_000 }));

  const finalPayerBalance = await token.balanceOf(signer.address);
  if (finalPayerBalance !== initialPayerBalance)
    throw new Error("Payer balance did not return to its starting value after release/refund flows.");
  const released = await escrow.getPayment(1);
  const refunded = await escrow.getPayment(2);
  const releaseState = BigInt(released.state);
  const refundState = BigInt(refunded.state);
  if (releaseState !== 2n || refundState !== 3n) throw new Error("Unexpected final payment states.");
  report.lifecycle = {
    releaseState: releaseState.toString(),
    refundState: refundState.toString(),
    payerStartBalance: initialPayerBalance.toString(),
    payerFinalBalance: finalPayerBalance.toString(),
    payeeReceived: (releaseBalance - initialPayeeBalance).toString(),
    escrowFinalBalance: (await token.balanceOf(deployment.address)).toString(),
  };

  async function mirrorTokenRelationship(contractAddress: string) {
    const contractResponse = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/contracts/${contractAddress}`);
    const contractInfo = (await contractResponse.json()) as { contract_id?: string };
    if (!contractResponse.ok || !contractInfo.contract_id)
      throw new Error(`Mirror Node cannot resolve contract ${contractAddress}.`);
    const relationshipResponse = await fetch(
      `https://testnet.mirrornode.hedera.com/api/v1/accounts/${contractInfo.contract_id}/tokens?token.id=${tokenId}&limit=10`,
    );
    const relationshipInfo = (await relationshipResponse.json()) as {
      tokens?: Array<{ token_id: string; balance: number; decimals: number }>;
    };
    const relationship = relationshipInfo.tokens?.find(item => item.token_id === tokenId);
    if (!relationshipResponse.ok || !relationship)
      throw new Error(`Mirror Node has no ${tokenId} relationship for ${contractInfo.contract_id}.`);
    return { contractId: contractInfo.contract_id, ...relationship };
  }

  const [escrowRelationship, payeeRelationship] = await Promise.all([
    mirrorTokenRelationship(deployment.address),
    mirrorTokenRelationship(payeeAddress),
  ]);
  if (escrowRelationship.balance !== 0 || payeeRelationship.balance !== Number(AMOUNT)) {
    throw new Error("Mirror Node balances do not match the completed release/refund flows.");
  }
  report.mirrorNode = { escrow: escrowRelationship, payee: payeeRelationship };

  console.log(JSON.stringify(report, null, 2));
}

main(hre).catch(error => {
  console.error(error instanceof Error ? error.message : "Testnet diagnostic failed.");
  process.exitCode = 1;
});
