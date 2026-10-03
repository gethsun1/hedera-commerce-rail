import * as dotenv from "dotenv";
import * as path from "path";
import { createHcsTopic } from "../lib/hcs/publisher";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

async function main() {
  if (process.env.HEDERA_NETWORK !== "testnet")
    throw new Error("Topic provisioning is restricted to HEDERA_NETWORK=testnet in this scaffold.");
  if (process.env.HCS_TOPIC_ID)
    throw new Error(
      "HCS_TOPIC_ID is already configured. Reuse that topic; clear it explicitly before provisioning another.",
    );
  const visibility = process.env.HCS_TOPIC_SUBMIT_KEY ? "private" : "public";
  const result = await createHcsTopic(`Hedera Commerce Rail M5 audit schema v1 (${visibility})`);
  console.log(`Created ${visibility} HCS topic ${result.topicId}; transaction ${result.transactionId}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "HCS topic provisioning failed.");
  process.exitCode = 1;
});
