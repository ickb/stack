# Architecture

**Analysis Date:** 2026-02-14

## Pattern Overview

**Overall:** Layered monorepo architecture with blockchain-first design

**Key Characteristics:**
- Monorepo structure with `packages/` (NEW CCC-based libraries) and `apps/` (applications)
- CCC (`@ckb-ccc/core`) as foundation for CKB blockchain interactions (replacing deprecated Lumos)
- Manager-based pattern for handling domain entities (DAO, Orders, Logic, Capacity)
- Local CCC dev build override via `scripts/setup-ccc.sh` + `.pnpmfile.cjs` (NOT a git submodule)
- Transaction-centric abstraction with SmartTransaction extending ccc.Transaction

**Migration Status:**
- `packages/` contain the NEW replacement libraries built on CCC
- `@ickb/lumos-utils@1.4.2` and `@ickb/v1-core@1.4.2` are LEGACY & DEPRECATED (this monorepo builds their replacements)
- All `@ckb-lumos/*` packages are DEPRECATED (CCC is the replacement)
- Apps split: `faucet` and `sampler` already use new packages; `bot`, `tester`, `interface` still on legacy Lumos
- CCC PRs for UDT and Epoch support have been MERGED upstream -- some local code may now overlap with CCC features
- SmartTransaction was ABANDONED as an ecosystem-wide concept (no adoption), but the class itself remains used locally; headers are now cached in CCC Client Cache

## Layers

**Core Blockchain Foundation (CCC):**
- Purpose: Abstract CKB protocol operations and provide type-safe wrappers
- Source: `@ckb-ccc/core` (npm) or local clone at `ccc/` (via `scripts/setup-ccc.sh`)
- Contains: CKB RPC clients, transaction builders, signer implementations, Molecule codec, UDT support, Epoch handling
- Depends on: CKB network services
- Used by: All new packages and migrated apps
- Note: CCC now includes UDT and Epoch features contributed by this project's maintainer

**Utility Layer:**
- Purpose: Provide reusable blockchain primitives and transaction helpers
- Location: `packages/utils/`
- Contains: SmartTransaction, CapacityManager, epoch handling, codec helpers, UDT handlers
- Depends on: @ckb-ccc/core
- Used by: All domain packages and applications

**Domain Packages:**
- Purpose: Implement specific protocol/business logic
- Location: `packages/{core,dao,order,sdk}`
- Core (`packages/core/`): iCKB core logic, deposit/receipt management via LogicManager
- DAO (`packages/dao/`): Nervos DAO interactions via DaoManager
- Order (`packages/order/`): Limit order cell management via OrderManager
- SDK (`packages/sdk/`): High-level IckbSdk composing all domain managers

**Application Layer:**
- Purpose: Run specific operational tasks
- Location: `apps/{bot,faucet,sampler,tester,interface}`
- Bot: Continuously matches and fulfills limit orders (**LEGACY** -- still on Lumos + @ickb/v1-core)
- Faucet: Distributes testnet CKB from deposit cells (**MIGRATED** -- uses new @ickb/utils + CCC)
- Sampler: Samples blockchain state and outputs exchange rate CSV (**MIGRATED** -- uses new @ickb/core + CCC)
- Tester: Simulates limit order creation scenarios (**LEGACY** -- still on Lumos + @ickb/v1-core)
- Interface: React web UI for user interactions (**LEGACY** -- still on Lumos + @ickb/v1-core)

## Data Flow

**Order Fulfillment Flow (Bot):**

1. Bot queries L1 state via IckbSdk.getL1State()
2. Retrieves all order cells, available/maturing CKB, exchange ratio
3. Filters matchable orders at midpoint ratio
4. Builds transaction using OrderManager.satisfy() for matched orders
5. Adds order inputs/outputs and witnesses
6. Completes transaction fee via SmartTransaction.completeFee()
7. Signs and broadcasts transaction

**User Conversion Flow (Interface):**

1. User selects conversion direction (CKB↔UDT) and amount
2. Interface fetches L1State (cached via react-query)
3. Estimates conversion using IckbSdk.estimate() with fee rate
4. Displays maturity estimate via IckbSdk.maturity()
5. If user requests, builds transaction via transaction builders
6. SmartTransaction completes fee and adds UDT/capacity changes
7. Signer signs transaction (JoyId connector)
8. Transaction submitted to CKB network

