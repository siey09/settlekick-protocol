# npm Audit Exceptions

## @solana/web3.js 1.98.4 transitive uuid advisory

Status: Temporarily accepted  
Reviewed: 2026-07-11  
Severity: Moderate  
Advisory: GHSA-w5hq-g745-h8pq

Dependency path:

- @settlekick/txline-client
- @solana/web3.js 1.98.4
- jayson 4.3.0
- uuid 8.3.2

Reason for temporary acceptance:

- The advisory affects uuid v3, v5, and v6 methods when a caller supplies an output buffer.
- SettleKick's unsigned transaction builder does not directly import or call uuid.
- The current builder performs deterministic local transaction construction only.
- It does not request RPC data, read a private key, sign, or broadcast a transaction.
- npm currently offers no compatible patched @solana/web3.js 1.x resolution through npm audit.
- npm audit suggests a breaking and invalid-looking downgrade rather than a compatible patch.

Controls:

- High and critical npm findings fail through `npm run audit:high`.
- The builder has tests confirming no RPC request, private-key read, signing, or sending.
- Dependency versions are pinned in package-lock.json.
- This exception must be reviewed when @solana/web3.js, jayson, or uuid publishes a compatible fix.
- Do not use `npm audit fix --force` for this exception.

This exception does not mean the dependency is vulnerability-free.
