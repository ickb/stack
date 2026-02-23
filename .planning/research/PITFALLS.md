# Pitfalls Research

**Domain:** CKB/CCC library migration -- removing SmartTransaction, adopting CCC UDT, migrating apps from Lumos
**Researched:** 2026-02-21
**Confidence:** HIGH (derived from direct codebase analysis, CCC source inspection, and domain-specific contract constraints)

## Critical Pitfalls

### Pitfall 1: Removing SmartTransaction Before Extracting All Implicit Behaviors

**What goes wrong:**
SmartTransaction is not just a thin wrapper around `ccc.Transaction`. It carries three orthogonal responsibilities that are interleaved throughout 9 files (55 references): (1) UDT handler registration and dispatch, (2) header caching with multi-key lookup, and (3) DAO-aware `getInputsCapacity` and `completeFee` overrides including the 64-output NervosDAO check. Developers see "remove SmartTransaction, use `ccc.Transaction` + utility functions" and attempt a mechanical find-and-replace, missing that `completeFee` silently iterates all registered UDT handlers before calling `super.completeFee()`, that `clone()` shares `udtHandlers` and `headers` maps across transaction copies (shared-state semantics), and that `getInputsCapacity` adds DAO withdrawal profit to the capacity total. A naive replacement that only extracts the obvious methods will produce transactions that fail on-chain because (a) UDT change cells are never added, (b) DAO withdrawal profits are not counted in capacity balancing, or (c) headers needed for withdrawal are not in `headerDeps`.

**Why it happens:**
SmartTransaction's design buries critical side effects in method overrides that are not visible from call sites. The callers (e.g., `LogicManager.deposit`, `DaoManager.requestWithdrawal`, `OrderManager.mint`) call `tx.addUdtHandlers()`, `tx.addHeaders()`, and `tx.getHeader()` -- methods that only exist on SmartTransaction, not on `ccc.Transaction`. These are the implicit contract. But the highest-stakes behavior -- `completeFee` iterating all handlers and `getInputsCapacity` adding DAO profit -- is triggered by the signer at transaction submission time, far from where handlers/headers were registered.

**How to avoid:**
1. Before removing anything, catalog every SmartTransaction-specific method used across the codebase. The complete list: `addUdtHandlers`, `addHeaders`, `getHeader`, `hasUdtHandler`, `getUdtHandler`, `encodeUdtKey`, `encodeHeaderKey`, `completeFee` (override), `getInputsCapacity` (override), `getInputsUdtBalance` (override), `getOutputsUdtBalance` (override), `clone` (override with shared maps), `copy` (override with map merging), `default` (override), `from` (override).
2. Design the replacement as standalone functions for the UDT completion concern (`completeUdtChange(tx, signer)`). Note: `getInputsCapacity` DAO profit accounting does NOT need a utility — CCC's `Transaction.getInputsCapacity()` handles this natively via `getInputsCapacityExtra()` → `Cell.getDaoProfit()`. Header management: `getHeader()` and `HeaderKey` are removed entirely; call sites inline CCC client calls (`client.getTransactionWithHeader()`, `client.getHeaderByNumber()`); `addHeaders()` call sites push to `tx.headerDeps` directly. Validate that each original override has a corresponding replacement (inlined CCC call or CCC-native method).
3. Write characterization tests BEFORE refactoring: for a known set of inputs, capture the exact `completeFee` output (number of added inputs, whether change was added) and the exact `getInputsCapacity` return value. Run these tests against the new utility functions.

**Warning signs:**
- Any `completeFee` call that returns `[0, false]` when it previously returned `[N, true]` -- means UDT change is missing
- Transactions rejected on-chain with "ImbalancedCapacity" -- means DAO profit is not being counted
- "Header not found in HeaderDeps" errors -- means header caching was lost
- Off-by-one in output count near the 64-output NervosDAO limit -- means the DAO check was lost from `completeFee`

**Phase to address:**
Phase 1 (Library refactor). This must be the first step -- all five library packages and all downstream apps depend on SmartTransaction. Getting this wrong blocks everything else.

---

### Pitfall 2: Conservation Law Violation When Subclassing CCC Udt for iCKB Multi-Representation Value

