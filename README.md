# Hedera Commerce Rail

A Scaffold HBAR template for programmable commerce settlement on Hedera. The planned reference flow is a buyer funding an escrow, approving service milestones, and releasing or refunding funds with an auditable history.

> **Status:** Milestone 1 (project foundation). This repository contains the upstream Scaffold HBAR blank starter with its sample contracts; Commerce Rail payment, escrow, HTS, HCS, and Mirror Node features are roadmap work and are not implemented yet. No Hedera deployment is configured or performed.

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

## Configuration and secrets

Copy `.env.example` to `.env` when a later milestone requires credentials. It contains safe placeholders only. The root variables document the intended configuration names; the current upstream Hardhat and wallet configuration is documented in each package's own `.env.example`. Never commit `.env`, account keys, mnemonics, or API credentials.

## Architecture and project status

- [Architecture](docs/architecture.md) — system boundaries, current foundation, and planned integration points.
- [Milestones](docs/MILESTONES.md) — acceptance criteria and verification gates for the complete roadmap.
- [Development log](docs/DEVELOPMENT_LOG.md) — reconnaissance findings and implementation record.

## Upstream foundation

This project was initialized with the official `create-scaffold-hbar` 0.4.1 CLI from the `hedera-dev/scaffold-hbar` `templates/blank-template` branch. It preserves the Scaffold HBAR workspace layout and Next.js/Hardhat conventions. See [Scaffold HBAR](https://github.com/hedera-dev/scaffold-hbar) and [create-scaffold-hbar](https://github.com/hedera-dev/create-scaffold-hbar) for upstream documentation.
