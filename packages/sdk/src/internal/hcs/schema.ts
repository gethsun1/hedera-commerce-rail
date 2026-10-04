import { createHash } from "crypto";

export const COMMERCE_EVENT_TYPES = [
  "payment.created",
  "payment.funded",
  "payment.released",
  "payment.refunded",
] as const;

export type CommerceEventType = (typeof COMMERCE_EVENT_TYPES)[number];
export type CommerceAuditEvent = {
  schemaVersion: 1;
  eventId: string;
  eventType: CommerceEventType;
  paymentId: string;
  assetType: "HBAR" | "HTS_FUNGIBLE";
  assetId: string | null;
  payer: string;
  payee: string;
  amount: string;
  contractAddress: string;
  network: "hedera-testnet" | "hedera-mainnet";
  sourceTxHash: string;
  sourceBlockNumber: string;
  sourceLogIndex: number;
  occurredAt: string;
  metadata: Record<string, string | number | boolean | null>;
};

export type CommerceAuditEventInput = Omit<
  CommerceAuditEvent,
  "schemaVersion" | "eventId"
>;
export type EscrowPaymentSnapshot = Pick<
  CommerceAuditEventInput,
  "paymentId" | "payer" | "payee" | "amount" | "assetType" | "assetId"
>;
export type EscrowSourceLog = {
  eventName: string;
  paymentId: string;
  contractAddress: string;
  network: CommerceAuditEventInput["network"];
  sourceTxHash: string;
  sourceBlockNumber: string;
  sourceLogIndex: number;
  occurredAt: string;
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const TOPIC_ID = /^\d+\.\d+\.\d+$/;

export function createEventId(
  input: Pick<
    CommerceAuditEventInput,
    "network" | "sourceTxHash" | "contractAddress" | "sourceLogIndex"
  >,
): string {
  const identity = [
    input.network,
    input.sourceTxHash.toLowerCase(),
    input.contractAddress.toLowerCase(),
    input.sourceLogIndex,
  ].join(":");
  return `0x${createHash("sha256").update(identity).digest("hex")}`;
}

export function createCommerceAuditEvent(
  input: CommerceAuditEventInput,
): CommerceAuditEvent {
  if (!(COMMERCE_EVENT_TYPES as readonly string[]).includes(input.eventType))
    throw new Error("Unsupported commerce event type.");
  if (
    !/^\d+$/.test(input.paymentId) ||
    !/^\d+$/.test(input.amount) ||
    !/^\d+$/.test(input.sourceBlockNumber)
  ) {
    throw new Error(
      "Payment ID, amount, and source block number must be unsigned integer strings.",
    );
  }
  if (
    !ADDRESS.test(input.payer) ||
    !ADDRESS.test(input.payee) ||
    !ADDRESS.test(input.contractAddress)
  ) {
    throw new Error(
      "Payer, payee, and contract address must be EVM addresses.",
    );
  }
  if (
    !HASH.test(input.sourceTxHash) ||
    !Number.isSafeInteger(input.sourceLogIndex) ||
    input.sourceLogIndex < 0
  ) {
    throw new Error("Source transaction hash or log index is invalid.");
  }
  if (input.assetType === "HBAR") {
    if (input.assetId !== null)
      throw new Error("HBAR events must use a null asset ID.");
  } else if (input.assetType === "HTS_FUNGIBLE") {
    if (typeof input.assetId !== "string" || !ADDRESS.test(input.assetId))
      throw new Error("HTS events require the token EVM address as asset ID.");
  } else {
    throw new Error("Unsupported settlement asset type.");
  }
  if (!Number.isFinite(Date.parse(input.occurredAt)))
    throw new Error("Occurrence time must be an ISO-compatible timestamp.");
  if (
    !input.metadata ||
    Array.isArray(input.metadata) ||
    typeof input.metadata !== "object"
  )
    throw new Error("Metadata must be an object.");
  if (input.network !== "hedera-testnet" && input.network !== "hedera-mainnet")
    throw new Error("Unsupported Hedera network.");
  if (
    Object.values(input.metadata).some(
      (value) =>
        value !== null &&
        !["string", "number", "boolean"].includes(typeof value),
    )
  ) {
    throw new Error("Metadata values must be scalar JSON values.");
  }

  const event = {
    schemaVersion: 1 as const,
    eventId: createEventId(input),
    ...input,
  };
  if (Buffer.byteLength(JSON.stringify(event), "utf8") > 1024)
    throw new Error(
      "Commerce audit event exceeds the single-message 1024-byte limit.",
    );
  return event;
}

/** Normalize an already confirmed escrow EVM log, enriched with terms read at that block. */
export function normalizeEscrowLog(
  log: EscrowSourceLog,
  payment: EscrowPaymentSnapshot,
): CommerceAuditEvent {
  const eventTypes: Record<string, CommerceEventType> = {
    PaymentCreated: "payment.created",
    TokenPaymentCreated: "payment.created",
    PaymentFunded: "payment.funded",
    TokenPaymentFunded: "payment.funded",
    PaymentReleased: "payment.released",
    TokenPaymentReleased: "payment.released",
    PaymentRefunded: "payment.refunded",
    TokenPaymentRefunded: "payment.refunded",
  };
  const eventType = eventTypes[log.eventName];
  if (!eventType) throw new Error("Unsupported escrow source event.");
  if (log.paymentId !== payment.paymentId)
    throw new Error(
      "Escrow log payment ID does not match the resolved on-chain payment.",
    );
  return createCommerceAuditEvent({
    eventType,
    paymentId: payment.paymentId,
    assetType: payment.assetType,
    assetId: payment.assetId,
    payer: payment.payer,
    payee: payment.payee,
    amount: payment.amount,
    contractAddress: log.contractAddress,
    network: log.network,
    sourceTxHash: log.sourceTxHash,
    sourceBlockNumber: log.sourceBlockNumber,
    sourceLogIndex: log.sourceLogIndex,
    occurredAt: log.occurredAt,
    metadata: {},
  });
}

export function parseCommerceAuditEvent(message: string): CommerceAuditEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    throw new Error("Commerce audit message is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object")
    throw new Error("Commerce audit message must be an object.");
  const candidate = parsed as Partial<CommerceAuditEvent>;
  if (candidate.schemaVersion !== 1)
    throw new Error("Unsupported commerce audit schema version.");
  const input = { ...candidate };
  delete input.schemaVersion;
  delete input.eventId;
  const validated = createCommerceAuditEvent(input as CommerceAuditEventInput);
  if (candidate.eventId !== validated.eventId)
    throw new Error(
      "Commerce audit event identity does not match its source coordinates.",
    );
  return validated;
}

export function validateTopicId(topicId: string): string {
  if (!TOPIC_ID.test(topicId))
    throw new Error(
      "HCS topic ID must use the numeric shard.realm.number format.",
    );
  return topicId;
}
