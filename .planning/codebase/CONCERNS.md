# Codebase Concerns

**Analysis Date:** 2026-02-17

## Tech Debt

### Apps Depend on Deprecated Legacy Libraries (Critical)

- Issue: Three apps (`bot`, `tester`, `interface`) depend on `@ickb/lumos-utils@1.4.2` and `@ickb/v1-core@1.4.2`, which are the legacy deprecated versions that this monorepo's `packages/` are designed to replace.
- Files:
  - `apps/bot/package.json` - depends on `@ickb/lumos-utils@^1.4.2`, `@ickb/v1-core@^1.4.2`
  - `apps/tester/package.json` - depends on `@ickb/lumos-utils@^1.4.2`, `@ickb/v1-core@^1.4.2`
  - `apps/interface/package.json` - depends on `@ickb/lumos-utils@^1.4.2`, `@ickb/v1-core@^1.4.2`
  - `apps/bot/src/index.ts` - heavy usage of legacy APIs throughout (~900 lines)
  - `apps/tester/src/index.ts` - heavy usage of legacy APIs throughout (~470 lines)
  - `apps/interface/src/transaction.ts` - uses `TransactionSkeleton` from Lumos
  - `apps/interface/src/queries.ts` - uses `I8Header`, `I8Cell`, `I8Script` from legacy
  - `apps/interface/src/utils.ts` - uses `epochSinceAdd`, `parseEpoch` from Lumos, `ickbExchangeRatio` from v1-core
- Impact: The new `packages/` libraries (`@ickb/utils`, `@ickb/core`, `@ickb/dao`, `@ickb/order`, `@ickb/sdk`) cannot be validated in production until these apps are migrated. Any features added to the new libraries need parallel implementation in the old ones for the apps to use them.
- Fix approach: Migrate apps one at a time to use the new `packages/` libraries. The `faucet` app has already been migrated (uses `@ickb/utils` and CCC). The `sampler` app also uses the new packages. Start with `tester` (simplest remaining), then `bot`, then `interface` (most complex, React-based).

### All `@ckb-lumos/*` Usage is Deprecated (Critical)

- Issue: Lumos is being replaced by CCC (`ckb-ccc`) ecosystem-wide. The three legacy apps still import extensively from `@ckb-lumos/helpers`, `@ckb-lumos/base`, `@ckb-lumos/hd`, and `@ckb-lumos/common-scripts`.
- Files:
  - `apps/bot/src/index.ts` - imports from `@ckb-lumos/helpers`, `@ckb-lumos/common-scripts`, `@ckb-lumos/hd`, `@ckb-lumos/base`
  - `apps/tester/src/index.ts` - same Lumos imports
  - `apps/interface/src/transaction.ts` - `TransactionSkeletonType` from `@ckb-lumos/helpers`
  - `apps/interface/src/queries.ts` - `Cell`, `Header` from `@ckb-lumos/base`
  - `apps/interface/src/utils.ts` - `parseEpoch`, `EpochSinceValue` from `@ckb-lumos/base/lib/since`
- Impact: Lumos is deprecated upstream and will eventually stop receiving updates. Security patches and CKB protocol changes will only be reflected in CCC.
- Fix approach: This is resolved by the app migration above. The new `packages/` libraries already use CCC exclusively via `@ckb-ccc/core`.

### ~~Local Epoch Class Partially Duplicates CCC Upstream~~ (RESOLVED)

- **Resolved in:** commit ae8b5af (`refactor: replace ickb Epoch with ccc.Epoch`)
- Local `packages/utils/src/epoch.ts` (244 lines) was deleted. All packages now use `ccc.Epoch` directly.

### Local UDT Handling May Overlap CCC Upstream (Medium)

- Issue: CCC now has a dedicated `@ckb-ccc/udt` package (at `ccc-dev/ccc/packages/udt/`). The local `packages/utils/src/udt.ts` and `packages/core/src/udt.ts` implement custom UDT handling (`UdtHandler` interface, `IckbUdtManager` class). While the local UDT handling is iCKB-specific (custom balance calculation accounting for DAO deposits), the generic UDT operations like `ccc.udtBalanceFrom()` are still being used from CCC upstream in `packages/utils/src/udt.ts` (4 locations).
- Files:
  - `packages/utils/src/udt.ts` - `UdtHandler` interface, `UdtManager` class (~370 lines)
  - `packages/core/src/udt.ts` - `IckbUdtManager` extending UDT handling for iCKB-specific logic
  - `ccc-dev/ccc/packages/udt/src/` - CCC upstream UDT package
  - Usage of `ccc.udtBalanceFrom()`: `packages/utils/src/udt.ts` lines 169, 197, 323, 368
