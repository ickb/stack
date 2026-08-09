# Snapshot Review: Ponytail Operational Audit

## Scope and Freshness

- Source: a sanitized disposable snapshot of the latest dirty Stack checkout.
- Snapshot HEAD: `ca51bf88d57887fcc554f8697939e0560e9ef2ab`.
- Canonical snapshot dirty-status hash: `bc40f0d81d4c4f2c88f45c02c8adc797d155ed2fff0f5b429519b185dc760bd8`.
- Strict all-untracked NUL-status hash: `f205d815834301e32ea2c316093fefea2a085ccbc3ae6a8b8689fbd1874c463a`.
- Session: `ses_08ea44bd4ffeQPCAjzz9Tpgi7x`, GPT-5.6 Sol at high effort with the audited `ponytail-audit` skill.
- Reviewed paths: Order, bot, validation, bot and validation apps, launcher, supervisor loops, bot script tests, and directly cited shared code and tests.
- Isolation: Git remotes, linked-worktree metadata, prior review reports, local runtime configs, logs, and scratch files were absent. The session was read-only and both status hashes remained unchanged.
- Freshness warning: these candidates were produced from the recorded snapshot. The original checkout may have changed since it was copied. Reproduce every candidate against current source before implementing it.
- Admission warning: these are aggressive simplification candidates, not approved changes. Each still needs normal contract review and focused verification.

## Candidates

### Delete the orphaned sequential matcher

`packages/order/src/matching/order_match_sequence.ts:57-94` retains `sequentialMatches`, an older subdivision search. Its only discovered consumers were dedicated tests in `packages/order/test/matching/order_manager_transaction.ts:86-180`; it is absent from the package public index, while production best-match behavior uses the directional frontier.

Direction: delete `sequentialMatches` and only its dedicated tests while retaining `orderMatchers` and frontier search. Recheck direct source imports before applying.

Estimated reduction: one concept and about 133-135 lines; no files or dependencies.

### Delete directory-local validation support hops

Fourteen `packages/validation/test/**/support.ts` files only re-export an existing support barrel. Each discovered consumer also imports the substantive support barrel directly, and the intermediary modules had no hook or mock-registration side effects.

Direction: remove the 14 intermediary files and their side-effect imports. Preserve `tester/runtime/attempt/support.ts`, which contains substantive support behavior.

Estimated reduction: one convention, 14 files, and about 29 lines; no dependencies.

### Reuse the shared symlink-path helper

`packages/bot/src/observability/artifacts.ts:195-217` and `scripts/bot/incident/io/filesystem.ts:159-182` duplicate `packages/node-utils/src/path.ts:10-35`.

Direction: call `firstSymlinkInPath` while retaining each caller's owned error text. Verify first-symlink, missing-descendant, injected-`lstat`, and error-propagation behavior at both security boundaries.

Estimated reduction: two local mechanisms and about 28-32 lines; no files or dependencies.

### Delete an unused tester import facade

`packages/validation/test/support/tester/testerAttemptLoopImports.ts:1-25` re-exports production and fixture helpers but had no discovered references. It is under an excluded test-support tree and is not a package export.

Direction: delete the file after an ignored-path-aware current-tree reference check.

Estimated reduction: one facade, one file, and 25 lines; no dependencies.

### Remove redundant error-summary layers

In `packages/bot/src/observability/error.ts`, `errorExtraFields` repeats an `Object.entries` scan for `txHash`, `status`, and `isTimeout` after `errorOwnProperties` already retains every enumerable non-built-in field. `summarizeNativeCause` only delegates to its callback.

Direction: remove the duplicate extra-field pass and inline the cause callback while retaining circular-value, stack, event-schema, and transaction-status tests.

Estimated reduction: two concepts and about 24 lines; no files or dependencies.

### Inline the private terminal-iteration helper

`completeTerminalIteration` at `packages/bot/src/bot/loop.ts:384-395` has one production caller, one dedicated test, and an otherwise unused export from `packages/bot/src/index.ts`.

Direction: increment locally and call the existing `reachedMaxIterations` helper. Preserve bounded-loop behavioral tests rather than replacing them only with implementation-level assertions.

Estimated reduction: one helper, API, and test concept and about 20-24 lines; no files or dependencies.

### Reuse the supervisor synchronous process adapter

`scripts/supervisor/dynamic-loop/command.ts:100-119` duplicates `spawnSyncCommand` from `scripts/supervisor/loop/command.ts:108-119`. The dynamic dependency type extends the loop dependency type, and the audit found no reverse dependency or cycle.

Direction: import the existing adapter and verify command, environment, and injected-spawn behavior.

Estimated reduction: one process adapter and about 20 lines; no files or dependencies.

### Inline fixture filesystem pass-throughs

`mkdirFixturePath`, `writeFixtureFile`, and `writeFixtureFileSync` at `packages/validation/test/supervisor/support/stimulus/liveBotStimulus.ts:46-67` only call injected functions for five test consumers.

Direction: call the injected functions directly and retain `{ recursive: true }` at directory-creation sites.

Estimated reduction: one fixture-adapter concept and about 12-18 lines; no files or dependencies.

### Remove launcher forwarding wrappers

`scripts/bot/launcher/storage/prepare.ts:70-72` forwards to the existing `closeSinks`, and `scripts/bot/launcher/runtime/records.ts:60-65` forwards two calls to `sink.writeLine`.

Direction: import `closeSinks` directly and write records to the sink directly. Preserve launch-record schema, failure cleanup, close ordering, and ownership-release tests.

Estimated reduction: two wrappers and about nine lines; no files or dependencies.

## Net Estimate

- Approximately 300-316 lines removable.
- Twelve concepts removable.
- Fifteen files removable.
- No dependency removal.

## Verification

- No source files were edited.
- No tests or build checks were run because the task was a read-only candidate audit.
- No live, testnet, wallet, RPC, network, install, clean, or dependency-changing commands were run.
- HEAD and both source-status hashes were unchanged after the audit.
- Git remotes: absent.
- Audit-started processes remaining: none.

## Session Metrics

- Cost: `$2.556839`.
- Tokens: 176,395 input; 9,823 output; 10,089 reasoning; 2,155,008 cache read.
- Tool calls: 130 across 23 messages.
- Wall-clock span: 26.11 minutes.
