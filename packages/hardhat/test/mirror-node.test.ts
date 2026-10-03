import { expect } from "chai";
import { Interface } from "ethers";
import { createCommerceAuditEvent, type CommerceAuditEventInput } from "../lib/hcs/schema";
import { createMirrorNodeClient, MirrorNodeError, readMirrorNodeConfig } from "../lib/mirror-node/client";
import { locateHcsEvent, locateSettlementEvent } from "../lib/mirror-node/verification";

const txHash = `0x${"a".repeat(64)}`;
const address = "0x1111111111111111111111111111111111111111";
const eventInput: CommerceAuditEventInput = {
  eventType: "payment.funded",
  paymentId: "1",
  assetType: "HBAR",
  assetId: null,
  payer: "0x2222222222222222222222222222222222222222",
  payee: "0x3333333333333333333333333333333333333333",
  amount: "1",
  contractAddress: address,
  network: "hedera-testnet",
  sourceTxHash: txHash,
  sourceBlockNumber: "10",
  sourceLogIndex: 2,
  occurredAt: "2026-10-03T00:00:00.000Z",
  metadata: {},
};
const event = createCommerceAuditEvent(eventInput);
const escrowInterface = new Interface([
  "event PaymentFunded(uint256 indexed paymentId,address indexed payer,uint256 amount,address asset)",
]);
const encodedLog = escrowInterface.encodeEventLog(escrowInterface.getEvent("PaymentFunded")!, [
  1n,
  eventInput.payer,
  1n,
  "0x0000000000000000000000000000000000000000",
]);
const log = {
  address,
  contract_id: "0.0.123",
  transaction_hash: txHash,
  timestamp: "1791043226.600708000",
  index: 2,
  data: encodedLog.data,
  topics: encodedLog.topics,
};
const json = (value: unknown, status = 200, headers = new Headers()) =>
  new Response(JSON.stringify(value), { status, headers });
const clientFor = (fetcher: typeof fetch) =>
  createMirrorNodeClient({ network: "testnet", baseUrl: "https://testnet.mirrornode.hedera.com" }, fetcher);

describe("Mirror Node configuration", () => {
  it("selects supported network defaults and accepts an explicit HTTPS endpoint", () => {
    expect(readMirrorNodeConfig({ HEDERA_NETWORK: "testnet" }).baseUrl).to.equal(
      "https://testnet.mirrornode.hedera.com",
    );
    expect(
      readMirrorNodeConfig({ HEDERA_NETWORK: "mainnet", MIRROR_NODE_BASE_URL: "https://mirror.example" }),
    ).to.deep.equal({ network: "mainnet", baseUrl: "https://mirror.example" });
  });
  it("rejects missing/unsupported network and unsafe or malformed URLs", () => {
    for (const env of [
      {},
      { HEDERA_NETWORK: "local" },
      { HEDERA_NETWORK: "testnet", MIRROR_NODE_BASE_URL: "not a URL" },
      { HEDERA_NETWORK: "testnet", MIRROR_NODE_BASE_URL: "http://localhost:8080" },
      { HEDERA_NETWORK: "testnet", MIRROR_NODE_BASE_URL: "https://user:pass@example.com" },
    ]) {
      expect(() => readMirrorNodeConfig(env as NodeJS.ProcessEnv)).to.throw(MirrorNodeError);
    }
  });
});

