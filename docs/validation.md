# Automated validation (M10)

This project uses [Hedera Harness](https://github.com/hedera-dev/hedera-harness),
the official Scaffold HBAR recipe and validation CLI, at version 1.2.2. The
recipe follows its schema v2 format. Harness validates a project recipe and
runs its declared deterministic checks; it is not the test framework for the
Solidity or SDK suites.

## Run the local suite

Use Node.js >=20.18.3 and npm. Install from the lockfile, then run the same
checks independently or as the Harness recipe:

```bash
npm ci --legacy-peer-deps
npm run hardhat:test
npm run hardhat:compile
npm run hardhat:check-types
npm run sdk:test
npm run sdk:check-types
npm run sdk:build
npm run next:check-types
npm run next:build
npm run check-browser-bundle -w @sh/nextjs
npm run lint
npm run harness:validate
```

Harness uses `.harness/validators/static.json` for template, package-manager,
required-file, and secret-file invariants. Its command validator runs the
contract, SDK, frontend, browser-bundle, and lint regressions. No live-network
write or deployment command is included. Harness install/build checks are
repeatable from the tracked npm lockfile; `--legacy-peer-deps` is needed by
this Scaffold HBAR workspace's existing dependency graph.

The official Harness secret checks intentionally reject `.env` files even
when Git ignores them. Run `npm run harness:validate` from a clean checkout or
isolated workspace that has no copied `.env`/`.env.local` files; keep active
credentials in the original ignored env files. The recipe never needs those
credentials.

## What the checks establish

| Area | Local evidence | Limit |
| --- | --- | --- |
| HBAR | `PaymentEscrow` contract tests exercise create/fund/release/refund, state, authorization, and events. | Tests execute on the configured Hedera-forked Hardhat network; fork startup may need public Testnet RPC access. |
| HTS | `TokenPaymentEscrow` tests exercise payment accounting, state, and failure behavior with token doubles; the association diagnostic records the local emulator boundary. | This does not emulate a real Testnet token relationship. HIP-719 association against newly created local contracts remains an emulator limitation. |
| HCS | Schema and publisher tests cover normalization, deterministic event IDs, input validation, duplicate coalescing, and failure isolation. | Mocked SDK tests do not submit or index a live HCS message. Delivery remains at-least-once across processes. |
| Mirror Node | Mocked adapter tests cover transaction/log/token/topic shapes, pagination, error mapping, and HBAR/HTS/HCS correlation. | These tests do not prove current indexer availability or a new Testnet event's indexing. |
| SDK | SDK tests cover settlement helpers, HCS and Mirror Node methods, response/error mapping, and receipt behavior. | Test doubles are not evidence of a new live transaction. |
| Browser/server boundary | Browser entry tests, TypeScript builds, and generated-bundle scan check that server-only SDK code and credentials do not enter browser assets. | This is a source/build boundary check, not a wallet-authorized user journey. |
| Scaffold regression | Static Harness checks verify template metadata, package manager, core files, and absence of local env files; Next.js build/typecheck verify the app. | M9 used a fresh scaffold smoke previously; rerunning it is separate from this recipe's root-workspace checks. |

The Hardhat command sets `HEDERA_FORKING=true`: it runs against the project's
local Hedera EVM fork configuration and may query the public Testnet RPC to
load fork state. It does not submit Testnet transactions. Unit tests that use
contract doubles and tests that mock SDK/HTTP boundaries remain local. The
`hardhat:chain` command starts a persistent fork node separately and is not
required for the in-process test command.

## Optional read-only Testnet check

The existing `packages/hardhat/test/hedera-testnet.integration.test.ts` check is
**CREDENTIAL-GATED**. It is enabled only when
`HEDERA_TESTNET_INTEGRATION=true`; it requires `HEDERA_NETWORK=testnet`,
`HEDERA_ACCOUNT_ID`, and `HEDERA_PRIVATE_KEY` in the ignored root `.env`. It
queries account information using the configured account and sends no
transaction. When the enable flag is absent, Mocha reports the test as
pending/skipped; this is not a Testnet pass.

Run it explicitly with:

```bash
HEDERA_TESTNET_INTEGRATION=true npm run hardhat:test
```

Never place account credentials in recipe files, test fixtures, CI variables,
or browser configuration. A missing or invalid credential must fail the
explicitly enabled check rather than silently fall back to a local result.

Previously validated shared Testnet references are documented for
read-only inspection:

| Resource | Testnet reference |
| --- | --- |
| `PaymentEscrow` | `0x85a038f7FB8E01EBD6F0E5B02791E57Bfb6aa260` / `0.0.10842321` |
| `TokenPaymentEscrow` | `0xa1069144BAc92E69634F8af332C92d053d9e72bb` / `0.0.10843288` |
| Fungible HTS token | `0.0.10843331`, six decimals |
| Public HCS audit topic | `0.0.10844125` |

These are shared reference resources, not resources provisioned by validation.
The local recipe does not write to them. M8's separate manual Testnet browser
wallet lifecycle was completed and recorded; that evidence is separate from
M10's deterministic local checks.

## Separate manual acceptance

M10's automated checks do not replace the M8 browser wallet lifecycle. The M8
manual Testnet wallet lifecycle is recorded complete in the M8 milestone
evidence; see [`reference-app.md`](reference-app.md#repeatable-testnet-validation)
for the repeatable procedure and its scope. That prior manual activity is not
counted as an M12 live transaction.

## M12 fresh-machine validation (2026-10-04–05)

Validation used an isolated shallow GitHub clone at the stated starting commit
(`9a9ff063fb2fd95c83bb81d32401302cdf44627b`) and a separate Scaffold HBAR
destination. The clean environment used Node.js 24.18.0 and the repository's
declared npm 10.0.0, with an empty process environment and separate npm cache.
No source `.env`, previous `node_modules`, build output, deployment directory,
or SDK distribution was copied into either workspace.

| Area | Validation performed | Result |
| --- | --- | --- |
| Fresh clone | GitHub clone; clean initial status; npm 10 `npm ci --legacy-peer-deps` | PASS |
| Contracts | Hardhat compile, types, and Hedera-fork tests | PASS — 45 tests; one credential-gated Testnet read skipped |
| SDK | Build, typecheck, and tests | PASS — 14 tests |
| Next.js | Typecheck and production build without `.env` | PASS |
| Browser/server boundary | Production asset inspection | PASS — 197 JavaScript assets |
| Hedera Harness | `npm run harness:validate` with no credentials | PASS — `passed=true`, zero findings; all ten declared commands exited 0 |
| Scaffold CLI | `create-scaffold-hbar@latest` (resolved to 0.4.1), public GitHub template, Next.js, Hardhat, npm, Testnet, Skills skipped | PASS — generation and dependency installation completed |
| Generated scaffold | Hardhat compile/tests, SDK build/typecheck/tests, workspace typechecks, Next.js production build, browser scan | PASS — 45 contract tests and 14 SDK tests; one credential-gated read skipped |
| Runtime | Generated app started with no credentials; requested `/` | PASS — HTTP 200; first development compile took about 97 seconds |
| Documentation commands | Compared root commands with package scripts; verified CLI flags using its current `--help`; CLI generation completed | PASS |
| Secret/template hygiene | Tracked secret-pattern and local-path scan; ignored env and generated-artifact checks | PASS — no real `.env`, private-key material, deployment JSON, VPS path, or temporary path in tracked/generated source |
| Diff hygiene | `git diff --check` | PASS |

The fresh npm install reported 84 audit findings (24 low, 28 moderate, 29
high, 3 critical). M11's package-path and reachability analysis remains in
[`security.md`](security.md); the install output is not evidence that those
advisories were remediated. npm 10 completed the clean install without npm 12's
six install-script policy warnings. The local/fork suites did not submit
Testnet transactions or publish HCS messages.

The scaffold's generated project remained Git-clean after build/test output;
the hygiene scan excluded disposable `.git`, `node_modules`, and `.next` build
directories while checking source and tracked files. Placeholder `.env.example`
files are intentional and contain no credentials.
