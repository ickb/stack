# Technology Stack

**Analysis Date:** 2026-02-17

## Languages

**Primary:**
- TypeScript 5.9.3 - All source code across packages and apps

**On-Chain (reference):**
- Rust 2021 edition - On-chain CKB smart contracts in `reference/contracts/` reference repo (3 contracts + shared utils, ~1,163 lines). Built with Capsule v0.10.5, `no_std` + alloc-only runtime, targeting RISC-V. Uses `ckb-std 0.15.3` and `primitive_types` crate for C256 safe math.

**Secondary:**
- Bash - `ccc-dev/record.sh`, `ccc-dev/replay.sh` for local CCC dev build setup
- JavaScript (CJS) - `.pnpmfile.cjs` for pnpm hook overrides, `prettier.config.cjs`

## Runtime

**Environment:**
- Node.js >= 24 (enforced via `engines` in root `package.json`)
- Current environment: v24.13.0

**Package Manager:**
- pnpm 10.30.1 (pinned via `packageManager` field with SHA-512 hash in root `package.json`)
- Lockfile: `pnpm-lock.yaml` present
- Workspace protocol: `workspace:*` for internal deps, `catalog:` for shared version pins

## Frameworks

**Core:**
- CCC (`@ckb-ccc/core` ^1.12.2) - CKB Common Chains SDK, the primary blockchain interaction library for all new packages. Version pinned via `pnpm-workspace.yaml` catalog.
- React 19.2.0 - Frontend UI framework (`apps/interface` only)
- Vite 6.4.0 - Frontend dev server and build tool (`apps/interface` only)

**LEGACY and DEPRECATED (still used by apps/bot, apps/tester, apps/interface):**
- `@ckb-lumos/*` 0.23.0 - DEPRECATED Lumos CKB framework. Being replaced by CCC.
- `@ickb/lumos-utils` 1.4.2 - DEPRECATED iCKB Lumos utilities. Being replaced by `@ickb/utils`.
- `@ickb/v1-core` 1.4.2 - DEPRECATED iCKB v1 core logic. Being replaced by `@ickb/core`.

**Testing:**
- Vitest 3.2.4 - Test runner, configured at root via `vitest.config.mts`
- `@vitest/coverage-v8` 3.2.4 - V8-based coverage

**Build/Dev:**
- TypeScript 5.9.3 - `tsc` for compilation (all packages/apps use `"build": "tsc"`)
- ESLint 9.39.2 + typescript-eslint 8.55.0 - Linting with strict type-checked rules
- Prettier 3.8.1 + prettier-plugin-organize-imports 4.3.0 - Formatting
- Typedoc 0.28.7 - API documentation generation
- Changesets CLI 2.29.8 - Version management and publishing

## Key Dependencies

**Critical (new CCC-based packages):**
- `@ckb-ccc/core` ^1.12.2 - CKB blockchain client, transaction building, signing, cell queries, Molecule codecs. THE foundational dependency for all new code. Used by: `@ickb/utils`, `@ickb/dao`, `@ickb/order`, `@ickb/core`, `@ickb/sdk`, `@ickb/faucet`, `@ickb/sampler`.

**Critical (legacy, apps not yet migrated):**
- `@ckb-lumos/*` 0.23.0 - Used by `apps/bot`, `apps/tester`, `apps/interface`. Will be removed when these apps migrate to CCC.
- `@ickb/lumos-utils` 1.4.2 - Legacy iCKB utilities. Used by `apps/bot`, `apps/tester`, `apps/interface`.
- `@ickb/v1-core` 1.4.2 - Legacy iCKB core. Used by `apps/bot`, `apps/tester`, `apps/interface`.

**Frontend (apps/interface only):**
- `@tanstack/react-query` 5.90.5 - Server-state management and data fetching
- `@ckb-ccc/ccc` ^1.1.21 - CCC full bundle (includes wallet connectors, JoyId signer)
- Tailwind CSS 4.1.14 - Utility-first CSS framework
- `immutable` 4.3.7 - Immutable data structures (used with Lumos TransactionSkeleton)
- `@vitejs/plugin-react` 4.7.0 + `babel-plugin-react-compiler` - React 19 compiler integration
- `@vitejs/plugin-basic-ssl` 1.2.0 - HTTPS in dev mode

## Monorepo Workspace Structure

**Workspace definition** (`pnpm-workspace.yaml`):
```yaml
packages:
  - packages/*
  - apps/*
  - ccc-dev/ccc/packages/*
  - "!ccc-dev/ccc/packages/demo"
  - "!ccc-dev/ccc/packages/docs"
  - "!ccc-dev/ccc/packages/examples"
  - "!ccc-dev/ccc/packages/faucet"
  - "!ccc-dev/ccc/packages/playground"
  - "!ccc-dev/ccc/packages/tests"

catalog:
  '@ckb-ccc/core': ^1.12.2
  '@types/node': ^24.8.1

minimumReleaseAge: 1440
```

**Internal dependency graph (new CCC-based packages):**
```
@ickb/utils          <- @ckb-ccc/core
@ickb/dao            <- @ckb-ccc/core, @ickb/utils
@ickb/order          <- @ckb-ccc/core, @ickb/utils
@ickb/core           <- @ckb-ccc/core, @ickb/dao, @ickb/utils
@ickb/sdk            <- @ckb-ccc/core, @ickb/core, @ickb/dao, @ickb/order, @ickb/utils
```

