# Snapshot Review: Fable Method and Scalpel Fresh-Order Fix

## Scope and Freshness

- Source: a disposable snapshot of the dirty Stack checkout, limited by task to the bot, tester, supervisor, validation, order, and directly shared code.
- Snapshot HEAD: `ca51bf88d57887fcc554f8697939e0560e9ef2ab`.
- Snapshot dirty-status hash: `3384660eb9ec35e553f1b4d25a7ed85d82f60295e823d038a817e5b969282206`.
- Session: `ses_091b54478ffeaqrmuZGNPl3tbA`, GPT-5.6 Sol at high effort with the audited `fable-method` and `scalpel` skills added together to the current OpenCode policy.
- Isolation: only the two Markdown skill paths were exposed. Git remotes, linked-worktree metadata, prior `docs/reviews` reports, local runtime configs, logs, and scratch files were absent. No install, live-chain, commit, or push action was available or taken.
- Freshness warning: this implementation and review came from a frozen snapshot. The original checkout may have changed since it was copied. Recheck the current guard and matcher before applying or closing any direction below.

## Implemented Candidate

The hybrid session removed the guard-specific one-CKB subdivision override from `packages/validation/src/tester/runtime/freshMatchableOrderSkip.ts`, leaving `{ feeRate, maxPartials: 1 }` and the matcher's existing 1,000-CKB default step.

Unlike the baseline session, the hybrid added a regression that:

1. Builds a large resolver-produced UDT-to-CKB mint order.
2. Confirms the old one-CKB options throw `OrderMatchSearchIncompleteError`.
3. Confirms the guard with the default step returns the normal `fresh-matchable-order` skip.

The production change is one line. Fixture parameterization adds 5 lines and removes 2; the regression adds 34 lines.

## Observed Verification

- Focused fresh-order tests: 12 passed.
- Full offline `@ickb/validation` suite: 78 files and 395 tests passed.
- Validation package typecheck: passed.
- Prettier over the three touched files: passed.
- `git diff --check` over the three touched files: passed.
- Twin search found 14 other one-CKB overrides, all in tests.
- Independent Grok review reported no material finding.

No full repository gate or live CKB path was run.

## Review Findings

### The narrow caller fix is now evidence-backed for the tested contract

For one order with `maxPartials === 1`, profitability after the fixed per-partial fee is monotonic over a direction's fill, and the search retains an exact residual probe at the caller's available allowance. The coarser default sequence therefore need not enumerate every one-CKB subdivision to answer whether the tested singleton order has an actionable fill.

The new regression materially improves the baseline proposal because it proves both that the old options arm the budget failure and that a large marketable order remains detected after the change.

### The shared allowance cap remains the more complete bound

The caller fix reduces subdivision count by a factor of 1,000 but still sizes directional generation from the order's maximum fill. An arbitrarily large singleton order can still exceed 100,000 default-step states even when the guard's initial synthetic allowance makes most of those states unreachable.

The Fable-Method-only candidate instead caps singleton one-partial generation at initial spend allowance, which directly removes all states the allowance check must reject. That shared cap is robust to order maximum size and preserves the caller's one-CKB resolution.

Direction: prefer the shared allowance-cap candidate after completing its opposite-direction and nonzero-fee tests. Keep this hybrid regression as a useful guard-level acceptance case, adapted to assert the shared-cap behavior without removing the fine step.

## Skill Signal

Combining Fable Method with Scalpel improved the minimal baseline approach substantially: it added a true failure control, a large marketable case, full package verification, twin search, and independent review while retaining a one-line production diff. It did not outperform Fable Method alone on end-to-end robustness because the minimal caller change leaves an avoidable extreme-range budget case.
