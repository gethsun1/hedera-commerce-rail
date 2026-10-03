import { expect } from "chai";
import { createHederaClient, parseHederaNetwork, readHederaEnvironment } from "../lib/hedera/config";

describe("Hedera connection configuration", () => {
  it("accepts supported network names and rejects unknown values", () => {
    expect(parseHederaNetwork("testnet")).to.equal("testnet");
    expect(parseHederaNetwork("mainnet")).to.equal("mainnet");
    expect(parseHederaNetwork("local")).to.equal("local");
    expect(() => parseHederaNetwork("previewnet")).to.throw("Unsupported HEDERA_NETWORK");
    expect(() => parseHederaNetwork(undefined)).to.throw("HEDERA_NETWORK is required");
  });

  it("requires a valid account and key on public networks", () => {
    expect(() => readHederaEnvironment({ HEDERA_NETWORK: "testnet" })).to.throw(
      "HEDERA_ACCOUNT_ID is required when HEDERA_NETWORK=testnet",
    );
    expect(() => readHederaEnvironment({ HEDERA_NETWORK: "testnet", HEDERA_ACCOUNT_ID: "0.0.123" })).to.throw(
      "HEDERA_PRIVATE_KEY is required when HEDERA_NETWORK=testnet",
    );
    expect(() =>
      readHederaEnvironment({
        HEDERA_NETWORK: "testnet",
        HEDERA_ACCOUNT_ID: "not-an-account",
        HEDERA_PRIVATE_KEY: "not-a-key",
      }),
    ).to.throw("HEDERA_ACCOUNT_ID must be a valid");
  });

  it("never includes the supplied secret in an error and allows local credentials-free setup", () => {
    const secret = "definitely-not-a-key";
    let message = "";
    try {
      readHederaEnvironment({ HEDERA_NETWORK: "testnet", HEDERA_ACCOUNT_ID: "0.0.123", HEDERA_PRIVATE_KEY: secret });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).to.contain("HEDERA_PRIVATE_KEY is malformed");
    expect(message).not.to.contain(secret);
    expect(readHederaEnvironment({ HEDERA_NETWORK: "local" }).network).to.equal("local");
    expect(Boolean(createHederaClient({ network: "local" }))).to.equal(true);
  });
});
