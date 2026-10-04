# Known limitations

- HCS publication is **at-least-once**. An ambiguous submission followed by retry may create a duplicate; consumers must deduplicate by deterministic event ID.
- There is no durable cross-process outbox. In-process duplicate suppression does not survive a restart.
- Mirror Node is eventually consistent and may lag consensus or return partial results. Contract state and successful receipts remain authoritative.
- HBAR forcibly transferred around the normal receive path can create contract surplus that is not accounted for in escrow liabilities and has no recovery method.
- HTS association is required for the escrow and participating accounts. Allowance does not create association. The local fork's HIP-719/self-association limitation means local tests do not prove live token association behavior.
- Server/operator credentials and deployment keys require secure storage, access control, rotation, and network-specific separation by the operator.
- M11's dependency audit reported residual critical/high/moderate/low transitive and development advisories. See [security review](security.md); this project does not claim zero vulnerabilities or formal audit.
- The SDK package is private and unpublished; it is consumed through the repository workspace.
- Mainnet writes require deliberate network configuration and operational review. The reference application addresses and token/topic IDs are demonstration Testnet resources and are not provisioned by scaffolding.
- Public RPC, HCS, and Mirror Node services can be rate limited, unavailable, or delayed. Retrying a write after an ambiguous result requires checking transaction/audit state first.
