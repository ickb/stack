# Scripts

The tooling behind the gate: one command checks the whole tree!

Everything here runs from the root `package.json` scripts. Nothing here ships in a package.

## What the gate enforces

[`CI=true pnpm check`](../package.json) is the gate. It depends on the tree alone. It runs the whole lint suite, then builds the interface. The lint suite covers types, format, duplication, unused code, dependency boundaries, the [SDK API](../sdk/docs/package.md#versioning) and package, coverage and ESLint.

Three more runs sit outside it:

- **`pnpm fresh`:** the checks that depend on the date. It runs `pnpm audit`, checks for outdated dependencies and GitHub Actions, then fails when the pinned Node major has a newer security release ([`pins.ts`](tooling/pins.ts)). The dependency policy lives in [`pnpm-workspace.yaml`](../pnpm-workspace.yaml).
- **`pnpm mutate:changed`:** mutation testing on the lines a pull request adds.
- **`pnpm mutate`:** the full mutation run.

When each one runs is a rule of the [working agreement](../AGENTS.md#the-gate).

## Lint rules

The custom ESLint rules sit beside their reasons in [`eslint.config.mts`](../eslint.config.mts). Each has a test that it still matches what it bans. [`dependency-cruiser`](../.dependency-cruiser.jsonc) holds the import boundaries. A [dead-member check](tooling/dead-members.ts) finds the class members knip can't see. The [lint rules](docs/lint_rules.md) page has the details.

## Coverage

The SDK and the Node actors need 100% coverage. The test kit and the interface have tests, without a percentage target. The [coverage](docs/coverage.md) page explains where the line sits.

## Mutation testing

Full coverage only proves the code ran: a guard could still go without a test failing. Mutation testing makes one small edit to the code at a time, then reports every edit no test notices. `pnpm mutate:changed` fails on any such mutant within the added lines. The [mutation testing](docs/mutation_testing.md) page covers both runs, their gaps and how to mark an equivalent mutant.

## Layout

- `tooling/build/rewrite-dts-imports.ts`: rewrites the relative `.ts` specifiers `tsgo` leaves in the emitted SDK declarations. The SDK build runs it.
- `tooling/dead-members.ts`: the dead-member check, run by `pnpm lint:knip`.
- `tooling/mutate-changed.ts`: `pnpm mutate:changed`.
- `tooling/pins.ts`: the Node release check of `pnpm fresh`.
- `tooling/eslint-plugin-types.d.ts`: the declaration shim for the ESLint plugins that publish no types.
- `test/`: tests run by the Node test runner (`node --test 'scripts/test/**/*.ts'`) after vitest in `pnpm lint:coverage`.
- `test/build/native-source-smoke.ts`: proves the workspace runs from TypeScript source. No deprecated `punycode` loads. The bot and the generator fail fast without config.
- `test/build/rewrite-dts-imports.ts`: covers the declaration rewrite.
- `test/docs/readme_examples.ts`: checks that each README shows its `sdk/examples` file as it is.
- `test/lint-rules.ts`: tests the custom ESLint rules.
- `test/tooling/mutate-changed.ts`: covers how the diff becomes Stryker ranges.
