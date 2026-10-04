import {
  Client,
  PublicKey,
  TopicCreateTransaction,
  TopicId,
  TopicMessageSubmitTransaction,
} from "@hiero-ledger/sdk";
import { createHederaClient, readHederaEnvironment } from "../hedera/config";
import {
  CommerceAuditEvent,
  parseCommerceAuditEvent,
  validateTopicId,
} from "./schema";

export type HcsPublisherConfig = {
  network: "testnet" | "mainnet";
  topicId: string;
};
export type HcsPublishResult = {
  eventId: string;
  topicId: string;
  transactionId: string;
  sequenceNumber?: string;
};

export function readHcsPublisherConfig(
  env: NodeJS.ProcessEnv = process.env,
): HcsPublisherConfig {
  if (env.HEDERA_NETWORK !== "testnet" && env.HEDERA_NETWORK !== "mainnet") {
    throw new Error(
      "HEDERA_NETWORK must be explicitly set to testnet or mainnet for HCS publishing.",
    );
  }
  if (env.HEDERA_NETWORK === "mainnet" && env.HCS_ALLOW_MAINNET !== "true") {
    throw new Error(
      "Mainnet HCS publishing is disabled unless HCS_ALLOW_MAINNET=true is explicitly configured.",
    );
  }
  const topicId = env.HCS_TOPIC_ID;
  if (!topicId) throw new Error("HCS_TOPIC_ID is required for HCS publishing.");
  validateTopicId(topicId);
  return { network: env.HEDERA_NETWORK, topicId };
}

export function readHcsTopicSubmitKey(
  env: NodeJS.ProcessEnv = process.env,
): PublicKey | undefined {
  if (!env.HCS_TOPIC_SUBMIT_KEY) return undefined;
  try {
    return PublicKey.fromString(env.HCS_TOPIC_SUBMIT_KEY.replace(/^0x/i, ""));
  } catch {
    throw new Error(
      "HCS_TOPIC_SUBMIT_KEY must be a valid DER or raw public key; its value is not displayed.",
    );
  }
}

type SubmitMessage = (
  topicId: string,
  message: string,
) => Promise<HcsPublishResult>;

export function createHcsPublisher(
  client: Client,
  config: HcsPublisherConfig,
  submit?: SubmitMessage,
) {
  validateTopicId(config.topicId);
  const inFlight = new Map<string, Promise<HcsPublishResult>>();
  const published = new Set<string>();

  return {
    async publish(event: CommerceAuditEvent): Promise<HcsPublishResult> {
      const validated = parseCommerceAuditEvent(JSON.stringify(event));
      if (validated.network !== `hedera-${config.network}`) {
        throw new Error(
          "Commerce event network does not match the configured HCS network.",
        );
      }
      const previous = inFlight.get(validated.eventId);
      if (previous) return previous;
      if (published.has(validated.eventId))
        throw new Error(
          `Commerce event ${validated.eventId} was already published by this process.`,
        );
      const operation = (async () => {
        const result = submit
          ? await submit(config.topicId, JSON.stringify(validated))
          : await (async () => {
              const response = await new TopicMessageSubmitTransaction()
                .setTopicId(TopicId.fromString(config.topicId))
                .setMessage(JSON.stringify(validated))
                .execute(client);
              const receipt = await response.getReceipt(client);
              const sequenceNumber = receipt.topicSequenceNumber?.toString();
              return {
                eventId: validated.eventId,
                topicId: config.topicId,
                transactionId: response.transactionId.toString(),
                ...(sequenceNumber ? { sequenceNumber } : {}),
              };
            })();
        published.add(validated.eventId);
        return result;
      })();
      inFlight.set(validated.eventId, operation);
      try {
        return await operation;
      } finally {
        inFlight.delete(validated.eventId);
      }
    },
  };
}

export async function createHcsTopic(
  memo = "Hedera Commerce Rail audit schema v1",
) {
  const environment = readHederaEnvironment();
  if (environment.network === "local")
    throw new Error(
      "HCS topic provisioning requires Hedera Testnet or Mainnet.",
    );
  const client = createHederaClient(environment);
  try {
    const createTransaction = new TopicCreateTransaction().setTopicMemo(memo);
    const submitKey = readHcsTopicSubmitKey();
    if (submitKey) createTransaction.setSubmitKey(submitKey);
    const response = await createTransaction.execute(client);
    const receipt = await response.getReceipt(client);
    if (!receipt.topicId)
      throw new Error(
        "HCS topic creation succeeded without returning a topic ID.",
      );
    return {
      topicId: receipt.topicId.toString(),
      transactionId: response.transactionId.toString(),
    };
  } finally {
    client.close();
  }
}

export async function publishConfiguredEvent(event: CommerceAuditEvent) {
  const config = readHcsPublisherConfig();
  const environment = readHederaEnvironment();
  if (
    environment.network !== config.network ||
    !environment.accountId ||
    !environment.privateKey
  ) {
    throw new Error("HCS network and operator configuration are inconsistent.");
  }
  const client = createHederaClient(environment);
  try {
    return await createHcsPublisher(client, config).publish(event);
  } finally {
    client.close();
  }
}
