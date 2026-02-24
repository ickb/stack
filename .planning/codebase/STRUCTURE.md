# Codebase Structure

**Analysis Date:** 2026-02-17

## Directory Layout

```
/workspaces/stack/
├── packages/                       # NEW CCC-based libraries (replacing Lumos)
│   ├── core/                       # iCKB protocol logic (deposits, receipts, ownership)
│   │   └── src/
│   │       ├── index.ts            # Barrel export: cells, entities, logic, owned_owner, udt
│   │       ├── logic.ts            # LogicManager class (269 lines)
│   │       ├── owned_owner.ts      # OwnedOwnerManager class (239 lines)
│   │       ├── cells.ts            # Cell type wrappers (175 lines)
│   │       ├── entities.ts         # OwnerData, ReceiptData codec (113 lines)
│   │       └── udt.ts              # iCKB UDT value calculations (213 lines)
│   ├── dao/                        # Nervos DAO abstraction layer
│   │   └── src/
│   │       ├── index.ts            # Barrel export: cells, dao
│   │       ├── dao.ts              # DaoManager class (412 lines)
│   │       └── cells.ts            # DaoCell types (180 lines)
│   ├── order/                      # Limit order management
│   │   └── src/
│   │       ├── index.ts            # Barrel export: cells, entities, order
│   │       ├── order.ts            # OrderManager class (988 lines)
│   │       ├── entities.ts         # Info, Ratio, OrderData types (754 lines)
│   │       └── cells.ts            # OrderCell, MasterCell, OrderGroup (396 lines)
│   ├── sdk/                        # High-level SDK composition
│   │   └── src/
│   │       ├── index.ts            # Barrel export: codec, constants, sdk
│   │       ├── sdk.ts              # IckbSdk class (512 lines)
│   │       ├── constants.ts        # Script config factory (205 lines)
│   │       └── codec.ts            # PoolSnapshot codec (138 lines)
│   └── utils/                      # Shared blockchain utilities
│       └── src/
│           ├── index.ts            # Barrel export: codec, capacity, heap, transaction, udt, utils
│           ├── transaction.ts      # SmartTransaction class (517 lines)
│           ├── capacity.ts         # CapacityManager class (221 lines)
│           ├── udt.ts              # UDT calculations and handlers (393 lines)
│           ├── utils.ts            # Binary search, collectors, etc. (458 lines)
│           ├── codec.ts            # CheckedInt32LE codec (21 lines)
│           └── heap.ts             # Heap implementation (175 lines)
├── apps/                           # Applications
│   ├── bot/                        # Order matching daemon (LEGACY - Lumos)
│   │   └── src/
│   │       └── index.ts            # main() entry with order matching loop (897 lines)
│   ├── faucet/                     # Testnet CKB distribution (MIGRATED to CCC)
│   │   └── src/
│   │       ├── index.ts            # Entry: imports and calls main() from main.ts
│   │       └── main.ts             # main() entry with distribution loop (88 lines)
│   ├── sampler/                    # Blockchain state sampling (MIGRATED to CCC)
│   │   └── src/
│   │       └── index.ts            # Direct execution entry (192 lines)
│   ├── tester/                     # Order creation simulator (LEGACY - Lumos)
│   │   └── src/
│   │       └── index.ts            # main() entry with test scenarios (469 lines)
│   └── interface/                  # React web UI (LEGACY - Lumos)
│       ├── src/
│       │   ├── main.tsx            # startApp(wallet_chain) entry (68 lines)
│       │   ├── App.tsx             # Root component with conversion logic (93 lines)
│       │   ├── Connector.tsx       # Wallet connection setup (104 lines)
│       │   ├── Form.tsx            # User input form (144 lines)
│       │   ├── Action.tsx          # Transaction execution (174 lines)
│       │   ├── Dashboard.tsx       # Balance display (36 lines)
│       │   ├── Progress.tsx        # Loading indicator (42 lines)
│       │   ├── queries.ts          # React Query options and state (395 lines)
│       │   ├── transaction.ts      # Transaction builders (291 lines)
│       │   ├── utils.ts            # Helper utilities (160 lines)
│       │   └── vite-env.d.ts       # Vite type definitions
│       └── public/                 # Static assets
├── ccc-dev/                        # Local CCC development (record/replay system)
│   ├── pins/                       # Committed: manifest + counted resolutions + local patches
│   │   ├── HEAD                    # Expected final SHA after full replay
│   │   ├── manifest                # Base SHA + merge refs (TSV, one per line)
│   │   ├── res-N.resolution        # Conflict resolution for merge step N (counted format)
│   │   └── local-*.patch           # Local development patches (applied after merges)
│   ├── ccc/                        # Gitignored: ephemeral CCC clone (auto-generated)
│   ├── lib.sh                      # Shared shell functions for ccc-dev scripts
│   ├── patch.sh                    # Rewrites CCC exports to .ts source, creates deterministic commit
│   ├── push.sh                     # Pushes local CCC changes upstream
│   ├── record.sh                   # Records new pins with AI Coworker conflict resolution
│   ├── replay.sh                   # Deterministically rebuilds ccc/ from pins
│   ├── save.sh                     # Captures local CCC work as a patch in pins/
│   ├── status.sh                   # Checks if ccc-dev/ccc/ has pending custom work
│   └── tsgo-filter.sh              # Wrapper around tsgo filtering CCC diagnostics
├── reference/                      # Read-only reference repos (git-ignored, clone via `pnpm reference`)
│   ├── contracts/                 # Rust on-chain contracts
│   │   └── scripts/contracts/
│   │       ├── ickb_logic/        # Type script: iCKB UDT minting/validation
│   │       ├── limit_order/       # Lock script: peer-to-peer limit orders
│   │       ├── owned_owner/       # Lock script: DAO withdrawal delegation
│   │       └── utils/             # Shared: DAO helpers, C256 safe math, MetaPoint
│   └── whitepaper/                # iCKB protocol design
│       ├── README.md              # Complete protocol specification (~49KB)
│       └── 2024_overview.md       # Project overview and timeline
├── .planning/                      # GSD analysis documents
│   └── codebase/
│       ├── ARCHITECTURE.md         # Architecture and data flows
│       ├── STRUCTURE.md            # Directory layout and file locations
│       ├── CONVENTIONS.md          # Code style and naming conventions
│       ├── TESTING.md              # Testing patterns and frameworks
│       ├── CONCERNS.md             # Technical debt and issues
│       ├── STACK.md                # Technology stack
│       └── INTEGRATIONS.md         # External services and APIs
├── scripts/                        # Developer scripts
│   ├── pr.sh                       # Open GitHub PR creation page
│   └── review.sh                   # Fetch PR review comments
├── .github/                        # GitHub configuration
│   └── workflows/                  # CI/CD pipeline definitions
├── .devcontainer/                  # Dev container configuration
├── node_modules/                   # Installed dependencies (gitignored)
├── .pnpm-store/                    # pnpm package cache (gitignored)
├── pnpm-workspace.yaml             # Monorepo workspace and catalog definitions
├── package.json                    # Root workspace scripts and metadata
├── pnpm-lock.yaml                  # Deterministic lock file (committed)
├── tsconfig.json                   # Root TypeScript configuration
├── vitest.config.mts               # Test framework configuration
├── eslint.config.mjs               # ESLint configuration
├── prettier.config.cjs             # Code formatter configuration
├── .gitignore                      # Git exclusions
├── LICENSE                         # MIT License
├── README.md                       # Project overview
└── CONTRIBUTING.md                 # Contribution guidelines
```

