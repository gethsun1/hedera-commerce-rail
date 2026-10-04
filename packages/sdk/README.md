# `@hedera-commerce/sdk`

Private workspace package for the Hedera Commerce Rail SDK, with separate browser and server entry points. See the repository [SDK guide](../../docs/sdk.md) for the public API, configuration, examples, security boundaries, and transaction semantics.

```ts
import { createCommerceClient } from "@hedera-commerce/sdk";
```

From the repository root: `npm run sdk:build`, `npm run sdk:check-types`, and `npm run sdk:test`. The package is currently private and is not published to npm.

# Commerce SDK entry points

Use `@hedera-commerce/sdk/browser` from browser code. It accepts only an Ethers signer provided by the connected wallet and has no private-key configuration, Hiero client, HCS publisher, or Mirror Node client. Use `@hedera-commerce/sdk/server` for the existing M7 operator signing, HCS publishing, and Mirror Node features. The root entry remains a compatibility alias for the server entry.

The browser client validates Hedera chain IDs before reads and writes (296 Testnet, 295 Mainnet), signs only through the supplied signer, and waits for a successful receipt. HBAR amounts are tinybars; HTS amounts are smallest units. Wallet rejection and an unobserved confirmation are reported distinctly. Client JSON serialization exposes only network and capability flags.
