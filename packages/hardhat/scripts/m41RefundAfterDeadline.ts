import type { HardhatRuntimeEnvironment } from "hardhat/types";
import hre from "hardhat";
import { Wallet, ZeroAddress, getAddress, parseUnits } from "ethers";

const TESTNET_CHAIN_ID = 296n;
const MIRROR_URL = "https://testnet.mirrornode.hedera.com/api/v1";
const REFUND_WINDOW_SECONDS = 600n;
const REFUND_PAYMENT_ID = 5n;
const POLL_INTERVAL_MS = 15_000;
const AMOUNT = parseUnits("1", 6);

async function main(hre: HardhatRuntimeEnvironment) {
  if (hre.network.name !== "hederaTestnet" || (await hre.ethers.provider.getNetwork()).chainId !== TESTNET_CHAIN_ID) {
    throw new Error("This diagnostic is restricted to Hedera Testnet (chain ID 296).");
  }
  const accountId = process.env.HEDERA_ACCOUNT_ID;
  const privateKey = process.env.HEDERA_PRIVATE_KEY;
  const tokenId = process.env.M41_TOKEN_ID;
  const configuredPayeeAddress = process.env.M41_PAYEE_ADDRESS;
  if (!accountId || !privateKey || !tokenId || !configuredPayeeAddress) {
    throw new Error("HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY, M41_TOKEN_ID and M41_PAYEE_ADDRESS are required.");
  }
  const [signer] = await hre.ethers.getSigners();
  if (signer.address.toLowerCase() !== new Wallet(privateKey).address.toLowerCase()) {
    throw new Error("Configured signer does not match the ECDSA key.");
  }

  const deployment = await hre.deployments.get("TokenPaymentEscrow");
  const escrow = await hre.ethers.getContractAt("TokenPaymentEscrow", deployment.address, signer);
  const match = /^0\.0\.(\d+)$/.exec(tokenId);
  if (!match) throw new Error("M41_TOKEN_ID must be a Testnet token ID in 0.0.x format.");
  const tokenAddress = getAddress(`0x${BigInt(match[1]).toString(16).padStart(40, "0")}`);
  const payeeAddress = getAddress(configuredPayeeAddress);
  const token = await hre.ethers.getContractAt(
    [
      "function balanceOf(address account) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
    ],
    tokenAddress,
    signer,
  );

  async function latestNetworkTime() {
    const response = await fetch(`${MIRROR_URL}/blocks?limit=1&order=desc`);
    const body = (await response.json()) as { blocks?: Array<{ timestamp?: { from?: string } }> };
    const timestamp = body.blocks?.[0]?.timestamp?.from;
    if (!response.ok || !timestamp) throw new Error("Mirror Node latest block timestamp is unavailable.");
    return BigInt(timestamp.split(".")[0]);
  }

  async function record(
    label: string,
    tx: { hash: string; wait: () => Promise<{ status?: number | null; blockNumber: number } | null> },
  ) {
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error(`${label} failed: ${tx.hash}`);
    return { transactionHash: tx.hash, blockNumber: receipt.blockNumber };
  }

  const existingRelease = await escrow.getPayment(1);
  const secondRelease = await escrow.getPayment(2);
  if (
    BigInt(existingRelease.state) !== 2n ||
    BigInt(secondRelease.state) !== 2n ||
    secondRelease.token !== tokenAddress
  ) {
    throw new Error("Expected diagnostic payments 1 and 2 to be Released.");
  }

  const transactions: Record<string, unknown> = {};
  const nextPaymentId = BigInt(await escrow.nextPaymentId());
  if (nextPaymentId !== REFUND_PAYMENT_ID)
    throw new Error(`Expected next payment ID ${REFUND_PAYMENT_ID}, got ${nextPaymentId}.`);
  const refundDeadline = (await latestNetworkTime()) + REFUND_WINDOW_SECONDS;
  transactions.createRefundPayment = await record(
    "create payment 4",
    await escrow.createPayment(tokenAddress, payeeAddress, ZeroAddress, AMOUNT, refundDeadline),
  );
  transactions.approveRefundPayment = await record(
    "approve payment 4",
    await token.approve(deployment.address, AMOUNT, { gasLimit: 2_000_000 }),
  );
  transactions.fundRefundPayment = await record("fund payment 4", await escrow.fundPayment(5, { gasLimit: 2_000_000 }));

  let lastProgressLog = 0;
  for (;;) {
    const currentNetworkTime = await latestNetworkTime();
    if (currentNetworkTime > refundDeadline + 2n) break;
    if (Date.now() - lastProgressLog >= 60_000) {
      console.log(
        `Waiting for Testnet consensus time to pass payment deadline ${refundDeadline}; latest network time is ${currentNetworkTime}.`,
      );
      lastProgressLog = Date.now();
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const refundTx = await escrow.refundPayment(5, { gasLimit: 2_000_000 });
  const refundReceipt = await refundTx.wait();
  if (!refundReceipt || refundReceipt.status !== 1) throw new Error(`Deadline refund failed: ${refundTx.hash}`);
  const refundBlock = await hre.ethers.provider.getBlock(refundReceipt.blockNumber);
  if (!refundBlock || BigInt(refundBlock.timestamp) <= refundDeadline) {
    throw new Error("Refund transaction block timestamp did not pass the payment deadline.");
  }
  transactions.refundPaymentAfterDeadline = { transactionHash: refundTx.hash, blockNumber: refundReceipt.blockNumber };

  const states = await Promise.all([escrow.getPayment(1), escrow.getPayment(2), escrow.getPayment(5)]);
  const stateNumbers = states.map(payment => BigInt(payment.state));
  const payerBalance = BigInt(await token.balanceOf(signer.address));
  const payeeBalance = BigInt(await token.balanceOf(payeeAddress));
  const escrowBalance = BigInt(await token.balanceOf(deployment.address));
  const liability = BigInt(await escrow.totalEscrowed(tokenAddress));
  if (
    stateNumbers[0] !== 2n ||
    stateNumbers[1] !== 2n ||
    stateNumbers[2] !== 3n ||
    escrowBalance !== 0n ||
    liability !== 0n
  ) {
    throw new Error("Final Testnet escrow state or token balance is inconsistent.");
  }

  async function relationship(contractAddress: string) {
    const contractResponse = await fetch(`${MIRROR_URL}/contracts/${contractAddress}`);
    const contractInfo = (await contractResponse.json()) as { contract_id?: string };
    if (!contractResponse.ok || !contractInfo.contract_id)
      throw new Error(`Mirror Node cannot resolve ${contractAddress}.`);
    const response = await fetch(
      `${MIRROR_URL}/accounts/${contractInfo.contract_id}/tokens?token.id=${tokenId}&limit=10`,
    );
    const body = (await response.json()) as { tokens?: Array<{ token_id: string; balance: number; decimals: number }> };
    const found = body.tokens?.find(item => item.token_id === tokenId);
    if (!response.ok || !found)
      throw new Error(`Mirror Node has no token relationship for ${contractInfo.contract_id}.`);
    return { contractId: contractInfo.contract_id, ...found };
  }

  const [escrowRelationship, payeeRelationship] = await Promise.all([
    relationship(deployment.address),
    relationship(payeeAddress),
  ]);
  if (escrowRelationship.balance !== 0 || payeeRelationship.balance !== Number(AMOUNT * 2n)) {
    throw new Error("Mirror Node balances do not match the completed release/refund flow.");
  }

  console.log(
    JSON.stringify(
      {
        network: hre.network.name,
        accountId,
        tokenId,
        tokenAddress,
        escrowAddress: deployment.address,
        payeeAddress,
        refundDeadline: refundDeadline.toString(),
        refundTransactionHash: refundTx.hash,
        refundBlock: refundReceipt.blockNumber,
        refundBlockTimestamp: refundBlock.timestamp,
        payerTokenBalance: payerBalance.toString(),
        payeeTokenBalance: payeeBalance.toString(),
        escrowTokenBalance: escrowBalance.toString(),
        totalEscrowed: liability.toString(),
        paymentStates: {
          release1: stateNumbers[0].toString(),
          release2: stateNumbers[1].toString(),
          refund5: stateNumbers[2].toString(),
        },
        transactions,
        mirrorNode: { escrow: escrowRelationship, payee: payeeRelationship },
      },
      null,
      2,
    ),
  );
}

main(hre).catch(error => {
  console.error(error instanceof Error ? error.message : "Testnet deadline refund diagnostic failed.");
  process.exitCode = 1;
});
