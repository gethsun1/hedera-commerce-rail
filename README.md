# Hedera Commerce Rail

A Scaffold HBAR template for programmable commerce settlement on Hedera. The planned reference flow is a buyer funding an escrow, approving service milestones, and releasing or refunding funds with an auditable history.

> **Status:** M8 reference code covers connected-wallet HBAR and HTS settlement, shared SDK transaction execution, independent server-side HCS audit publication, and Mirror Node correlation. **M8 manual browser wallet validation outstanding.** No live wallet-authorized HBAR settlement or HCS publication is claimed; see the [repeatable Testnet procedure](docs/reference-app.md#repeatable-testnet-validation).

Milestone 7 adds the reusable server-side TypeScript SDK in [`packages/sdk`](packages/sdk/README.md), composing the existing contracts and M5/M6 adapters without changing settlement semantics. See the [SDK guide](docs/sdk.md) for configuration, public APIs, asset units, and transaction behavior.

The [Reference Application guide](docs/reference-app.md) explains wallet setup, the HBAR flow, and remaining validation limits. Configure `HCS_TOPIC_ID` in the Next.js server environment to read existing audit messages.

## Create a project

The current CLI package is `create-scaffold-hbar`. From the repository root, run:

```bash
npm create scaffold-hbar@latest -- --template gethsun1/hedera-commerce-rail
```

The CLI retrieves this repository's `main` branch from GitHub. Its `template.json` selects the verified Next.js, Hardhat, and npm combination. Git and Node.js >=20.18.3 are required.

## Local development

Requirements: Node.js >=20.18.3, npm, and Git configured with `user.name` and `user.email`. The selected upstream baseline is Next.js + Hardhat; use the npm workspace commands below.

```bash
npm install
npm run dev
```

`npm run dev` starts the Next.js application at `http://localhost:3000`; it compiles the contracts and builds the SDK first. Other useful commands:

```bash
npm run build
npm run lint
npm test
npm run hardhat:chain
npm run sdk:test
npm run sdk:check-types
npm run sdk:build
npm run next:check-types
npm run hardhat:check-types
npm run check-browser-bundle -w @sh/nextjs
```

Hardhat's baseline tests include Hedera-specific HTS precompile examples and may require the local Hedera fork node. See `packages/hardhat/README.md` for the upstream contract workflow. Do not use production accounts or real funds for development.

### Native HBAR escrow

`PaymentEscrow` lets a payer create an agreement, fund it with its exact native HBAR amount, and have the payer or arbiter release funds to the payee. After the agreed deadline, the payer can refund; the arbiter can resolve by release or refund at any time. Agreements use the states `Created → Funded → Released | Refunded`. Amounts are specified in Hedera EVM tinybars. On a Hedera Ethers transaction, encode a tinybar amount as `tinybars * 10_000_000_000` weibars (so one HBAR is `10^18` in the transaction value); see [Hedera's denomination and Hardhat guidance](https://docs.hedera.com/hedera/sdks-and-apis/sdks/smart-contracts/ethereum-transaction).

Run only the escrow tests with `npm run hardhat:test -- --grep PaymentEscrow`. The reference Testnet deployment is [`0x85a038f7FB8E01EBD6F0E5B02791E57Bfb6aa260`](https://hashscan.io/testnet/contract/0.0.10842321), deployed in transaction [`0xb8dedb6bd8cf23ae03496594e15bb4f887a8b9e20d5b86f081f4ef06f15f1c13`](https://hashscan.io/testnet/transaction/0xb8dedb6bd8cf23ae03496594e15bb4f887a8b9e20d5b86f081f4ef06f15f1c13). This reference ID is specific to Hedera Testnet and is not created when someone scaffolds the project.

Scaffolded projects contain no configured account or credentials. For a deployment, use a dedicated ECDSA account with Testnet HBAR. The explicit deployment command is `npm run hardhat:deploy -- --network hederaTestnet --tags PaymentEscrow`; it spends Testnet gas and is never part of build or tests. Hardhat scripts load the repository-root `.env` before package-local settings. See [docs/architecture.md](docs/architecture.md) for lifecycle and security assumptions.

### Fungible HTS token escrow

`TokenPaymentEscrow` is a separate settlement contract, preserving `PaymentEscrow` as HBAR-only. It accepts fungible HTS token EVM addresses through their ERC-20-compatible facade. Amounts are integer smallest units. Before use, the escrow contract, payer, and payee need token associations; call `associateToken(tokenAddress)` so the escrow contract opts in through HIP-719, associate payer/payee accounts with the token, and have the payer approve the escrow for the exact amount. Then create and fund a payment. Token IDs remain Hedera's canonical identifier; their EVM token address is the Solidity-facing value recorded by the contract and events. Allowances do not create token associations.

For local unit tests, run `npm run hardhat:chain`; the lifecycle suite uses a token double and a diagnostic confirms the local fork limitation. For actual HTS behavior, the reference Testnet `TokenPaymentEscrow` is [`0xa1069144BAc92E69634F8af332C92d053d9e72bb`](https://hashscan.io/testnet/contract/0.0.10843288) and its test token is `0.0.10843331` (`0x0000000000000000000000000000000000a574C3`). Scaffolding does not create these resources. Your wallet must own and associate the token; the escrow and recipient also need token association. The local fork limitation is specific: its HTS emulator requires an account-to-Hedera-entity mapping for HIP-719, which newly deployed local EVM contracts do not have. Do not use the local fork diagnostic as proof of Testnet failure.

### HCS commerce audit stream

`PaymentEscrow` and `TokenPaymentEscrow` Solidity logs remain the authoritative payment record. A server-side adapter normalizes an observed contract log to schema version 1 and submits it to a configured Hedera Consensus Service topic. HCS unavailability never changes or rolls back settlement. The canonical schema, event identity, provisioning steps, and retry limitations are described in [docs/architecture.md](docs/architecture.md).

Provision your own dedicated Testnet topic with `npm run hcs:topic:create -w @sh/hardhat`, then set `HCS_TOPIC_ID` in the relevant server environment. The validation reference topic is `0.0.10844125`; it is public Testnet infrastructure and may not be available or suitable for your project. Topic creation defaults to public; private-topic submission requires a matching submit key. Runtime publishing is opt-in through `publishConfiguredEvent` in `packages/hardhat/lib/hcs/publisher.ts`. Do not include private data or credentials in messages. HCS messages are public and immutable.

To exercise publishing on Testnet, run `npm run hcs:smoke -w @sh/hardhat`. It creates, funds with one tinybar, and releases a minimal HBAR payment, then publishes that actual contract event. It also publishes the previously verified M4 HTS funding event without another token transfer. Each HCS write incurs the network's standard transaction fee. Retry after an ambiguous timeout can create a duplicate; consumers should deduplicate using the deterministic `eventId`. The M5 validation and exact transaction/consensus records are in [docs/DEVELOPMENT_LOG.md](docs/DEVELOPMENT_LOG.md).

### Mirror Node reads

The Hardhat workspace exposes a server-side, read-only adapter in `packages/hardhat/lib/mirror-node/`. It queries contract metadata, EVM contract results/logs, Hedera transaction IDs, account/current balance information, fungible-token details, and topic messages. HBAR and HTS source events correlate by transaction hash + contract address + log index; HCS messages use the existing M5 `eventId`. Collections expose a page method and follow Mirror Node `links.next` only within a caller-provided limit (maximum 10,000 items). A current not-found result describes the indexer's current response and does not determine settlement state.

Set `HEDERA_NETWORK=testnet` or `mainnet`. `MIRROR_NODE_BASE_URL` is optional and defaults to the official network endpoint; overrides must be HTTPS origins and are trusted server configuration. `HCS_TOPIC_ID` configures the default topic query. The adapter uses standard `fetch`, sends no credentials, performs no automatic retries, preserves source JSON, and maps 404, 400, 429 (`Retry-After` preserved), upstream, and configuration failures to typed errors. Mainnet rate limits can change; respect 429 responses and avoid unbounded scans. See [architecture](docs/architecture.md) and the M6 record in [development log](docs/DEVELOPMENT_LOG.md).

## Configuration and secrets

Use separate ignored files for Hardhat/SDK tools and the Next.js application:

```bash
cp .env.example .env
cp packages/nextjs/.env.example packages/nextjs/.env.local
```

For local Hiero SDK access set `HEDERA_NETWORK=local`; this targets an independently running Hedera Local Node and needs no account credentials. The Scaffold HBAR `npm run hardhat:chain` fork is an EVM JSON-RPC node, not a Hiero SDK Local Node. For Testnet or Mainnet operations that sign server-side transactions, use a dedicated `HEDERA_ACCOUNT_ID` and `HEDERA_PRIVATE_KEY`. Hardhat deployment also accepts the upstream encrypted account workflow; it will never fall back to Hardhat's public local key on a Hedera network. `HEDERA_RPC_URL` overrides the Hardhat RPC endpoint. The Next.js app needs no server credentials to render or connect a user's wallet; its HCS topic and signing credentials are optional and only enable independent audit publishing. `NEXT_PUBLIC_*` values are browser-visible configuration and must never contain secrets. Never commit either local env file, account keys, mnemonics, or API credentials.

Run `npm test` for the credential-free unit and local-fork suite. To opt into the read-only account lookup, set the Testnet variables in the root `.env` and run `HEDERA_TESTNET_INTEGRATION=true npm test`; this performs an account information query and sends no transaction.

## M10 automated validation

The official [Hedera Harness](https://github.com/hedera-dev/hedera-harness) is pinned as a development dependency. Run `npm run harness:validate` from a clean checkout without local `.env` files for its deterministic static and command validators. The recipe invokes the credential-free regression commands and includes no deploy, HCS publish, or funded-chain stage. Its baseline install uses `npm ci --legacy-peer-deps` to match this repository's lockfile and Scaffold HBAR workspace dependencies.

The regression suite covers HBAR escrow transitions and authorization, HTS escrow behavior with local token doubles, HCS normalization/publication semantics, Mirror Node parsing and event correlation, SDK methods/errors, the browser/server boundary, frontend type/build checks, browser bundle inspection, and lint. These local results do not establish live Testnet behavior. The `HEDERA_TESTNET_INTEGRATION=true` Hardhat check is separately opt-in and **CREDENTIAL-GATED**: it is a read-only account lookup, requires a Testnet account and Hiero SDK credentials in the ignored root `.env`, makes no transaction, and is not run by the Harness recipe. See [the M10 validation guide](docs/validation.md) for tier boundaries and existing Testnet resource references.

## Fresh project and reference resources

Scaffolding and installing dependencies do not deploy contracts, create an HTS token, or create an HCS topic. The app loads without credentials; its settlement panels use the Testnet contracts and token listed above. To transact, connect a Hedera-compatible wallet on Testnet with HBAR. HTS actions additionally require token ownership/association, and each account plus the escrow must be associated. The audit history and server publisher require a topic configured in `packages/nextjs/.env.local`; configure an account ID and private key there only if you want the server to submit HCS messages. A new deployment requires updating the contract address constants in `packages/nextjs/app/settlement-panel.tsx` and `packages/nextjs/app/api/audit/route.ts`, then deploying/associating the required HTS resources. These Testnet IDs are demonstration infrastructure, not production configuration.

Without a network wallet or configured topic, developers can load the UI and run builds, lint, SDK, and contract checks locally. For a new Hedera deployment, provisioning accounts, funding, contract deployment, token/topic creation, and production key management remain operator responsibilities. The account and contract APIs read public Testnet data; they do not submit transactions.

## Architecture and project status

- [Architecture](docs/architecture.md) — system boundaries, current foundation, and planned integration points.
- [Milestones](docs/MILESTONES.md) — acceptance criteria and verification gates for the complete roadmap.
- [Development log](docs/DEVELOPMENT_LOG.md) — reconnaissance findings and implementation record.

## Upstream foundation

This project was initialized with the official `create-scaffold-hbar` 0.4.1 CLI from the `hedera-dev/scaffold-hbar` `templates/blank-template` branch. It preserves the Scaffold HBAR workspace layout and Next.js/Hardhat conventions. See [Scaffold HBAR](https://github.com/hedera-dev/scaffold-hbar) and [create-scaffold-hbar](https://github.com/hedera-dev/create-scaffold-hbar) for upstream documentation.
