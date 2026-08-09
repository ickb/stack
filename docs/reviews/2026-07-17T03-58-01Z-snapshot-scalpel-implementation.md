# Snapshot Review: Scalpel Fresh-Order Fix

## Scope and Freshness

- Source: a disposable snapshot of the dirty Stack checkout, limited by task to the bot, tester, supervisor, validation, order, and directly shared code.
- Snapshot HEAD: `ca51bf88d57887fcc554f8697939e0560e9ef2ab`.
- Snapshot dirty-status hash: `3384660eb9ec35e553f1b4d25a7ed85d82f60295e823d038a817e5b969282206`.
- Session: `ses_091cb1cb1ffetM1WP4TCAbAJx3`, GPT-5.6 Sol at high effort with the audited `scalpel` skill added to the current OpenCode policy.
- Isolation: only the Markdown skill path was exposed. Git remotes, linked-worktree metadata, prior `docs/reviews` reports, local runtime configs, logs, and scratch files were absent. No install, live-chain, commit, or push action was available or taken.
- Freshness warning: this implementation and review came from a frozen snapshot. The original checkout may have changed since it was copied. Recheck the current code before applying or closing any direction below.

## Implemented Candidate

The session added an established midpoint marketability predicate to `packages/validation/src/tester/runtime/freshMatchableOrderSkip.ts` before calling the fee-aware exact matcher. An order that does not improve either applicable direction over the current iCKB exchange midpoint returns `false` without constructing the large fixed-step search.

The change is 16 insertions and 2 deletions in one file. It retains the one-CKB step, live fee rate, one-partial limit, candidate budget, and `OrderMatchSearchIncompleteError` behavior for orders that pass the midpoint check.

Observed checks:

- `pnpm exec vitest run packages/validation/test/tester/runtime/core/testerFreshOrder.ts`: 11 passed, repeated after formatting.
- `pnpm exec tsgo --noEmit -p packages/validation/tsconfig.json`: passed, repeated after formatting.
- `pnpm exec prettier --check packages/validation/src/tester/runtime/freshMatchableOrderSkip.ts`: passed.
- Root typecheck remained blocked by three pre-existing bot fixtures missing `MatchDiagnostics.candidateBudget` and `generatedStates`.

## Review Findings

### The midpoint prefilter is useful for the reproduced fixture

The failing fixture is not marketable at the midpoint. Filtering it before exact search removes work irrelevant to the guard's decision and avoids weakening the matcher budget, test, or error type. Unlike replacing the one-CKB step with the coarser default step, this does not introduce sampling error for orders rejected by the prefilter.

Direction: retain this prefilter as part of the eventual fix if the midpoint comparison is confirmed as a necessary condition for positive fee-adjusted singleton gain in both directions. Add direct tests for equality, each direction, dual-ratio orders, and fee-sensitive near-midpoint boundaries.

### Marketable large-range orders can still exhaust the exact search

Any order that passes the midpoint predicate still reaches `OrderManager.bestMatch` with one-million-CKB synthetic allowances and a one-CKB subdivision. A sufficiently large marketable order can therefore exceed the same directional state budget and abort the fresh-order guard.

Impact: the patch fixes the observed unmarketable test but does not make candidate-budget exhaustion a fully owned outcome.

Direction: pair the prefilter with a complete bounded singleton actionability operation, or derive the fee-adjusted one-order threshold directly. Include a marketable order whose range exceeds 100,000 generated states and assert a deterministic Boolean result rather than an incomplete-search exception.

## Skill Signal

Compared with baseline Sol's one-line coarse-step change, Scalpel preserved exact-search settings and found a more contract-aware early rejection. Its minimal implementation still stopped once the visible fixture passed and left the general marketable exhaustion path unresolved. This is a promising component, not a complete accepted fix.
