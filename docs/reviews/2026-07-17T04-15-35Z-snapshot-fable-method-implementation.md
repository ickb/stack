# Snapshot Review: Fable Method Fresh-Order Fix

## Scope and Freshness

- Source: a disposable snapshot of the dirty Stack checkout, limited by task to the bot, tester, supervisor, validation, order, and directly shared code.
- Snapshot HEAD: `ca51bf88d57887fcc554f8697939e0560e9ef2ab`.
- Snapshot dirty-status hash: `3384660eb9ec35e553f1b4d25a7ed85d82f60295e823d038a817e5b969282206`.
- Session: `ses_091c616b5ffeT2FQ5SjJVvz0Ug`, GPT-5.6 Sol at high effort with the audited `fable-method` skill added to the current OpenCode policy.
- Isolation: only the Markdown skill path was exposed. Git remotes, linked-worktree metadata, prior `docs/reviews` reports, local runtime configs, logs, and scratch files were absent. No install, live-chain, commit, or push action was available or taken.
- Freshness warning: this implementation and review came from a frozen snapshot. The original checkout may have changed since it was copied. Recheck the current matcher before applying or closing any direction below.
- Later verdict: `2026-07-17T04-37-54Z-snapshot-fable-judge.md` refuted this candidate with a dual-ratio Cartesian-budget counterexample. Do not promote the implementation described here as written.

## Implemented Candidate

The session changed the shared exact matcher rather than special-case the fresh-order caller. When the search has exactly one order and `maxPartials === 1`, state generation is capped at the initial spend allowance:

- CKB-to-UDT generation is capped by initial UDT allowance.
- UDT-to-CKB generation is capped by initial CKB allowance minus one prepared-partial mining fee.
- All multi-order and multi-partial searches retain their previous path and explicit candidate-budget failures.

`packages/order/src/matching/order_match_sequence.ts` applies the optional cap consistently to state generation and its preflight upper bound. `packages/order/src/matching/order_match_search.ts` enables it only for the singleton one-partial contract. `packages/order/test/matching/order_matcher_budget.ts` proves that a small affordable fill completes while the uncapped large-range case still fails before allocation.

The candidate adds 44 lines and removes 2 across those three files. No validation, bot, tester, or supervisor source changed.

## Why the Cap Is Sound

For CKB-to-UDT matching, matcher allowance is UDT spent, so a one-partial candidate cannot spend more UDT than the initial UDT allowance. For UDT-to-CKB matching, matcher allowance is CKB spent, and viability subtracts one partial's CKB mining fee, so the maximum reachable allowance is initial CKB minus that fee.

With one order and `maxPartials === 1`, a candidate cannot combine both directional partials. Opposite-direction proceeds therefore cannot fund a larger accepted allowance. States above either cap are rejected by the existing allowance check and cannot change the best valid result.

This is materially stronger than coarsening the allowance step: it preserves the same reachable search resolution and removes only unreachable states.

## Observed Verification

- Five focused and adjacent Vitest files: 30 tests passed.
- Order package typecheck: passed.
- Validation package typecheck: passed.
- ESLint over the three touched files: passed.
- Prettier over the three touched files: passed.
- `git diff --check` over the three touched files: passed.
- An independent Grok review reported no correctness defect in the cap.

The full repository gate and live CKB paths were not run.

## Remaining Proof

The new regression directly exercises only the UDT-to-CKB, zero-fee case. Before promotion, add focused cases for:

- CKB-to-UDT allowance capping.
- A nonzero mining fee at the exact CKB boundary.
- Initial CKB below the required fee.
- A dual-ratio singleton order, proving only one directional partial can survive `maxPartials === 1`.
- Equality at each allowance cap and one unit above it.

The earlier fixed-step exactness finding remains separate: this candidate preserves current sampling and does not prove that the sampled search is globally exact.

## Skill Signal

Fable Method was the only implementation arm to move the fix to the shared decision owner, preserve reachable search resolution, add a regression at the budget contract, run adjacent checks, search related call sites, and complete an independent final review. It took about 17 minutes and added more code than the other arms, but produced the strongest candidate from this smoke comparison.
