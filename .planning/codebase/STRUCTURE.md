# Codebase Structure

**Analysis Date:** 2026-02-14

## Directory Layout

```
/workspaces/stack/
├── packages/                    # NEW CCC-based libraries (replacing deprecated @ickb/lumos-utils, @ickb/v1-core)
│   ├── core/                    # iCKB core logic and entities
│   ├── dao/                     # Nervos DAO wrapper
│   ├── order/                   # Limit order cell logic
│   ├── sdk/                     # High-level SDK composing all packages
│   └── utils/                   # Blockchain primitives and transaction helpers
├── apps/                        # Applications
│   ├── bot/                     # Order fulfillment bot (LEGACY - Lumos)
│   ├── faucet/                  # Testnet CKB distribution (MIGRATED - CCC)
│   ├── sampler/                 # Blockchain state sampling (MIGRATED - CCC)
│   ├── tester/                  # Order creation simulator (LEGACY - Lumos)
│   └── interface/               # React web UI (LEGACY - Lumos)
├── scripts/                     # Dev scripts (setup-ccc.sh)
├── ccc/                         # Local CCC clone (optional, gitignored, created by scripts/setup-ccc.sh)
├── .pnpmfile.cjs                # pnpm hook to override @ckb-ccc/* with local ccc/ builds
├── .planning/                   # GSD planning documents
├── .github/                     # GitHub workflows and configuration
├── .devcontainer/               # Dev container config
├── pnpm-workspace.yaml          # Monorepo workspace definition
├── package.json                 # Root package manifest
├── tsconfig.json                # TypeScript configuration
├── vitest.config.mts            # Vitest configuration
├── eslint.config.mjs            # ESLint configuration
└── README.md                    # Project documentation
```

## Directory Purposes

**packages/core:**
- Purpose: Core iCKB protocol implementation
- Contains: Deposit/receipt cell types, LogicManager, entity encoders, owned owner script logic
- Key files: `logic.ts` (LogicManager), `entities.ts` (ReceiptData), `cells.ts` (cell types)
- Exports: All via `index.ts` barrel export
- Dependencies: @ckb-ccc/core, @ickb/dao, @ickb/utils

**packages/dao:**
- Purpose: Nervos DAO abstraction layer
- Contains: DaoManager for DAO cell operations, cell type wrappers
- Key files: `dao.ts` (DaoManager), `cells.ts` (DAO cell types)
- Exports: All via `index.ts` barrel export
- Dependencies: @ckb-ccc/core

**packages/order:**
- Purpose: Limit order cell management
- Contains: OrderManager, order cell types, order entities
- Key files: `order.ts` (OrderManager), `entities.ts` (order data structures), `cells.ts` (cell types)
- Exports: All via `index.ts` barrel export
- Dependencies: @ckb-ccc/core, @ickb/utils

**packages/sdk:**
- Purpose: High-level unified SDK
- Contains: IckbSdk class (main entry point), codec definitions, constants
- Key files: `sdk.ts` (IckbSdk), `codec.ts` (PoolSnapshot codec), `constants.ts` (script configs)
- Exports: All via `index.ts` barrel export
- Dependencies: @ckb-ccc/core, @ickb/core, @ickb/dao, @ickb/order, @ickb/utils

**packages/utils:**
- Purpose: Shared blockchain utilities and primitives
- Contains: SmartTransaction, CapacityManager, epoch helpers, UDT handlers, codec utilities
- Key files: `transaction.ts` (SmartTransaction), `capacity.ts` (CapacityManager), `epoch.ts`, `udt.ts`
- Exports: All via `index.ts` barrel export
- Dependencies: @ckb-ccc/core

**apps/bot:**
- Purpose: Automated order fulfillment service
- **Status: LEGACY** -- still uses `@ickb/lumos-utils`, `@ickb/v1-core`, `@ckb-lumos/*` (all deprecated)
- Contains: Main loop logic for matching and executing limit orders
- Key files: `src/index.ts` (main entry point with bot loop)
- Environment: Requires CHAIN, RPC_URL, BOT_PRIVATE_KEY, BOT_SLEEP_INTERVAL
- Execution: `pnpm start` runs with specified chain environment

