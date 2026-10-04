import { NextResponse } from "next/server";
import hbarArtifact from "../../../../hardhat/deployments/hederaTestnet/PaymentEscrow.json";
import htsArtifact from "../../../../hardhat/deployments/hederaTestnet/TokenPaymentEscrow.json";
import { createAuditAuthorizationMessage } from "@hedera-commerce/sdk/browser";
import { createCommerceClient, createCommerceReader, normalizeEscrowLog } from "@hedera-commerce/sdk/server";
import { Interface, JsonRpcProvider, type Log, verifyMessage } from "ethers";
import "server-only";

const contracts = {
  HBAR: "0x85a038f7FB8E01EBD6F0E5B02791E57Bfb6aa260",
  HTS_FUNGIBLE: "0xa1069144BAc92E69634F8af332C92d053d9e72bb",
} as const;
const hashPattern = /^0x[\da-f]{64}$/i;
const idPattern = /^\d+$/;

/** Reconstruct and publish an audit event only after Mirror Node confirms the actual escrow log. */
export async function POST(request: Request) {
  let phase: "verify" | "mirror" | "publish" = "verify";
  let eventId: string | undefined;
  try {
    const origin = request.headers.get("origin");
    if (!origin || new URL(origin).host !== new URL(request.url).host) {
      return NextResponse.json({ error: "Cross-origin audit requests are not accepted." }, { status: 403 });
    }
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const input = body as Record<string, unknown>;
    const txHash = input.transactionHash;
    const paymentId = input.paymentId;
    const assetType = input.assetType;
    const signature = input.signature;
    if (
      typeof txHash !== "string" ||
      !hashPattern.test(txHash) ||
      typeof paymentId !== "string" ||
      !idPattern.test(paymentId) ||
      (assetType !== "HBAR" && assetType !== "HTS_FUNGIBLE") ||
      typeof signature !== "string" ||
      !/^0x[\da-f]+$/i.test(signature)
    ) {
      return NextResponse.json({ error: "Transaction, payment, or asset is invalid." }, { status: 400 });
    }
    const contractAddress = contracts[assetType];
    if (
      typeof input.contractAddress !== "string" ||
      input.contractAddress.toLowerCase() !== contractAddress.toLowerCase()
    ) {
      return NextResponse.json({ error: "Unknown escrow contract." }, { status: 400 });
    }
    const topicId = process.env.HCS_TOPIC_ID?.trim();
    if (!topicId || !process.env.HEDERA_ACCOUNT_ID || !process.env.HEDERA_PRIVATE_KEY) {
      return NextResponse.json({ status: "failed", error: "Server HCS publisher is not configured." }, { status: 503 });
    }

    const artifact = assetType === "HBAR" ? hbarArtifact : htsArtifact;
    const iface = new Interface(artifact.abi);
    const rpc = new JsonRpcProvider(process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api");
    const reader = createCommerceReader({
      network: "testnet",
      rpcUrl: process.env.HEDERA_RPC_URL,
      contracts: { hbar: contracts.HBAR, hts: contracts.HTS_FUNGIBLE },
    });
    const mirror = createCommerceClient({ network: "testnet", mirrorNode: { topicId } });
    try {
      const receipt = await rpc.getTransactionReceipt(txHash);
      if (!receipt || receipt.status !== 1)
        return NextResponse.json({
          status: "pending",
          error: "Mirror Node or RPC has not indexed a successful settlement yet.",
        });
      if (receipt.to?.toLowerCase() !== contractAddress.toLowerCase())
        return NextResponse.json({ error: "Transaction did not call the configured escrow." }, { status: 400 });
      const authorizedAccount = verifyMessage(
        createAuditAuthorizationMessage({ transactionHash: txHash, contractAddress, paymentId, assetType }),
        signature,
      );
      if (authorizedAccount.toLowerCase() !== receipt.from.toLowerCase())
        return NextResponse.json(
          { error: "Audit request must be signed by the wallet that submitted the settlement." },
          { status: 403 },
        );
      phase = "mirror";
      const mirrorResult = await mirror.mirror!.getContractResults(txHash);
      if (!mirrorResult.transactionHash || mirrorResult.transactionHash.toLowerCase() !== txHash.toLowerCase()) {
        return NextResponse.json({ status: "pending", error: "Mirror Node indexing pending." });
      }
      const source = receipt.logs.find((log: Log) => {
        if (log.address.toLowerCase() !== contractAddress.toLowerCase()) return false;
        try {
          const parsed = iface.parseLog(log);
          return (
            (parsed?.args.paymentId?.toString() === paymentId &&
              /^Payment(Created|Funded|Released|Refunded)$/.test(parsed?.name ?? "")) ||
            (parsed?.args.paymentId?.toString() === paymentId &&
              /^TokenPayment(Created|Funded|Released|Refunded)$/.test(parsed?.name ?? ""))
          );
        } catch {
          return false;
        }
      });
      if (!source)
        return NextResponse.json(
          { error: "No matching confirmed escrow event exists in this transaction." },
          { status: 400 },
        );
      const mirrored = mirrorResult.logs.find(
        log =>
          log.logIndex === source.index &&
          log.contractAddress.toLowerCase() === contractAddress.toLowerCase() &&
          log.transactionHash?.toLowerCase() === txHash.toLowerCase(),
      );
      const parsed = iface.parseLog(source);
      if (!parsed) return NextResponse.json({ status: "pending", error: "Contract log could not be decoded." });
      if (
        !mirrored?.decodedEvent ||
        mirrored.decodedEvent.name !== parsed.name ||
        mirrored.decodedEvent.args.paymentId !== paymentId
      )
        return NextResponse.json({ status: "pending", error: "Mirror Node contract log indexing pending." });
      const payment = await reader.readPayment(assetType === "HBAR" ? "hbar" : "hts", paymentId);
      const assetId = payment.tokenAddress;
      const block = await rpc.getBlock(receipt.blockNumber);
      if (!block)
        return NextResponse.json({ status: "pending", error: "Settlement block timestamp is not available yet." });
      const event = normalizeEscrowLog(
        {
          eventName: parsed.name,
          paymentId,
          contractAddress,
          network: "hedera-testnet",
          sourceTxHash: txHash,
          sourceBlockNumber: String(receipt.blockNumber),
          sourceLogIndex: source.index,
          occurredAt: new Date(block.timestamp * 1000).toISOString(),
        },
        {
          paymentId,
          payer: payment.payer,
          payee: payment.payee,
          amount: payment.amount,
          assetType,
          assetId,
        },
      );
      eventId = event.eventId;
      const located = await mirror.mirror!.locateSettlementEvent(event);
      if (!located.located)
        return NextResponse.json({ status: "pending", eventId: event.eventId, error: "Mirror Node indexing pending." });

      const publisher = createCommerceClient({
        network: "testnet",
        hcs: { topicId, accountId: process.env.HEDERA_ACCOUNT_ID, privateKey: process.env.HEDERA_PRIVATE_KEY },
      });
      try {
        phase = "mirror";
        const prior = await mirror.mirror!.locateHcsEvent({ eventId: event.eventId, topicId });
        let published;
        if (prior.located) {
          published = {
            eventId: event.eventId,
            topicId,
            transactionId: prior.message?.transactionId ?? "already-published",
            sequenceNumber: String(prior.sequenceNumber),
          };
        } else {
          phase = "publish";
          published = await publisher.audit.publish(event);
        }
        const indexed = published.sequenceNumber
          ? await mirror
              .mirror!.locateHcsEvent({
                eventId: event.eventId,
                topicId,
                sequenceNumber: Number(published.sequenceNumber),
              })
              .catch(() => null)
          : null;
        return NextResponse.json({
          status: "published",
          event,
          publication: published,
          mirrorNode: "located",
          consensusTimestamp: indexed?.message?.consensusTimestamp ?? null,
        });
      } finally {
        publisher.close();
      }
    } finally {
      mirror.close();
      reader.close();
      await rpc.destroy();
    }
  } catch (error) {
    return NextResponse.json(
      {
        status: phase === "mirror" ? "pending" : "failed",
        ...(eventId ? { eventId } : {}),
        error:
          phase === "mirror"
            ? "Mirror Node indexing or lookup is pending. Retry shortly."
            : error instanceof Error
              ? error.message
              : "Audit publication failed.",
      },
      { status: 503 },
    );
  }
}
