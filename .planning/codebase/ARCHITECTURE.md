# Architecture

**Analysis Date:** 2026-02-17

## Pattern Overview

**Overall:** Layered monorepo with blockchain-centric manager composition pattern

**Key Characteristics:**
- Modular library packages (`packages/`) composed into high-level SDK
- Manager-based pattern encapsulating script operations with uniform `ScriptDeps` interface
- Async-first cell discovery via generator functions with lazy evaluation
- TypeScript ESM modules with strict null checks and type safety
- CCC-native transaction building with TransactionLike pattern (SmartTransaction deleted in Phase 1)
- Cell wrapper abstractions extending raw blockchain data with domain logic

**Migration Status:**
- `packages/` contain the NEW replacement libraries built on CCC
- `@ickb/lumos-utils@1.4.2` and `@ickb/v1-core@1.4.2` are LEGACY & DEPRECATED (this monorepo builds their replacements)
- All `@ckb-lumos/*` packages are DEPRECATED (CCC is the replacement)
- Apps split: `faucet` and `sampler` already use new packages; `bot`, `tester`, `interface` still on legacy Lumos
- CCC PRs for UDT and Epoch support have been MERGED upstream -- local Epoch class has been deleted (replaced by `ccc.Epoch`); some local UDT handling may still overlap with CCC's `@ckb-ccc/udt`
- Custom `mol.union` codec and deprecated `mol.*` APIs have been replaced with CCC's `mol.union`, `ccc.Entity.Base`, and `@ccc.codec` decorator
- SmartTransaction was DELETED in Phase 1; all managers now accept `ccc.TransactionLike` and return `ccc.Transaction` directly; headers cached by CCC Client Cache

## Protocol Design (from whitepaper)

The iCKB protocol solves NervosDAO illiquidity by pooling DAO deposits and issuing a liquid iCKB token. Key design principles:

**Core Concept:** CKB deposited into NervosDAO is locked for ~30 days (180 epochs). iCKB tokenizes these deposits so users can trade the locked value immediately while still accruing DAO interest.

**Exchange Rate:** `iCKB_value = unoccupied_capacity * AR_0 / AR_m` where `AR_0 = 10^16` (genesis accumulated rate) and `AR_m` is the accumulated rate at the deposit block. CKB is inflationary; iCKB is not -- 1 iCKB represents an ever-increasing amount of CKB over time.

**Deposit (2-Step):**
1. Step 1: User deposits CKB into NervosDAO -> receives a Receipt cell (cannot calculate iCKB value yet because the block's accumulated rate isn't available during validation).
2. Step 2: Receipt cell is converted to iCKB xUDT tokens using the now-available accumulated rate from the deposit block header.