**apps/faucet:**
- Purpose: Testnet CKB distribution from deposit cells
- **Status: MIGRATED** -- uses new `@ickb/utils` + CCC
- Contains: Account management, transaction building for fund transfers
- Key files: `src/index.ts` (main0 function with distribution loop)
- Environment: Requires ADDRESS (target account)
- Execution: `pnpm start` with ADDRESS env variable

**apps/sampler:**
- Purpose: Blockchain state monitoring and iCKB exchange rate sampling
- **Status: MIGRATED** -- uses new `@ickb/core`, `@ickb/utils` + CCC
- Contains: State snapshot collection, rate calculation
- Key files: `src/index.ts` (main entry point)
- Output: CSV format to stdout via rate.csv
- Execution: `pnpm start`

**apps/tester:**
- Purpose: Order creation simulation and testing
- **Status: LEGACY** -- still uses `@ickb/lumos-utils`, `@ickb/v1-core`, `@ckb-lumos/*` (all deprecated)
- Contains: Order scenario execution, response validation
- Key files: `src/index.ts` (main entry point)
- Environment: Requires CHAIN environment variable
- Execution: `pnpm start` with CHAIN environment

**apps/interface:**
- Purpose: Web UI for iCKB operations
- **Status: LEGACY** -- still uses `@ickb/lumos-utils`, `@ickb/v1-core`, `@ckb-lumos/*` (all deprecated)
- Contains: React components, transaction building, state queries
- Key files: `main.tsx` (app bootstrap), `App.tsx` (root component), `queries.ts` (data fetching)
- Components: Dashboard, Form, Action, Progress, Connector
- Dependencies: React 19, TailwindCSS, react-query, CCC, Lumos

**ccc/:**
- Purpose: Local CCC clone for development against unpublished upstream changes
- **NOT a git submodule** -- cloned by `scripts/setup-ccc.sh`, gitignored
- When present, `.pnpmfile.cjs` auto-overrides all `@ckb-ccc/*` deps with `link:` references
- Building: `pnpm ccc:setup` runs `scripts/setup-ccc.sh` with preconfigured refs

**.planning/codebase/:**
- Purpose: GSD codebase analysis documents
- Contains: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md, STACK.md, INTEGRATIONS.md
- Usage: Referenced by GSD orchestrator for phase planning

## Key File Locations

**Entry Points:**
- `packages/sdk/src/sdk.ts` - IckbSdk.from() factory
- `apps/bot/src/index.ts` - Bot main() function
- `apps/faucet/src/index.ts` - Faucet main0() function
- `apps/sampler/src/index.ts` - Sampler main() function
- `apps/tester/src/index.ts` - Tester main() function
- `apps/interface/src/main.tsx` - Interface startApp() function

**Configuration:**
- `pnpm-workspace.yaml` - Monorepo packages and catalog definitions
- `package.json` - Root scripts and CCC override configuration
- `tsconfig.json` - TypeScript compiler options (ES2020 target, strict mode)
- `vitest.config.mts` - Vitest test discovery and coverage configuration

**Core Logic:**
- `packages/core/src/logic.ts` - LogicManager (deposit/receipt operations)
- `packages/order/src/order.ts` - OrderManager (order cell operations)
- `packages/utils/src/transaction.ts` - SmartTransaction (fee completion, UDT balancing)
- `packages/utils/src/capacity.ts` - CapacityManager (cell collection and change management)

**Testing:**
- `vitest.config.mts` - Test configuration at root
- `packages/*/vitest.config.mts` - Per-package test configs (if present)
- No test files currently in packages/ or apps/

## Naming Conventions

**Files:**
- Sources: `*.ts` for TypeScript, `*.tsx` for React components
- Compiled output: `dist/` directory (gitignored)
- Type definitions: Automatic from `*.ts` files via `declaration: true` in tsconfig