**Apps dependency split:**
- **CCC-based (new):** `apps/faucet` -> `@ickb/utils`; `apps/sampler` -> `@ickb/core`, `@ickb/utils`
- **Lumos-based (legacy):** `apps/bot`, `apps/tester`, `apps/interface` -> `@ickb/lumos-utils`, `@ickb/v1-core`, `@ckb-lumos/*`

## Local CCC Dev Build Override Mechanism

The repo supports using a local development build of CCC for testing unpublished upstream changes. This is controlled by two files:

**`ccc-dev/record.sh`:**
- Clones the CCC repo (`https://github.com/ckb-devrel/ccc.git`) into `./ccc-dev/ccc/`
- Accepts refs as args: branch names, PR numbers, or commit SHAs
- Merges specified refs onto a `wip` branch (uses AI Coworker CLI for merge conflict resolution)
- Builds CCC locally: `pnpm build:prepare && pnpm build`
- Run via: `pnpm ccc:record` (default invocation: `bash ccc-dev/record.sh releases/next releases/udt`)
- The `ccc-dev/ccc/` directory is gitignored
- Aborts if `ccc-dev/ccc/` has pending work (any changes vs pinned commit, diverged HEAD, or untracked files)

**`.pnpmfile.cjs`:**
- A pnpm `readPackage` hook that auto-discovers all packages in `ccc-dev/ccc/packages/*/package.json`
- When `ccc-dev/ccc/` exists, overrides all `@ckb-ccc/*` dependency versions in the workspace with `workspace:*` (CCC packages are listed in `pnpm-workspace.yaml`, but catalog specifiers resolve to semver ranges before workspace linking, so the hook forces `workspace:*` to ensure local packages are used)
- Applies to `dependencies`, `devDependencies`, and `optionalDependencies`
- Effect: all workspace packages transparently use the local CCC build instead of npm versions

**CCC upstream contributions:** The maintainer contributed UDT and Epoch support to CCC upstream (now merged). The local Epoch class has been deleted (replaced by `ccc.Epoch`). Some local UDT handling in `packages/utils/src/udt.ts` may still overlap with features now available in CCC's `@ckb-ccc/udt` package.

## Configuration

**TypeScript** (`tsconfig.json`):
- Target: ES2020
- Module: NodeNext / ModuleResolution: NodeNext
- Strict mode enabled with additional checks: `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitAny`
- `verbatimModuleSyntax: true`
- `importsNotUsedAsValues: "remove"`
- Packages extend root tsconfig: `rootDir: "src"`, `outDir: "dist"`

**ESLint** (`eslint.config.mjs`):
- Flat config format (ESLint 9+)
- Base: `eslint.configs.recommended` + `tseslint.configs.strictTypeChecked` + `tseslint.configs.strict`
- Custom rule: `@typescript-eslint/explicit-function-return-type: "error"`
- Ignores: `**/dist/**`
- `apps/interface` has its own `eslint.config.mjs` with React-specific plugins

**Prettier** (`prettier.config.cjs`):
- Double quotes (`singleQuote: false`)
- Trailing commas: `all`
- Plugin: `prettier-plugin-organize-imports` (auto-sorts imports on format)
- `apps/interface` has a separate `.prettierrc` with `prettier-plugin-tailwindcss`

**Environment:**
- `apps/bot`: Loads env from `env/${CHAIN}/.env` via Node.js `--env-file=` flag
- `apps/tester`: Same pattern as bot
- `apps/faucet`: Reads `ADDRESS` from env
- `.env` files present at `apps/bot/env/devnet/.env` and `apps/tester/env/devnet/.env`

**Build:**
- `pnpm build` builds only packages (excludes apps): `pnpm -r --filter !./apps/** build`
- `pnpm build:all` builds everything: `pnpm -r build`
- All packages use `tsc` as build step
- `apps/interface` uses `tsc && vite build`
- `pnpm clean` removes dist dirs; `pnpm clean:deep` also removes node_modules and lockfile

## Versioning

**Packages use version `1001.0.0`** (Epoch Semantic Versioning) - All publishable packages (`@ickb/utils`, `@ickb/dao`, `@ickb/order`, `@ickb/core`, `@ickb/sdk`) use this version, managed by changesets.

**Changesets** (`.changeset/config.json`):
- Public access
- GitHub changelog integration linked to `ickb/stack` repo
- Base branch: `master`
- Template syncing via `pnpm sync:template` copies shared config files (`.npmignore`, `tsconfig.json`, `typedoc.json`, `vitest.config.mts`) from `packages/utils` to other packages

**All packages publish to npm** with `"access": "public"` and `"provenance": true`.

## Platform Requirements

**Development:**
- Node.js >= 24
- pnpm 10.30.1
- Git (for CCC setup script)
- DevContainer configuration at `.devcontainer/devcontainer.json`

**Production:**
- `apps/bot`: Node.js CLI, long-running process with `start:loop` (infinite restart with 10s delay)
- `apps/tester`: Node.js CLI, long-running process
- `apps/faucet`: Node.js CLI, one-shot or long-running
- `apps/sampler`: Node.js CLI, outputs CSV to stdout, one-shot
- `apps/interface`: Static SPA built with Vite, deploy as static files

## Abandoned / Superseded Concepts

**SmartTransaction** (`packages/utils/src/transaction.ts`): Extends `ccc.Transaction` with UDT handler management and header caching. The SmartTransaction concept was abandoned as a standalone pattern because nobody else in the CKB ecosystem adopted it. Headers are now cached in the CCC Client Cache instead. However, the class code remains in the codebase and is still actively used by the new packages (`@ickb/utils`, `@ickb/dao`, `@ickb/order`, `@ickb/core`, `@ickb/sdk`).

---

*Stack analysis: 2026-02-17*
