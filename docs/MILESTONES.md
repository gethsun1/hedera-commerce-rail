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

## Milestone 2 — Hedera Connection Layer — NOT STARTED

- **Objective:** Provide typed, validated network/client configuration for supported Hedera environments.
- **Dependencies:** Milestone 1.
- **Implementation tasks:** Define `testnet`/`mainnet`/local network models, validate account and signer settings, isolate signing, expose reusable client/RPC utilities, and test missing/invalid configuration.
- **Files affected:** `packages/hedera/` or equivalent shared module; Hardhat config; `.env.example`; unit tests and docs.
- **Acceptance criteria:** Configuration fails clearly when required values are absent; no credentials are logged; local/testnet selection is explicit.
- **Automated tests:** Config validation unit tests; typecheck/lint; offline client construction tests.
- **Manual verification:** Review a placeholder-only setup and verify network selection without submitting transactions.
- **Definition of done:** A new developer can configure a test account without source edits and understand signing behavior.
- **Potential risks:** Hedera SDK/provider interfaces and RPC capabilities may differ by service and network.

## Milestone 3 — Commerce Smart Contracts — NOT STARTED

- **Objective:** Implement and test generic HBAR escrow and milestone settlement primitives.
- **Dependencies:** Milestone 2 and written decisions for disputes/deadlines.
- **Implementation tasks:** Specify state transitions; implement creation, funding, release, refund, deadlines, access control, events, and failure cases; apply checks-effects-interactions and reentrancy protection.
- **Files affected:** `packages/hardhat/contracts/`, deploy scripts, tests, and contract design docs.
- **Acceptance criteria:** State transitions are permissioned and terminal states cannot be reopened; funds cannot be released/refunded twice; edge cases are documented.
- **Automated tests:** Unit/property-style tests for valid and invalid lifecycle transitions, reentrancy attempts, deadlines, and accounting.
- **Manual verification:** Review state diagram and event/API consistency; compile deployed bytecode locally only.
- **Definition of done:** Contract interface and security assumptions reviewed; no deployment without a later explicit milestone.
- **Potential risks:** Ambiguous dispute rights, native HBAR receipt behavior, and contract upgrade expectations.

## Milestone 4 — HTS Integration — NOT STARTED

- **Objective:** Add supported fungible HTS payment assets to settlement flows.
- **Dependencies:** Milestones 2–3.
- **Implementation tasks:** Choose the current supported HTS transfer path; model token decimals/association/allowance; define token failure handling and asset metadata.
- **Files affected:** Contracts, Hedera client package, tests, config, and integration docs.
- **Acceptance criteria:** Only supported tokens can be used under explicit policy; accounting handles token units correctly; failed transfers leave escrow state unchanged.
- **Automated tests:** Local Hedera fork integration tests and unit coverage for decimals, rejection, association, and transfer failures.
- **Manual verification:** Test with a disposable Testnet token/account after an explicit operator setup.
- **Definition of done:** HBAR and HTS paths have clear shared interfaces and separately verified semantics.
- **Potential risks:** Precompile/token behavior may diverge from generic EVM mocks; account association and fees.

## Milestone 5 — HCS Audit Trail — NOT STARTED

- **Objective:** Define and optionally publish privacy-conscious commerce audit events.
- **Dependencies:** Milestones 2–3; event/state schema stable.
- **Implementation tasks:** Version event schema; define topic setup, submitter permissions, retry/idempotency behavior, and contract-to-HCS correlation.
- **Files affected:** HCS integration module, schema/docs, tests, environment example.
- **Acceptance criteria:** Events are structured, versioned, correlated to on-chain state, and contain no secrets or unnecessary personal data.
- **Automated tests:** Schema validation, serialization, error/retry tests, and mocked client tests.
- **Manual verification:** Submit a sample to Testnet only with a designated test account/topic.
- **Definition of done:** Consumers can validate and correlate audit messages; HCS is clearly optional and not canonical escrow state.
- **Potential risks:** Duplicate messages, topic key permissions, fees, and immutable accidental disclosure.

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