**Directories:**
- Package directories: kebab-case (e.g., `packages/order`, `apps/interface`)
- Source directories: Always `src/` for packages and apps
- Output directory: Always `dist/` after compilation

**Exports:**
- Barrel exports: `index.ts` re-exports all public types and functions
- Pattern: `export * from "./module.js"` (using `.js` extension for ESM)
- No default exports in index files

**Functions and Classes:**
- Class names: PascalCase (e.g., `IckbSdk`, `LogicManager`, `SmartTransaction`)
- Function names: camelCase (e.g., `main`, `deposit`, `completeFee`)
- Manager classes: Consistently named with Manager suffix (LogicManager, OrderManager, DaoManager, CapacityManager)

**Interfaces and Types:**
- Interfaces: PascalCase, often end with -Like for permissive input types (e.g., `OwnerDataLike`, `ReceiptDataLike`)
- Type unions: PascalCase (e.g., `SystemState`, `OrderCell`, `L1StateType`)
- Type aliases: Match the entity they represent

## Where to Add New Code

**New Feature (e.g., new protocol operation):**
- Primary code: Create in `packages/{appropriate-package}/src/{feature}.ts`
  - If cross-domain: Add to `packages/sdk/src/` and compose with existing managers
  - If specific to domain: Add to domain package (core, dao, order)
- Tests: Create `packages/{package}/src/{feature}.test.ts` (when testing is set up)
- Export: Add to `packages/{package}/src/index.ts` barrel file

**New Component/Module (e.g., new UI page):**
- Implementation: `apps/interface/src/{ComponentName}.tsx`
- Styles: Inline with TailwindCSS classes or tailwind.config.js
- Data fetching: Add query options in `apps/interface/src/queries.ts`
- Transaction helpers: Add to `apps/interface/src/transaction.ts` if needed

**New Application (e.g., new CLI tool):**
- Create: New directory in `apps/{app-name}/`
- Copy structure: Use existing app (e.g., faucet or sampler) as template
- Files needed:
  - `package.json` - With appropriate scripts and dependencies
  - `src/index.ts` - Main entry point
  - `env/{CHAIN}/.env` - If environment-specific (for bot, tester)
- Register: Add to `pnpm-workspace.yaml` packages list if not auto-detected

**Utilities (e.g., new helper functions):**
- Shared helpers: `packages/utils/src/{category}.ts`
- Import pattern: `export * from "./{category}.js"` in `packages/utils/src/index.ts`
- Domain-specific: Place in appropriate domain package

**Dependencies:**
- Internal: Use workspace protocol: `"@ickb/package": "workspace:*"`
- External: Run `pnpm add @package/name` from workspace root
- Catalog versions: Use `"@package/name": "catalog:"` if defined in pnpm-workspace.yaml

## Special Directories

**ccc/:**
- Purpose: Local CCC clone for development
- Generated: Via `scripts/setup-ccc.sh` (clones, merges refs, builds)
- Committed: No (gitignored)
- Override: `.pnpmfile.cjs` auto-redirects `@ckb-ccc/*` deps to local builds
- Scripts: `pnpm ccc:setup`

**scripts/:**
- Purpose: Dev tooling scripts
- `setup-ccc.sh` - Clones CCC repo, merges specified refs (branches/PRs/SHAs), builds locally
- Committed: Yes

**node_modules/:**
- Purpose: Installed dependencies via pnpm
- Generated: Yes (via `pnpm install`)
- Committed: No (in .gitignore)
- Management: Use pnpm-lock.yaml for lock file

**dist/:**
- Purpose: Compiled TypeScript output
- Generated: Yes (via `pnpm build`)
- Committed: No (in .gitignore)
- Structure: Mirrors src/ with .js, .d.ts, and .map files

**.github/workflows/:**
- Purpose: CI/CD pipeline definitions
- Committed: Yes
- Contains: Automated tests, build, and publish workflows

**.planning/codebase/:**
- Purpose: GSD analysis documents
- Generated: By gsd:map-codebase command
- Committed: Yes
- Usage: Read by gsd:plan-phase for implementation guidance

---

*Structure analysis: 2026-02-14*
