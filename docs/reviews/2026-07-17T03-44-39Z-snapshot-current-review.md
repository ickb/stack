# Snapshot Review: Current Sol Review Policy

## Scope and Freshness

- Source: a disposable snapshot of the complete dirty Stack checkout.
- Snapshot HEAD: `ca51bf88d57887fcc554f8697939e0560e9ef2ab`.
- Snapshot dirty-status hash: `3384660eb9ec35e553f1b4d25a7ed85d82f60295e823d038a817e5b969282206`.
- Session: `ses_092034c3fffeH2t7qtsNXcpAmm`, GPT-5.6 Sol at high effort with the current OpenCode review and simplification policy.
- Isolation: Git remotes, linked-worktree metadata, prior `docs/reviews` reports, local runtime configs, logs, and scratch files were absent. The session was read-only and made no source changes.
- Freshness warning: these findings were generated from a frozen snapshot. The original checkout may have changed since it was copied. Reproduce each finding against the current checkout before fixing or closing it.

## Findings

### High: exact order matching can miss a profitable feasible match

`packages/order/src/matching/order_match_sequence.ts:34` samples fixed-step allowances, while `packages/order/src/matching/order_match_search.ts:165` only probes a residual below the step. The test oracle at `packages/order/test/matching/support/order_match_helpers.ts:135` reuses the same sampling restriction.

The session reproduced two dual-direction orders `(CKB, UDT, ratio)` of `(12, 12, 1:3)` and `(6, 1, 5:1)`, allowance `{ CKB: 6, UDT: 2 }`, exchange rate `1:1`, step `2`, and fee `0`. Allowances `3` and `1` produce net deltas `(+8, -2)`, but the sampled sequence checks only `2` and `4`; `bestMatch` returns no match.

Impact: a valid profitable match is silently omitted despite the exact-search contract, and the current mirrored oracle cannot detect the omission.

Direction: generate all allowance-relevant nondominated states within the candidate budget and retain an independent exhaustive oracle for this fixture.

### High: interface confirmation can wait forever after broadcast

`apps/interface/src/action/actionTransaction.ts:54` passes `Infinity` to the confirmation wait. A pending, unknown, or disappeared transaction therefore prevents `finally` from restoring form and query state. `apps/interface/test/action/actionTransaction.ts:47` expects the infinite timeout, while the repository's finite-wait ESLint rule rejects it.

Direction: use a finite timeout, preserve the broadcast hash, and restore recoverable UI and query state after timeout.

### High: matcher-budget exhaustion is not owned by production callers

The focused validation test reproduced `OrderMatchSearchIncompleteError` with `requiredCount: 164002` over the default `100000` budget. `packages/validation/src/tester/runtime/freshMatchableOrderSkip.ts:90` throws instead of deciding marketability. The corresponding bot path at `packages/bot/src/runtime/transaction.ts:109` reaches nonretryable handling in `packages/bot/src/bot/failure.ts:141`.

Impact: sufficiently large public order ranges can abort the validation guard and terminate the bot process.

Direction: make incomplete search an explicit caller-owned outcome. The fresh-order guard should use a bounded one-order actionability check rather than require full exact matching.

### Medium: submission broadcasts a potentially stale preview

`apps/interface/src/action/Action.tsx:118` submits the cached preview through `apps/interface/src/action/actionTransaction.ts:52`. Account, pool, order, or tip state can change between preview creation and confirmation. The prior committed implementation rebuilt from freshly fetched L1 state at click time.

Direction: refresh and rebuild, or revalidate, the final transaction immediately before wallet confirmation.

### Medium: the two-process fresh-order scenario loses ownership provenance

`apps/validation/src/tester.ts:82` starts each tester process with empty in-memory broadcast provenance. The second process in `tester-fresh-skip-two-pass` therefore cannot identify the first process's order as tester-owned, although unit tests inject that provenance in memory.

Direction: persist or explicitly transfer broadcast provenance between scenario steps and test the real two-process boundary.

### Medium: CKB-to-iCKB planning rejects a valid output-limit boundary

`packages/sdk/src/client/sdk_conversion_class.ts:112` reserves two completion outputs unconditionally. A base transaction with 61 outputs plus an exact direct deposit's two outputs is predicted to need 65 outputs, although this path has no iCKB change and needs at most one fee-change output, for 64 total.

Direction: reserve outputs from the prospective value flow and add the 61-output exact-deposit boundary case.

## Observed Gate Failures

These failures existed in the snapshot before the review session:

- Root typecheck: three bot test fixtures omit required `candidateBudget` and `generatedStates` diagnostics fields.
- Source-structure lint: `OrderMatchSearchIncompleteError.constructor` lacks public TSDoc.
- Interface ESLint: the infinite transaction wait is rejected.
- Focused fresh-order tests: 1 of 11 failed from candidate-budget exhaustion.
- Focused matcher tests: all 19 passed, demonstrating that the current tests do not expose the exactness counterexample above.

The full build, full test suite, and live CKB paths were not run.