**What goes wrong:**
iCKB value exists in three on-chain forms: xUDT tokens (standard `u128 LE` balance), receipt cells (representing pending deposit conversions, carrying `{depositQuantity, depositAmount}`), and DAO deposit cells (locked CKB). The iCKB Logic contract enforces a conservation law: `input_udt + input_receipts = output_udt + input_deposits`. CCC's `Udt` class only understands form (1) -- it counts `u128 LE` balances in cells with a matching type script. If you subclass `Udt` and override `infoFrom`/`balanceFrom` to also count receipts and deposits (as `IckbUdtManager` currently does), you create a class that claims a balance that CCC's generic transaction completion logic does not understand. When CCC's `Udt.completeInputsByBalance` adds inputs to satisfy the declared balance, it may add receipt or deposit cells that trigger the conservation law in unexpected ways, or it may fail to add the correct header deps needed for receipt/deposit value calculation.

Concretely, `IckbUdtManager.getInputsUdtBalance` currently (a) counts xUDT balances, (b) converts receipt cells to iCKB value using the block header's accumulated rate, and (c) subtracts deposit value when a deposit-to-withdrawal-request conversion is happening. This logic requires `tx.getHeader()` -- a SmartTransaction method -- and depends on knowing the transaction's intent (is a deposit being converted to a withdrawal request?). CCC's `Udt` has no concept of header-dependent balance calculation or intent-aware accounting.

**Why it happens:**
The temptation is to make `IckbUdt extends Udt` so that CCC's generic transaction completion (`completeBy`, `completeInputsByBalance`) "just works" for iCKB. But iCKB's multi-representation value model is fundamentally incompatible with the assumption that UDT balance = sum of `u128 LE` fields in matching type cells. The CCC `Udt` class was designed for standard xUDT tokens, not for protocol-specific tokens with conservation laws spanning multiple cell types.

**How to avoid:**
1. The preferred approach (confirmed in Phase 3 research) is to subclass `Udt` as `IckbUdt`, overriding `infoFrom()`. Input cells have `outPoint` set (resolved via `CellInput.getCell()`), enabling header fetches for receipt/deposit value calculation. `CellAny` has `capacityFree` for deposit valuation. See 03-RESEARCH.md for the corrected design.
2. If subclassing proves unviable, the fallback is to keep multi-representation accounting in iCKB-specific standalone functions (refactored from `IckbUdtManager`), using CCC's `Udt` only for standard xUDT operations (cell discovery, basic balance reading).
3. Whichever approach is chosen, ensure that CCC's `Udt.completeInputsByBalance()` does not inadvertently add receipt or deposit cells as if they were standard xUDT inputs. Verify that the conservation law (`input_udt + input_receipts = output_udt + input_deposits`) is enforced correctly by the overridden methods.
4. Always add required `headerDeps` explicitly -- CCC's client cache handles header fetching performance, but `headerDeps` must be on the transaction for on-chain validation.

**Warning signs:**
- Tests where `udt.calculateBalance(signer)` returns a different value than the on-chain xUDT balance visible in an explorer
- Transaction completion that adds iCKB receipt cells as if they were xUDT cells
- Missing `headerDeps` in completed transactions (receipts require the header of their creation TX)
- CCC's generic `completeInputsByBalance()` selecting cells that trigger the conservation law unexpectedly

**Phase to address:**
Phase 3 (CCC Udt Integration Investigation). The UDT handling architecture must be settled before core implementation (Phase 5), because the apps currently use `SmartTransaction.completeFee` which delegates to `IckbUdtManager.completeUdt`. Phase 3 is specifically designed to resolve this design question.

---

### Pitfall 3: Exchange Rate Divergence Between TypeScript and Rust Contract

**What goes wrong:**
The TypeScript exchange rate formula in `packages/core/src/udt.ts` must produce byte-identical results to the Rust `ickb_logic` contract's `deposit_to_ickb()` function. The formula is `iCKB = capacity * AR_0 / AR_m` with a soft cap penalty. Any divergence -- even by 1 shannon due to integer division rounding -- causes the conservation law check to fail on-chain, and the transaction is rejected. This is not caught by type checking, linting, or any compile-time analysis. It can only be caught by cross-validation tests that compare TypeScript output against known Rust contract outputs.

