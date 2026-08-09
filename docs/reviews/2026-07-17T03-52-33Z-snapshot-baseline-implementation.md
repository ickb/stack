# Snapshot Review: Baseline Fresh-Order Fix

## Scope and Freshness

- Source: a disposable snapshot of the dirty Stack checkout, limited by task to the bot, tester, supervisor, validation, order, and directly shared code.
- Snapshot HEAD: `ca51bf88d57887fcc554f8697939e0560e9ef2ab`.
- Snapshot dirty-status hash: `3384660eb9ec35e553f1b4d25a7ed85d82f60295e823d038a817e5b969282206`.
- Session: `ses_091cf765dffeJzy8aO3HqmUPFh`, GPT-5.6 Sol at high effort with the current OpenCode policy and no additional candidate skill.
- Isolation: Git remotes, linked-worktree metadata, prior `docs/reviews` reports, local runtime configs, logs, and scratch files were absent. No install, live-chain, commit, or push action was available or taken.
- Freshness warning: this implementation and review came from a frozen snapshot. The original checkout may have changed since it was copied. Recheck the current code before applying or closing any direction below.

## Attempted Fix

The session changed one option in `packages/validation/src/tester/runtime/freshMatchableOrderSkip.ts:97`:

```diff
-{ feeRate, ckbAllowanceStep: ccc.fixedPointFrom(1), maxPartials: 1 }
+{ feeRate, maxPartials: 1 }
```

This replaces the guard's one-CKB subdivision with the matcher's default 1,000-CKB subdivision.

Observed checks:

- `pnpm exec vitest run packages/validation/test/tester/runtime/core/testerFreshOrder.ts`: 11 passed.
- `pnpm exec tsgo --noEmit -p packages/validation/tsconfig.json`: passed.
- Root typecheck remained blocked by three pre-existing bot fixtures missing `MatchDiagnostics.candidateBudget` and `generatedStates`.

## Review Finding

### The green one-line fix does not prove sound actionability detection

The change prevents the reproduced `requiredCount: 164002` budget failure by sampling a coarser allowance sequence. However, the same snapshot contains a separately reproduced exactness defect: fixed-step sampling can miss a profitable feasible allowance, and the residual probe covers only selected below-step cases. A coarser 1,000-CKB step increases that false-negative surface.

Impact: the guard can stop throwing while incorrectly treating a fresh marketable order as non-actionable. The focused suite proves its current fixtures, not the required marketability contract.

Direction: do not promote the one-line patch by itself. Give the fresh-order guard a bounded one-order actionability operation whose result is complete for one order, or derive a direct threshold test from `OrderMatcher` and the live fee/exchange rate. Add an independent boundary oracle that searches all relevant one-order allowances and includes profitable values skipped by the default step.

## Skill Signal

Baseline Sol produced a minimal, well-scoped diff and honest verification, but optimized for the visible failing test without reconciling it with the known search-exactness contract. This run is therefore a focused-test pass and a soundness failure, not an accepted implementation.
