import { type CommerceAuditEvent, createCommerceClient } from "@hedera-commerce/sdk";
import "server-only";

export type ReferenceEvent = {
  event: CommerceAuditEvent;
  sequence: number;
  consensus: string;
  verified: boolean;
};

export async function getReferenceActivity(): Promise<{
  configured: boolean;
  error?: string;
  events: ReferenceEvent[];
}> {
  const topicId = process.env.HCS_TOPIC_ID?.trim();
  if (!topicId) return { configured: false, events: [] };
  const client = createCommerceClient({ network: "testnet", mirrorNode: { topicId } });
  try {
    const messages = await client.mirror!.getTopicMessages(topicId, 25).getAll();
    const events = await Promise.all(
      messages
        .filter(message => message.event)
        .map(async message => {
          const event = message.event!;
          try {
            const result = await client.mirror!.verifyCommerceEvent(event, {
              topicId,
              sequenceNumber: message.sequenceNumber,
            });
            return {
              event,
              sequence: message.sequenceNumber,
              consensus: message.consensusTimestamp,
              verified: result.settlement.located && result.hcs.located && result.sourceCoordinatesMatch,
            };
          } catch {
            return { event, sequence: message.sequenceNumber, consensus: message.consensusTimestamp, verified: false };
          }
        }),
    );
    return { configured: true, events };
  } catch {
    return {
      configured: true,
      events: [],
      error: "Retry shortly. Mirror Node may be rate limited or still indexing this topic.",
    };
  } finally {
    client.close();
  }
}