The specific danger points:
- Integer division direction: Rust uses truncating division. TypeScript `BigInt` also truncates, but the order of operations matters. `(a * b) / c` may produce a different result than `a * (b / c)`.
- The soft cap formula: `amount - (amount - 100000) / 10n` where `100000` is `ICKB_SOFT_CAP_PER_DEPOSIT` in CKB units (100,000 * 10^8). Getting the unit wrong by a factor of 10^8 is catastrophic.
- The `depositCapacityDelta` constant: computed as `(82 CKB * AR_0) / ICKB_DEPOSIT_CAP`. This is a compile-time constant in the TypeScript but must match the Rust contract's treatment of occupied capacity (82 bytes for a DAO deposit cell).

**Why it happens:**
The contract code is in Rust, the library is in TypeScript, and there are zero cross-validation tests. The developer relies on manual inspection to verify formula equivalence. Any future change to either side (e.g., adopting a CCC upstream utility for the conversion) risks introducing a subtle arithmetic difference.

**How to avoid:**
1. Create a test fixture file with known input/output pairs derived from the Rust contract: deposit amounts at boundary conditions (1000 CKB, 100000 CKB, 1000000 CKB), various accumulated rates, and the exact expected iCKB amounts.
2. Run these as the first test in CI. If the test breaks, it means the TypeScript formula diverged from the contract.
3. Add a comment in `packages/core/src/udt.ts` at each formula step citing the exact Rust source line it corresponds to.
4. Never replace a hand-written arithmetic formula with a CCC utility without verifying the utility produces identical results for the test fixture.

**Warning signs:**
- Any change to `ickbValue()`, `convert()`, or `ickbExchangeRatio()` in `packages/core/src/udt.ts`
- Changing the `AR_0`, `depositUsedCapacity`, or `ICKB_DEPOSIT_CAP` constants
- On-chain transaction failures with error code 11 (`AmountMismatch`) from the `ickb_logic` script

**Phase to address:**
Phase 1 (Library refactor) -- add cross-validation tests before any refactoring touches the exchange rate code. This is a safety net for the entire migration.

---

### Pitfall 4: Breaking the Conservation Law During Lumos-to-CCC App Migration

**What goes wrong:**
The legacy bot app (`apps/bot/src/index.ts`, ~900 lines) builds iCKB transactions using Lumos primitives (`TransactionSkeleton`, `addCells`, `addCkbChange`, `addIckbUdtChange`, etc.). The new library packages build equivalent transactions using CCC primitives. During migration, the developer must produce transactions with **identical on-chain semantics** -- same cell types in the same positions, same data formats, same header deps, same witness structure. The iCKB contracts enforce position-sensitive rules: for example, the `owned_owner` script requires a 1:1 pairing between owner cells and owned cells at specific relative positions (the `owned_distance: i32` field). The order contract requires the master cell to appear at a specific offset from its order cell. Getting the cell ordering wrong produces transactions that pass TypeScript validation but fail on-chain.

Specifically dangerous patterns in the bot migration:
- `ickbRequestWithdrawalFrom` in Lumos creates paired cells (owned withdrawal request + owner cell) with specific relative positioning. The new `OwnedOwnerManager.requestWithdrawal` must produce identical relative positions.
- `orderSatisfy`/`orderMint` in Lumos produce order cells with `master_distance` encoded as a relative `i32`. The new `OrderManager.mint` uses `Relative.create(1n)` for the same purpose. The byte encoding must be identical.
- The bot's `addCkbChange` + `addIckbUdtChange` sequence in Lumos has specific ordering semantics (iCKB change first, then CKB change). The new `SmartTransaction.completeFee` iterates UDT handlers before calling `super.completeFee()`, preserving this order. But if the replacement utility functions change this order, fee calculation will differ.

**Why it happens:**
The migration is a "rewrite-in-place" of ~900 lines of Lumos-based transaction building. The developer focuses on making the TypeScript type-check with the new API, but the on-chain contracts don't care about TypeScript types -- they care about byte-level cell layout. The implicit contract between the off-chain code and the on-chain scripts is not captured in any type system.

