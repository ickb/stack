# Snapshot Review: Full Fable Judge on Latest Operational WIP

## Scope and Freshness

- Source: a sanitized disposable snapshot of the latest dirty Stack checkout.
- Snapshot HEAD: `ca51bf88d57887fcc554f8697939e0560e9ef2ab`.
- Snapshot dirty-status hash: `bc40f0d81d4c4f2c88f45c02c8adc797d155ed2fff0f5b429519b185dc760bd8`.
- Session: `ses_08eea6d43ffea4LPDa4KDQtZcT`, GPT-5.6 Sol at high effort with the audited full default `fable-judge` skill.
- Claim source: the shared unverified claim card at `/tmp/opencode/ickb-skill-eval-latest/CLAIM_CARD.md`.
- Reviewed paths: Order, bot, validation, bot and validation apps, launcher, supervisor loops, and directly related tests and process helpers.
- Isolation: Git remotes, linked-worktree metadata, prior review reports, local runtime configs, logs, and scratch files were absent. The session was read-only and left the source-status hash unchanged.
- Freshness warning: these findings were produced from the recorded snapshot. The original checkout may have changed since it was copied. Reproduce each finding against current source before fixing or closing it.

## Verdict

REFUTED

Eight of ten supplied behavioral claims survived implementation tracing, package tests, Node tests, and focused counterexamples. Claims 8 and 10 were refuted.

## Findings

### Medium: launcher ownership is per UID and log directory, not per directory

`scripts/bot/launcher/runtime/process.ts:27-29` derives the abstract Unix socket name from both `process.getuid()` and the resolved log-directory hash. This prevents two launchers under the same UID from owning one log directory, but different UIDs derive different socket names for the same directory.

Trigger: two users or service identities both have write access to one launcher log directory.

Impact: both can acquire different abstract-socket locks and concurrently rotate or write the same launcher slots and metadata. Existing ownership tests exercise only same-UID contention.

Direction: either enforce and document a single owning UID through directory ownership and permissions, or use a directory-global lock identity whose acquisition remains safe across UIDs. Add a cross-identity ownership test at the actual deployment boundary.

### Medium: dynamic-loop timeout floor can expire during accumulated graceful cleanup

`scripts/supervisor/dynamic-loop/args.ts:253-266` derives chunk timeout as one fixed prebuild allowance, `chunkMaxRuns * childTimeoutSeconds`, inter-run backoff, and one fixed 60-second margin. The child process helper can consume an additional five-second SIGTERM cleanup window after timeout.

An offline control-flow probe used `chunkMaxRuns = 13`, `childTimeoutSeconds = 66`, `commandTimeoutSeconds = 1`, and zero backoff. The derived chunk timeout was `4818` seconds: `3900 + 13 * 66 + 60`. Thirteen simulated child results carried `ETIMEDOUT` with status `0`; supervisor-loop retained valid no-progress summaries, continued 12 times, and reached the final max-runs inspection. Those reachable runs can consume up to `13 * 5 = 65` seconds of graceful cleanup, exceeding the fixed 60-second outer margin.

Impact: the outer chunk timeout can fire during the thirteenth inner cleanup, preempting the process-group cleanup window the timeout floor claims to protect.

Direction: include the cleanup grace per possible child run, or make `childTimeoutSeconds` include and enforce the complete spawn-to-reap duration. Add a multi-run status-zero timeout test that advances through all cleanup windows.

## Verified Claims

- A complete order search is emitted only after the atomic feasible domain is covered.
- Incomplete search returns structured truncation evidence and an exact visited candidate rather than throwing on ordinary budget exhaustion.
- Candidate-budget ownership and candidate/work diagnostics matched the documented owners.
- Singleton allowance caps and `maxPartials: 1` avoid impossible cross-direction pair work.
- Bot consumers may execute positive incomplete matches, disable complete-only floors, and surface incomplete empty results as `match_search_incomplete`.
- The tester fresh-order guard fails closed on incomplete search, propagates unexpected failures, and applies the inclusive 180-block boundary.
- Supervisor classification treats `match_search_incomplete` as terminal inspection evidence.
- Launcher identity capture, argument omission, post-spawn child reaping, sink closure, environment passthrough, and output non-disclosure held under the tested same-UID model.

Actual on-chain acceptance of an incomplete visited match remains unverified because no live CKB state was used.

## Verification

- Order: 16 files, 149 tests passed.
- Bot: 21 files, 168 tests passed.
- Validation: 78 files, 413 tests passed.
- Bot CLI: 1 file, 6 tests passed.
- Validation CLI: 2 files, 17 tests passed.
- Node scripts: 197 tests passed.
- `pnpm bot:check`: passed.
- HEAD and dirty-status hash: unchanged after review.
- Git remotes: absent.
- Started launcher or supervisor processes remaining: none.

The first package-check attempt was blocked because the disposable snapshot had omitted dependency `dist` artifacts. The dependency tree was restored from the same source checkout without changing source state, and every blocked check above was then rerun successfully; the initial environment failures are withdrawn.