## Directory Purposes

**packages/core/src/:**
- Purpose: Core iCKB protocol implementation
- Exports: LogicManager, OwnedOwnerManager, IckbDepositCell, ReceiptCell, WithdrawalGroup, OwnerCell
- Dependencies: @ckb-ccc/core, @ickb/dao, @ickb/utils

**packages/dao/src/:**
- Purpose: Nervos DAO abstraction layer
- Exports: DaoManager, DaoCell factory
- Key class: `DaoManager` implements ScriptDeps interface
- Methods: `deposit()`, `requestWithdrawal()`, `withdraw()`, `findDeposits()`, `findWithdrawalRequests()`
- Dependencies: @ckb-ccc/core, @ickb/utils

**packages/order/src/:**
- Purpose: Limit order cell management and matching
- Exports: OrderManager, OrderCell, MasterCell, OrderGroup, Info, Ratio, OrderData
- Key class: `OrderManager` implements ScriptDeps interface
- Methods: `convert()`, `mint()`, `satisfy()`, `melt()`, `findOrders()`
- Key types: `Info` (order metadata), `Ratio` (exchange rate)
- Dependencies: @ckb-ccc/core, @ickb/utils

**packages/sdk/src/:**
- Purpose: High-level unified SDK for iCKB operations
- Exports: IckbSdk, SystemState, CkbCumulative, PoolSnapshot codec
- Key class: `IckbSdk` with static factory `from()` and instance methods
- Primary methods: `estimate()`, `maturity()`, `request()`, `collect()`, `getL1State()`
- Dependencies: @ckb-ccc/core, @ickb/core, @ickb/dao, @ickb/order, @ickb/utils

