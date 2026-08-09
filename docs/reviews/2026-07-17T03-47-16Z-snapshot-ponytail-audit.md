# Snapshot Review: Ponytail Audit

## Scope and Freshness

- Source: a disposable snapshot of the complete dirty Stack checkout.
- Snapshot HEAD: `ca51bf88d57887fcc554f8697939e0560e9ef2ab`.
- Snapshot dirty-status hash: `3384660eb9ec35e553f1b4d25a7ed85d82f60295e823d038a817e5b969282206`.
- Session: `ses_091e565edffetgG2Roxasiq3XM`, GPT-5.6 Sol at high effort with `ponytail-audit` added to the current OpenCode policy.
- Isolation: only the audited Markdown skill paths were exposed. Git remotes, linked-worktree metadata, prior `docs/reviews` reports, local runtime configs, logs, and scratch files were absent. The session was read-only and made no source changes.
- Freshness warning: these findings were generated from a frozen snapshot. The original checkout may have changed since it was copied. Recheck the current scripts and lint configuration before applying them.
- Coverage warning: the repository-wide audit reached its 20-minute limit before completion. This report contains only candidates supported by files inspected during that session.

## Actionable Candidates

### Remove repeated build and test stages from the full check

`package.json:10-27` runs `pnpm lint` before `pnpm build:all` and `pnpm test:ci`. Within lint, `lint:api` already runs `pnpm build`, and `lint:coverage` already runs both Vitest and the Node test runner. The later build and test stages repeat that work.

Direction: make the full check build reusable packages once, build the interface once, and run each test suite once with coverage. Preserve the current failure surfaces and fresh-install boundary while removing the duplicate executions.

Expected reduction: two repeated pipeline stages and their CI time; no product files or dependencies.

### Remove the custom warning-severity rewrite

`eslint.config.mts:142-166` recursively rewrites warning severities from imported plugin configurations to errors. The owned ESLint command at `package.json:24` already uses `--max-warnings=0`, so warnings fail the repository gate without rewriting third-party configuration objects.

Direction: pass the RegExp, Security, and Promise plugin configurations through without severity mutation. Retain only the minimum typing or missing-config assertion required by the flat-config API.

Expected reduction: the recursive adapter and severity conversion policy; no rule coverage or dependency change.

### Give cyclomatic complexity one policy owner

`eslint.config.mts:185` enables ESLint's core `complexity` rule with a maximum of 15, while `eslint.config.mts:331` also enables `sonarjs/cyclomatic-complexity`. They enforce overlapping cyclomatic-complexity policies with independently controlled thresholds and diagnostics.

Direction: choose one rule and one explicit threshold after comparing their current diagnostics, then remove the other owner. This candidate does not imply removing complexity enforcement.

Expected reduction: one duplicate lint policy and its dual-disable pressure.

### Remove the exhaustive class-member ordering taxonomy

`eslint.config.mts:38-102` defines a detailed public/protected/private, static/instance, field/accessor/method ordering table used only by `@typescript-eslint/member-ordering` at lines 393-399.

Direction: remove the ordering rule and table unless a concrete merge, review, or generated-API contract depends on it. Formatting and local readability remain owned by Prettier and normal review.

Expected reduction: one style-only policy and about 60 lines of configuration; no runtime behavior or dependency change.

## Rejected Candidate

The session proposed deleting Dependency Cruiser's `no-orphans` rule because Knip runs immediately before it. That is not currently sound: `knip.jsonc:5` declares every `scripts/**/*.ts` file as an entry point, which prevents Knip from proving unused script entry files, while `.dependency-cruiser.jsonc:4-21` retains a separate orphan check and explicit entry exceptions. Keep this rule until Knip has a precise, demonstrated replacement for that coverage.

## Verification Limits

No configuration was changed, so no lint or full-check timing comparison was run. Each accepted candidate still needs a disposable implementation trial followed by the relevant repository-native gates. No live CKB path was exercised.
