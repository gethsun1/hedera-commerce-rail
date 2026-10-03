# Development milestones

Statuses are evidence-based. A milestone is complete only after its stated checks pass and its outcome is recorded in the development log.

## Milestone 0 — Reconnaissance & Architecture — COMPLETE

- **Objective:** Inspect the VPS, representative applications, and current Scaffold HBAR conventions; choose a bounded architecture.
- **Dependencies:** None.
- **Implementation tasks:** Read-only environment/service and project inspection; inspect the official CLI and blank-template branch; record constraints and decisions.
- **Files affected:** `docs/architecture.md`, `docs/DEVELOPMENT_LOG.md`, this roadmap.
- **Acceptance criteria:** Host/tooling and relevant project patterns are recorded; current CLI/template mechanism is verified from upstream source; existing production projects remain untouched.
- **Automated tests:** Not applicable; read-only reconnaissance.
- **Manual verification:** Confirm `/srv/apps` contents and inspect status/configuration of representative projects and running services.
- **Definition of done:** Findings and unresolved infrastructure warnings are documented.
- **Potential risks:** Existing repositories may contain concurrent work; upstream CLI conventions can change.

## Milestone 1 — Project Foundation — COMPLETE

- **Objective:** Establish a clean, buildable Scaffold HBAR-based repository and document the plan.
- **Dependencies:** Milestone 0.
- **Implementation tasks:** Initialize from official blank starter with Next.js + Hardhat; retain template metadata/workspace; establish npm root commands, safe environment examples, README, Git, and docs.
- **Files affected:** Root metadata/config; `packages/nextjs`, `packages/hardhat`; `.env.example`; `README.md`; `docs/*`.
- **Acceptance criteria:** Upstream layout is recognizable; build, lint, and test commands exist and are verified; ignore rules exclude credentials and generated dependencies; no new network deployment.
- **Automated tests:** `npm install --legacy-peer-deps`; `npm run build`; `npm run lint`; `npm test`; secret-pattern review.
- **Manual verification:** Inspect repository file list and Git status; check example config and scaffold metadata; confirm no test/deploy reached live accounts.
- **Definition of done:** All applicable checks and limitations are recorded; only this milestone is complete.
- **Potential risks:** Upstream sample HTS test needs a Hedera-compatible fork; baseline configuration may require hardening before use with funded accounts.

## Milestone 2 — Hedera Connection Layer — COMPLETE

- **Objective:** Provide typed, validated network/client configuration for supported Hedera environments.
- **Dependencies:** Milestone 1.
- **Implementation tasks:** Define `testnet`/`mainnet`/local network models, validate account and signer settings, isolate signing, expose reusable client/RPC utilities, and test missing/invalid configuration.
- **Files affected:** `packages/hedera/` or equivalent shared module; Hardhat config; `.env.example`; unit tests and docs.
- **Acceptance criteria:** Configuration fails clearly when required values are absent; no credentials are logged; local/testnet selection is explicit.
- **Automated tests:** Config validation unit tests; typecheck/lint; offline client construction tests.
- **Manual verification:** Review a placeholder-only setup and verify network selection without submitting transactions.
- **Definition of done:** A new developer can configure a test account without source edits and understand signing behavior. The SDK module and environment validation are in `packages/hardhat/lib/hedera/config.ts`; local client construction is credential-free, while public networks require explicit credentials. Hardhat no longer falls back to the public local test key for Hedera networks.
- **Potential risks:** Hedera SDK/provider interfaces and RPC capabilities may differ by service and network.

## Milestone 3 — Commerce Smart Contracts — COMPLETE

- **Objective:** Implement and test a focused native HBAR escrow primitive. Multi-milestone settlement is deferred.
- **Dependencies:** Milestone 2; payer refund after deadline and arbiter resolution policy are specified in the contract/docs.
- **Implementation tasks:** Specify state transitions; implement agreement creation, funding, release, refund, deadlines, access control, events, and failure cases; apply checks-effects-interactions and reentrancy protection.
- **Files affected:** `packages/hardhat/contracts/`, deploy scripts, tests, and contract design docs.
- **Acceptance criteria:** State transitions are permissioned and terminal states cannot be reopened; funds cannot be released/refunded twice; edge cases are documented.
- **Automated tests:** Unit/property-style tests for valid and invalid lifecycle transitions, reentrancy attempts, deadlines, and accounting.
- **Manual verification:** Review state diagram and event/API consistency; compile deployed bytecode locally. Testnet deployment remains explicit and optional.
- **Definition of done:** Contract interface and security assumptions reviewed; all validation recorded in the development log; no automatic deployment.
- **Potential risks:** Arbiter trust, native HBAR denomination, and contract upgrade expectations.