**packages/utils/src/:**
- Purpose: Shared blockchain utilities and primitives
- Exports: SmartTransaction, CapacityManager, UdtHandler, CheckedInt32LE, codecs
- Key classes: `SmartTransaction` (transaction builder), `CapacityManager` (cell management)
- Key helpers: `collect()`, `unique()`, `binarySearch()`, `hexFrom()`, `getHeader()`
- Dependencies: @ckb-ccc/core

**apps/bot/src/:**
- Purpose: Automated order matching service
- Status: LEGACY (uses @ickb/v1-core, @ckb-lumos/*, deprecated)
- Entry: `main()` function with infinite loop
- Key operations: State query → order matching → transaction building → signing → broadcast
- Environment variables: CHAIN, RPC_URL, BOT_PRIVATE_KEY, BOT_SLEEP_INTERVAL

**apps/faucet/src/:**
- Purpose: Testnet CKB distribution from deposit cells
- Status: MIGRATED (uses new packages + CCC)
- Entry: `main.ts` with `main()` function and 2-minute poll loop
- Key operations: Discover faucet funds → build transfer transaction → sign and broadcast
- Environment variables: ADDRESS (recipient address)

**apps/sampler/src/:**
- Purpose: Blockchain state monitoring and exchange rate sampling
- Status: MIGRATED (uses new packages + CCC)
- Entry: Direct execution from `index.ts`
- Key operations: Periodic state snapshot collection, rate calculation
- Output: CSV format data via rate.csv

**apps/tester/src/:**
- Purpose: Order creation simulation and testing
- Status: LEGACY (uses @ickb/v1-core, @ckb-lumos/*, deprecated)
- Entry: `main()` function with test scenarios
- Key operations: Simulate user order creation, validate responses

**apps/interface/src/:**
- Purpose: Web UI for iCKB operations (React application)
- Status: LEGACY (uses @ickb/v1-core, @ckb-lumos/*, deprecated)
- Entry: `main.tsx` with `startApp(wallet_chain)` function
- Component tree: Connector → App → Form/Dashboard/Action
- Data flow: React Query for L1 state, SmartTransaction for TX building
- Styling: TailwindCSS with inline classes

**ccc-dev/:**
- Purpose: Local CCC clone for development against unpublished upstream changes
- System: Record/replay mechanism for deterministic builds
- `pins/`: Committed directory with manifest + counted resolutions + local patches (multi-file format)
- `ccc/`: Gitignored, ephemeral clone auto-generated by `replay.sh`
- Activation: `.pnpmfile.cjs` auto-triggers replay on `pnpm install` and redirects @ckb-ccc/* deps

**.planning/codebase/:**
- Purpose: GSD codebase analysis documents
- Contents: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md, STACK.md, INTEGRATIONS.md
- Usage: Read by GSD orchestrator for phase planning and code generation

## Key File Locations

**Entry Points:**
- SDK: `packages/sdk/src/sdk.ts` → `IckbSdk` class with static `from()` factory
- Faucet app: `apps/faucet/src/main.ts` → `main()` async function
- Bot app: `apps/bot/src/index.ts` → `main()` async function
- Interface app: `apps/interface/src/main.tsx` → `startApp(wallet_chain: string)` function
- Sampler app: `apps/sampler/src/index.ts` → Direct execution entry
- Tester app: `apps/tester/src/index.ts` → `main()` async function

**Configuration Files:**
- Monorepo: `pnpm-workspace.yaml` (workspace definition + catalog)
- Root scripts: `package.json` (build/test/lint/dev commands)
- TypeScript: `tsconfig.json` (ES2020 target, strict mode)
- Tests: `vitest.config.mts` (test discovery and coverage)
- Linting: `eslint.config.mjs` (ESLint rules)
- Formatting: `prettier.config.cjs` (code style)

**Core Domain Logic:**
- Deposits: `packages/core/src/logic.ts` → `LogicManager` class (269 lines)
- Orders: `packages/order/src/order.ts` → `OrderManager` class (988 lines)
- DAO: `packages/dao/src/dao.ts` → `DaoManager` class (412 lines)
- Transactions: `packages/utils/src/transaction.ts` → `SmartTransaction` class (517 lines)
- Capacity: `packages/utils/src/capacity.ts` → `CapacityManager` class (221 lines)

**Type Definitions:**
- Order entities: `packages/order/src/entities.ts` (Info, Ratio, OrderData) — 754 lines
- Core entities: `packages/core/src/entities.ts` (OwnerData, ReceiptData) — 113 lines
- Cell wrappers: `packages/{core,dao,order}/src/cells.ts` (DaoCell, IckbDepositCell, etc.)

## Naming Conventions

**Files:**
- Source: `*.ts` for TypeScript, `*.tsx` for React components
- Compiled: `dist/` directory (generated, gitignored)
- Type definitions: Auto-generated from source via `declaration: true`
- Tests: Not currently present; would use `*.test.ts` or `*.spec.ts` pattern

**Directories:**
- Packages: kebab-case (`core`, `dao`, `order`, `sdk`, `utils`)
- Apps: kebab-case (`bot`, `faucet`, `sampler`, `tester`, `interface`)
- Source: Always `src/` for both packages and apps
- Output: Always `dist/` after compilation

**Exports:**
- Barrel files: `index.ts` re-exports all public symbols
- Pattern: `export * from "./module.js"` (using `.js` extension for ESM)
- No default exports; all named exports
- Types and functions exported at package level via index

**Classes and Functions:**
- Classes: PascalCase (e.g., `IckbSdk`, `LogicManager`, `SmartTransaction`, `DaoManager`)
- Manager suffix: Consistently applied to manager classes
- Instance methods: camelCase (e.g., `deposit()`, `mint()`, `getL1State()`)
- Static methods: camelCase on class (e.g., `IckbSdk.from()`, `IckbSdk.estimate()`)
- Private methods: camelCase prefixed with underscore (e.g., `_getCkb()`)

**Interfaces and Types:**
- Interfaces: PascalCase (e.g., `DaoCell`, `OrderCell`, `ValueComponents`)
- Input-like types: Suffix with -Like (e.g., `InfoLike`, `OwnerDataLike`)
- Readonly types: No prefix; immutability expressed via readonly properties
- Type unions: PascalCase (e.g., `SystemState`, `OrderGroup`, `L1StateType`)

## Where to Add New Code

**New Blockchain Operation (e.g., new order type):**
- Domain package location: `packages/{appropriate-domain}/src/{feature}.ts`
  - Order-related: `packages/order/src/`
  - DAO-related: `packages/dao/src/`
  - iCKB-specific: `packages/core/src/`
- Manager method: Add to appropriate Manager class
- Type export: Add to barrel export in `packages/{package}/src/index.ts`
- SDK integration: If cross-domain, add to `IckbSdk` in `packages/sdk/src/sdk.ts`

**New React Component (e.g., new UI page):**
- Location: `apps/interface/src/{ComponentName}.tsx`
- Pattern: Functional component with React hooks
- Data fetching: Add query factory to `apps/interface/src/queries.ts`
- Styling: TailwindCSS classes inline; no separate CSS files
- State: Use React hooks + React Query for async state

**New CLI App (e.g., new service daemon):**
- Structure: Create `apps/{app-name}/` directory
- Template: Copy structure from existing app (faucet or sampler)
- Required files:
  - `package.json` with scripts and dependencies
  - `src/index.ts` as entry point (export main function if needed)
  - `src/main.ts` if index.ts re-exports
  - `env/{CHAIN}/.env` if environment-specific config needed
- Registration: Auto-detected by pnpm-workspace.yaml pattern matching

**New Utility Function:**
- Shared/generic: `packages/utils/src/{category}.ts`
- Domain-specific: Place in appropriate domain package `src/{category}.ts`
- Export: Add to barrel in `src/index.ts` with `export * from "./{category}.js"`
- Import pattern: Use `.js` extensions in ESM exports for compatibility

**New Manager Class:**
- Location: `packages/{domain}/src/{manager-name}.ts`
- Pattern: Implement `ScriptDeps` interface if handling scripts:
  ```typescript
  export class FeatureManager implements ScriptDeps {
    constructor(
      public readonly script: ccc.Script,
      public readonly cellDeps: ccc.CellDep[],
    ) {}
    // ... methods
  }
  ```
- Transaction methods: Accept `ccc.TransactionLike`, return `ccc.Transaction`, call `.addCellDeps()`, `.addInput()`, `.addOutput()`
- Finding methods: Use async generators for lazy cell discovery
- Type checkers: Implement `isFoo(cell)` methods for type verification

**Dependencies:**
- Internal package: `"@ickb/package": "workspace:*"` in package.json
- Internal CCC (local dev): Automatic via `.pnpmfile.cjs` override when `ccc-dev/ccc/` exists
- External package: `pnpm add @vendor/package` from workspace root
- Catalog versions: Reference via `"@vendor/package": "catalog:"` in pnpm-workspace.yaml

**reference/contracts/ (reference repo):**
- Purpose: Rust on-chain smart contracts for the iCKB protocol (3 production contracts + shared utils)
- Cloned via: `pnpm reference` (git-ignored, read-only reference)
- Key paths:
  - `scripts/contracts/ickb_logic/` - Type script: iCKB UDT minting, deposit/receipt validation, conservation law
  - `scripts/contracts/limit_order/` - Lock script: peer-to-peer limit order matching (mint/match/melt lifecycle)
  - `scripts/contracts/owned_owner/` - Lock script: owner-owned cell pairing for DAO withdrawal delegation
  - `scripts/contracts/utils/` - Shared: DAO helpers, C256 safe math, MetaPoint, cell type classification
  - `schemas/encoding.mol` - Molecule schema definitions (canonical data format that TS codecs must match)
  - `scripts/deployment/` - Network configs (devnet/testnet/mainnet)
- Build: Capsule v0.10.5, Rust 2021, `no_std` + alloc-only, RISC-V target
- Audit: Scalebit (2024-09-11)

**reference/whitepaper/ (reference repo):**
- Purpose: iCKB protocol design specification
- Cloned via: `pnpm reference` (git-ignored, read-only reference)
- Key files:
  - `README.md` (~49KB) - Complete protocol specification: deposit/withdrawal phases, exchange rate mechanics, soft cap penalty, pooled deposit model, ancillary scripts (owned owner, limit order), deployment details, attack mitigations
  - `2024_overview.md` - Project timeline and milestones
- Key concepts: 2-phase deposit/withdrawal, `iCKB = capacity * AR_0 / AR_m`, 100k iCKB soft cap with 10% excess penalty, non-upgradable deployment, NervosDAO illiquidity solution

## Special Directories

**ccc-dev/:**
- Purpose: Local development environment for CCC upstream PRs
- System: Record/replay mechanism for deterministic, conflict-free builds
- `pins/`: Committed directory with manifest + counted resolutions + local patches (multi-file format)
- `ccc/`: Generated from pins; auto-deleted and rebuilt on `pnpm install`
- Activation: `.pnpmfile.cjs` hook triggers `replay.sh` and overrides package resolution
- Commands:
  - Record: `pnpm ccc:record` (requires AI Coworker CLI)
  - Status: `pnpm ccc:status` (check for pending work in `ccc/`)
  - Save: `pnpm ccc:save` (capture local work as patch in pins/)
  - Push: `pnpm ccc:push` (cherry-pick commits onto a PR branch)
  - Rebuild: `pnpm install` (automatic)
  - Clean (re-replay): `pnpm ccc:clean && pnpm install` (guarded)
  - Reset (published): `pnpm ccc:reset && pnpm install` (guarded)

**node_modules/:**
- Purpose: Installed npm/pnpm dependencies
- Auto-generated: Yes (via `pnpm install`)
- Committed: No (in .gitignore)
- Management: pnpm handles with pnpm-lock.yaml

**dist/:**
- Purpose: Compiled TypeScript output
- Auto-generated: Yes (via `pnpm build`)
- Committed: No (in .gitignore)
- Structure: Mirrors src/ with `.js`, `.d.ts`, and `.map` files
- Cleanup: `pnpm clean` removes all dist/ directories

**.github/workflows/:**
- Purpose: GitHub Actions CI/CD pipelines
- Committed: Yes
- Workflows: Build, test, and publish on push/PR

**.planning/codebase/:**
- Purpose: GSD analysis documents for orchestrator reference
- Generated: Yes (by `gsd:map-codebase` command)
- Committed: Yes
- Usage: `gsd:plan-phase` loads relevant docs for code generation guidance

---

*Structure analysis: 2026-02-17*