- Impact: There may be duplicated utility code for standard UDT operations (finding cells, calculating balances). The iCKB-specific extensions (e.g., `IckbUdtManager` which modifies balance calculations based on DAO deposit/withdrawal state) are domain-specific and unlikely to be in CCC.
- Fix approach: Audit the CCC `@ckb-ccc/udt` package to identify which local utilities can be replaced. Keep iCKB-specific extensions but delegate standard UDT operations (cell finding, basic balance) to CCC where possible.

### Fragile CCC Local Override Mechanism (Medium)

- Issue: The `.pnpmfile.cjs` hook and `ccc-dev/record.sh` script create a fragile mechanism for overriding published CCC packages with local builds. The `.pnpmfile.cjs` `readPackage` hook intercepts pnpm's dependency resolution to redirect `@ckb-ccc/*` packages to local paths under `ccc-dev/ccc/packages/*/`.
- Files:
  - `.pnpmfile.cjs` - pnpm hook that overrides `@ckb-ccc/*` package resolutions
  - `ccc-dev/record.sh` - clones CCC repo, merges refs, and builds it locally
  - `pnpm-workspace.yaml` - includes `ccc-dev/ccc/packages/*` in workspace
  - `ccc-dev/ccc/` - local CCC checkout (when present)
- Impact: Multiple fragility points:
  1. The local CCC repo at `ccc-dev/ccc/` must be manually cloned and kept in sync with a specific branch/commit.
  2. The `readPackage` hook modifies `dependencies` objects at install time, which can silently break if CCC reorganizes its packages.
  3. CI/CD (`ccc-dev/replay.sh`) must run this setup before `pnpm install`, creating an ordering dependency.
  4. The override mechanism is invisible to developers who don't read `.pnpmfile.cjs`, leading to confusion when packages resolve differently than expected from `package.json`.
- Fix approach: Now that UDT and Epoch PRs have been merged into CCC upstream, evaluate whether the local overrides are still needed. If CCC publishes releases containing the merged features, switch to published versions and remove the override mechanism.

## Known Bugs

### ~~Faucet `main()` Runs Diagnostic Code Instead of Faucet Logic~~ (RESOLVED)

- **Resolved:** Faucet was restructured. `apps/faucet/src/index.ts` now imports and calls `main()` from `apps/faucet/src/main.ts` which contains the actual faucet transfer logic (88 lines).

### ~~Self-Comparison Bug in Pool Snapshot Maturity Calculation~~ (INVALID)

- **Invalid:** The original analysis incorrectly stated the condition was `tipEpoch.compare(tipEpoch) < 0` (self-comparison). The actual code at `packages/sdk/src/sdk.ts` line 443 is `start.compare(tipEpoch) < 0`, which correctly checks whether the bin start epoch precedes the current tip epoch. No bug exists.

## Security Considerations

### Private Keys in Environment Variables

- Risk: Both `apps/bot/src/index.ts` and `apps/tester/src/index.ts` read private keys directly from environment variables (`BOT_PRIVATE_KEY`, `TESTER_PRIVATE_KEY`) and use them in-process for transaction signing via `@ckb-lumos/hd` `key.signRecoverable()`.
- Files:
  - `apps/bot/src/index.ts`, lines 67-68, 859-884 (key usage in `secp256k1Blake160` and `signer`)
  - `apps/tester/src/index.ts`, lines 51, 59-60, 420-467 (same pattern)
- Current mitigation: No `.env` files found committed to the repo. Keys are validated as non-empty before use.
- Recommendations: For production bot operations, consider using a dedicated key management solution or hardware signing. Document required environment variables without example values.

### Faucet Logs Ephemeral Private Key to Console

- Risk: `apps/faucet/src/main.ts` generates a temporary private key using `crypto.getRandomValues()` at line 26 and logs the key to console at line 27 (`console.log(key)`).
- Files: `apps/faucet/src/main.ts`, lines 26-27
- Current mitigation: The key is ephemeral and only used for testnet faucet transfers.
- Recommendations: Avoid logging private keys even in development/testnet contexts. Keep the key in memory only.

### Hardcoded Script Constants

- Risk: On-chain script code hashes, dep group outpoints, and known bot addresses are hardcoded in `packages/sdk/src/constants.ts`. If any on-chain script is upgraded or redeployed, these constants must be manually updated.
- Files: `packages/sdk/src/constants.ts`, lines 112-205 (DAO, UDT, ICKB_LOGIC, OWNED_OWNER, ORDER script hashes, dep groups, bot addresses)
- Current mitigation: Separate mainnet and testnet constants. The `getConfig()` function accepts devnet configuration as an alternative to hardcoded values.
- Recommendations: Consider loading constants from an on-chain registry or configuration file for easier updates.