## Milestone 3.5 — Testnet Readiness & Deployment — INCOMPLETE (GitHub push blocked)

- **Objective:** Validate the configured ECDSA Testnet signer, deploy only the M3 `PaymentEscrow`, verify its on-network code, and publish a documented GitHub checkpoint.
- **Credential handling:** The repository-root `.env` is ignored and remains local. The ECDSA signer is used for EVM/Hardhat operations; ED25519 credentials are not used for deployment.
- **Deployment:** Hedera Testnet, chain ID 296; `PaymentEscrow` at `0x85a038f7FB8E01EBD6F0E5B02791E57Bfb6aa260` (Hedera contract `0.0.10842321`), transaction `0xb8dedb6bd8cf23ae03496594e15bb4f887a8b9e20d5b86f081f4ef06f15f1c13`, 2026-10-03 13:09:42 UTC.
- **Verification:** Mirror Node contract and transaction results returned HTTP 200 / `SUCCESS`; Testnet JSON-RPC reported non-empty runtime bytecode and chain ID 296. No payment-flow transaction was sent.
- **Definition of done:** Signer/account, M3 checks, secret protection, docs, and focused local commit are verified. GitHub push is still required to complete this checkpoint. M4 HTS integration has NOT started.
- **GitHub checkpoint:** SSH push was rejected (`Permission denied (publickey)`). The authenticated GitHub CLI account has repository write access, but GitHub rejected publishing `.github/workflows/lint.yaml` because its OAuth token lacks the `workflow` scope. No credential was changed and no history was rewritten.
- **Potential risks:** Testnet deployment is not an audit; arbiter trust and M3 limitations remain as documented.

## Milestone 4 — HTS Integration — COMPLETE (Testnet validated)

- **Objective:** Add supported fungible HTS payment assets to settlement flows.
- **Dependencies:** Milestones 2–3.
- **Implementation tasks:** Choose the current supported HTS transfer path; model token decimals/association/allowance; define token failure handling and asset metadata.
- **Files affected:** Contracts, Hedera client package, tests, config, and integration docs.
- **Acceptance criteria:** Only supported tokens can be used under explicit policy; accounting handles token units correctly; failed transfers leave escrow state unchanged.
- **Automated tests:** Token lifecycle unit tests pass with a token double; existing HTS provisioning tests pass. End-to-end association/transfer against the local Hedera fork currently reverts inside the fork emulation layer and is not accepted as complete verification.
- **Manual verification:** Testnet deployment and lifecycle using a dedicated test token/account; Mirror Node confirms transactions, logs, and final balances.
- **Definition of done:** HBAR and HTS paths have separate interfaces and separately verified semantics. Met through Testnet validation; local fork association remains an emulator limitation and is documented.
- **Potential risks:** Precompile/token behavior may diverge from generic EVM mocks; account association and fees.

The implementation adds `TokenPaymentEscrow` and a tagged deployment script. Testnet: contract `0xa1069144BAc92E69634F8af332C92d053d9e72bb` (`0.0.10843288`), token `0.0.10843331` (`0x0000000000000000000000000000000000a574C3`). The escrow and payee contract self-associated, payer approved the escrow, payments 1 and 2 were released, and payment 5 was refunded after its deadline. Final payer/payee/escrow balances were 98/2/0 token units (6 decimals); escrow liability was zero. Mirror Node confirmed terminal states and logs. The local fork diagnostic fails because new local contracts lack remote Hedera entity mappings required by its HIP-719 emulator; this is separate from the successful Testnet validation. See the development log for evidence and transaction hashes.

## Milestone 5 — HCS Audit Trail — COMPLETE

