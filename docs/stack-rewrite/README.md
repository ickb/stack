# iCKB Stack Rewrite

> Status: Work in progress. The on-chain contracts are fixed; this work reshapes the TypeScript stack around them.

The iCKB Stack is being rebuilt to make its protocol boundaries easier to verify, its public SDK easier to use, and its bot and validation code easier to operate. This is not a protocol redesign. The rewrite preserves the deployed contracts and the fund-safety rules that protect signing, transaction submission, recovery, and deployment.

The work started with a whole-repository review. That review found a small number of correctness defects, including an inverted conversion in the order matcher, alongside a larger structural problem: callers had to coordinate chain snapshots, planning, transaction completion, signing, waiting, and recovery through conventions spread across several packages. The target design puts those invariants behind fewer, explicit boundaries.

## What is changing

- Five published packages become one browser-safe `@ickb/sdk` with a single entry point.
- Thirteen workspaces become four at the root: `sdk`, its `sdk/node` actors, `testkit`, and `interface`; `sdk/node` holds the bot, stimulus generator, and sampler entrypoints.
- The SDK exposes plain sampled state, typed planning results, stable error codes, and an explicit transaction lifecycle.
- Bot and interface read committed cells through one uncached exact-lock scan per account lock, classified client-side, and persist no pending transaction identity.
- Stack selects exact inputs and output shapes; CCC retains collection-disabled fee preparation and signing mechanics, while its cache is never input-selection authority.
- The bot keeps the fund-safety policy and removes policy machinery that did not justify its complexity.
- Validation is organized around contract-derived vectors, property tests, an in-memory client, testnet smoke and soak runs, and continuous operational checks.
- The interface keeps its signer, chain-switch, accessibility, and exact-money guarantees while simplifying state management.

## Progress

| Phase               | State    | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Foundations      | Complete | Dependency and toolchain pins, repository hygiene, contract oracle, and the C1 matcher correction.                                                                                                                                                                                                                                                                                                                                                                           |
| 1. Test bed         | Complete | Golden vectors, property tests, `FakeClient`, tree-shaking checks, and the API Extractor entity probe.                                                                                                                                                                                                                                                                                                                                                                       |
| 2. SDK reshape      | Complete | Plain sampled state, typed results and errors, uncapped exact-lock scans, scan-free completion that compacts the account, and the one-transaction match search (amendment 52); the shape of 52(g) is in place.                                                                                                                                                                                                                                                               |
| 3. Repository shape | Complete | The SDK packages merged into `@ickb/sdk` and each app into its package (amendment 35); the packed-artifact probes, export manifest, and release tags retired (52(r)).                                                                                                                                                                                                                                                                                                        |
| 4. Runtime          | Active   | Delivered: single-turn bot and stimulus generator under a systemd user unit with env config (amendments 32-34, 48) and the one-transaction turn policy with its typed events (amendment 52). Outstanding: the N20 rows not yet observed on testnet (deposit maturity, receipt completion by the bot, the partial cap).                                                                                                                                                       |
| 5. Depth            | Planned  | Product features that each wait for a decision: the position list of amendment 29 (resolved order, receipt, and withdrawal positions with value, state, and maturity), connected-destination iCKB migration, and amendment 29's deferred set (fee-safe CKB Max, position dates, order cancellation or replacement, protocol history, global liquidity and APY). Test depth (real-header fixtures, mutation spot checks, live smoke wiring) only against an observed failure. |

Every phase is expected to land through green slices. Required checks move with the code they protect; later CI reorganization cannot defer or weaken an earlier exit gate.

## Target safety boundaries

These are the rewrite's fund-safety requirements. Implementation proceeds only where a concrete consumer or fund-loss path justifies the boundary.

- Derive the transaction hash locally and use it as the confirmation identity whatever the node returns.
- Reject connector-returned changes to ordered inputs, outputs, or output data before fee inspection or broadcast.
- Keep the fee ceiling on every signing path.
- Keep the reserve as a sizing line for matches and deposits (no check on the completed transaction, amendment 52(i)), the match-gain-beats-fee rule, and the consensus output limits (amendment 52).
- Treat ambiguous broadcast results as unresolved for one bounded observation window, then let the next turn rebuild from committed state rather than replaying persisted bytes.
- Keep the chain identity check ahead of signing; dependency identity is enforced by `data1` code-hash pinning at the node (amendment 52).
- Read every cell through uncached exact-lock scans with client-side classification, complete and uncapped, without anchors, scan limits, or connector-specific signer attestation (amendment 52).
- Exit `0` after a skipped or committed turn and `1` after any failure; an underfunded account skips turn after turn until funded, so no exit code halts the unit (amendment 52).
- Keep keys out of logs and agent-readable artifacts. The signing key lives only in a mode 0600 file named by the unit; it never enters environment values or unit text.

## Reading guide

| Document                                              | Status                  | Purpose                                                                                   |
| ----------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| [Stack rewrite decisions](decisions.md)               | Current decision record | Target architecture, accepted product decisions, implementation sequence, and amendments. |
| [CCC integration constraints](ccc-integration.md)     | Current companion       | Maps the external CKB/CCC audit findings onto concrete rewrite constraints.               |
| [Findings to investigate](findings-to-investigate.md) | Open, non-authoritative | Confirmed current-code gaps and questions that remain after the decision record.          |

The design passes that led to this record, the frozen-tree review of it, and the two interface investigations behind amendments 30 and 31 were deleted on 2026-09-05; git history keeps them, and the decision record carries their outcomes.

## Still open

- npm version and registry handling, which blocks publication but not implementation.
- The current-code questions collected in [findings to investigate](findings-to-investigate.md), including ring intervention, generated-vector provenance, fee-safe CKB Max, and the deferred order-migration boundary.

This documentation separates settled decisions from open review work so implementation can continue without presenting an unresolved proposal as shipped behavior.
