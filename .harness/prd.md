# Hedera Commerce Rail validation contract

This recipe checks that the reusable template retains its documented Hedera
boundaries and that its credential-free automated validation remains green.
It does not deploy contracts, submit HBAR or HTS transactions, publish HCS
messages, or replace the manual M8 wallet lifecycle.

The local commands cover escrow contract tests, HCS schema/publisher behavior,
Mirror Node parsing and correlation, SDK behavior, the browser/server package
boundary, and the scaffolded Next.js application. Real Testnet writes are not
part of this recipe.