**How to avoid:**
1. Migrate the bot in a feature branch and test against CKB testnet before mainnet.
2. For each transaction type the bot produces (deposit, withdrawal request, withdrawal, order match, order melt), capture a "golden" transaction from the Lumos version (serialized bytes). Build the same transaction with the CCC version and compare byte-for-byte. Differences must be explicitly justified.
3. Test the migrated bot in a read-only mode first: build transactions but log them instead of submitting. Compare against what the Lumos version would build.
4. Keep the Lumos version running in parallel during the transition period.

**Warning signs:**
- Transaction failures on testnet with error codes from `ickb_logic` (5-12), `owned_owner` (5-8), or `limit_order` (5-21)
- The bot producing transactions that succeed on testnet but fail on mainnet (indicating testnet-specific constants leaked)
- Order matching that produces different `ckbDelta`/`udtDelta` values than the Lumos version for the same order pool

**Phase to address:**
App migration (deferred to future milestone, not in v1 roadmap). The bot is the highest-stakes migration because it runs autonomously and handles real CKB/iCKB value.

---

### Pitfall 5: Molecule Codec Byte Layout Mismatch After Refactoring

**What goes wrong:**
The TypeScript Molecule codecs (`ReceiptData`, `OwnedOwnerData`, `OrderInfo`, `Ratio`, etc.) use CCC's `@ccc.codec` decorators and `mol.Entity.Base`. These produce byte encodings that must match the Molecule schema at `reference/contracts/schemas/encoding.mol` exactly -- field order, sizes, endianness, padding. A refactoring that reorders fields in a TypeScript class, changes a field type, or inadvertently uses a different encoding for the same semantic value (e.g., `Uint32` vs `Int32` for `owned_distance`) will produce silently different byte encodings. The contracts will reject the transaction or, worse, misinterpret the data.

Key risk areas:
- `ReceiptData { deposit_quantity: Uint32, deposit_amount: Uint64 }` = 12 bytes. TypeScript uses `@ccc.codec` with fields `depositQuantity` (u32 LE) and `depositAmount` (u64 LE). If someone renames or reorders these fields, the encoded bytes change.
- `OwnedOwnerData { owned_distance: Int32 }` = 4 bytes. Note this is **signed** Int32, not unsigned. Using `Uint32` would encode the same numeric value differently for negative distances.
- Order cell data layout is 89 bytes with a specific structure. The `OrderData` class in `packages/order/src/entities.ts` manually constructs this from components. Any change to the field sizes or offsets breaks order matching.

**Why it happens:**
TypeScript field names are camelCase, Molecule schema field names are snake_case. There is no compile-time link between them. The mapping is purely by convention and manual code review. When refactoring moves entities to a different file or refactors the class hierarchy, the byte layout can change without any type error.

**How to avoid:**
1. Add roundtrip codec tests: encode a known TypeScript object, compare to a hardcoded expected hex string, then decode and compare to the original object.
2. Generate the expected hex strings from the Molecule schema directly (or from known Rust test vectors).
3. Never change field order in `@ccc.codec`-decorated classes without verifying the byte layout.
4. Add a comment on each codec class citing the exact Molecule schema line it corresponds to.

**Warning signs:**
- Any modification to files in `packages/order/src/entities.ts`, `packages/core/src/entities.ts`, or `packages/sdk/src/codec.ts`
- A codec class where the field order differs from the Molecule schema field order
- A cell data `outputData` that decodes to unexpected values in the CCC explorer

**Phase to address:**
Phase 1 (Library refactor) -- add codec tests as a safety net before any refactoring.

---

### Pitfall 6: Losing the 64-Output NervosDAO Limit Enforcement

**What goes wrong:**
The NervosDAO script rejects transactions with more than 64 output cells. This limit is currently enforced in 6 separate locations in the codebase: `SmartTransaction.completeFee`, `LogicManager.deposit`, `DaoManager.deposit`, `DaoManager.requestWithdrawal`, `DaoManager.withdraw`, and `apps/bot/src/index.ts`. When SmartTransaction is removed and replaced with utility functions, the `completeFee` check is the most likely to be lost because it is an override that the caller never explicitly invokes -- it runs implicitly when the signer calls `completeFee`. If the replacement utility function does not include this check, transactions built by the SDK will occasionally exceed 64 outputs and fail on-chain in production.

