# Snapshot Review: Fable Judge of the Allowance-Cap Candidate

## Scope and Freshness

- Subject: the three-file candidate produced by the Fable Method implementation session, compared directly with its frozen sibling base.
- Snapshot HEAD: `ca51bf88d57887fcc554f8697939e0560e9ef2ab`.
- Snapshot dirty-status hash: `3384660eb9ec35e553f1b4d25a7ed85d82f60295e823d038a817e5b969282206`.
- Judge session: `ses_091ac133effetWyvfHNiogj18c`, GPT-5.6 Sol at high effort with the audited `fable-judge` skill.
- Isolation: only the judge and referenced method Markdown were exposed. Git remotes, linked-worktree metadata, prior `docs/reviews` reports, local runtime configs, logs, and scratch files were absent. The judge changed nothing.
- Freshness warning: this verdict concerns a frozen snapshot candidate, not necessarily the current original checkout.
- Supersession: this verdict refutes the acceptance direction in `2026-07-17T04-15-35Z-snapshot-fable-method-implementation.md`. Do not promote that allowance-cap candidate as written.

## Verdict

REFUTED

The directional allowance caps are individually correct, but the search still forms the full Cartesian product of both capped directions for a dual-ratio singleton order. Under `maxPartials === 1`, every pair containing both directional partials is impossible, yet each pair consumes candidate budget before the partial-count rejection.

## Reproduction

The judge constructed one valid dual-ratio order with 400 units available on each side and a one-unit allowance step.

- Each capped direction generated 400 nonempty states plus its empty state.
- The current nested loop therefore considered about 160,000 pairs.
- Only the empty-opposite pairs can satisfy `maxPartials === 1`; 159,201 pairs are impossible two-partial combinations.
- With the default 100,000 candidate budget, search threw at required candidate 100,001 after generating only 251 of 400 CKB-to-UDT states.
- With `candidateBudget: 200000`, the same fixture resolved to a valid profitable one-partial result with `ckbDelta = 800`, `udtDelta = -400`.

The nonzero-fee reproduction reserved a 283-shannon prepared-partial fee and failed in the same candidate phase under the default budget. This confirms that the defect is Cartesian candidate accounting, not directional unit or fee-cap arithmetic.

## Additional Diagnostic Finding

The new one-sided regression produces two UDT-to-CKB states and visits two candidates under the default budget, but `candidateBudget: 2` is rejected before search as requiring three states. `sequentialMatchStateUpperBound` therefore reports a conservative probe bound rather than the actual generated-state contract. That may be acceptable as an upper bound, but diagnostics and tests must name it accurately.

## Required Direction

Under the existing exact singleton gate, `orderCount === 1 && maxPartials === 1`, evaluate each directional state only against the empty state from the opposite direction. Do not generate or charge budget for pairs that necessarily contain two partials.

Add at least:

- A dual-ratio, nonzero-fee regression that resolves under the default candidate budget.
- An assertion that the selected result matches a higher-budget or direct singleton oracle.
- A tight candidate-budget boundary test based on reachable evaluated candidates.
- Both one-sided allowance-cap tests from the earlier review.

The simpler hybrid caller change remains narrower and passed its validation regression, but it does not remove this generic singleton Cartesian waste from the matcher.

## Verification Evidence

- Full order package suite: 16 files and 117 tests passed.
- All matching tests: 7 files and 69 tests passed.
- Order and validation package typechecks: passed.
- Targeted ESLint, Prettier, and exact-delta whitespace checks: passed.
- No weakened tests, skipped checks, scope expansion, or judge-created source changes were found.

The clean repository-native checks did not cover the dual-ratio budget failure. The judge's adversarial runtime reproduction is the decisive evidence.

## Skill Signal

Fable Judge found a material counterexample missed by the implementation session, its embedded Grok review, and the existing 117-test order suite. In this smoke study it added clear value as a bounded post-implementation verifier, especially when given explicit attack dimensions and an exact candidate delta.