## Performance Bottlenecks

### Sequential Header Fetching in DAO Cell Construction

- Problem: `daoCellFrom()` in `packages/dao/src/cells.ts` fetches headers sequentially using `await getHeader()`. For withdrawal requests, it makes 2 sequential RPC calls (deposit header by block number, then withdrawal request header by txHash). When processing multiple DAO cells in a loop (e.g., in `DaoManager.findDeposits()` or `OwnedOwnerManager.findWithdrawalGroups()`), these are sequential per cell.
- Files:
  - `packages/dao/src/cells.ts`, lines 87-116 (sequential header fetching)
  - `packages/dao/src/dao.ts`, lines 326-334 (called in async generator loop)
  - `packages/core/src/owned_owner.ts`, lines 229-234 (same pattern)
- Cause: Each `daoCellFrom()` call makes 1-2 RPC calls that cannot be parallelized within a single cell construction.
- Improvement path: The `SmartTransaction.headers` cache in `packages/utils/src/transaction.ts` partially mitigates this by caching fetched headers. For batch operations, consider prefetching all needed headers in parallel before constructing DAO cells.

### Duplicated RPC Batching Code in Legacy Apps

- Problem: `apps/bot/src/index.ts`, `apps/tester/src/index.ts`, and `apps/interface/src/queries.ts` each contain nearly identical implementations of `getTxsOutputs()`, `getHeadersByNumber()`, `getMixedCells()`, and `secp256k1Blake160()`, each with their own manual RPC batch management and in-memory caching.
- Files:
  - `apps/bot/src/index.ts`, lines 722-827 (getTxsOutputs, getHeadersByNumber, getMixedCells)
  - `apps/tester/src/index.ts`, lines 315-467 (same functions, plus secp256k1Blake160)
  - `apps/interface/src/queries.ts`, lines 270-376 (same functions)
- Cause: These are pre-migration legacy code patterns. The new `packages/` libraries use CCC's built-in client caching.
- Improvement path: Resolved by migrating apps to new packages, which handle caching through `ccc.Client` methods like `findCells()` and `findCellsOnChain()`.

### Unbounded In-Memory Caches in Bot

- Problem: Global mutable maps `_knownHeaders` and `_knownTxsOutputs` in `apps/bot/src/index.ts` accumulate indefinitely without eviction.
- Files: `apps/bot/src/index.ts`, lines 793 (`_knownTxsOutputs`), 827 (`_knownHeaders`)
- Cause: `Object.freeze()` on the map prevents modification but new maps are created and assigned on each fetch cycle, with old data carried over.
- Improvement path: Implement LRU cache with size limits or TTL-based expiration. Alternatively, this is resolved by migrating the bot to new packages which use CCC's client-side caching.

## Fragile Areas

### SmartTransaction Class Extending ccc.Transaction

- Files: `packages/utils/src/transaction.ts` (517 lines)
- Why fragile: `SmartTransaction` extends `ccc.Transaction` and overrides 8 methods: `completeFee`, `getInputsUdtBalance`, `getOutputsUdtBalance`, `getInputsCapacity`, `clone`, `copy`, `from`, `default`, and `fromLumosSkeleton`. Changes to `ccc.Transaction`'s interface or behavior upstream can silently break `SmartTransaction`.
- Safe modification: When updating CCC dependency, review `ccc.Transaction` changelog for breaking changes to overridden methods. The `completeFee` override (lines 63-98) is particularly fragile as it calls `super.completeFee()` and also queries the client for the NervosDAO script to check the 64-output limit.
- Test coverage: No tests for `SmartTransaction`.

### Bot Order Matching Algorithm

- Files: `apps/bot/src/index.ts`, lines 272-399 (`bestPartialFilling`, `partialsFrom`)
- Why fragile: Complex recursive algorithm with memoization (`alreadyVisited` map) that depends on consistent `evaluate` function behavior. Random shuffling at lines 351-356 (`Math.random() > 0.9` triggers shuffle) makes output non-deterministic. The matching explores a 2D grid of CKB-to-UDT and UDT-to-CKB partial fills.
- Safe modification: Add comprehensive logging of decision path. Test with deterministic random seed. Add invariant checks that total gain is non-negative.
- Test coverage: No unit tests for matching algorithm.

### Hardcoded Script Constants in SDK

