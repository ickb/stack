# Snapshot Review: Integrated Fablify, Interrupted

## Scope and Freshness

- Source: `/tmp/opencode/ickb-fablify-full-20260717`, a sanitized disposable copy of the latest dirty Stack snapshot.
- Snapshot HEAD: `ca51bf88d57887fcc554f8697939e0560e9ef2ab`.
- Parent preflight text-status hash (`git status --porcelain=v1 | sha256sum`): `bc40f0d81d4c4f2c88f45c02c8adc797d155ed2fff0f5b429519b185dc760bd8`.
- Session NUL-status hash (`git status --porcelain=v1 -z | sha256sum`): `60b0ef11e80d5a01063fd66bfc00b75f03171efada5b4068d352ff4d7e88a3cb`.
- Session: `ses_08e42779fffeFm95cTbYmJs1b3`, GPT-5.6 Sol at high effort using the integrated `review` simplification/Fablify route.
- Isolation: the snapshot had no Git remote or prior review reports. Existing `node_modules` was copied from the sanitized base; no install, audit, publish, live, wallet, RPC, or network action ran.
- Freshness warning: the disposable checkout disappeared during final verification. This report is reconstructed from preserved OpenCode session, patch, command, and database records. Reproduce every candidate against current source before implementation.

## Verdict

PARTIALLY VERIFIED; RUN INTERRUPTED

The integrated Fablify behavior is partially validated for discovery, candidate rejection, smallest-owner edits, and focused verification. It inspected the whole repository by ownership boundary, obtained an independent critic before editing, rejected high-risk or cosmetic proposals, and applied a sequence of material simplifications with package-level proof.

End-to-end completion was not achieved. The checkout disappeared between successful commands at 23:01:35 and failed commands at 23:03:26. The final source-status hash, complete resulting diff, final ESLint result, final broad test/build pass, and post-run process proof therefore do not exist. The last ESLint plugin-barrel change remains provisional.

## Accepted Simplifications

The preserved patch stream records these evidence-backed groups:

1. Removed zero-caller source-structure helpers, types, and one stale Dependency Cruiser exception.
2. Removed the unused `BufferedGenerator` implementation, export, tests, and API entry.
3. Removed the production-dead sequential order matcher and tests that characterized only that obsolete schedule.
4. Folded the private order-match uniqueness wrapper into its sole search owner.
5. Removed the free `bestMatch` facade while preserving validation, context creation, provenance, diagnostics, and search ownership.
6. Removed the duplicate exact-withdrawal selector while converting oracle comparisons into direct behavioral assertions for the production multi-count selector.
7. Made the SDK withdrawal-request cap the single owner reused by SDK best-fit selection and bot planning.
8. Replaced duplicate exact-lock/plain-capacity scanners with one private SDK scanner while retaining caller-owned aggregation.
9. Removed the bot error serializer's second pass over fields already retained by `errorOwnProperties`.
10. Reused the bot policy's `CKB_RESERVE` in the reserve-recovery threshold.
11. Reused the node-utils stop exit code in validation.
12. Reused supervisor-owned event names, transaction-hash pattern, timeout, tester path, and repository root in stimulus scanning.
13. Centralized validation actor entrypoint paths without changing either CLI surface.
14. Reused the generic runtime-config builder for live environment config generation.
15. Reused the supervisor loop's synchronous process adapter in dynamic-loop.
16. Deleted 12 inert validation test support hops and their side-effect-only imports.
17. Made `quoteDraft` own conversion symbol, text, direction, and amount parsing across interface callers, then removed the obsolete symbol-to-direction helper.
18. Deleted the unused Tailwind v4 config and phantom TypeScript, ESLint, and architecture inputs; removed unmatched-pattern suppression after making the remaining ESLint inputs exact.

The last patch also replaced the ESLint plugin barrel with direct imports and deleted that barrel. Typecheck and architecture passed afterward, but ESLint ran while the checkout was being removed: it reported both a missing built-in formatter and missing `node_modules` about 14 seconds before commands began failing with a missing working directory. Do not count that last change as accepted without a clean reproduction.

## Rejected or Deferred Candidates

- `asyncPassthroughTransaction`: not dead; it remained in SDK fixture wiring, and inlining offered low net value.
- `IckbSdk` interface/constructor ceremony: retained because runtime name, statics, type assignability, and generated API surface are demonstrated contracts.
- Bot decision-transcript reconstruction, shared log normalization, and event/artifact shape changes: deferred because byte/schema stability was not established.
- Cross-program reserve and stimulus-policy unification: rejected as a drive-by coupling of independently operated programs.
- Package, class, process-program, order-search, provenance, wait-transaction, security/path/process-guard, and custom-linter collapses: rejected as behavior-moving rather than simplifying.
- Shared frontend layout frames, private `.npmignore` cleanup, and documentation-only polish: skipped as cosmetic or low-value.

