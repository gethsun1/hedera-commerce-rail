# Hedera Commerce Rail

A Scaffold HBAR template for programmable commerce settlement on Hedera. The planned reference flow is a buyer funding an escrow, approving service milestones, and releasing or refunding funds with an auditable history.

> **Status:** Milestone 3 (native HBAR escrow) is implemented. The repository includes the Scaffold HBAR starter, a validated Hedera SDK connection module, and a tested PaymentEscrow contract. HTS payments, HCS audit integration, Mirror Node business queries, and the reference UI remain roadmap work. No Hedera deployment has been performed.

## Create a project

The current CLI package is `create-scaffold-hbar`. From the repository root, run:

```bash
npx create-scaffold-hbar@latest --template gethsun1/hedera-commerce-rail
```

The CLI retrieves community templates from GitHub. Once this repository is published and reachable, choose Next.js, Hardhat, and Testnet in its prompts. The root `template.json` limits this template to the verified Next.js + Hardhat + npm combination.

## Local development

Requirements: Node.js >=20.18.3, npm, and Git. The selected upstream baseline is Next.js + Hardhat; use the npm workspace commands below.

```bash
npm install --legacy-peer-deps
npm run dev
```

`npm run dev` starts the Next.js application at `http://localhost:3000`. Other baseline commands:

```bash
npm run build
npm run lint
npm test
npm run hardhat:chain
```

Hardhat's baseline tests include Hedera-specific HTS precompile examples and may require the local Hedera fork node. See `packages/hardhat/README.md` for the upstream contract workflow. Do not use production accounts or real funds for development.

### Native HBAR escrow

`PaymentEscrow` lets a payer create an agreement, fund it with its exact native HBAR amount, and have the payer or arbiter release funds to the payee. After the agreed deadline, the payer can refund; the arbiter can resolve by release or refund at any time. Agreements use the states `Created → Funded → Released | Refunded`. Amounts are specified in Hedera EVM tinybars. On a Hedera Ethers transaction, encode a tinybar amount as `tinybars * 10_000_000_000` weibars (so one HBAR is `10^18` in the transaction value); see [Hedera's denomination and Hardhat guidance](https://docs.hedera.com/hedera/sdks-and-apis/sdks/smart-contracts/ethereum-transaction).

Run only the escrow tests with `npm run hardhat:test -- --grep PaymentEscrow`. To deploy explicitly to Testnet after configuring a dedicated `HEDERA_PRIVATE_KEY`, run `npm run hardhat:deploy -- --network hederaTestnet --tags PaymentEscrow`. This command sends a deployment transaction and spends gas; it is never part of build or tests. See [docs/architecture.md](docs/architecture.md) for lifecycle and security assumptions.

## Configuration and secrets

Copy `.env.example` to `.env` to configure the connection layer. For local Hiero SDK access set `HEDERA_NETWORK=local`; this targets an independently running Hedera Local Node and needs no account credentials. The Scaffold HBAR `npm run hardhat:chain` fork is an EVM JSON-RPC node, not a Hiero SDK Local Node. For Testnet or Mainnet set `HEDERA_NETWORK=testnet` or `mainnet`, then provide a dedicated `HEDERA_ACCOUNT_ID` and `HEDERA_PRIVATE_KEY`. Hardhat deployment also accepts the upstream encrypted account workflow; it will never fall back to Hardhat's public local key on a Hedera network. `HEDERA_RPC_URL` overrides the Hardhat fork provider URL. Never commit `.env`, account keys, mnemonics, or API credentials.

Run `npm test` for the credential-free unit and local-fork suite. To opt into the read-only account lookup, set the three Testnet variables above and run `HEDERA_TESTNET_INTEGRATION=true npm test`; this performs an account information query and sends no transaction.

## Architecture and project status

- [Architecture](docs/architecture.md) — system boundaries, current foundation, and planned integration points.
- [Milestones](docs/MILESTONES.md) — acceptance criteria and verification gates for the complete roadmap.
- [Development log](docs/DEVELOPMENT_LOG.md) — reconnaissance findings and implementation record.

## Upstream foundation

This project was initialized with the official `create-scaffold-hbar` 0.4.1 CLI from the `hedera-dev/scaffold-hbar` `templates/blank-template` branch. It preserves the Scaffold HBAR workspace layout and Next.js/Hardhat conventions. See [Scaffold HBAR](https://github.com/hedera-dev/scaffold-hbar) and [create-scaffold-hbar](https://github.com/hedera-dev/create-scaffold-hbar) for upstream documentation.
