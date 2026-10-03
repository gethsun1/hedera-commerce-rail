import * as dotenv from "dotenv";
import * as path from "path";
import { ethers } from "hardhat";
import type { Log, LogDescription } from "ethers";
import { createCommerceAuditEvent } from "../lib/hcs/schema";
import { publishConfiguredEvent } from "../lib/hcs/publisher";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const HBAR_ESCROW = "0x85a038f7FB8E01EBD6F0E5B02791E57Bfb6aa260";
const HTS_ESCROW = "0xa1069144BAc92E69634F8af332C92d053d9e72bb";
const HTS_FUND_TX = "0x5296e83324a35ac409f6342a57b0f79def3ec7f015bb3ce088075800fd3e7f69";

function findEvent(
  receipt: Awaited<ReturnType<typeof ethers.provider.getTransactionReceipt>>,
  contract: { interface: { parseLog(log: Log): LogDescription | null } },
  name: string,
) {
  if (!receipt) return undefined;
  for (const log of receipt.logs) {
    try {
      const description = contract.interface.parseLog(log);
      if (description?.name === name) return { log, description };
    } catch {
      // Receipts may contain token facade or unrelated contract logs.
    }
  }
  return undefined;
}

async function main() {
  if (process.env.HEDERA_NETWORK !== "testnet" || !process.env.HCS_TOPIC_ID) {
    throw new Error("HCS smoke validation requires HEDERA_NETWORK=testnet and an existing HCS_TOPIC_ID.");
  }
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 296n)
    throw new Error("Refusing HCS smoke validation unless connected to Hedera Testnet (chain ID 296).");
  const [payer] = await ethers.getSigners();
  const hbar = await ethers.getContractAt("PaymentEscrow", HBAR_ESCROW, payer);
  const payee = ethers.Wallet.createRandom().address;
  const amount = 1n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const createReceipt = await (await hbar.createPayment(payee, ethers.ZeroAddress, amount, deadline)).wait();
  if (!createReceipt) throw new Error("HBAR payment creation returned no receipt.");
  const createLog = findEvent(createReceipt, hbar, "PaymentCreated");
  if (!createLog) throw new Error("HBAR PaymentCreated event was not present in the source receipt.");
  const paymentId = createLog.description.args.paymentId as bigint;
  const fundingReceipt = await (await hbar.fundPayment(paymentId, { value: 10_000_000_000n })).wait();
  if (!fundingReceipt) throw new Error("HBAR payment funding returned no receipt.");
  const fundedLog = findEvent(fundingReceipt, hbar, "PaymentFunded");
  if (!fundedLog) throw new Error("HBAR PaymentFunded event was not present in the source receipt.");
  const block = await ethers.provider.getBlock(fundingReceipt.blockNumber);
  if (!block) throw new Error("Could not load the HBAR funding block timestamp.");
  const hbarEvent = createCommerceAuditEvent({
    eventType: "payment.funded",
    paymentId: String(fundedLog.description.args.paymentId),
    assetType: "HBAR",
    assetId: null,
    payer: String(fundedLog.description.args.payer),
    payee,
    amount: String(fundedLog.description.args.amount),
    contractAddress: HBAR_ESCROW,
    network: "hedera-testnet",
    sourceTxHash: fundingReceipt.hash,
    sourceBlockNumber: String(fundingReceipt.blockNumber),
    sourceLogIndex: fundedLog.log.index,
    occurredAt: new Date(block.timestamp * 1000).toISOString(),
    metadata: { validation: "testnet-smoke" },
  });
  let hbarResult: Awaited<ReturnType<typeof publishConfiguredEvent>> | undefined;
  let publishError: unknown;
  try {
    hbarResult = await publishConfiguredEvent(hbarEvent);
  } catch (error) {
    publishError = error;
  }
  const releaseReceipt = await (await hbar.releasePayment(paymentId)).wait();
  if (!releaseReceipt) throw new Error("HBAR smoke payment could not be fully settled after audit publication.");
  if (publishError) throw publishError;

  const tokenEscrow = await ethers.getContractAt("TokenPaymentEscrow", HTS_ESCROW, payer);
  const tokenReceipt = await ethers.provider.getTransactionReceipt(HTS_FUND_TX);
  if (!tokenReceipt) throw new Error("Previously validated M4 HTS funding transaction was not found on Testnet.");
  const tokenLog = findEvent(tokenReceipt, tokenEscrow, "TokenPaymentFunded");
  if (!tokenLog) throw new Error("M4 source receipt did not contain TokenPaymentFunded.");
  const tokenPaymentId = tokenLog.description.args.paymentId as bigint;
  const payment = await tokenEscrow.getPayment(tokenPaymentId);
  const tokenBlock = await ethers.provider.getBlock(tokenReceipt.blockNumber);
  if (!tokenBlock) throw new Error("Could not load the HTS funding block timestamp.");
  const htsEvent = createCommerceAuditEvent({
    eventType: "payment.funded",
    paymentId: String(tokenPaymentId),
    assetType: "HTS_FUNGIBLE",
    assetId: String(payment.token),
    payer: String(payment.payer),
    payee: String(payment.payee),
    amount: String(payment.amount),
    contractAddress: HTS_ESCROW,
    network: "hedera-testnet",
    sourceTxHash: tokenReceipt.hash,
    sourceBlockNumber: String(tokenReceipt.blockNumber),
    sourceLogIndex: tokenLog.log.index,
    occurredAt: new Date(tokenBlock.timestamp * 1000).toISOString(),
    metadata: { validation: "existing-m4-testnet-event" },
  });
  const htsResult = await publishConfiguredEvent(htsEvent);
  console.log(
    JSON.stringify(
      {
        hbar: { event: hbarEvent, hcs: hbarResult, settlementTx: releaseReceipt.hash },
        hts: { event: htsEvent, hcs: htsResult },
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "HCS smoke validation failed.");
  process.exitCode = 1;
});
