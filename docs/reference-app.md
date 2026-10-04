# Reference application (M8)

The home page presents HBAR and HTS escrow, existing indexed M5 audit messages, and connected wallet settlement. The Scaffold HBAR RainbowKit/Wagmi connector supplies the signer to `@hedera-commerce/sdk/browser`. Shared SDK settlement code handles denomination conversion, input/term validation, ABI calls, chain checks, receipt confirmation, and error mapping. `@hedera-commerce/sdk/server` stays server-side for Mirror Node and the M5 HCS publisher.

## Run and configure

Copy `packages/nextjs/.env.example` to `packages/nextjs/.env.local`. Set `HCS_TOPIC_ID` to a topic you control (the validation reference topic is Testnet `0.0.10844125`) to display audit messages. Configure the server-only `HEDERA_ACCOUNT_ID`, `HEDERA_PRIVATE_KEY`, and optional `HEDERA_RPC_URL` only if you want the server to publish audits. The page loads and wallet settlement works without these server credentials; HCS publication remains unavailable until configured. Never prefix credentials with `NEXT_PUBLIC_`. `MIRROR_NODE_BASE_URL` is optional and must be an HTTPS origin. Start from the repository root with `npm run next:dev` (`http://localhost:3000`).

The server component queries the configured HCS topic and correlates M5 events with M6 Mirror Node contract results. The browser imports only `@hedera-commerce/sdk/browser`, resolves the signer from the active Scaffold connector, and validates Hedera Testnet chain ID 296 before reads and transactions.

## HBAR settlement

Use a connected Hedera Testnet wallet. Enter a controlled payee EVM address and `1000000` tinybars (0.01 HBAR) for the first small-value check. Choose **Create and fund**, approve the create and fund wallet prompts, read the displayed payment state, then choose **Release** while the payer or arbiter is connected. Refund is enabled only for an authorized actor when the deadline or arbiter rule permits it. The connected account is the payer and transaction signer; there is no server signer fallback. Success is shown only after receipt confirmation.

After a confirmed release or refund, the page requests an independent audit operation. The wallet signs a free message binding the request to that transaction; this is not another transaction and costs no HBAR. The server checks the signature against the transaction sender, verifies the receipt and matching escrow event, fetches the corresponding Mirror Node log, reconstructs the event with the existing M5 schema, and calls the existing publisher. Audit status does not control settlement status. If indexing is pending, the page offers a retry; if HCS fails or the message signature is declined, the confirmed settlement remains confirmed. The result includes event ID and, once indexed, topic sequence and consensus timestamp.

## HTS reference flow

The panel uses the reference M4 `TokenPaymentEscrow` and token `0.0.10843331` (Testnet, fungible, six decimals); scaffolding does not create them. It exposes user-account association, escrow association, create, exact payer allowance, fund, read, release, and refund. The token holder must connect their own wallet to associate and approve. The payer must own at least the selected smallest-unit amount; the panel does not assume token ownership or association. The escrow also needs token association. Contract authorization and deadlines remain authoritative. Use the read-only Testnet account/token relationships to confirm holdings and association before attempting a transaction; do not spend significant test tokens.

The connected account is always the payer. The UI does not accept a payer address, pass operator credentials to client props, or place them in browser storage or URLs. No end-user can approve another account's allowance.

The Scaffold development burner wallet, when enabled, uses tab-scoped `sessionStorage`; its key is not persisted in `localStorage`. For Testnet validation, an external Hedera-compatible wallet is recommended.

## Provenance layers

- **Settlement:** the escrow contract is authoritative for payment state; the panel shows confirmed transaction and contract address.
- **Audit:** HCS carries the deterministic Commerce event, topic sequence, and consensus timestamp when published and indexed.
- **Verification:** Mirror Node provides indexed transaction/log lookup and correlation. It is a query layer, not a cryptographic proof. Indexing delay is shown as pending rather than failure.

Rendering the page creates no transaction or HCS message. The activity list contains actual records from the configured Testnet topic, not simulated events.

## Repeatable Testnet validation

Automated checks cannot approve wallet prompts. For the live HBAR check:

1. Run `npm run next:dev` and open `http://localhost:3000`.
2. Connect a wallet funded with Testnet HBAR and select Hedera Testnet, chain ID 296.
3. Enter a controlled payee address and `1000000` tinybars (0.01 HBAR); choose **Create and fund** and approve both prompts.
4. Capture both transaction hashes. Confirm the payment ID and **Funded** state.
5. Choose **Release** and approve. Capture its transaction hash and confirm **Released** state. Sign the following wallet message to authorize the independent audit publication; decline does not undo settlement.
6. Wait for Mirror Node indexing. Confirm the source transaction, contract log, event ID, HCS status, topic sequence, and consensus timestamp in the panel/topic. Use the HashScan transaction links and the topic activity section to cross-check.

**M8 manual browser wallet validation outstanding.** This procedure can be repeated with a wallet you control; automated validation does not count as wallet lifecycle evidence. The connected account must hold and associate the existing reference token; its public token record confirms the token exists and has six decimals, but does not establish ownership by a new developer's wallet.