## Recovered Delta

- 25 successful patch operations touched 72 unique paths.
- Update/add hunks recorded 228 additions and 739 deletions.
- Sixteen deleted files contained another 114 lines in the source snapshot.
- Recorded total: approximately 853 deletions, 228 additions, and 625 net lines removed.
- File operations: one file added and 16 deleted, for 15 net files removed.
- Dependencies removed or added: none.
- These figures describe the preserved patch stream, including the provisional final plugin-barrel patch. They are not a final `git diff --stat` and may include small edit churn.

## Verification

Baseline before edits:

- `pnpm lint:typecheck`: passed.
- `pnpm lint:structure`: passed.
- `pnpm lint:knip`: passed.
- `pnpm test:ci`: 236 Vitest files / 1,348 tests and 197 Node tests passed.

Focused and cumulative checks after accepted changes:

- Utils: 3 files / 27 tests passed; ESLint, build, and API extraction passed.
- Order: 16 files / 145 tests passed repeatedly; ESLint, typecheck, architecture, build, and API extraction passed.
- SDK: 60 files / 198 tests passed repeatedly; typecheck and ESLint passed after one corrected `no-shadow` failure; full workspace build plus SDK API extraction passed.
- Bot: 21 files / 168 tests passed; focused error schema suite passed 15 tests; ESLint and typecheck passed.
- Validation: 78 files / 413 tests passed repeatedly; node-utils passed 8 files / 62 tests; validation CLI passed 2 files / 17 tests.
- Live-config focused Node tests: 11 passed.
- Supervisor loop focused Node tests: 68 passed.
- Interface: 26 files / 146 tests passed; typecheck, ESLint, build, architecture, and the post-Tailwind CSS build passed.
- `pnpm lint:structure`, `pnpm lint:knip`, `pnpm lint:typecheck`, and `pnpm lint:architecture` passed at later cumulative checkpoints.
- Full root ESLint passed at 22:59:17 after stale-glob cleanup and before the provisional plugin-barrel patch.

Expected intermediate failures were corrected before proceeding: SDK API extraction required the release tag and workspace build order; SDK ESLint found a shadowed callback parameter; stricter root ESLint exposed one deliberately ignored app config. The final ESLint failure is consistent with concurrent checkout destruction and was not diagnosable after the directory disappeared.

## Checkout Disappearance

### Confirmed

- The checkout existed for the successful typecheck and architecture commands started at 23:01:35.
- At 23:03:26, three independent commands failed because their configured working directory no longer existed. A direct read and glob then confirmed the directory was absent.
- No Fablify-session command used `rm`, `rmdir`, `unlink`, `mv`, trash, Git clean, Git reset, or Git worktree removal. All 25 patches named repository files rather than the checkout root.
- No recorded command in any OpenCode session targeted this checkout for deletion.
- User and system tmpfiles cleanup completed before the checkout was created. No matching Trash entry or journal record was found.
- The OpenCode database still retains the Fablify root session, its subagents, the project-directory row, and the path in the project's sandbox list.
- OpenCode 1.18.2 session deletion removes the session and its stored events. It does not remove a repository directory.
- The concurrent auto-mode evaluator imported and deleted temporary session records and removed only its own `mkdtemp` directory. Its six fixture sessions referenced the main Stack checkout or `/var/home/user`, not the Fablify snapshot.

### Plausible but Unproven Mechanism

OpenCode 1.18.2's workspace deletion path calls `Worktree.remove`. If the target is not present in `git worktree list`, that implementation still recursively deletes the supplied directory. The Fablify snapshot was a plain `cp -a` repository copy registered as a Stack sandbox, so it was vulnerable to that endpoint despite not being a Git worktree.

The desktop application invokes this endpoint only from the confirmed Delete Workspace dialog. No retained HTTP/access log proves such a request occurred, and the project row was not updated to remove the sandbox as the normal successful endpoint would do. This mechanism therefore explains how OpenCode could delete the copy, but does not establish who or what invoked it. Confidence in attribution is low.

### Root-Cause Conclusion

The concurrent auto-mode evaluator is temporally correlated but not supported as the cause by its code, fixture directories, or session-delete implementation. The deletion was external to the Fablify agent's recorded actions. An interrupted or otherwise unlogged workspace-delete request is one identified mechanism; an unrecorded operating-system deletion remains equally possible. Root cause remains unresolved.

## Session Metrics

- Cost: `$11.554445`.
- Tokens: 307,323 input; 33,960 output; 9,749 reasoning; 17,413,120 cache read.
- Tool parts: 295, including 95 Bash calls, 25 patches, 102 reads, 47 greps, 10 globs, and 9 subagent tasks.
- Wall-clock span: 43.21 minutes.
