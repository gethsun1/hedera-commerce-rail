import { expect } from "chai";
import { createCommerceAuditEvent, normalizeEscrowLog, parseCommerceAuditEvent } from "../lib/hcs/schema";
import { createHcsPublisher, readHcsPublisherConfig, readHcsTopicSubmitKey } from "../lib/hcs/publisher";
import { PrivateKey } from "@hiero-ledger/sdk";

const base = {
  eventType: "payment.funded" as const,
  paymentId: "12",
  assetType: "HBAR" as const,
  assetId: null,
  payer: "0x1111111111111111111111111111111111111111",
  payee: "0x2222222222222222222222222222222222222222",
  amount: "100000000",
  contractAddress: "0x3333333333333333333333333333333333333333",
  network: "hedera-testnet" as const,
  sourceTxHash: `0x${"a".repeat(64)}`,
  sourceBlockNumber: "12345",
  sourceLogIndex: 2,
  occurredAt: "2026-10-03T00:00:00.000Z",
  metadata: {},
};

describe("HCS commerce audit schema", () => {
  it("validates and parses HBAR and HTS events while preserving distinct asset identity", () => {
    const hbar = createCommerceAuditEvent(base);
    const hts = createCommerceAuditEvent({
      ...base,
      assetType: "HTS_FUNGIBLE",
      assetId: "0x4444444444444444444444444444444444444444",
    });
    expect(parseCommerceAuditEvent(JSON.stringify(hbar))).to.deep.equal(hbar);
    expect(hts.assetId).to.equal("0x4444444444444444444444444444444444444444");
    expect(hbar.assetId).to.equal(null);
  });

  it("rejects missing, malformed, unsupported and mismatched-version data", () => {
    expect(() => createCommerceAuditEvent({ ...base, eventType: "other" as never })).to.throw(
      "Unsupported commerce event type",
    );
    expect(() => createCommerceAuditEvent({ ...base, payer: "" })).to.throw("must be EVM addresses");
    expect(() => createCommerceAuditEvent({ ...base, amount: "-1" })).to.throw("unsigned integer strings");
    const valid = createCommerceAuditEvent(base);
    expect(() => parseCommerceAuditEvent(JSON.stringify({ ...valid, schemaVersion: 2 }))).to.throw(
      "Unsupported commerce audit schema version",
    );
    expect(() => parseCommerceAuditEvent(JSON.stringify({ ...valid, eventId: "wrong" }))).to.throw(
      "identity does not match",
    );
  });

  it("derives stable identity from reconstructable network, tx, contract, and log coordinates", () => {
    expect(createCommerceAuditEvent(base).eventId).to.equal(createCommerceAuditEvent(base).eventId);
    expect(createCommerceAuditEvent({ ...base, sourceLogIndex: 3 }).eventId).not.to.equal(
      createCommerceAuditEvent(base).eventId,
    );
  });

  it("normalizes both contract event families using their on-chain payment terms", () => {
    const log = {
      paymentId: base.paymentId,
      contractAddress: base.contractAddress,
      network: base.network,
      sourceTxHash: base.sourceTxHash,
      sourceBlockNumber: base.sourceBlockNumber,
      sourceLogIndex: base.sourceLogIndex,
      occurredAt: base.occurredAt,
    };
    const normalized = normalizeEscrowLog(
      { ...log, eventName: "TokenPaymentFunded" },
      {
        paymentId: base.paymentId,
        payer: base.payer,
        payee: base.payee,
        amount: base.amount,
        assetType: "HTS_FUNGIBLE",
        assetId: "0x4444444444444444444444444444444444444444",
      },
    );
    expect(normalized.eventType).to.equal("payment.funded");
    expect(normalized.assetType).to.equal("HTS_FUNGIBLE");
    expect(() =>
      normalizeEscrowLog(
        { ...log, eventName: "EscrowTokenAssociated" },
        {
          paymentId: base.paymentId,
          payer: base.payer,
          payee: base.payee,
          amount: base.amount,
          assetType: base.assetType,
          assetId: null,
        },
      ),
    ).to.throw("Unsupported escrow source event");
    expect(() =>
      normalizeEscrowLog(
        { ...log, eventName: "PaymentFunded", paymentId: "13" },
        {
          paymentId: base.paymentId,
          payer: base.payer,
          payee: base.payee,
          amount: base.amount,
          assetType: base.assetType,
          assetId: null,
        },
      ),
    ).to.throw("does not match");
  });
});

describe("HCS publisher", () => {
  it("validates configuration and topic IDs without revealing secrets", () => {
    expect(() => readHcsPublisherConfig({ HEDERA_NETWORK: "testnet", HCS_TOPIC_ID: "1.2" })).to.throw(
      "numeric shard.realm.number",
    );
    expect(() => readHcsPublisherConfig({ HEDERA_NETWORK: "local", HCS_TOPIC_ID: "0.0.1" })).to.throw("explicitly set");
    expect(() => readHcsPublisherConfig({ HEDERA_NETWORK: "testnet" })).to.throw("HCS_TOPIC_ID is required");
  });

  it("supports an optional private-topic submit public key without exposing malformed key input", () => {
    const privateKey = PrivateKey.generateECDSA();
    expect(readHcsTopicSubmitKey({ HCS_TOPIC_SUBMIT_KEY: privateKey.publicKey.toStringRaw() })?.toStringRaw()).to.equal(
      privateKey.publicKey.toStringRaw(),
    );
    const invalid = "not-a-public-key";
    expect(() => readHcsTopicSubmitKey({ HCS_TOPIC_SUBMIT_KEY: invalid })).to.throw(
      "must be a valid DER or raw public key",
    );
  });

  it("publishes a validated event and prevents a second in-process submission", async () => {
    let count = 0;
    const publisher = createHcsPublisher(
      {} as never,
      { network: "testnet", topicId: "0.0.123" },
      async (_topic, message) => {
        count += 1;
        expect(parseCommerceAuditEvent(message).eventType).to.equal("payment.funded");
        return { eventId: createCommerceAuditEvent(base).eventId, topicId: "0.0.123", transactionId: "0.0.1@1.2" };
      },
    );
    const event = createCommerceAuditEvent(base);
    expect((await publisher.publish(event)).topicId).to.equal("0.0.123");
    await expect(publisher.publish(event)).to.be.rejectedWith("already published");
    expect(count).to.equal(1);
  });

  it("refuses to send an event to a topic on a different Hedera network", async () => {
    const publisher = createHcsPublisher({} as never, { network: "mainnet", topicId: "0.0.123" }, async () => {
      throw new Error("submit must not be called");
    });
    await expect(publisher.publish(createCommerceAuditEvent(base))).to.be.rejectedWith("does not match");
  });

  it("surfaces submit errors and permits a deliberate retry", async () => {
    let fail = true;
    const publisher = createHcsPublisher({} as never, { network: "testnet", topicId: "0.0.123" }, async () => {
      if (fail) throw new Error("network unavailable");
      return { eventId: createCommerceAuditEvent(base).eventId, topicId: "0.0.123", transactionId: "0.0.1@1.2" };
    });
    const event = createCommerceAuditEvent(base);
    await expect(publisher.publish(event)).to.be.rejectedWith("network unavailable");
    fail = false;
    expect((await publisher.publish(event)).eventId).to.equal(event.eventId);
  });
});