- **Objective:** Define and optionally publish privacy-conscious commerce audit events.
- **Dependencies:** Milestones 2–3; event/state schema stable.
- **Implementation tasks:** Version event schema; define topic setup, submitter permissions, retry/idempotency behavior, and contract-to-HCS correlation.
- **Files affected:** HCS integration module, schema/docs, tests, environment example.
- **Acceptance criteria:** Events are structured, versioned, correlated to on-chain state, and contain no secrets or unnecessary personal data.
- **Automated tests:** Schema validation, serialization, error/retry tests, and mocked client tests.
- **Manual verification:** Submit a sample to Testnet only with a designated test account/topic.
- **Definition of done:** Consumers can validate and correlate audit messages; HCS is clearly optional and not canonical escrow state. Testnet verification is recorded in the development log. Delivery is at-least-once across process restarts; consumers deduplicate by event ID.
- **Potential risks:** Duplicate messages, topic key permissions, fees, and immutable accidental disclosure.

M5 adds `packages/hardhat/lib/hcs/{schema,publisher}.ts` and opt-in `hcs:topic:create` / `hcs:smoke` workflows. Topic `0.0.10844125` was provisioned on Testnet. Mirror Node confirmed ordered schema-v1 HBAR and HTS_FUNGIBLE messages at sequences 3 and 4, with consensus timestamps and source EVM transaction/log coordinates. A prior smoke retry also wrote duplicate messages at sequences 1 and 2 after an RPC reset; delivery is at-least-once and consumers must deduplicate by `eventId`. No payment settlement depends on HCS. Exact evidence is in the M5 development log.

## Milestone 6 — Mirror Node Integration — NOT STARTED

- **Objective:** Provide reusable read-only history and event queries.
- **Dependencies:** Milestones 2–5 as applicable.
- **Implementation tasks:** Build typed clients for transactions, contract events, HCS messages, and payment history; handle paging, throttling, and indexing delay.
- **Files affected:** `packages/mirror-node/` or equivalent; tests and docs.
- **Acceptance criteria:** Read APIs are network-aware, paginated, resilient to transient failures, and distinguish not-yet-indexed from absent data.
- **Automated tests:** Fixture-based parsing, pagination, timeout/retry, and error tests.
- **Manual verification:** Compare returned test data with an authoritative Hedera explorer/Mirror Node response.
- **Definition of done:** App history views use read-only utilities and explain indexer delay.
- **Potential risks:** Mirror Node schema/version and service availability can change.

## Milestone 7 — Commerce SDK — NOT STARTED

- **Objective:** Offer a stable developer API over contracts, assets, and history.
- **Dependencies:** Milestones 2–6.
- **Implementation tasks:** Design typed `createPayment`, `fundPayment`, `releaseMilestone`, `refundPayment`, `getPayment`, and `getPaymentHistory` equivalents; standardize results/errors and wallet injection.
- **Files affected:** `packages/commerce-core/`, exports, tests, examples, API docs.
- **Acceptance criteria:** SDK hides repetitive wiring without hiding network/signing choices; functions are typed and framework-independent.
- **Automated tests:** Unit tests with wallet/client doubles plus local-chain integration tests.
- **Manual verification:** Complete a local lifecycle through the public SDK.
- **Definition of done:** Example code can use the SDK without importing app internals.
- **Potential risks:** Coupling ABI/client package versions and unstable API design.

## Milestone 8 — Reference Application — NOT STARTED

- **Objective:** Demonstrate buyer-to-provider milestone settlement in a simple, polished UI.
- **Dependencies:** Milestones 3 and 7; optional 5–6 for history.
- **Implementation tasks:** Create payment, fund escrow, approve/release milestone, show refund path and audit history, and communicate wallet/network state.
- **Files affected:** `packages/nextjs/app`, components, hooks, tests, screenshots/docs.
- **Acceptance criteria:** A user can follow the full demo without hidden steps; pending/failed/success states are clear; test data is labeled.
- **Automated tests:** Component/unit tests and browser smoke for the user path.
- **Manual verification:** Run against local Hedera fork and later Testnet with disposable accounts.
- **Definition of done:** Demo path is repeatable and does not require production credentials.
- **Potential risks:** Wallet UX friction and delayed Mirror Node indexing.

## Milestone 9 — Developer Experience — NOT STARTED