- Files: `packages/sdk/src/constants.ts`, lines 112-205
- Why fragile: Script code hashes, dep group outpoints, and known bot addresses are hardcoded. If any on-chain script is upgraded or redeployed, these constants silently produce wrong results (transactions would fail on-chain but the SDK would not throw beforehand).
- Safe modification: Only change constants after verifying the new values on-chain. Test against both testnet and mainnet.
- Test coverage: No tests verify these constants match on-chain state.

## Scaling Limits

### 64 Output Cell Limit for NervosDAO Transactions

- Current capacity: Maximum 64 output cells per transaction containing NervosDAO operations.
- Limit: Enforced by the NervosDAO script itself. Checked in 6 locations throughout the codebase.
- Files:
  - `packages/dao/src/dao.ts`, lines 99-103, 174-177, 244-248
  - `packages/core/src/owned_owner.ts`, lines 102-106, 144-148
  - `packages/utils/src/transaction.ts`, lines 85-95
  - `apps/bot/src/index.ts`, line 414 (limits to 58 outputs to reserve 6 for change)
- Scaling path: Protocol-level constraint. The bot works around it by limiting deposit/withdrawal operations per transaction. Future NervosDAO script updates may relax this.

## Dependencies at Risk

### `@ickb/lumos-utils@1.4.2` and `@ickb/v1-core@1.4.2`

- Risk: Legacy deprecated packages that this monorepo is replacing. They depend on the deprecated `@ckb-lumos/*` ecosystem. No further updates are expected.
- Impact: Three apps (`bot`, `tester`, `interface`) depend on these. Cannot receive bug fixes or new features.
- Migration plan: Migrate apps to use the new `packages/` libraries (`@ickb/utils`, `@ickb/core`, `@ickb/dao`, `@ickb/order`, `@ickb/sdk`).

### `@ckb-lumos/*` Packages (All Deprecated)

- Risk: The entire Lumos framework is deprecated in favor of CCC. These packages may stop receiving security updates.
- Impact: Used by `@ickb/lumos-utils` and directly in legacy apps.
- Migration plan: Already addressed by new packages using CCC. Remove Lumos dependencies when apps are migrated.

### React Compiler Plugins Unpinned

- Risk: `babel-plugin-react-compiler` and `eslint-plugin-react-compiler` in `apps/interface/package.json` are using `latest` tag without version pinning (lines 29, 31).
- Impact: Unpredictable behavior changes when new versions are released; no reproducible builds.
- Migration plan: Pin to specific versions once the React compiler stabilizes.

## Missing Critical Features

### No Automated Tests

- Problem: Zero test files exist in the project source code (all `*.test.*` and `*.spec.*` files are in `node_modules/`). The CI pipeline (`.github/workflows/check.yaml`) runs `pnpm check` which includes `pnpm test:ci`, but with no test files, `vitest run` passes vacuously.
- Blocks: Confident refactoring, library migration, and CCC upstream updates. Any code change is a regression risk.
- Files: `.github/workflows/check.yaml`

### No Published Package Versions

- Problem: All packages in `packages/` have version `1001.0.0` (Epoch Semantic Versioning placeholder) in their `package.json` files. None have been published to npm yet.
- Blocks: External consumers cannot depend on the new libraries. External projects still must use the deprecated `@ickb/lumos-utils@1.4.2` and `@ickb/v1-core@1.4.2`.
- Files:
  - `packages/utils/package.json` - version `1001.0.0`
  - `packages/core/package.json` - version `1001.0.0`
  - `packages/dao/package.json` - version `1001.0.0`
  - `packages/order/package.json` - version `1001.0.0`
  - `packages/sdk/package.json` - version `1001.0.0`

## Test Coverage Gaps

### Entire Codebase is Untested

- What's not tested: Every package and every app. Zero test files in the project.
- Files: All files under `packages/` and `apps/`
- Risk: The financial logic in `packages/sdk/src/sdk.ts` (order matching, maturity estimation, CKB/UDT conversion), `packages/order/src/order.ts` (order matching algorithm with complex bigint arithmetic), and `packages/dao/src/cells.ts` (DAO interest calculation, maturity computation) handle real cryptocurrency operations. Bugs in these areas could lead to financial loss.
- Priority: High. At minimum, the following should have unit tests:
  1. `packages/utils/src/utils.ts` - `binarySearch`, `asyncBinarySearch`, `gcd`, `min`, `max`, `sum`, `hexFrom`, `isHex`, `shuffle`
  2. `packages/utils/src/codec.ts` - `CheckedInt32LE` encode/decode
  3. `packages/order/src/entities.ts` - `Ratio.applyFee()`, `Ratio.convert()`, `Info.validate()`
  4. `packages/order/src/order.ts` - `OrderMatcher.match()`, `OrderMatcher.nonDecreasing()`, `OrderManager.bestMatch()`
  5. `packages/sdk/src/codec.ts` - `PoolSnapshot` encode/decode roundtrip
  6. `packages/dao/src/cells.ts` - `daoCellFrom()` maturity/interest calculations
  7. `packages/core/src/logic.ts` - iCKB exchange ratio and conversion logic

