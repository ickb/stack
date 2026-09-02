# iCKB Stack Rewrite

> Status: Work in progress. The on-chain contracts are fixed; this work reshapes the TypeScript stack around them.

The iCKB Stack is being rebuilt to make its protocol boundaries easier to verify, its public SDK easier to use, and its bot and validation code easier to operate. This is not a protocol redesign. The rewrite preserves the deployed contracts and the fund-safety rules that protect signing, transaction submission, recovery, and deployment.

The work started with a whole-repository review. That review found a small number of correctness defects, including an inverted conversion in the order matcher, alongside a larger structural problem: callers had to coordinate chain snapshots, planning, transaction completion, signing, waiting, and recovery through conventions spread across several packages. The target design puts those invariants behind fewer, explicit boundaries.

## What is changing

- Five published packages become one browser-safe `@ickb/sdk` with a single entry point.
- Thirteen workspaces become six: `packages/{sdk,node-utils,testkit}` and `apps/{bot,validation,interface}`.
- The SDK exposes plain sampled state, typed planning results, stable error codes, and an explicit transaction lifecycle.
- Bot and interface share bounded exact committed-cell scans and persist no pending transaction identity.
- Stack selects exact inputs and output shapes; CCC retains collection-disabled fee preparation and signing mechanics, while its cache is never input-selection authority.
- The bot keeps the fund-safety policy and removes policy machinery that did not justify its complexity.
- Validation is organized around contract-derived vectors, property tests, an in-memory client, `ckb-debugger`, testnet smoke and soak runs, and continuous operational checks.
- The interface keeps its signer, chain-switch, accessibility, and exact-money guarantees while simplifying state management.

## Progress

| Phase               | State    | Work                                                                                                                                                                                                                                             |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0. Foundations      | Complete | Dependency and toolchain pins, repository hygiene, contract oracle, the C1 matcher correction, contract fixtures, and `ckb-debugger` pinning.                                                                                                    |
| 1. Test bed         | Complete | Golden vectors, property tests, `FakeClient`, tree-shaking checks, and the API Extractor entity probe.                                                                                                                                           |
| 2. SDK reshape      | Active   | Delivered: plain sampled state, typed results and errors, bounded exact committed-cell scans, and hybrid completion. Remaining: the SDK-owned dependency resolver, pre-sign congruence enforcement, and the offline identity/debugger exit lane. |
| 3. Repository shape | Planned  | Merge the SDK packages, move private workspaces, collapse test/config surfaces, and redistribute the required CI gates.                                                                                                                          |
| 4. Runtime          | Planned  | Bot state machine, minimal policy, validation product, event contracts, layered configuration, and staged systemd cutover.                                                                                                                       |
| 5. Depth            | Planned  | Real-header fixtures, mutation spot checks, live smoke wiring, and the selected resolved-balance, position-visibility, and planner-derived iCKB Max scope. Connected-destination iCKB migration remains a later slice.                           |

Every phase is expected to land through green slices. Required checks move with the code they protect; later CI reorganization cannot defer or weaken an earlier exit gate.

## Target safety boundaries

These are the rewrite's fund-safety requirements. Implementation proceeds only where a concrete consumer or fund-loss path justifies the boundary.

- Derive the transaction hash locally and reject a different node result.
- Reject connector-returned changes to ordered inputs, outputs, or output data before fee inspection or broadcast.
- Keep the fee ceiling on every signing path.
- Preserve the reserve floor, projected post-transaction guard, recovery exception, match-value-beats-fee rule, 21/20 shutdown, and consensus output limits.
- Treat ambiguous broadcast results as unresolved for one bounded observation window, then rebuild later from committed state rather than replaying persisted bytes.
- Keep chain identity and deployed dependency identity checks ahead of signing.
- Use the decision record's bounded account-scan contract: uncached exact-lock scans, client-side classification, outpoint deduplication, and typed fail-closed scan limits without anchors or connector-specific signer attestation.
- Preserve exit-code-2 behavior through systemd so a fund-safety halt does not become an automatic restart loop.
- Keep keys out of logs and agent-readable artifacts. Long-running signers use a separate service identity and systemd credentials.

## Reading guide

| Document                                                             | Status                  | Purpose                                                                                          |
| -------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| [Stack rewrite decisions](decisions.md)                              | Current decision record | Target architecture, accepted product decisions, implementation sequence, and amendments.        |
| [CCC integration constraints](ccc-integration.md)                    | Current companion       | Maps the external CKB/CCC audit findings onto concrete rewrite constraints.                      |
| [NervDAO iCKB feature investigation](nervdao-feature-map.md)         | Design investigation    | Evaluates which NervDAO workflows justify inclusion in the new interface.                        |
| [Wallet migration investigation](wallet-migration-investigation.md)  | Design investigation    | Records migration evidence, per-state constraints, and the selected connected-destination slice. |
| [Findings to investigate](findings-to-investigate.md)                | Open, non-authoritative | Confirmed current-code gaps and questions that remain after the decision record.                 |
| [Authority and enforcement review](reviews/authority-enforcement.md) | Review evidence         | Findings against a frozen working-tree version of the decision record and its enforcement gates. |

The [history](history/) contains the design path that led to the current record:

1. [Repository review](history/repository-review.md)
2. [Rewrite design](history/rewrite-design.md)
3. [Maintainer decisions](history/maintainer-decisions.md)
4. [Simplification review](history/simplification-review.md)
5. [Selected architecture](history/selected-architecture.md)

Historical documents remain useful for rationale and evidence, but they do not override the current decision record. Later timestamps or folder order do not imply authority.

## Still open

- npm version and registry handling, which blocks publication but not implementation.
- Correction of the stale ICKB-017 integration-audit reproduction.
- The current-code questions collected in [findings to investigate](findings-to-investigate.md), including ring intervention, generated-vector provenance, fee-safe CKB Max, and the deferred order-migration boundary.

This documentation separates settled decisions from open review work so implementation can continue without presenting an unresolved proposal as shipped behavior.
