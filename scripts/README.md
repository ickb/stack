# Scripts

Repository tooling, run from the root by the `package.json` scripts; nothing here ships in a package.

- `test/build/`: the build tests, run by Node's own test runner (`node --test 'scripts/test/**/*.ts'`) after vitest in `pnpm lint:coverage`. `native-source-smoke.ts` proves the workspace runs from TypeScript source (no deprecated `punycode` load, the two Node entrypoints fail fast without config); `rewrite-dts-imports.ts` covers the declaration rewrite below.
- `test/lint-rules.ts`: lints, for each custom rule in `eslint.config.mts`, a snippet it must leave alone and one it must report once for each branch of its selector and each cell-read method it bans, since a mistyped selector matches nothing and reports nothing.
- `test/tooling/`: the same runner's tests of the tooling scripts; `mutate-changed.ts` covers how the diff becomes Stryker ranges.
- `tooling/build/rewrite-dts-imports.ts`: rewrites the relative `.ts` specifiers `tsgo` leaves in the SDK's emitted declarations; the SDK build runs it.
- `tooling/dead-members.ts`: the dead-member lint knip cannot do, since knip sees exports and not class members; `pnpm lint:knip` runs it. Test-only references do not keep a production member alive. A TypeScript program supplies the references without the heavier language-service machinery.
- `tooling/mutate-changed.ts`: `pnpm mutate:changed`, the [diff-scoped mutation run](#mutation-testing).
- `tooling/eslint-plugin-types.d.ts`: the declaration shim for the ESLint plugins that publish no types.

## What the gate enforces

[`CI=true pnpm check`](../package.json) runs the full lint suite and interface build against installed dependencies; `pnpm fresh`, run on pull requests, holds the date-dependent checks that the root README's [dependency policy](../README.md#dependencies-and-checks) lists. The lint suite includes typechecking, formatting, duplication, unused code, dependency boundaries, API and package checks, coverage and ESLint.

The custom ESLint rules sit beside their rationale in [`eslint.config.mts`](../eslint.config.mts): compare whole script identities, use one uncached paging loop, parse untyped input at its boundary, justify type assertions and keep `@__PURE__` annotations out of class static blocks. The last rule prevents the bundler from removing codec initialization while retaining the class. Other production restrictions keep test-only dependency bags and fallback implementations out of runtime APIs. General style and test-shape checks use established presets rather than another local metrics framework.

[`dependency-cruiser`](../.dependency-cruiser.jsonc) enforces the browser/Node boundaries and keeps the contract oracle independent of the implementation it judges. That one import rule does not need a separate ESLint plugin or a graph reproducing every SDK directory.

### Coverage

[`vitest.config.mts`](../vitest.config.mts) requires 100% statements, branches, functions and lines on `sdk/src` and `sdk/node/src`. The bot and generator entrypoints are tested by spawning them and excluded from imported-module coverage; the sampler entrypoint is imported with its sampling mocked, so it is covered. Coverage-ignore comments are prohibited under `sdk/`.

Those thresholds cover the transaction and actor paths. Applying them to test doubles and presentation glue would require tests of the apparatus whenever its shape changes; those workspaces still have tests, without a universal percentage target. The bot fixture uses the real SDK builders so their constraints remain visible: a no-op builder once hid a prefix walk reusing a transaction that earlier candidates had mutated. See the [test kit](../testkit/README.md) for the shared doubles and oracle.

The [SDK API checks](../sdk/README.md#versioning-and-api-checks) validate reachable exports without freezing the unpublished rewrite's surface in a committed report.

### Mutation testing

`pnpm mutate` runs [StrykerJS](https://stryker-mutator.io/) over the source of the four workspaces, as [`stryker.config.json`](../stryker.config.json) sets it up. It makes one small edit to the code at a time and reports every edit no test notices. Full coverage only proves the code ran: a guard could still be deleted without a test failing. A full run takes far longer than the gate, so it runs on demand, outside `pnpm check`; `--mutate <globs>` narrows it. `--incremental` retests only what changed, but after an edit to the tests alone it can keep a stale survivor, such as a module-level constant the new test now pins, so final numbers come from a run without it or with `--force`.

`pnpm mutate:changed [base]` ([`tooling/mutate-changed.ts`](tooling/mutate-changed.ts)) mutates only the lines added since `base`, by default where the branch left `origin/master`. It keeps the changed files the config's `mutate` globs select, exclusions included, since a `--mutate` list replaces the config's, and passes each added hunk as a line range. With nothing left it exits 0 without starting Stryker; otherwise it runs without `--incremental`. The config's `break` threshold of 100 fails the run on any mutant that survives or that no test covers; a full `pnpm mutate` fails the same way while an unmarked survivor remains. Run it before opening or updating a pull request, as the [working agreement](../AGENTS.md#the-gate) asks. An equivalent mutant, one no input can tell apart from the original, is marked where it occurs with `// Stryker disable next-line <Mutator>: <reason>`.

The diff-scoped run has accepted gaps:

- A pull request that changes only tests mutates nothing, though its tests may have stopped killing mutants of unchanged code; a full run catches that.
- A deleted line produces no mutant, so the run says nothing about code whose guard was removed.
- Stryker makes a mutant only for code lying wholly inside one range, so a condition or block that also spans an unchanged line is not mutated, even where it joins an added guard to existing code.
- The sandbox gap below applies to it as to a full run.

A CI step running it on every pull request was rejected. Hosted runner minutes are free for this public repository, but wall time is not: its pull requests are often large, and a run the size of [pull request #67](https://github.com/ickb/stack/pull/67), close to a full one, was estimated at 35 to 50 minutes on a runner with four vCPUs. The accepted cost is that CI does not enforce the local rule; a full `pnpm mutate` can run at any time, for example before a merge.

The config names the vitest runner plugin because Stryker looks for plugins beside its own package, where the isolated layout of pnpm puts none. The bot and generator entrypoints are left out, because their tests spawn a process the mutant switch does not reach; the sampler's test imports it, so it is mutated. In the sandbox the workspace package links still lead to the checkout, so a test importing `@ickb/sdk` or `@ickb/testkit` runs the unmutated package: an SDK mutant meets only the tests that import the SDK by path, its own and the node actors', and a test kit mutant only its own tests. Such a survivor may still be caught elsewhere.

A surviving mutant earns the smallest test that kills it, or the deletion of the code it proves dead. The TypeScript checker was tried and left out: on a sample it found the same survivors, only relabeled as compile errors mutants the tests already killed, and made the run slower.