**Deposit Lifecycle:**

1. User calls LogicManager.deposit() to lock CKB in Nervos DAO
2. Receipt cell minted containing deposit metadata
3. Bot fetches deposits via LogicManager.findDeposits()
4. After maturity, bot calls LogicManager.withdraw() to extract funds
5. Change cells automatically added by SmartTransaction

**State Management:**

- L1 state: Immutable snapshots fetched per query with configurable refresh intervals
- Transaction state: Built incrementally via SmartTransaction.add* methods
- UDT balances: Tracked per UDT handler in SmartTransaction.udtHandlers map
- Maturing CKB: Cumulative array sorted by maturity timestamp

## Key Abstractions

**IckbSdk:**
- Purpose: Unified interface for all iCKB operations
- Examples: `packages/sdk/src/sdk.ts`
- Pattern: Factory pattern (static `from()` method) + composition of managers
- Exposes: estimate(), maturity(), request(), collect(), getL1State()

**Manager Classes:**
- Purpose: Encapsulate entity-specific logic and cell finding
- Examples: LogicManager, OrderManager, DaoManager, CapacityManager
- Pattern: Implements ScriptDeps interface where applicable
- Provide: Cell discovery, transaction mutations, entity serialization

**SmartTransaction:**
- Purpose: Extend CCC Transaction with automatic UDT/capacity balancing
- Location: `packages/utils/src/transaction.ts`
- Pattern: Inheritance from ccc.Transaction with additional state maps
- Manages: UDT handlers, block headers, fee completion
- Note: The "SmartTransaction" ecosystem concept was ABANDONED (no CKB ecosystem adoption). However, this class is still actively used throughout all new packages. The name is a vestige. Header caching has moved to CCC's Client Cache.

**Cell Finding Pattern:**
- Purpose: Lazy async iteration over blockchain cells matching criteria
- Pattern: Async generator functions (e.g., findCapacities, findOrders)
- Supports: Filtering, pagination, onChain snapshots
- Usage: Collected via `collect()` helper into arrays

## Entry Points

**IckbSdk Factory:**
- Location: `packages/sdk/src/sdk.ts` - `IckbSdk.from()`
- Triggers: Called by all applications to initialize SDK
- Responsibilities: Instantiates managers, loads script configs, prepares bot scripts

**Bot Main Loop:**
- Location: `apps/bot/src/index.ts` - `main()`
- Triggers: Scheduled execution (configurable interval from env)
- Responsibilities: Query state, match orders, build/sign/broadcast transactions

**Interface Startup:**
- Location: `apps/interface/src/main.tsx` - `startApp()`
- Triggers: Browser navigation to specific chain
- Responsibilities: Initialize chain config, setup query client, render React app

**Faucet Main Loop:**
- Location: `apps/faucet/src/index.ts` - `main0()`
- Triggers: Continuous loop with 2-minute intervals
- Responsibilities: Transfer accumulated CKB from temporary account to real account

## Error Handling

**Strategy:** Try-catch with execution logging and graceful degradation

**Patterns:**
- Bot/Faucet/Sampler: Log errors to stdout JSON format for monitoring
- Interface: React error boundaries + query retry logic with exponential backoff
- Validation: Throw errors with descriptive messages (e.g., "iCKB deposit minimum is 1082 CKB")
- Network errors: Query-level retry mechanism in react-query with refetchInterval

## Cross-Cutting Concerns

**Logging:**
- Bot/Faucet: JSON structured logs with timestamps and operation results
- Interface: Console.log for debugging, suppressed in production

**Validation:**
- Constructor validation (e.g., minimum amounts, non-empty env vars)
- Pre-transaction checks (deposit minimums, fee calculations)

**Authentication:**
- Bot/Faucet/Sampler: Environment variable secrets (BOT_PRIVATE_KEY, ADDRESS)
- Interface: JoyId wallet connector for transaction signing

---

*Architecture analysis: 2026-02-14*