describe("Mirror Node client", () => {
  it("normalizes transaction, contract, result logs, tokens, and HCS schema messages", async () => {
    const message = Buffer.from(JSON.stringify(event)).toString("base64");
    const fetcher: typeof fetch = async input => {
      const url = String(input);
      if (url.endsWith("/transactions/0.0.1-1-000000002"))
        return json({
          transactions: [
            {
              transaction_id: "0.0.1@1.000000002",
              hash: txHash,
              consensus_timestamp: "1791043226.600708000",
              result: "SUCCESS",
              name: "CONTRACTCALL",
              entity_id: "0.0.123",
            },
          ],
        });
      if (url.endsWith(`/contracts/${address}`))
        return json({
          contract_id: "0.0.123",
          evm_address: address.slice(2),
          deleted: false,
          created_timestamp: "1.2",
          bytecode: "abcd",
        });
      if (url.endsWith(`/contracts/results/${txHash}`))
        return json({
          transaction_id: "0.0.1@1.2",
          transaction_hash: txHash,
          timestamp: "1791043226.600708000",
          result: "SUCCESS",
          logs: [log],
        });
      if (url.endsWith("/tokens/0.0.123"))
        return json({
          token_id: "0.0.123",
          name: "Test",
          symbol: "T",
          type: "FUNGIBLE_COMMON",
          decimals: "6",
          total_supply: "10",
        });
      if (url.endsWith("/accounts/0.0.1"))
        return json({
          account: "0.0.1",
          evm_address: "0x1111111111111111111111111111111111111111",
          balance: { balance: 1234 },
          deleted: false,
        });
      if (url.endsWith("/topics/0.0.99/messages/4"))
        return json({
          topic_id: "0.0.99",
          sequence_number: 4,
          consensus_timestamp: "1791043226.600708000",
          transaction_id: "0.0.1@1.2",
          payer_account_id: "0.0.1",
          message,
        });
      throw new Error(`Unexpected path ${url}`);
    };
    const client = clientFor(fetcher);
    expect((await client.getTransaction("0.0.1@1.000000002"))[0]).to.include({
      transactionHash: txHash,
      result: "SUCCESS",
      consensusTimestamp: "1791043226.600708000",
    });
    expect((await client.getContract(address)).contractId).to.equal("0.0.123");
    expect((await client.getContractResults(txHash)).logs[0]).to.include({
      contractAddress: address,
      logIndex: 2,
      transactionHash: txHash,
    });
    expect((await client.getContractResults(txHash)).logs[0].decodedEvent).to.deep.equal({
      name: "PaymentFunded",
      args: {
        paymentId: "1",
        payer: eventInput.payer,
        amount: "1",
        asset: "0x0000000000000000000000000000000000000000",
      },
    });
    expect((await client.getToken("0.0.123")).decimals).to.equal("6");
    expect((await client.getToken("0.0.123")).evmAddress).to.equal("0x000000000000000000000000000000000000007b");
    expect(await client.getAccount("0.0.1")).to.include({
      accountId: "0.0.1",
      balanceTinybars: "1234",
      evmAddress: "0x1111111111111111111111111111111111111111",
    });
    expect(await client.getTopicMessage("0.0.99", 4)).to.include({
      topicId: "0.0.99",
      sequenceNumber: 4,
      transactionId: "0.0.1@1.2",
    });
    expect((await client.getTopicMessage("0.0.99", 4)).event?.eventId).to.equal(event.eventId);
  });

  it("pages with API next links and stops at a caller limit", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async input => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/messages?limit=2&order=asc"))
        return json({
          messages: [{ topic_id: "0.0.99", sequence_number: 1, consensus_timestamp: "1.000000001", message: "e30=" }],
          links: { next: "/api/v1/topics/0.0.99/messages?limit=2&order=asc&sequ=2" },
        });
      return json({
        messages: [
          { topic_id: "0.0.99", sequence_number: 2, consensus_timestamp: "1.000000002", message: "e30=" },
          { topic_id: "0.0.99", sequence_number: 3, consensus_timestamp: "1.000000003", message: "e30=" },
        ],
        links: { next: "/api/v1/topics/0.0.99/messages?limit=2&order=asc&sequ=4" },
      });
    };
    const result = await clientFor(fetcher).getTopicMessages("0.0.99", 2).getAll();
    expect(result.map(item => item.sequenceNumber)).to.deep.equal([1, 2]);
    expect(calls).to.have.length(2);
  });

  it("supports one-page collection retrieval and rejects malformed collection members", async () => {
    const client = clientFor(async () => json({ logs: [log], links: { next: null } }));
    expect((await client.getContractLogs("0.0.123").getPage()).items).to.have.length(1);
    const malformed = clientFor(async () => json({ logs: [{ ...log, index: "bad" }] }));
    await expect(malformed.getContractLogs("0.0.123").getPage()).to.be.rejectedWith("malformed contract log");
    await expect(client.getTopicMessage("invalid", 1)).to.be.rejectedWith("numeric shard.realm.number");
  });

  it("preserves exact large integer balances from JSON", async () => {
    const precise = clientFor(
      async () => new Response('{"account":"0.0.1","balance":{"balance":9007199254740993},"deleted":false}'),
    );
    expect((await precise.getAccount("0.0.1")).balanceTinybars).to.equal("9007199254740993");
  });

  it("distinguishes HTTP status failures and transport/JSON errors", async () => {
    const partial = clientFor(async () => json({ hash: txHash, result: "SUCCESS", logs: [] }, 206));
    expect((await partial.getContractResults(txHash)).partial).to.equal(true);
    for (const [status, code] of [
      [404, "NOT_FOUND"],
      [400, "INVALID_REQUEST"],
      [429, "RATE_LIMITED"],
      [503, "UPSTREAM_ERROR"],
    ] as const) {
      const client = clientFor(async () => json({}, status, new Headers({ "retry-after": "3" })));
      try {
        await client.getContract(address);
        throw new Error("expected failure");
      } catch (error) {
        expect(error).to.include({ code, status });
        if (status === 429) expect((error as MirrorNodeError).retryAfter).to.equal("3");
      }
    }
    await expect(
      clientFor(async () => {
        throw new Error("offline");
      }).getContract(address),
    ).to.be.rejectedWith(MirrorNodeError, "network layer");
    await expect(clientFor(async () => new Response("not json")).getContract(address)).to.be.rejectedWith(
      MirrorNodeError,
      "malformed JSON",
    );
    const hostile = clientFor(async () => json({ links: { next: "https://attacker.example/api/v1/x" }, logs: [] }));
    const page = await hostile.getContractLogs("0.0.123").getPage();
    expect(page.next).to.equal("https://attacker.example/api/v1/x");
    await expect(hostile.getContractLogs("0.0.123").getPage(page.next!)).to.be.rejectedWith("escaped");
  });

  it("correlates HBAR and HTS logs by their source transaction, contract, and log index", async () => {
    const fetcher: typeof fetch = async input => {
      if (String(input).includes("/transactions/"))
        return json({
          transactions: [
            {
              transaction_id: "0.0.1@1.000000002",
              hash: txHash,
              consensus_timestamp: "1791043226.600708000",
              result: "SUCCESS",
            },
          ],
        });
      return json({ transaction_hash: txHash, timestamp: "1791043226.600708000", result: "SUCCESS", logs: [log] });
    };
    const client = clientFor(fetcher);
    expect((await locateSettlementEvent(client, event)).located).to.equal(true);
    const mainnetEvent = createCommerceAuditEvent({ ...eventInput, network: "hedera-mainnet" });
    await expect(locateSettlementEvent(client, mainnetEvent)).to.be.rejectedWith("network does not match");
    const hts = createCommerceAuditEvent({
      ...eventInput,
      assetType: "HTS_FUNGIBLE",
      assetId: address,
      contractAddress: "0x4444444444444444444444444444444444444444",
    });
    const htsClient = clientFor(async input => {
      if (String(input).includes("/contracts/results/")) {
        return json({
          hash: txHash,
          timestamp: "1791043226.600708000",
          result: "SUCCESS",
          logs: [{ ...log, address: hts.contractAddress }],
        });
      }
      throw new Error("Unexpected request");
    });
    expect((await locateSettlementEvent(htsClient, hts)).located).to.equal(true);
    const missed = await locateSettlementEvent(client, hts);
    expect(missed.located).to.equal(false);
    expect(missed.eventId).to.equal(hts.eventId);
  });

  it("correlates HCS event identity and source coordinates, including missing messages", async () => {
    const message = Buffer.from(JSON.stringify(event)).toString("base64");
    const client = clientFor(async () =>
      json({ topic_id: "0.0.99", sequence_number: 4, consensus_timestamp: "1791043226.600708000", message }),
    );
    const located = await locateHcsEvent(client, { eventId: event.eventId, topicId: "0.0.99", sequenceNumber: 4 });
    expect(located.located).to.equal(true);
    expect(located.message?.event?.sourceTxHash).to.equal(txHash);
    const unmatched = await locateHcsEvent(client, {
      eventId: `0x${"b".repeat(64)}`,
      topicId: "0.0.99",
      sequenceNumber: 4,
    });
    expect(unmatched.located).to.equal(false);
  });
});
