import { expect } from "chai";
import { Wallet } from "ethers";
import {
  createCommerceClient,
  type CommerceAuditEventInput,
  type CommerceClientConfig,
  type HtsFungibleAsset,
} from "../src";
import {
  AuditError,
  ConfigurationError,
  SettlementError,
  ValidationError,
} from "../src/errors";
import type { SettlementResult } from "../src";
import { createCommerceClientWithAdapters } from "../src/internal/test-factory";

const payerKey = Wallet.createRandom().privateKey;
const token: HtsFungibleAsset = {
  type: "HTS_FUNGIBLE",
  tokenId: "0.0.12345",
  tokenAddress: "0x0000000000000000000000000000000000003039",
};
const baseEvent = {
  eventType: "payment.funded",
  paymentId: "7",
  assetType: "HBAR",
  assetId: null,
  payer: "0x1111111111111111111111111111111111111111",
  payee: "0x2222222222222222222222222222222222222222",
  amount: "10",
  contractAddress: "0x3333333333333333333333333333333333333333",
  network: "hedera-testnet",
  sourceTxHash: `0x${"44".repeat(32)}`,
  sourceBlockNumber: "12",
  sourceLogIndex: 1,
  occurredAt: "2026-10-04T00:00:00.000Z",
  metadata: {},
} as CommerceAuditEventInput;