**Withdrawal (2-Step):**
1. Step 1: User burns iCKB tokens -> creates a NervosDAO withdrawal request (using any mature deposit from the pool, not necessarily the user's original deposit).
2. Step 2: Standard NervosDAO withdrawal after 180-epoch maturity.

**Soft Cap Penalty:** Deposits exceeding 100,000 iCKB-equivalent incur a 10% discount on the excess amount. This incentivizes standard-size deposits (~100k CKB) and prevents DoS via fragmentation. Formula: `final = amount - (amount - 100000) / 10` when `amount > 100000`.

**Pooled Deposits:** Unlike dCKB (predecessor), deposits are protocol-owned, not user-specific. Any mature deposit can satisfy any withdrawal request. This eliminates the "original depositor only" restriction.

**Non-Upgradable:** All scripts are deployed with zero-args locks (unlockable), making the protocol immutable and trustless. No governance, no oracles, no admin keys.

## On-Chain Contracts (Rust)

Three production smart contracts (in `forks/contracts/` reference repo) implement the protocol on CKB L1. Each TS package in `packages/` corresponds to contract logic:

| Contract | Script Type | TS Package | Purpose |
|---|---|---|---|
| `ickb_logic` | Type script | `@ickb/core` (LogicManager) | Controls iCKB minting/burning, validates deposits and receipts, enforces conservation law |
| `limit_order` | Lock script | `@ickb/order` (OrderManager) | Enables peer-to-peer limit order matching for CKB/UDT trading |
| `owned_owner` | Lock script | `@ickb/core` (OwnedOwnerManager) | Manages owner-owned cell pairing for DAO withdrawal delegation |
| (shared `utils`) | Library | `@ickb/utils`, `@ickb/dao` | DAO helpers, safe math (C256), MetaPoint, cell type classification |

**Key Contract Invariant (ickb_logic):**
```
Input UDT + Input Receipts = Output UDT + Input Deposits
```
Receipts convert to UDT; deposits stay as deposits or convert to UDT. No iCKB can be created or destroyed outside this conservation law.

**Limit Order Lifecycle:** Mint (create order + master cell) -> Match (partial/full fill preserving value) -> Melt (destroy fulfilled order). Value conservation: `in_ckb * ckb_mul + in_udt * udt_mul <= out_ckb * ckb_mul + out_udt * udt_mul`.

**Owned Owner Pairing:** 1:1 relationship between "owned" cells (DAO withdrawal requests) and "owner" cells (authorization). Connected via relative `owned_distance: i32` offset. Solves NervosDAO's constraint that deposit lock and withdrawal lock must have equal size.

## Layers

**Foundation: CCC Framework**
- Purpose: Provide blockchain primitives and client interface
- Location: `@ckb-ccc/core` (npm or local `forks/ccc/`)
- Contains: CKB RPC clients, transaction builders, signers, Molecule codec, UDT support, Epoch handling
- Used by: All packages and applications
- Note: CCC now includes UDT and Epoch features contributed by this project's maintainer

**Utilities Layer (`packages/utils/src/`)**
- Purpose: Reusable blockchain primitives and UDT handlers
- Key exports: `UdtManager`, `UdtHandler`, codec/heap utilities
- Key files:
  - `udt.ts` (407 lines): UDT token value calculations and handlers
  - `utils.ts` (292 lines): General utilities (binary search, collectors, helpers)
  - `codec.ts` (21 lines): CheckedInt32LE codec
  - `heap.ts` (175 lines): MinHeap implementation
- Depends on: `@ckb-ccc/core`
- Used by: All domain packages
- Note: `SmartTransaction`, `CapacityManager`, `transaction.ts`, `capacity.ts` were deleted in Phase 1

**Domain Layer - DAO (`packages/dao/src/`)**
- Purpose: Abstract Nervos DAO operations (deposit, withdraw, requestWithdrawal)
- Key abstractions:
  - `DaoManager`: Implements ScriptDeps, manages deposit/withdrawal transactions
  - `DaoCell`: Wraps blockchain cell with maturity and interest calculations
  - Methods: `isDeposit()`, `isWithdrawalRequest()`, async generators `findDeposits()` and `findWithdrawalRequests()`
- Key files:
  - `dao.ts` (412 lines): DaoManager implementation
  - `cells.ts` (180 lines): DaoCell construction and type checking
- Depends on: Utilities layer
- Used by: Core and applications

**Domain Layer - Order (`packages/order/src/`)**
- Purpose: Limit order cell management and matching logic
- Key abstractions:
  - `OrderManager`: Implements ScriptDeps, mint/satisfy/melt operations
  - `OrderCell`, `MasterCell`, `OrderGroup`: Order representation and grouping
  - `Info`, `Ratio`: Order metadata and exchange ratio types
  - Conversion logic with fee calculations (default 0.001% fee)
- Key files:
  - `order.ts` (988 lines): OrderManager with convert/mint/satisfy/melt/find methods
  - `entities.ts` (754 lines): Info/Ratio/OrderData types and comparisons
  - `cells.ts` (396 lines): Cell wrappers for orders, groups, masters
- Depends on: Utilities layer
- Used by: Core and SDK

**Domain Layer - Core iCKB Logic (`packages/core/src/`)**
- Purpose: iCKB protocol-specific operations (deposits, receipts, ownership)
- Key abstractions:
  - `LogicManager`: Deposit/receipt management (implements ScriptDeps)
  - `OwnedOwnerManager`: Ownership and withdrawal group management (implements ScriptDeps)
  - `IckbDepositCell`: DAO cell marked as iCKB deposit
  - `ReceiptCell`, `WithdrawalGroup`, `OwnerCell`: Domain-specific cell types
- Key files:
  - `logic.ts` (269 lines): LogicManager for deposits and receipts
  - `owned_owner.ts` (239 lines): OwnedOwnerManager for withdrawal operations
  - `cells.ts` (175 lines): Cell wrappers and type constructors
  - `udt.ts` (213 lines): iCKB UDT calculations
- Depends on: DAO + Utilities layers
- Used by: SDK

**SDK Composition Layer (`packages/sdk/src/`)**
- Purpose: High-level interface composing all domain managers
- Key abstractions:
  - `IckbSdk`: Factory and orchestrator class
  - `SystemState`: Immutable snapshot of blockchain state (fee rate, tip, exchange ratio, orders, available/maturing CKB)
  - `CkbCumulative`: Maturing CKB entries with cumulative amounts
- Key methods:
  - Static `estimate()`: Conversion preview with optional fee
  - Static `maturity()`: Estimated order fulfillment timestamp
  - Instance `request()`: Create order cell
  - Instance `collect()`: Cancel order groups
  - Instance `getL1State()`: Fetch complete system state
  - Instance `getCkb()` (private): Maturing CKB calculation from deposits and bot withdrawals
- Key files:
  - `sdk.ts` (512 lines): IckbSdk implementation
  - `constants.ts` (205 lines): Script configurations
  - `codec.ts` (138 lines): Pool snapshot encoding/decoding
- Depends on: All domain + utils layers
- Used by: Applications

**Application Layer (`apps/*/src/`)**
- Purpose: Domain-specific operational services

  **Faucet (Migrated to CCC + New Packages):**
  - Location: `apps/faucet/src/main.ts` (88 lines), entry via `apps/faucet/src/index.ts`
  - Entry: `main()` async function
  - Pattern: Infinite loop with 2-minute poll interval
  - Uses: CCC client, ccc.Transaction
  - Flow: Discover faucet funds → transfer to user account → log JSON results

  **Sampler (Migrated to CCC):**
  - Location: `apps/sampler/src/index.ts` (192 lines)
  - Entry: Direct execution
  - Pattern: Periodic blockchain observation
  - Uses: CCC primitives

  **Bot (Legacy - Lumos):**
  - Location: `apps/bot/src/index.ts` (897 lines)
  - Entry: `main()` async function
  - Pattern: Infinite loop with configurable sleep interval
  - Uses: `@ickb/v1-core`, `@ckb-lumos/*`, TransactionSkeleton
  - Flow: Query orders → match at midpoint → build transaction → sign/broadcast
  - Note: Status quo legacy implementation; NOT yet migrated

  **Interface (Legacy - Lumos + React):**
  - Location: `apps/interface/src/` (total 1,158 lines)
  - Entry: `startApp(wallet_chain)` in `main.tsx` (68 lines)
  - Pattern: React component hierarchy with React Query state management
  - Uses: `@ickb/v1-core`, `@ckb-lumos/*`, React, TanStack Query
  - Component tree:
    - `Connector.tsx` (104 lines): Wallet connection setup
    - `App.tsx` (93 lines): Main state/conversion logic
    - `Form.tsx` (144 lines): Input form
    - `Action.tsx` (174 lines): Transaction execution
    - `Dashboard.tsx` (36 lines): Balance display
    - `Progress.tsx` (42 lines): Loading indicator
  - Queries/Utils: `queries.ts` (395 lines), `transaction.ts` (291 lines), `utils.ts` (160 lines)
  - Note: Status quo legacy implementation; NOT yet migrated

  **Tester (Legacy - Lumos):**
  - Location: `apps/tester/src/index.ts` (469 lines)
  - Entry: `main()` async function
  - Pattern: Simulation of order creation scenarios
  - Uses: `@ickb/v1-core`, `@ckb-lumos/*`

## Data Flow

**Order Creation and Matching (Primary Flow):**

1. User calls `IckbSdk.request(tx, user, info, amounts)` via app
2. `OrderManager.mint()` creates order cell with `Info` metadata (ratio, direction, fee info)
3. Transaction adds cell deps, outputs via `tx.addCellDeps()` / `tx.addOutput()`
4. User signs and broadcasts transaction

**Order Discovery and Matching (Bot Flow):**

1. Bot calls `IckbSdk.getL1State(client, locks)`
2. Parallel fetch: tip header, fee rate, order cells, bot capacities
3. Calculate exchange ratio from tip: `Ratio.from(ickbExchangeRatio(tip))`
4. Fetch deposits and withdrawal requests to calculate maturing CKB
5. Filter orders: separate user orders from system-matchable orders (ratio within 0.1% of midpoint)
6. Estimate maturity for each user order based on pool liquidity
7. Returns `SystemState { feeRate, tip, exchangeRatio, orderPool, ckbAvailable, ckbMaturing }`
8. Bot identifies orders where CKB/UDT supply exists for matching
9. Calls `OrderManager.satisfy()` to process matched orders
10. Builds transaction with satisfied order cells and input/output witnesses
11. Completes fees via `tx.completeFeeChangeToLock()`
12. Signs and broadcasts

**Maturity Estimation (Supporting Calculation):**

1. `IckbSdk.maturity(order, system)` computes estimated fulfillment timestamp
2. For dual-ratio orders: returns undefined (no fixed maturity)
3. For single-direction orders:
   - Scans order pool to calculate available opposite liquidity
   - Applies exchange ratio conversion to matching depth
   - If sufficient liquidity exists: maturity = 10 minutes + (amount / capacity scaling factor)
   - If insufficient: finds earliest bin in `ckbMaturing` cumulative array that covers shortfall
4. Returns Unix timestamp (milliseconds) or undefined

**Conversion Preview (UI Flow):**

1. User calls `IckbSdk.estimate(isCkb2Udt, amounts, system, options?)`
2. Applies 0.001% default fee (or custom fee/feeBase)
3. Calls `OrderManager.convert()` with adjusted ratio
4. Returns `{ convertedAmount, ckbFee, info, maturity? }`
5. UI displays converted amount and estimated maturity if applicable

**Deposit Lifecycle:**

1. User calls `LogicManager.deposit()` to lock CKB in Nervos DAO
2. Receipt cell minted containing deposit metadata
3. Bot fetches deposits via `LogicManager.findDeposits()`
4. After maturity, bot calls `LogicManager.withdraw()` to extract funds
5. Change cells added via CCC fee completion pipeline

**State Management:**

- L1 state: Immutable snapshots fetched per query with configurable refresh intervals
- Transaction state: Built incrementally via `ccc.Transaction` methods (`addInput`, `addOutput`, `addCellDeps`)
- UDT balances: Tracked via `UdtHandler` interface implementations
- Maturing CKB: Cumulative array sorted by maturity timestamp

## Key Abstractions

**ScriptDeps Interface (Contracts):**
- Implemented by: DaoManager, OrderManager, LogicManager, OwnedOwnerManager
- Contract: `{ script: ccc.Script; cellDeps: ccc.CellDep[] }`
- Purpose: Uniform interface for adding script dependencies to transactions
- Pattern: Enables composability and type-safe manager stacking

**Manager Classes (Pattern):**
- Purpose: Encapsulate entity-specific operations
- Pattern: Stateless managers with methods that accept `ccc.TransactionLike` and return `ccc.Transaction`
- Examples:
  - `DaoManager.deposit(tx, capacities, lock)`: Add DAO deposit cells
  - `OrderManager.mint(tx, user, info, amounts)`: Create order cell
  - `LogicManager.deposit(tx, user, info, amounts)`: Create iCKB deposit with receipt
- Type checkers: `isDeposit()`, `isOrder()`, `isMaster()` methods for cell filtering

**Cell Wrappers (Abstraction):**
- Purpose: Extend raw blockchain cells with domain calculations
- Pattern: Factory functions return wrapped interfaces with computed properties
- Examples:
  - `DaoCell`: Adds maturity, interests, isReady properties
  - `IckbDepositCell`: Extends DaoCell with [isIckbDepositSymbol] marker
  - `ReceiptCell`: Wraps receipt data with header reference
  - `WithdrawalGroup`: Pairs owned (withdrawal request) + owner cell with value aggregation
- Construction: Async factories via `daoCellFrom()`, `ickbDepositCellFrom()`, `receiptCellFrom()`

**Transaction Building (ccc.Transaction):**
- Purpose: All managers use plain `ccc.Transaction` (SmartTransaction was deleted in Phase 1)
- Pattern: Managers accept `ccc.TransactionLike` and return `ccc.Transaction` (TransactionLike pattern)
- Key operations: `tx.addCellDeps()`, `tx.addInput()`, `tx.addOutput()`, `tx.headerDeps.push()`
- Fee completion: CCC-native `completeFeeBy()` / `completeFeeChangeToLock()` with DAO-aware 64-output limit check (contributed to CCC core)
- Header caching: Transparently handled by CCC Client Cache (no explicit header map)

**Value Types (Domain Models):**
- `ValueComponents`: `{ ckbValue: ccc.FixedPoint; udtValue: ccc.FixedPoint }`
- `Info`: Order metadata with ratio bounds, direction, fee tier
- `Ratio`: Exchange rate as scaled numerator/denominator
- `OrderCell`: Extends ValueComponents with order-specific properties
- `OrderGroup`: Wrapper for order cells grouped by master cell
- `SystemState`: Immutable snapshot with fee rate, exchange ratio, order pool, available/maturing CKB

**Async Generator Pattern (Cell Finding):**
- Signature: `async *find*(client, locks, options?) : AsyncGenerator<T>`
- Examples: `DaoManager.findDeposits()`, `OrderManager.findOrders()`
- Usage: Lazy evaluation with batching via `defaultFindCellsLimit` (400 cells)
- Filtering: Applied after fetch via type checkers and lock script matching
- Collection: Wrapped via `collect()` helper to realize as array

## Entry Points

**CLI Entry Points:**

**Faucet:**
- Location: `apps/faucet/src/main.ts` - `main()` function
- Invocation: Run via `index.ts` or direct execution
- Environment: ADDRESS env variable (recipient CKB address)
- Behavior: Polls every 2 minutes for accumulated CKB, transfers to recipient account

**Sampler:**
- Location: `apps/sampler/src/index.ts`
- Invocation: Direct execution
- Behavior: Periodic blockchain observation and data sampling

**Bot:**
- Location: `apps/bot/src/index.ts` - `main()` function
- Invocation: CLI execution
- Environment: CHAIN, RPC_URL, BOT_PRIVATE_KEY, BOT_SLEEP_INTERVAL env variables
- Behavior: Infinite loop matching orders at configurable interval

**Web Application Entry:**

**Interface:**
- Location: `apps/interface/src/main.tsx` - `startApp(wallet_chain: string)` function
- Invocation: Called with parameter `"<walletName>_<chain>"` (e.g., `"JoyId_mainnet"`)
- Behavior: Initializes chain config, creates query client, renders React app
- Sets up: CCC client (ClientPublicTestnet or ClientPublicMainnet), JoyId wallet signers, React Query cache

**SDK Entry:**
- Location: `packages/sdk/src/sdk.ts` - `IckbSdk.from(...args)` static factory
- Invocation: Called by applications during setup
- Behavior: Instantiates all managers from script config, returns fully-composed SDK

## Error Handling

**Strategy:** Contract validation with descriptive errors; graceful degradation in apps

**Patterns:**
- **Validation**: Throw errors for invalid state (e.g., "Not a deposit", "Transaction have different inputs and outputs lengths")
- **Cell not found**: Throw in constructors (`receiptCellFrom()`), return empty generators in finders
- **Configuration**: Throw on missing or invalid environment variables with helpful messages
- **Transaction constraints**: Check limits (e.g., max 64 output cells in DAO transactions)
- **App-level**: Try-catch with JSON error logging including stack traces for monitoring

**Examples:**
- Bot/Faucet: Log execution JSON with error field containing full stack trace
- Interface: React Query retry logic with exponential backoff
- Managers: Pre-condition checks before transaction mutations (throw early)

## Cross-Cutting Concerns

**Logging:**
- Apps: Structured JSON logs with timestamps, success/error status, operation results
- Pattern: Log at operation boundaries (start, end) for monitoring
- Format: `{ startTime, balance?, txHash?, error?, elapsedSeconds }`

**Validation:**
- Script matching: `script.eq()` calls for type/lock verification
- Cell type checking: Manager predicates (isDeposit, isOrder, isMaster)
- Amount validation: Zero/minimum checks before operations

**Authentication:**
- Apps: Private key from environment variables (BOT_PRIVATE_KEY)
- Interface: JoyId wallet connector for signing
- Pattern: CCC signers abstract wallet implementation

**Capacity & Fee Management:**
- CCC-native: `tx.completeFeeBy()` / `tx.completeFeeChangeToLock()` with DAO-aware 64-output limit
- Pattern: Add-then-complete flow (add inputs/outputs, then complete fee via CCC pipeline)
- Note: `CapacityManager` was deleted in Phase 1; capacity discovery uses `client.findCellsOnChain()` directly

**UDT Handling:**
- `UdtHandler`: Interface encapsulating token script + cell deps
- `UdtManager`: Base implementation with `isUdt()`, `findUdts()`, `completeInputsByUdt()`
- Pattern: Managers hold `UdtHandler` reference; cell deps added via `tx.addCellDeps(udtHandler.cellDeps)`

---

*Architecture analysis: 2026-02-17*
