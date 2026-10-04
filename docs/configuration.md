# Configuration and network setup

Copy only the relevant placeholder example into an ignored local file. The root `.env.example` is for Hardhat and server SDK tools; `packages/nextjs/.env.example` is for the frontend. No key is needed to render the app, use read-only Mirror Node calls, run SDK unit tests, or sign settlement with a connected browser wallet. Root and frontend keys configure an optional independent server HCS publisher and must be server-only.

| Variable | Required? / purpose | Exposure and format | Network implications |
| --- | --- | --- | --- |
| `HEDERA_NETWORK` | Required by SDK network clients; `local`, `testnet`, or `mainnet`. | Server only; literal name. | `local` targets a separate Hiero Local Node, not the `hardhat:chain` EVM fork. Testnet is chain ID 296; Mainnet is 295. |
| `HEDERA_ACCOUNT_ID` | Required with `HEDERA_PRIVATE_KEY` for server-signed Hiero SDK actions and optional audit route; e.g. `0.0.12345`. | Server secret configuration; never `NEXT_PUBLIC_`. | Use an account created on the selected network. Testnet credentials are not production credentials. |
| `HEDERA_PRIVATE_KEY` | Optional unless using server/operator signing; Hedera SDK private key in accepted DER/raw format. | Secret; never browser-visible or committed. | Dedicated least-privilege account on the selected network. Browser settlement does not use it. |
| `HEDERA_RPC_URL` | Optional Hardhat/SDK RPC override; frontend audit route has a Testnet default. | Server-side URL; root example is blank; URL format. | Select the matching network endpoint. Mainnet write configuration must be intentional. |
| `MIRROR_NODE_BASE_URL` | Optional Mirror Node origin override; default follows `HEDERA_NETWORK`. | Server-only HTTPS origin, no path/query/credentials. | Choose the matching Testnet or Mainnet indexer; reads are eventually consistent. |
| `HCS_TOPIC_ID` | Optional for topic reads; required for HCS publishing; numeric `shard.realm.number`, e.g. `0.0.12345`. | Public identifier, server configuration. | Topic must exist on selected network. HCS messages are public and immutable. |
| `HCS_TOPIC_SUBMIT_KEY` | Optional public key used when provisioning/submitting to a private topic. | Public key, not the corresponding private key. | The server's `HEDERA_PRIVATE_KEY` must match the topic submit key. |
| `HCS_ALLOW_MAINNET` | Optional; defaults false. Must be literal `true` to permit Mainnet publishing. | Server-only boolean string. | Explicit safety opt-in; does not itself make publishing safe. |
| `DEPLOYER_PRIVATE_KEY_ENCRYPTED` | Optional Hardhat encrypted-account workflow value, created/imported by account commands. | Encrypted secret material; server/tooling only. | Use a separate encrypted account for each intended network and protect the password. |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | Optional public WalletConnect project ID; Scaffold default is used when blank. | Browser-visible identifier, not a secret. | Wallet connection configuration. |
| `NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL` | Optional public wallet RPC override. | Browser-visible URL. | Testnet only; use a trusted endpoint. |
| `NEXT_PUBLIC_HEDERA_MAINNET_RPC_URL` | Optional public wallet RPC override. | Browser-visible URL. | Mainnet only; use a trusted endpoint. |
| `HEDERA_MIRROR_TESTNET_URL` / `HEDERA_MIRROR_MAINNET_URL` | Optional overrides for the account lookup route. | Server-side endpoint URLs. | Each variable applies only to its named network. |
| `M41_TOKEN_ID` / `M41_PAYEE_ADDRESS` | Optional legacy M4.1 diagnostic inputs only. | Server/tooling; token ID `0.0.number`, EVM address `0x…`. | Testnet diagnostic; not needed by the app or ordinary validation. |
| `HEDERA_TESTNET_INTEGRATION` | Optional test switch; literal `true` enables a credential-gated read-only account query. | Test process only. | Requires Testnet account configuration; sends no transaction. |
| `HEDERA_FORKING` / `REPORT_GAS` | Set internally by the Hardhat test/chain scripts. | Local test process only. | Fork tests read Hedera RPC state; they do not submit live transactions. |
| `MAINNET_FORKING_ENABLED` | Internal Hardhat fork toggle used by the `hardhat:fork` script. | Local process only; do not set for ordinary tests. | Enables a Mainnet fork for local reads; does not authorize or submit Mainnet writes. |
| `PORT` / `VERCEL_PROJECT_PRODUCTION_URL` | Optional Next.js metadata inputs supplied by the runtime. | `PORT` is a local port number; production URL is public host metadata. | Neither selects a Hedera network or carries credentials. |
| `__RUNTIME_DEPLOYER_PRIVATE_KEY` | Internal transient variable set by the encrypted Hardhat deploy wrapper. | Secret, process-local; never configure manually or persist. | Only exists while a deployment command runs. |

`PAYMENT_ESCROW_ADDRESS` and `TOKEN_PAYMENT_ESCROW_ADDRESS` in the SDK guide are application configuration values supplied directly to `createCommerceClient`, not repository environment variables. Keep all secret values out of source, logs, browser props/storage, audit metadata, and scaffold output. Never treat a Testnet key as a Mainnet key.

## Testnet and Mainnet operations

Testnet and Mainnet are separate networks with separate accounts, keys, contracts, HTS tokens, and HCS topics. Testnet uses EVM chain ID 296; Mainnet uses 295. A deployment requires an existing funded Hedera account and a deliberate Hardhat network selection; from the repository root, the Testnet form is `npm run hardhat:deploy -- --network hederaTestnet --tags PaymentEscrow`. This command submits a deployment transaction and is not part of local validation. Mainnet requires replacing demonstration addresses, independently reviewing contract bytecode and config, funding a dedicated production account, protecting keys with an operational secret manager, and explicitly selecting `hederaMainnet`. Public reads should not require signing credentials where avoidable. Operators provision and associate HTS token resources and provision HCS topics separately.
