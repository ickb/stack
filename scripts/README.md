# Scripts

Repository tooling, run from the root by the `package.json` scripts; nothing here ships in a package.

- `run-node-tests.ts`: runs every `test/**/*.ts` file below (support files excepted) under Node's own test runner; `pnpm lint:coverage` calls it after vitest.
- `test/build/`: the build tests. `native-source-smoke.ts` proves the workspace runs from TypeScript source (no deprecated `punycode` load, the two Node entrypoints fail fast without config); `rewrite-dts-imports.ts` covers the declaration rewrite below.
- `tooling/build/rewrite-dts-imports.ts`: rewrites the relative `.ts` specifiers `tsgo` leaves in the SDK's emitted declarations; `pnpm build` runs it and checks the result.
- `tooling/dead-members.ts`: the dead-member lint knip cannot do, since knip sees exports and not class members; `pnpm lint:knip` runs it (decisions amendment 52(ak)(10)).
- `tooling/eslint/plugins.ts` and `tooling/eslint-plugin-types.d.ts`: the typed plugin registry the root `eslint.config.mts` imports, and the declaration shim for plugins that publish none.