**Why it happens:**
The 64-output limit is a NervosDAO-specific gotcha that is easy to forget because (a) most transactions have far fewer than 64 outputs, (b) the limit only applies to transactions that include DAO cells, and (c) the error only manifests on-chain, not during local transaction building. The developer testing with small transactions will never hit this limit. The bot operating on mainnet with many deposits/withdrawals will.

**How to avoid:**
1. When replacing `SmartTransaction.completeFee`, explicitly include the NervosDAO 64-output check in the replacement function.
2. Add an integration test that attempts to build a DAO transaction with 65 outputs and verifies it throws.
3. Consider consolidating the 64-output check into a single utility function (`assertDaoOutputLimit(tx, client)`) called from one place rather than scattered across 6 locations.

**Warning signs:**
- Removing `SmartTransaction.completeFee` without grepping for `outputs.length > 64` in the codebase
- On-chain failures with NervosDAO error codes only when the bot processes large batches
- Tests passing with small transaction sizes but failing with realistic sizes

**Phase to address:**
Phase 1 (Library refactor) -- the check must survive the SmartTransaction removal.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Keeping SmartTransaction "just for now" while migrating apps | Apps work immediately without library changes | Two transaction models coexist, every new feature must work with both, CCC upgrades become harder | Never -- library refactor must come before app migration |
| Passing `SmartTransaction` type through public API boundaries | Avoids rewriting callers | External consumers inherit a dependency on a non-standard Transaction subclass, blocking npm publication | Never for published packages -- internal-only is acceptable during transition |
| Skipping codec roundtrip tests | Faster initial development | Silent byte-level bugs that only manifest on-chain | Never -- these tests are cheap to write and prevent catastrophic failures |
| Duplicating CCC utility functions locally instead of adopting upstream | Avoids dependency on specific CCC version | Drift between local and upstream implementations, double maintenance burden | Only if CCC version is not yet released (use `ccc-dev/` local builds to validate, then switch to published version) |
| Migrating bot without parallel Lumos fallback | Cleaner codebase, single transaction path | If CCC-based bot has subtle bugs, no way to fall back; real funds at risk | Never for mainnet -- always keep Lumos bot runnable until CCC bot is validated on testnet |
| Removing `@ickb/lumos-utils` and `@ickb/v1-core` from workspace before all apps are migrated | Simpler dependency tree | Breaks unmigrated apps, blocks incremental migration | Only after ALL apps are migrated and verified |

## Integration Gotchas

