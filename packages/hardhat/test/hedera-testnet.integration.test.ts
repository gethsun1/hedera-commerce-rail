import { AccountInfoQuery } from "@hiero-ledger/sdk";
import { expect } from "chai";
import { createHederaClient, readHederaEnvironment } from "../lib/hedera/config";

const enabled = process.env.HEDERA_TESTNET_INTEGRATION === "true";

(enabled ? describe : describe.skip)("Hedera Testnet read-only integration", () => {
  it("retrieves account information for the configured Testnet account", async () => {
    const environment = readHederaEnvironment();
    if (environment.network !== "testnet" || !environment.accountId) {
      throw new Error("Set HEDERA_NETWORK=testnet and configure the Testnet account before enabling this check.");
    }

    const client = createHederaClient(environment);
    try {
      const info = await new AccountInfoQuery().setAccountId(environment.accountId).execute(client);
      expect(info.accountId.toString()).to.equal(environment.accountId.toString());
    } finally {
      client.close();
    }
  });
});
