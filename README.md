# Hedera Commerce Rail

A Scaffold HBAR template for programmable commerce settlement on Hedera. The planned reference flow is a buyer funding an escrow, approving service milestones, and releasing or refunding funds with an auditable history.

> **Status:** HBAR `PaymentEscrow` and fungible HTS `TokenPaymentEscrow` are deployed/exercised on Hedera Testnet. M4.1 validated contract self-association, payer approval, release, and post-deadline refund. The local Hedera fork cannot associate newly deployed local contracts because they are not registered Hedera entities. HCS audit integration, Mirror Node business queries, and the reference UI remain roadmap work.

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

Run only the escrow tests with `npm run hardhat:test -- --grep PaymentEscrow`. The M3 deployment is on Hedera Testnet at [`0x85a038f7FB8E01EBD6F0E5B02791E57Bfb6aa260`](https://hashscan.io/testnet/contract/0.0.10842321), deployed in transaction [`0xb8dedb6bd8cf23ae03496594e15bb4f887a8b9e20d5b86f081f4ef06f15f1c13`](https://hashscan.io/testnet/transaction/0xb8dedb6bd8cf23ae03496594e15bb4f887a8b9e20d5b86f081f4ef06f15f1c13). The transaction succeeded on 2026-10-03. Its contract record and non-empty bytecode were confirmed through Hedera Testnet Mirror Node and JSON-RPC.

For this checkout, a Testnet ECDSA account is configured in the ignored local `.env` and is used for Hardhat/EVM operations. Credentials are not committed. The ED25519 account is not used for EVM deployment. For a future redeployment, the explicit command is `npm run hardhat:deploy -- --network hederaTestnet --tags PaymentEscrow`; it spends Testnet gas and is never part of build or tests. The Hardhat scripts load the repository-root `.env` before package-local settings. See [docs/architecture.md](docs/architecture.md) for lifecycle and security assumptions.

### Fungible HTS token escrow

`TokenPaymentEscrow` is a separate settlement contract, preserving `PaymentEscrow` as HBAR-only. It accepts fungible HTS token EVM addresses through their ERC-20-compatible facade. Amounts are integer smallest units. Before use, the escrow contract, payer, and payee need token associations; call `associateToken(tokenAddress)` so the escrow contract opts in through HIP-719, associate payer/payee accounts with the token, and have the payer approve the escrow for the exact amount. Then create and fund a payment. Token IDs remain Hedera's canonical identifier; their EVM token address is the Solidity-facing value recorded by the contract and events. Allowances do not create token associations.

For local unit tests, run `npm run hardhat:chain`; the lifecycle suite uses a token double and a diagnostic confirms the local fork limitation. For actual HTS behavior, the M4.1 Testnet run deployed `TokenPaymentEscrow` at [`0xa1069144BAc92E69634F8af332C92d053d9e72bb`](https://hashscan.io/testnet/contract/0.0.10843288) and used token `0.0.10843331` (`0x0000000000000000000000000000000000a574C3`). It verified escrow and recipient self-association, allowance, two releases, and one payer refund after deadline. The escrow ended with zero token balance/liability. The local fork limitation is specific: its HTS emulator requires an account-to-Hedera-entity mapping for HIP-719, which newly deployed local EVM contracts do not have. Do not use the local fork diagnostic as proof of Testnet failure.

## Configuration and secrets

Copy `.env.example` to `.env` to configure the connection layer. For local Hiero SDK access set `HEDERA_NETWORK=local`; this targets an independently running Hedera Local Node and needs no account credentials. The Scaffold HBAR `npm run hardhat:chain` fork is an EVM JSON-RPC node, not a Hiero SDK Local Node. For Testnet or Mainnet set `HEDERA_NETWORK=testnet` or `mainnet`, then provide a dedicated `HEDERA_ACCOUNT_ID` and `HEDERA_PRIVATE_KEY`. Hardhat deployment also accepts the upstream encrypted account workflow; it will never fall back to Hardhat's public local key on a Hedera network. `HEDERA_RPC_URL` overrides the Hardhat fork provider URL. Never commit `.env`, account keys, mnemonics, or API credentials.

Run `npm test` for the credential-free unit and local-fork suite. To opt into the read-only account lookup, set the three Testnet variables above and run `HEDERA_TESTNET_INTEGRATION=true npm test`; this performs an account information query and sends no transaction.

## Architecture and project status

- [Architecture](docs/architecture.md) — system boundaries, current foundation, and planned integration points.
- [Milestones](docs/MILESTONES.md) — acceptance criteria and verification gates for the complete roadmap.
- [Development log](docs/DEVELOPMENT_LOG.md) — reconnaissance findings and implementation record.

## Upstream foundation

This project was initialized with the official `create-scaffold-hbar` 0.4.1 CLI from the `hedera-dev/scaffold-hbar` `templates/blank-template` branch. It preserves the Scaffold HBAR workspace layout and Next.js/Hardhat conventions. See [Scaffold HBAR](https://github.com/hedera-dev/scaffold-hbar) and [create-scaffold-hbar](https://github.com/hedera-dev/create-scaffold-hbar) for upstream documentation.
