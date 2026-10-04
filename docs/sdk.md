# Commerce SDK (Milestone 7)

`packages/sdk` is the server-side/application integration package for Hedera Commerce Rail. Import it in Node.js/TypeScript applications; it has no Next.js UI dependency. From this repository, use `npm run sdk:build`, `npm run sdk:check-types`, and `npm run sdk:test`. It is private and is not published to npm.

The SDK is a developer interface over the existing rails:

- escrow contracts remain the settlement authority;
- HCS is an optional, at-least-once audit stream;
- Mirror Node is a read/query/correlation layer and may lag consensus.

## Configure

```ts
import { createCommerceClient } from "@hedera-commerce/sdk";

const commerce = createCommerceClient({
  network: "testnet",
  settlement: {
    rpcUrl: process.env.HEDERA_RPC_URL!,
    privateKey: process.env.HEDERA_PRIVATE_KEY!,
    contracts: {
      hbar: process.env.PAYMENT_ESCROW_ADDRESS!,
      hts: process.env.TOKEN_PAYMENT_ESCROW_ADDRESS!,
    },
  },
  // Optional. Provide only when publishing audit events.
  hcs: {
    topicId: process.env.HCS_TOPIC_ID!,
    accountId: process.env.HEDERA_ACCOUNT_ID!,
    privateKey: process.env.HEDERA_PRIVATE_KEY!,
  },
  // Optional. Official network origin is used if baseUrl is omitted.
  mirrorNode: {},
});
```

The contract addresses are explicit for each environment; deployment JSONs under `packages/hardhat/deployments/` are the maintained source of truth. The SDK takes a dedicated RPC URL because EVM settlement requires a JSON-RPC signer. It does not infer network from a key. Configure secrets in the application environment or secret manager. The client keeps signer objects private in closures and its `toJSON()` output contains only network and capability flags. Never put secrets in audit metadata.

## HBAR escrow

Amounts are integer **tinybars**. The SDK does not accept floating point amounts or convert human decimals. The payer creates the terms, then funds with the exact agreed amount. Release/refund authorization and deadline behavior are enforced by `PaymentEscrow`.

```ts
const payment = await commerce.escrow.hbar.create({
  payee: "0x...",
  arbiter: "0x...", // optional
  amount: 10_000_000n, // tinybars
  deadline: 1_900_000_000,
});

await commerce.escrow.hbar.fund(payment.paymentId, {
  asset: { type: "HBAR" },
  amount: 10_000_000n,
});
await commerce.escrow.hbar.release(payment.paymentId, { type: "HBAR" });
// Or, subject to the contract's refund authorization and deadline rules:
// await commerce.escrow.hbar.refund(payment.paymentId, { type: "HBAR" });
```

The SDK translates tinybars to Ethers' wei-like transaction value (`1 tinybar = 10^10 weibars`) for `msg.value`, while retaining tinybars in results. It reads the payment terms before funding or settlement and rejects a caller-supplied asset/amount that disagrees with the contract. This read is a convenience check; the contract still validates every transaction.

## HTS fungible-token escrow

Amounts are integers in the token's smallest unit. Pass both native token ID and its EVM facade address; the SDK checks their numeric-ID/address correspondence. No decimal conversion is performed.

```ts
const asset = {
  type: "HTS_FUNGIBLE" as const,
  tokenId: "0.0.12345",
  tokenAddress: "0x0000000000000000000000000000000000003039",
};
const payment = await commerce.escrow.hts.create({
  token: asset,
  payee: "0x...",
  amount: 1_000_000n, // smallest units, not display decimals
  deadline: 1_900_000_000,
});

await commerce.escrow.hts.associateToken(asset); // escrow contract self-association
await commerce.escrow.hts.approve(payment.paymentId, asset, 1_000_000n); // payer allowance
await commerce.escrow.hts.fund(payment.paymentId, {
  asset,
  amount: 1_000_000n,
});
await commerce.escrow.hts.release(payment.paymentId, asset);
```

The payer and payee accounts must also be associated with the token as required by HTS. Account association is performed by each account through its Hedera wallet/account flow; the SDK does not custody other parties' keys. The escrow's authorization, exact balance checks, allowance consumption, and state transitions remain in `TokenPaymentEscrow`.

Each lifecycle result includes transaction ID/hash, network, contract, operation, confirmed status, payment ID when available, asset and amount when relevant, and EVM block number. These methods wait for a successful EVM receipt. A wait timeout after a transaction was broadcast raises `SettlementError` with the transaction hash when available; that error does not claim the transaction failed. Inspect the transaction through Mirror Node before retrying an ambiguous broadcast.

## Events and HCS audit

`CommerceAuditEvent` is the unchanged M5 schema v1. Use `audit.normalize(confirmedLog, paymentSnapshot)` for existing contract logs, or `audit.createEvent(...)` for an already-normalized source event. `audit.publish(event)` validates the M5 identity and publishes through the existing Hiero SDK publisher. It returns event ID, topic ID, transaction ID and sequence number where returned.

```ts
const event = commerce.audit.createEvent({
  eventType: "payment.funded",
  paymentId: "42",
  assetType: "HBAR",
  assetId: null,
  payer: "0x...",
  payee: "0x...",
  amount: "1000000",
  contractAddress: "0x...",
  sourceTxHash: "0x...",
  sourceBlockNumber: "123",
  sourceLogIndex: 0,
  occurredAt: new Date().toISOString(),
  metadata: {},
});
await commerce.audit.publish(event);
```

Settlement calls do not call HCS. If audit publication fails after settlement, `AuditError` identifies the event and states that settlement state is unchanged. The publisher preserves M5 same-process suppression and at-least-once behavior: a retry after an ambiguous network timeout may create a duplicate; consumers deduplicate by deterministic `eventId`. There is no durable outbox or exactly-once claim.

## Mirror Node

When configured, `commerce.mirror` delegates to the existing M6 adapter. It exposes normalized account, contract, token, transaction, contract-result/log, and topic-message queries plus settlement/HCS event location and `verifyCommerceEvent(event, { topicId, sequenceNumber? })`. Pagination limits, origin restrictions, indexing-delay behavior, and typed `MirrorNodeError` categories are preserved.

```ts
const verification = await commerce.mirror!.verifyCommerceEvent(event, {
  topicId: process.env.HCS_TOPIC_ID!,
});
```

This locates and correlates indexed records; it does not cryptographically prove a settlement. Contract state and receipt are authoritative. HCS and Mirror Node are optional to settlement.

## Errors and lifecycle

- `ConfigurationError`: invalid/missing network, signer, RPC, contract, HCS, or Mirror Node configuration.
- `ValidationError`: malformed addresses/IDs, invalid amounts, or incompatible asset/rail inputs.
- `SettlementError`: contract, RPC, receipt, or token-approval operation failure; transaction hash is included when known.
- `AuditError`: event/HCS publication failure, with the event ID when available.
- `MirrorNodeError`: M6 typed query error (`NOT_FOUND`, `INVALID_REQUEST`, `RATE_LIMITED`, `UPSTREAM_ERROR`, or `CONFIGURATION_ERROR`).

Call `commerce.close()` when finished to close the HCS SDK client and provider. Do not send private keys to Mirror Node or put secrets in HCS messages/metadata.