- **Objective:** Make this repository reliably scaffoldable through the published CLI.
- **Dependencies:** Milestones 1–8; repository published at the intended GitHub path.
- **Implementation tasks:** Confirm template.json capabilities/defaults; verify template download and npm/Yarn transformations; ensure project branding/docs/scripts survive CLI processing.
- **Files affected:** `template.json`, root package metadata, docs, CI/scaffold smoke scripts.
- **Acceptance criteria:** `npm create scaffold-hbar@latest -- --template <org/repo>` (or documented CLI equivalent) yields a runnable project from a clean directory.
- **Automated tests:** CLI scaffold smoke test with install skipped and a separate clean install/build check.
- **Manual verification:** Follow generated CLI instructions on a clean checkout.
- **Definition of done:** Scaffold path and package-manager support are demonstrated from the actual published ref.
- **Potential risks:** CLI version changes, GitHub access/rate limits, and package-manager rewrite behavior.

## Milestone 10 — Automated Validation / Hedera Harness — NOT STARTED

- **Objective:** Add repeatable validation tiers and harness recipe if it improves template quality.
- **Dependencies:** Stable commands and workflows from Milestones 3–9.
- **Implementation tasks:** Define build, unit, local-chain, Testnet, semantic, and deployment-validation tiers; add a Harness spec/validators where practical.
- **Files affected:** CI workflows, scripts, `.harness/` recipe/spec, docs.
- **Acceptance criteria:** Offline tiers run without secrets; live checks require explicit config and report skipped vs failed clearly.
- **Automated tests:** CI on pull requests; recipe validation and smoke checks.
- **Manual verification:** Run each tier and inspect safe handling of missing credentials.
- **Definition of done:** Validation commands are documented, deterministic, and do not deploy by surprise.
- **Potential risks:** External RPC flakiness and false failures from indexer delays.

## Milestone 11 — Security & Production Hardening — NOT STARTED

- **Objective:** Review contract, client, wallet, configuration, and supply-chain risks.
- **Dependencies:** Feature-complete contracts/SDK/app.
- **Implementation tasks:** Review authorization, reentrancy, arithmetic, deadlines, token edge cases, secrets, dependency advisories, and deployment controls; remediate findings.
- **Files affected:** Contracts, all packages, CI, security documentation.
- **Acceptance criteria:** Findings have severity, resolution, and evidence; secrets scan clean; dangerous deployment requires deliberate configuration.
- **Automated tests:** Security/static analyzers, dependency audit, secret scan, regression suite.
- **Manual verification:** Independent code review and deployment checklist review.
- **Definition of done:** No unresolved critical/high issues for the intended demo scope; limitations disclosed.
- **Potential risks:** Automated tools miss logic flaws; external audits exceed hackathon scope.

## Milestone 12 — Documentation & Fresh-Machine Validation — NOT STARTED

- **Objective:** Prove a new developer can install, run, test, and understand the template.
- **Dependencies:** Milestones 9–11.
- **Implementation tasks:** Finalize setup, network/account, architecture, troubleshooting, API, and security docs; validate clean environment steps.
- **Files affected:** README, package guides, docs, examples.
- **Acceptance criteria:** Instructions work from a fresh checkout without undocumented author knowledge; placeholders are safe.
- **Automated tests:** Documentation command smoke where practical; full install/build/test suite.
- **Manual verification:** Independent fresh-machine walkthrough and review.
- **Definition of done:** Issues from walkthrough are fixed and steps are reproducible.
- **Potential risks:** Toolchain drift and platform-specific instructions.

## Milestone 13 — Hackathon Submission — NOT STARTED

- **Objective:** Package a clear and verifiable submission demonstrating genuine Hedera utility.
- **Dependencies:** Milestones 10–12 and a working reference demo.
- **Implementation tasks:** Prepare final README, architecture diagram, screenshots, demo, technical highlights, integration explanation, and test evidence.
- **Files affected:** README, docs, demo assets, submission material.
- **Acceptance criteria:** Claims match implementation; demo is reproducible; repository is clean and license/attribution are clear.
- **Automated tests:** Final CI/build/test and scaffold smoke run.
- **Manual verification:** Rehearse demo and inspect published repository from a clean account/session.
- **Definition of done:** Submission package is complete and backed by recorded evidence.
- **Potential risks:** Submission requirements/deadlines may change and should be checked when this milestone begins.