describe("Commerce SDK", () => {
  it("constructs independent capabilities and serializes no signer material", () => {
    const client = createCommerceClient({
      network: "testnet",
      settlement: {
        rpcUrl: "https://testnet.hashio.io/api",
        privateKey: payerKey,
        contracts: { hbar: token.tokenAddress, hts: token.tokenAddress },
      },
      mirrorNode: {},
    });
    expect(client.network).eq("testnet");
    expect(Boolean(client.mirror)).eq(true);
    expect(JSON.stringify(client)).not.include(payerKey);
    expect(JSON.stringify(client)).not.include("privateKey");
    client.close();
  });

  it("requires explicit signer configuration only when a settlement call is attempted", async () => {
    const client = createCommerceClient({ network: "testnet" });
    expect(client.toJSON()).deep.eq({
      network: "testnet",
      capabilities: { settlement: false, audit: false, mirror: false },
    });
    try {
      await client.escrow.hbar.fund("1", {
        asset: { type: "HBAR" },
        amount: "1",
      });
      expect.fail("expected config error");
    } catch (error) {
      expect(error).instanceOf(ConfigurationError);
    }
  });

  it("rejects malformed network, signer, RPC, and mirror configuration without exposing keys", () => {
    expect(() =>
      createCommerceClient({
        network: "local",
      } as unknown as CommerceClientConfig),
    ).to.throw(ConfigurationError);
    expect(() =>
      createCommerceClient({
        network: "testnet",
        settlement: {
          rpcUrl: "https://rpc.example",
          privateKey: payerKey,
          contracts: { hbar: token.tokenAddress, hts: token.tokenAddress },
        },
        mirrorNode: { baseUrl: "http://user:secret@example.com" },
      }),
    ).to.throw(ConfigurationError);
    try {
      createCommerceClient({
        network: "testnet",
        hcs: { topicId: "0.0.2", accountId: "invalid", privateKey: payerKey },
      });
      expect.fail("expected invalid operator");
    } catch (error) {
      expect(error).instanceOf(ConfigurationError);
      expect(String(error)).not.include(payerKey);
      expect(JSON.stringify(error)).not.include(payerKey);
    }
  });

  it("validates escrow rail, denomination inputs, addresses, and token identifiers", async () => {
    const client = createCommerceClient({ network: "testnet" });
    const valid = {
      payee: "0x2222222222222222222222222222222222222222",
      amount: "10",
      deadline: 1_900_000_000,
    };
    const rejects = async (operation: () => unknown) => {
      try {
        await operation();
        expect.fail("expected validation error");
      } catch (error) {
        expect(error).instanceOf(ValidationError);
      }
    };
    await rejects(() =>
      client.escrow.hbar.create({ ...valid, token } as Parameters<
        typeof client.escrow.hbar.create
      >[0]),
    );
    await rejects(() =>
      client.escrow.hts.create(
        valid as unknown as Parameters<typeof client.escrow.hts.create>[0],
      ),
    );
    await rejects(() =>
      client.escrow.hts.create({
        ...valid,
        token: { ...token, tokenId: "bad" } as HtsFungibleAsset,
      }),
    );
    await rejects(() => client.escrow.hbar.create({ ...valid, amount: "0" }));
    await rejects(() =>
      client.escrow.hbar.create({
        ...valid,
        deadline: Number.MAX_SAFE_INTEGER + 1,
      }),
    );
    await rejects(() =>
      client.escrow.hbar.fund("-1", { asset: { type: "HBAR" }, amount: "1" }),
    );
    await rejects(() =>
      client.escrow.hts.fund("1", {
        asset: { type: "HBAR" } as unknown as HtsFungibleAsset,
        amount: "1",
      }),
    );
  });

  it("exposes the M5 canonical event schema unchanged for HBAR and HTS", () => {
    const hbar = createCommerceClient({ network: "testnet" }).audit.createEvent(
      baseEvent,
    );
    const hts = createCommerceClient({ network: "testnet" }).audit.createEvent({
      ...baseEvent,
      assetType: "HTS_FUNGIBLE",
      assetId: token.tokenAddress,
    });
    expect(hbar.schemaVersion).eq(1);
    expect(hbar.assetType).eq("HBAR");
    expect(hbar.assetId).eq(null);
    expect(hts.assetType).eq("HTS_FUNGIBLE");
    expect(hts.assetId).eq(token.tokenAddress);
    expect(hbar.eventId).match(/^0x[0-9a-f]{64}$/);
  });

  it("routes both complete escrow lifecycles and preserves their units in confirmed results", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client = createCommerceClientWithAdapters(
      {
        network: "testnet",
        settlement: {
          rpcUrl: "https://rpc.example",
          privateKey: payerKey,
          contracts: {
            hbar: baseEvent.contractAddress,
            hts: "0x4444444444444444444444444444444444444444",
          },
        },
      },
      {
        paymentReader: async ({ kind }) =>
          kind === "hbar"
            ? { asset: { type: "HBAR" }, amount: 10n }
            : { asset: token, amount: 500n },
        settlementExecutor: async (call) => {
          calls.push(call);
          const hash = `0x${String(calls.length).padStart(64, "0")}`;
          return {
            transactionId: hash,
            transactionHash: hash,
            network: "testnet",
            contractAddress: call.contractAddress,
            operation: call.operation,
            status: "confirmed",
            ...(call.createEvent
              ? { paymentId: call.kind === "hbar" ? "11" : "22" }
              : {}),
            ...(call.paymentId ? { paymentId: call.paymentId } : {}),
            asset: call.asset,
            ...(call.amount !== undefined
              ? { amount: call.amount.toString() }
              : {}),
            blockNumber: calls.length,
          } satisfies SettlementResult;
        },
      },
    );
    const common = {
      payee: baseEvent.payee,
      amount: "10",
      deadline: 1_900_000_000,
    };
    const hbarCreated = await client.escrow.hbar.create(common);
    await client.escrow.hbar.fund(hbarCreated.paymentId, {
      asset: { type: "HBAR" },
      amount: "10",
    });
    await client.escrow.hbar.release(hbarCreated.paymentId, { type: "HBAR" });
    await client.escrow.hbar.refund(hbarCreated.paymentId, { type: "HBAR" });

    const htsCreated = await client.escrow.hts.create({
      ...common,
      amount: "500",
      token,
    });
    await client.escrow.hts.fund(htsCreated.paymentId, {
      asset: token,
      amount: "500",
    });
    await client.escrow.hts.release(htsCreated.paymentId, token);
    await client.escrow.hts.refund(htsCreated.paymentId, token);

    expect(hbarCreated.status).eq("confirmed");
    expect(hbarCreated.paymentId).eq("11");
    expect(htsCreated.paymentId).eq("22");
    expect(calls.map((call) => call.method)).deep.eq([
      "createPayment",
      "fundPayment",
      "releasePayment",
      "refundPayment",
      "createPayment",
      "fundPayment",
      "releasePayment",
      "refundPayment",
    ]);
    expect(calls[1].value).eq(100_000_000_000n);
    expect(calls[5].value).eq(undefined);
    expect(calls[4].args).deep.eq([
      token.tokenAddress,
      baseEvent.payee,
      "0x0000000000000000000000000000000000000000",
      500n,
      1_900_000_000n,
    ]);
    expect(calls[6].amount).eq(500n);
    client.close();
  });

  it("checks stored terms and propagates settlement executor failures", async () => {
    let submitted = false;
    const config = {
      network: "testnet" as const,
      settlement: {
        rpcUrl: "https://rpc.example",
        privateKey: payerKey,
        contracts: { hbar: baseEvent.contractAddress, hts: token.tokenAddress },
      },
    };
    const client = createCommerceClientWithAdapters(config, {
      paymentReader: async () => ({ asset: { type: "HBAR" }, amount: 10n }),
      settlementExecutor: async () => {
        submitted = true;
        throw new Error("mock RPC rejection");
      },
    });
    try {
      await client.escrow.hbar.fund("1", {
        asset: { type: "HBAR" },
        amount: "9",
      });
      expect.fail("expected stored amount mismatch");
    } catch (error) {
      expect(error).instanceOf(ValidationError);
    }
    expect(submitted).eq(false);
    try {
      await client.escrow.hbar.fund("1", {
        asset: { type: "HBAR" },
        amount: "10",
      });
      expect.fail("expected settlement error");
    } catch (error) {
      expect(error).instanceOf(SettlementError);
      expect((error as SettlementError).status).eq("failed");
      expect((error as Error).message).not.include("mock RPC rejection");
    }
    client.close();
  });

  it("keeps settlement confirmed when independent HCS publication fails", async () => {
    const client = createCommerceClientWithAdapters(
      {
        network: "testnet",
        settlement: {
          rpcUrl: "https://rpc.example",
          privateKey: payerKey,
          contracts: {
            hbar: baseEvent.contractAddress,
            hts: token.tokenAddress,
          },
        },
      },
      {
        paymentReader: async () => ({ asset: { type: "HBAR" }, amount: 10n }),
        settlementExecutor: async (call) => ({
          transactionId: `0x${"55".repeat(32)}`,
          transactionHash: `0x${"55".repeat(32)}`,
          network: "testnet",
          contractAddress: call.contractAddress,
          operation: call.operation,
          status: "confirmed",
          paymentId: call.paymentId,
          asset: call.asset,
          blockNumber: 99,
        }),
        auditPublisher: {
          publish: async () => {
            throw new Error("mock HCS unavailable");
          },
        },
      },
    );
    const settlement = await client.escrow.hbar.release("7", { type: "HBAR" });
    expect(settlement.status).eq("confirmed");
    try {
      await client.audit.publish(client.audit.createEvent(baseEvent));
      expect.fail("expected audit failure");
    } catch (error) {
      expect(error).instanceOf(AuditError);
      expect((error as AuditError).eventId).eq(
        client.audit.createEvent(baseEvent).eventId,
      );
      expect((error as Error).message).include("settlement state is unchanged");
    }
    client.close();
  });

  it("delegates transaction and commerce-event verification to M6", async () => {
    const expectedLog = {
      transactionHash: baseEvent.sourceTxHash,
      contractAddress: baseEvent.contractAddress,
      logIndex: baseEvent.sourceLogIndex,
    };
    const event = createCommerceClient({
      network: "testnet",
    }).audit.createEvent(baseEvent);
    const mirror = {
      config: { network: "testnet" },
      getTransaction: async () => [{ result: "SUCCESS" }],
      getContractResults: async () => ({
        transactionHash: event.sourceTxHash,
        logs: [expectedLog],
      }),
      getTopicMessage: async () => ({ event }),
    } as unknown as NonNullable<
      Parameters<typeof createCommerceClientWithAdapters>[1]["mirrorClient"]
    >;
    const client = createCommerceClientWithAdapters(
      { network: "testnet", mirrorNode: {} },
      { mirrorClient: mirror },
    );
    expect(await client.mirror!.getTransaction("0.0.1@1.000000000")).deep.eq([
      { result: "SUCCESS" },
    ]);
    const verification = await client.mirror!.verifyCommerceEvent(event, {
      topicId: "0.0.2",
      sequenceNumber: 1,
    });
    expect(verification.settlement.located).eq(true);
    expect(verification.hcs.located).eq(true);
    expect(verification.sourceCoordinatesMatch).eq(true);
    client.close();
  });
});
