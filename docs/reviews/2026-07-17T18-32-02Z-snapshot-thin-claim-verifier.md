# Snapshot Review: Thin Claim Verifier on Latest Operational WIP

## Scope and Freshness

- Source: a sanitized disposable snapshot of the latest dirty Stack checkout.
- Snapshot HEAD: `ca51bf88d57887fcc554f8697939e0560e9ef2ab`.
- Snapshot dirty-status hash: `bc40f0d81d4c4f2c88f45c02c8adc797d155ed2fff0f5b429519b185dc760bd8`.
- Session: `ses_08ece1bd6ffe7qbdoZGjOCewIa`, GPT-5.6 Sol at high effort with the audited 36-line `claim-verifier` skill.
- Claim source: the shared unverified claim card at `/tmp/opencode/ickb-skill-eval-latest/CLAIM_CARD.md`.
- Reviewed paths: Order, bot, validation, bot and validation apps, launcher, supervisor loops, and directly related tests and process helpers.
- Isolation: Git remotes, linked-worktree metadata, prior review reports, local runtime configs, logs, and scratch files were absent. The session was read-only and left the source-status hash unchanged.
- Freshness warning: these findings were produced from the recorded snapshot. The original checkout may have changed since it was copied. Reproduce each finding against current source before fixing or closing it.

## Verdict

REFUTED

The thin verifier independently refuted claims 8, 9, and 10. It also found a documented incomplete-match guarantee that did not hold under a focused budget boundary. Claims 1, 3, 4, 5, and 7 held offline; claim 6 remained unverified at the live-chain boundary.

## Findings

### High: a PID-bearing child error can release launcher ownership without reaping the child

`scripts/bot/launcher/runtime/process.ts:68-83` allows a child `error` event to settle the normal launcher path. `scripts/bot/launcher/runtime/execute.ts:47-70` can then close sinks and release the ownership lock without observing child `close`.

Trigger: after spawn, a PID-bearing child emits `error` without `close`, with output streams absent or already closed. The focused reproduction returned `{status: 1}` while `killed` remained false and `exitCode` remained null.

Impact: the child may remain alive after ownership is released, allowing a replacement launcher and the surviving bot child to overlap. Asynchronous identity capture also leaves a PID-reuse race.

Direction: make every post-spawn failure path terminate and await child closure before sink closure and ownership release. Add an `error`-without-`close` test with a PID-bearing, non-exiting child.

### Medium: dynamic-loop timeout floor can expire during accumulated cleanup

`scripts/supervisor/dynamic-loop/args.ts:253-259` adds one fixed 60-second margin although prebuild and each child may consume a five-second cleanup grace.

Trigger: `chunkMaxRuns = 13`, zero backoff, `commandTimeoutSeconds = 1`, `childTimeoutSeconds = 66`, and derived chunk timeout `4818`. The parser accepted the tuple. The inner bounded duration can reach `4828` seconds while the outer SIGKILL boundary is `4823` seconds.

Impact: the outer process boundary can preempt inner cleanup and artifact completion.

Direction: account for cleanup grace at every reachable child run and prebuild, or define and enforce child timeout as complete spawn-to-reap duration. Add a multi-run timed-out-child boundary test.

### Medium: incomplete result can violate the documented best-visited guarantee

`packages/order/src/matching/match_types.ts:51` promises the best match among visited probes. A focused boundary used budget 4 and returned `{1, -1}` after the search had probed the better `{2, -2}` endpoint; budget 5 returned `{2, -2}` as complete.

Impact: the returned incomplete candidate can be executable yet economically worse than another candidate whose probe work was already charged. This weakens the evidence consumers can infer from incomplete diagnostics.

Direction: either retain the best economically valid visited candidate or narrow the type-level contract and all consumer assumptions. Add the budget-4 counterexample as a focused regression test.

## Additional Evidence

- Positive incomplete matches reached offline transaction construction; complete-only floors and empty-incomplete classification behaved as claimed. Actual live commit behavior was not exercised.
- Fresh-order tracking and the inclusive 180-block boundary held offline. RPC inclusion, reorg, and wallet behavior remain unverified because live state was prohibited.
- `match_search_incomplete` classified as terminal inspection evidence.
- Candidate accounting, singleton allowance caps, and the structural partial cap held under focused checks.
- Some launcher command-shape assertions were narrower than their HEAD counterparts, and some nonzero-fee Order interaction cases had been replaced by zero-fee small-value cases. Green output alone therefore was not treated as proof of those contracts.

## Verification

- Order: 16 files, 149 tests passed.
- Bot: 21 files, 168 tests passed.
- Validation: 78 files, 413 tests passed.
- Node scripts: 197 tests passed.
- `pnpm bot:check`: passed.
- HEAD and dirty-status hash: unchanged after review.
- Git remotes: absent.
- Verification processes remaining: none.

## Session Metrics

- Cost: `$4.904076`.
- Tokens: 754,010 input; 9,183 output; 8,172 reasoning; 1,226,752 cache read.
- Tool calls: 79 across 26 messages.
- Wall-clock span: 41.63 minutes, including a resumed final-verdict turn after the first invocation ended on tool calls.