Common mistakes when connecting to CKB RPC and CCC.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| CCC `findCells` vs `findCellsOnChain` | Using cached `findCells` for bot operations where freshness matters | Use `findCellsOnChain` for bot/time-sensitive operations, `findCells` only for UI queries where slight staleness is acceptable |
| CCC `ccc.Transaction.completeFee` | Assuming it handles UDT change automatically | It only handles CKB capacity change. UDT change must be handled separately (this is exactly what SmartTransaction's override added). The replacement must preserve this |
| CCC `Udt.completeInputsByBalance` | Assuming it works for iCKB multi-representation value | CCC's `Udt` only counts xUDT `u128 LE` balances. Receipt cells and deposit cells are invisible to it. Use iCKB-specific logic for iCKB value accounting |
| CCC `ccc.Client` header caching | Assuming headers fetched by `client.getHeaderByNumber` are automatically added to `headerDeps` | They are not. Headers must be explicitly added to the transaction's `headerDeps`. SmartTransaction's `addHeaders` did this automatically -- the replacement must too |
| NervosDAO `since` field encoding | Using `ccc.Epoch.toHex()` for the `since` field in withdrawal inputs | The `since` field requires absolute epoch encoding with specific bit layout. Verify against `ccc.epochToHex()` or the NervosDAO RFC. Incorrect encoding causes on-chain rejection |
| Lumos `TransactionSkeleton` immutability | Assuming in-place mutation works (CCC `Transaction` is mutable) | Lumos skeletons are immutable (Immutable.js). Every operation returns a new skeleton. CCC transactions are mutable. Migration code must not mix idioms (e.g., discarding the return value of a Lumos operation) |

## Performance Traps

Patterns that work at small scale but fail as the bot processes real volume.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Sequential `getHeader()` calls in DAO cell construction | Each DAO cell requires 1-2 RPC calls; processing 30 deposits = 60 sequential calls | Prefetch all needed headers in parallel before constructing cells (batch `getHeaderByNumber` calls) | >10 DAO cells per transaction cycle |
| Unbounded header cache in replacement for SmartTransaction.headers | Memory grows indefinitely across bot iterations | Use LRU or TTL-based cache, or create fresh context per transaction | After running for days with many DAO transactions |
| `findOrders` fetching all orders then filtering | The bot fetches ALL on-chain order cells, then filters by matchability | Use more specific RPC filters, or paginate with early termination | >1000 active orders on-chain |
| Re-fetching system state on every bot iteration | Full `getL1State` call fetches tip, deposits, withdrawals, orders each iteration | Cache tip-dependent data with short TTL, only refresh what changed | Bot with <2 second sleep interval |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Incorrect exchange rate in migrated code causes user to receive fewer iCKB than expected | Financial loss -- user deposits CKB, receives less iCKB than the contract would calculate | Cross-validation tests between TypeScript and Rust. Never approximate; use exact integer arithmetic |
| Bot private key leaked through error logging during migration | Bot wallet drained -- attacker uses private key to sign transactions | Audit all `console.log` and error handling in migrated bot. Never log `signer`, `key`, or raw env vars. The faucet already has this bug (logs ephemeral key at line 31) |
| Using testnet constants on mainnet after migration | Transactions silently produce wrong results -- wrong script hashes, wrong dep groups | Validate `getConfig("mainnet")` vs `getConfig("testnet")` constants against on-chain state in CI |
| Order matching with negative gain due to rounding error | Bot loses CKB/iCKB on every match cycle | Verify `gain > 0` assertion in migrated `bestMatch`. The current code checks this but the check could be lost during refactoring |

## UX Pitfalls

Common user experience mistakes during the interface app migration.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Wallet connector behavior change between Lumos and CCC | JoyId users see different connection flow, potential confusion | Test with actual JoyId wallet. CCC's wallet connector API differs from Lumos -- map the exact UX flow |
| Transaction fee estimation differs between Lumos and CCC | Users see different fee amounts than before, may reject transactions | Log fee estimates from both implementations during parallel testing. Align UX copy for fee display |
| Maturity estimates change due to different epoch calculation | Users see different lock-up times, lose trust | Verify maturity calculation against both implementations for the same deposits |
| Loading states during migration | React Query cache invalidation behaves differently with new data fetching | Map `queryKey` structure from Lumos to CCC. Preserve `refetchInterval` and `staleTime` settings |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **SmartTransaction removal:** Often missing the `completeFee` UDT handler iteration -- verify that ALL registered UDT handlers have their `completeUdt` called during fee completion
- [ ] **SmartTransaction removal:** Verify that DAO profit accounting delegates to CCC's native `Transaction.getInputsCapacity()` (which handles DAO profit via `getInputsCapacityExtra()` → `Cell.getDaoProfit()`) rather than reimplementing it locally
- [ ] **SmartTransaction removal:** Often missing the shared-map semantics of `clone()` -- verify that cloned transactions share the same `udtHandlers` and `headers` maps
- [ ] **Bot migration:** Often missing the witness structure for DAO withdrawals -- verify `inputType` witness field contains the header index for each withdrawal request
- [ ] **Bot migration:** Often missing the `same-size` lock args constraint -- verify that withdrawal request lock args have the same byte length as the deposit lock args (required by `OwnedOwner` contract)
- [ ] **Interface migration:** Often missing the React Query cache key migration -- verify that changing the data-fetching layer does not cause stale data or missing cache invalidation
- [ ] **Codec refactoring:** Often missing signed vs unsigned integer encoding -- verify `OwnedOwnerData.owned_distance` uses `Int32` (signed), not `Uint32`
- [ ] **Library API cleanup:** Often missing re-export paths -- verify that consumers importing from `@ickb/utils` still get all needed types after refactoring internal module structure
- [ ] **CCC alignment:** Often missing deprecation warnings -- verify that any `@deprecated` CCC APIs used locally (`udtBalanceFrom`, `ErrorTransactionInsufficientCoin`) are migrated to their replacements

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Conservation law violation on testnet | LOW | Identify which term of the conservation law is wrong (xUDT, receipts, or deposits). Compare TypeScript calculation against manual computation from block headers. Fix and retest. No on-chain damage -- testnet CKB is free |
| Conservation law violation on mainnet | MEDIUM | Immediately stop bot. Transactions are rejected on-chain so no funds are lost. But pending orders may be stuck until a working bot version is deployed. Rollback to Lumos bot while fixing |
| Exchange rate divergence discovered in production | HIGH | Stop bot. Audit all recent transactions for incorrect iCKB amounts. If users received fewer iCKB than expected, the protocol's conservation law would have prevented the transaction -- so this is actually caught on-chain. The real risk is the bot failing repeatedly and missing matching opportunities |
| 64-output limit hit in production | LOW | Transaction is rejected on-chain, no funds lost. Fix the limit check, redeploy. The bot will retry on next cycle |
| Molecule codec mismatch | HIGH | All transactions using the affected codec fail on-chain. If the codec was used for publishing order data, existing orders may become unmatchable. Must deploy fix immediately and potentially recreate affected orders |
| SmartTransaction removal breaks header caching | MEDIUM | Transactions fail with "Header not found in HeaderDeps". Add headers back to the transaction context. May need to re-add sequential header fetching temporarily until batch prefetching is implemented |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| SmartTransaction implicit behaviors lost | Phase 1 (Library refactor) | Characterization tests pass: `completeFee` output matches, `getInputsCapacity` return matches, headers present in `headerDeps` |
| CCC Udt subclassing for multi-representation value | Phase 3 (CCC Udt Integration Investigation) | Design decision documented: subclass viability confirmed or fallback approach chosen; conservation law preservation verified in either case |
| Exchange rate divergence | Phase 1 (Library refactor, test infrastructure) | Cross-validation test suite exists with known Rust contract outputs; tests pass in CI |
| Conservation law violation during app migration | Future milestone (App migration) | Migrated bot produces byte-identical transactions to Lumos bot for the same inputs; testnet validation passes |
| Molecule codec byte layout mismatch | Phase 1 (Library refactor, test infrastructure) | Codec roundtrip tests exist for all 6 entity types; expected hex strings match Molecule schema |
| 64-output NervosDAO limit lost | Phase 1 (Library refactor) | Integration test that builds a 65-output DAO transaction and verifies it throws; `assertDaoOutputLimit` utility exists |
| Lumos removal breaks unmigrated apps | Future milestone (App migration) | Each app is migrated and verified individually; Lumos dependencies removed only after all apps pass |
| Private key logging in migrated code | Future milestone (App migration) | Security audit of all `console.log` calls in migrated apps; no sensitive data in logs |
| React Query cache invalidation in interface | Future milestone (App migration, interface) | Manual testing with JoyId wallet; query key structure documented; refetch intervals preserved |

## Sources

- Direct codebase analysis: `packages/utils/src/transaction.ts` (SmartTransaction, 517 lines), `packages/utils/src/udt.ts` (UdtManager, 393 lines), `packages/core/src/udt.ts` (IckbUdtManager, 213 lines)
- CCC `Udt` class source: `ccc-dev/ccc/packages/udt/src/udt/index.ts` (1798 lines)
- On-chain contract source: `reference/contracts/scripts/contracts/ickb_logic/src/entry.rs` (conservation law, exchange rate)
- On-chain contract source: `reference/contracts/scripts/contracts/owned_owner/` (owner/owned pairing)
- On-chain contract source: `reference/contracts/scripts/contracts/limit_order/` (order/master relationship)
- Molecule schema: `reference/contracts/schemas/encoding.mol` (byte layout definitions)
- NervosDAO RFC: https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0023-dao-deposit-withdraw/0023-dao-deposit-withdraw.md (64-output limit)
- `.planning/PROJECT.md` -- project requirements and constraints
- `.planning/codebase/CONCERNS.md` -- known tech debt and fragile areas
- `.planning/codebase/INTEGRATIONS.md` -- CCC API surface and contract details

---
*Pitfalls research for: CKB/CCC library migration (iCKB Stack v2)*
*Researched: 2026-02-21*
