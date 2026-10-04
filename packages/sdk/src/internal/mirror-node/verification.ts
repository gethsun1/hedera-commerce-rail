import { createEventId, type CommerceAuditEvent } from "../hcs/schema";
import type {
  MirrorContractLog,
  MirrorContractResult,
  MirrorTopicMessage,
} from "./client";
import { createMirrorNodeClient, MirrorNodeError } from "./client";

export type SettlementLocation = {
  located: boolean;
  eventId: string;
  network: CommerceAuditEvent["network"];
  sourceTxHash: string;
  contractAddress: string;
  logIndex: number;
  transaction: MirrorContractResult | null;
  log: MirrorContractLog | null;
};
export type HcsLocation = {
  located: boolean;
  eventId: string;
  topicId: string;
  sequenceNumber: number | null;
  message: MirrorTopicMessage | null;
};

export async function locateSettlementEvent(
  client: ReturnType<typeof createMirrorNodeClient>,
  event: CommerceAuditEvent,
): Promise<SettlementLocation> {
  const expectedId = createEventId(event);
  if (event.eventId !== expectedId)
    throw new MirrorNodeError(
      "INVALID_REQUEST",
      "Commerce event ID does not match its settlement source coordinates.",
    );
  if (event.network !== `hedera-${client.config.network}`) {
    throw new MirrorNodeError(
      "INVALID_REQUEST",
      "Commerce event network does not match the configured Mirror Node network.",
    );
  }
  const contractResult = await client.getContractResults(event.sourceTxHash);
  const log =
    contractResult.logs.find(
      (candidate) =>
        candidate.transactionHash?.toLowerCase() ===
          event.sourceTxHash.toLowerCase() &&
        candidate.contractAddress.toLowerCase() ===
          event.contractAddress.toLowerCase() &&
        candidate.logIndex === event.sourceLogIndex,
    ) ?? null;
  return {
    located: log !== null,
    eventId: expectedId,
    network: event.network,
    sourceTxHash: event.sourceTxHash,
    contractAddress: event.contractAddress,
    logIndex: event.sourceLogIndex,
    transaction:
      contractResult.transactionHash?.toLowerCase() ===
      event.sourceTxHash.toLowerCase()
        ? contractResult
        : null,
    log,
  };
}

export async function locateHcsEvent(
  client: ReturnType<typeof createMirrorNodeClient>,
  input: {
    eventId: string;
    topicId: string;
    sequenceNumber?: number;
    limit?: number;
  },
): Promise<HcsLocation> {
  if (!/^0x[0-9a-f]{64}$/i.test(input.eventId))
    throw new Error("Commerce event ID must be a 32-byte hex value.");
  const messages =
    input.sequenceNumber !== undefined
      ? [await client.getTopicMessage(input.topicId, input.sequenceNumber)]
      : await client
          .getTopicMessages(input.topicId, input.limit ?? 100)
          .getAll();
  const message =
    messages.find(
      (candidate) =>
        candidate.event?.eventId.toLowerCase() === input.eventId.toLowerCase(),
    ) ?? null;
  return {
    located: message !== null,
    eventId: input.eventId,
    topicId: input.topicId,
    sequenceNumber: message?.sequenceNumber ?? null,
    message,
  };
}

export async function correlateCommerceEvent(
  client: ReturnType<typeof createMirrorNodeClient>,
  event: CommerceAuditEvent,
  hcs: { topicId: string; sequenceNumber?: number; limit?: number },
) {
  const [settlement, audit] = await Promise.all([
    locateSettlementEvent(client, event),
    locateHcsEvent(client, { ...hcs, eventId: event.eventId }),
  ]);
  const messageCoordinatesMatch =
    audit.message?.event?.sourceTxHash.toLowerCase() ===
      event.sourceTxHash.toLowerCase() &&
    audit.message.event.contractAddress.toLowerCase() ===
      event.contractAddress.toLowerCase() &&
    audit.message.event.sourceLogIndex === event.sourceLogIndex;
  return {
    eventId: event.eventId,
    settlement,
    hcs: audit,
    sourceCoordinatesMatch: messageCoordinatesMatch === true,
  };
}