### TS Exchange Rate Must Match Rust Contract Logic

- What's not tested: The TypeScript exchange rate calculation (`packages/core/src/udt.ts`) must produce identical results to the Rust contract's `deposit_to_ickb()` function (`reference/contracts/scripts/contracts/ickb_logic/src/entry.rs`). Any discrepancy would cause transactions to be rejected on-chain.
- Key formula: `iCKB = capacity * AR_0 / AR_m` with soft cap penalty `amount - (amount - 100000) / 10` when `amount > ICKB_SOFT_CAP_PER_DEPOSIT`
- Contract constants that TS must match:
  - `CKB_MINIMUM_UNOCCUPIED_CAPACITY_PER_DEPOSIT = 1,000 * 100_000_000` (1,000 CKB)
  - `CKB_MAXIMUM_UNOCCUPIED_CAPACITY_PER_DEPOSIT = 1,000,000 * 100_000_000` (1,000,000 CKB)
  - `ICKB_SOFT_CAP_PER_DEPOSIT = 100,000 * 100_000_000` (100,000 iCKB)
  - `GENESIS_ACCUMULATED_RATE = 10_000_000_000_000_000` (10^16)
- Reference: `reference/contracts/scripts/contracts/ickb_logic/src/entry.rs` function `deposit_to_ickb()`
- Fix approach: Add cross-validation tests with known inputs/outputs derived from the Rust contract logic

### TS Molecule Codecs Must Match Contract Schemas

- What's not tested: The TypeScript Molecule codec definitions (`@ccc.codec` decorators in `packages/order/src/entities.ts`, `packages/core/src/entities.ts`) must produce byte-identical encodings to the Molecule schema at `reference/contracts/schemas/encoding.mol`. Field order, sizes, and endianness must match exactly.
- Key schemas:
  - `ReceiptData { deposit_quantity: Uint32, deposit_amount: Uint64 }` = 12 bytes
  - `OwnedOwnerData { owned_distance: Int32 }` = 4 bytes
  - `Ratio { ckb_multiplier: Uint64, udt_multiplier: Uint64 }` = 16 bytes
  - `OrderInfo { ckb_to_udt: Ratio, udt_to_ckb: Ratio, ckb_min_match_log: Uint8 }` = 33 bytes
  - Order cell data: `[UDT amount (16)] [Action (4)] [TX hash/padding (32)] [Index/distance (4)] [OrderInfo (33)] = 89 bytes`
- Fix approach: Add codec roundtrip tests using known byte vectors from the Rust contract tests or manually constructed from the Molecule schema

## Dead Code

### `fromLumosSkeleton` in SmartTransaction

- Issue: `SmartTransaction.fromLumosSkeleton()` at `packages/utils/src/transaction.ts` line 432 provides Lumos interoperability. Since the new packages do not use Lumos, this method is only needed if external code passes Lumos skeletons to the new packages.
- Files: `packages/utils/src/transaction.ts`, lines 432-436
- Impact: Low. The method is a thin wrapper delegating to the superclass.
- Fix approach: Remove after all apps are migrated away from Lumos.

### SmartTransaction Name is Misleading (Not Dead)

- Issue: Despite the original "SmartTransaction" concept being abandoned ecosystem-wide, the `SmartTransaction` class in `packages/utils/src/transaction.ts` is actively used throughout the new packages. It extends `ccc.Transaction` with UDT handler management and header caching (which is what replaced the abandoned SmartTransaction headers concept). The name is a vestige but the code is alive and critical.
- Files: `packages/utils/src/transaction.ts` - definition (517 lines). Used in: `packages/sdk/src/sdk.ts`, `packages/order/src/order.ts`, `packages/dao/src/dao.ts`, `packages/core/src/owned_owner.ts`, `packages/core/src/logic.ts`, `apps/faucet/src/main.ts`
- Impact: The name `SmartTransaction` may confuse developers familiar with the abandoned ecosystem concept.
- Fix approach: Consider renaming to `IckbTransaction` or `EnhancedTransaction`. Low priority since the class is internal to the monorepo.

---

*Concerns audit: 2026-02-17*
