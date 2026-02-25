# Phase 1: SmartTransaction Removal (feature-slice) - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Delete SmartTransaction class and its infrastructure across all packages; contribute 64-output DAO limit check to CCC core; remove getHeader()/HeaderKey and inline CCC client calls; migrate all method signatures to ccc.TransactionLike. Using a **feature-slice approach**: each removal is chased across ALL packages so the build stays green at every step.

</domain>

<decisions>
## Implementation Decisions

### CCC DAO Contribution (via ccc-fork/)
- Build the 64-output NervosDAO limit check **in CCC core**, not in @ickb/utils
- Develop in `ccc-fork/ccc/`, record pins, use immediately via workspace override while waiting for upstream merge
- **Submit the upstream CCC PR during Phase 1 execution**
- CCC PR includes three components:
  1. **`completeFee()` safety net** — async check using `client.getKnownScript(KnownScript.NervosDao)` with full `Script.eq()` comparison
  2. **Standalone utility function** — `assertDaoOutputLimit(tx, client)` that auto-resolves unresolved inputs (populating `CellInput.cellOutput` as a side effect) and checks both inputs and outputs
  3. **`ErrorNervosDaoOutputLimit` error class** in `transactionErrors.ts` with metadata fields (count) and hardcoded limit of 64
- The check logic: if `outputs.length > 64` AND any input or output has DAO type script, throw error
- **PR description should mention** the possibility of adding the check to `addOutput()` as a future enhancement, inviting maintainer feedback
- All 6+ scattered DAO checks across dao/core/utils packages are replaced with calls to the new CCC utility **in Phase 1**

### getHeader() Removal
- **Remove `getHeader()` function and `HeaderKey` type entirely** from @ickb/utils
- Inline CCC client calls at each of the 8+ call sites across dao/core/sdk:
  - `txHash` lookups → `(await client.getTransactionWithHeader(hash))?.header` with null check/throw
  - `number` lookups → `await client.getHeaderByNumber(n)` with null check/throw
- SmartTransaction's redundant `Map<hexString, Header>` cache is deleted — CCC's built-in `ClientCacheMemory` LRU (128 blocks) handles caching
- **`addHeaders()` replacement needed** — `SmartTransaction.addHeaders()` is used by DaoManager (`requestWithdrawal`, `withdraw`) and LogicManager (`completeDeposit`) to push header hashes into `tx.headerDeps` with dedup. With SmartTransaction gone, these 3 call sites need to push to `tx.headerDeps` directly. Note: `SmartTransaction.getHeader()` (instance method) only validated that headers were already in headerDeps — it did not populate them. The standalone `getHeader()` function (being removed) never touched headerDeps at all.
- ROADMAP success criteria updated to reflect this — no standalone `getHeader()` utility will exist

### Feature-Slice Build Strategy
- **Build must pass after every removal step** — no intermediate broken states
- Execution order:
  1. CCC DAO utility (adds new code, nothing breaks)
  2. Replace all scattered DAO checks with CCC utility calls (all packages)
  3. Remove `getHeader()`/`HeaderKey` and inline CCC calls at all call sites (all packages)
  4. Remove SmartTransaction class and update all method signatures to `ccc.TransactionLike` (all packages)
  5. Remove CapacityManager and update SDK call sites (utils + sdk)
- Each step touches multiple packages but leaves `pnpm check:full` passing
- **Roadmap updated**: Phases 4-5 reduced in scope since method signatures are already updated to `ccc.TransactionLike` in Phase 1

### Method Signatures (CCC Pattern)
- Follow CCC's convention: public APIs accept `ccc.TransactionLike` (flexible input), return `ccc.Transaction` (concrete)
- Convert internally with `ccc.Transaction.from(txLike)` at method entry point
- Consistent with how CCC's own udt/spore/type-id packages work

### UdtHandler/UdtManager — Deferred
- UdtHandler interface and UdtManager class **stay in @ickb/utils** for Phase 1
- Their method signatures are updated from `SmartTransaction` to `ccc.TransactionLike` to keep the build green
- Full replacement deferred to Phase 3+ (depends on CCC Udt integration investigation)
- `addUdtHandlers()` call sites — Claude's discretion on replacement approach

### CapacityManager — Fully Removed
- CapacityManager is deleted from @ickb/utils
- Only consumer is `@ickb/sdk` (`findCapacities()` in sdk.ts, constructor in constants.ts)
- SDK call sites updated to use CCC's native cell finding

### Removal Approach
- **Clean delete** — no deprecation stubs, no migration comments, no breadcrumbs
- File deletions + barrel export removal in the **same commit** (atomic)
- Files deleted: `transaction.ts`, `capacity.ts` (from @ickb/utils)
- Files kept: `udt.ts` (signatures updated), `utils.ts` (getHeader/HeaderKey removed), `codec.ts`, `heap.ts`, `index.ts`
- `utils.ts` keeps its name — no rename needed

### Claude's Discretion
- `addUdtHandlers()` replacement strategy at call sites
- CapacityManager replacement approach in SDK (CCC native equivalent)
- Exact commit boundaries within each feature-slice step
- CCC PR code style and test approach (follow CCC's vitest patterns)

</decisions>

<specifics>
## Specific Ideas

- **Script comparison must use `eq()`** — never compare just `codeHash`. Always compare the full Script (codeHash + hashType + args) using CCC's `Script.eq()` method. This applies across the entire codebase, not just the DAO check. Downstream agents must follow this pattern for all script identification.
- NervosDao type script is invariant across mainnet, testnet, devnet — the code hash is a genesis constant. The CCC PR can reference this fact.
- CCC's existing `Cell.isNervosDao(client)` is async and uses client resolution — the new utility should be consistent with this pattern.
- The CCC PR should follow CCC's error class conventions: see `ErrorTransactionInsufficientCapacity` and `ErrorTransactionInsufficientCoin` in `transactionErrors.ts` for the pattern.

</specifics>

<deferred>
## Deferred Ideas

- **addOutput() DAO check** — Sync check in `Transaction.addOutput()` using hardcoded DAO script when outputs > 64. Deferred due to CCC maintainer acceptance concerns (hot path overhead, even though it only triggers past 64 outputs). Mentioned in CCC PR description as future possibility.
- **getHeader as CCC contribution** — A unified header lookup function (`client.getHeader(key)`) could be contributed to CCC itself, making iCKB's wrapper unnecessary. Low priority since the wrapper is being removed and calls inlined.

</deferred>

---

*Phase: 01-ickb-utils-smarttransaction-removal*
*Context gathered: 2026-02-22*
