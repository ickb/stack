# Scripts

Repository tooling, run from the root by the `package.json` scripts; nothing here ships in a package.

- `run-node-tests.ts`: runs every `test/**/*.ts` file below (support files excepted) under Node's own test runner; `pnpm lint:coverage` calls it after vitest.
- `test/build/`: the build tests. `native-source-smoke.ts` proves the workspace runs from TypeScript source (no deprecated `punycode` load, the two Node entrypoints fail fast without config); `rewrite-dts-imports.ts` covers the declaration rewrite below.
- `tooling/build/rewrite-dts-imports.ts`: rewrites the relative `.ts` specifiers `tsgo` leaves in the SDK's emitted declarations; `pnpm build` runs it and checks the result.
- `tooling/dead-members.ts`: the dead-member lint knip cannot do, since knip sees exports and not class members; `pnpm lint:knip` runs it. Test-only references do not keep a production member alive. A TypeScript program supplies the references without the heavier language-service machinery.
- `tooling/eslint/plugins.ts` and `tooling/eslint-plugin-types.d.ts`: the typed plugin registry the root `eslint.config.mts` imports, and the declaration shim for plugins that publish none.

## What the gate enforces

[`CI=true pnpm check`](../package.json) runs the audit, full lint suite and interface build against installed dependencies. The lint suite includes typechecking, formatting, duplication, unused code, dependency boundaries, API and package checks, coverage and ESLint.

The custom ESLint rules sit beside their rationale in [`eslint.config.mts`](../eslint.config.mts): compare whole script identities, use one uncached paging loop, parse untyped input at its boundary, justify type assertions and keep `@__PURE__` annotations out of class static blocks. The last rule prevents the bundler from removing codec initialization while retaining the class. Other production restrictions keep test-only dependency bags and fallback implementations out of runtime APIs. General style and test-shape checks use established presets rather than another local metrics framework.

[`dependency-cruiser`](../.dependency-cruiser.jsonc) enforces the browser/Node boundaries and keeps the contract oracle independent of the implementation it judges. That one import rule does not need a separate ESLint plugin or a graph reproducing every SDK directory.

### Coverage

[`vitest.config.mts`](../vitest.config.mts) requires 100% statements, branches, functions and lines on `sdk/src` and `sdk/node/src`. The three process entrypoints are tested by spawning them and excluded from imported-module coverage. Coverage-ignore comments are prohibited under `sdk/`.

Those thresholds cover the transaction and actor paths. Applying them to test doubles and presentation glue would require tests of the apparatus whenever its shape changes; those workspaces still have tests, without a universal percentage target. The bot fixture uses the real SDK builders so their constraints remain visible: a no-op builder once hid a prefix walk reusing a transaction that earlier candidates had mutated. See the [test kit](../testkit/README.md) for the shared doubles and oracle.

The [SDK API checks](../sdk/README.md#versioning-and-api-checks) validate reachable exports without freezing the unpublished rewrite's surface in a committed report.
