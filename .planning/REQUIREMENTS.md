# Requirements: iCKB Stack v2

**Defined:** 2026-02-21
**Core Value:** Clean, CCC-aligned library packages published to npm that frontends can depend on to interact with iCKB contracts -- no Lumos, no abandoned abstractions, no duplicated functionality with CCC.

## v1 Requirements

Requirements for initial milestone. Each maps to roadmap phases.

### SmartTransaction Removal

- [ ] **SMTX-01**: All manager method signatures across all 5 library packages accept `ccc.TransactionLike` instead of `SmartTransaction`, following CCC's convention (TransactionLike input, Transaction output); `CapacityManager` is deleted (not migrated)
- [ ] **SMTX-02**: `SmartTransaction` class and its `completeFee()` override are deleted from `@ickb/utils`
- [ ] **SMTX-03**: Fee completion uses CCC-native `ccc.Transaction.completeFeeBy()` or `completeFeeChangeToLock()` with DAO-aware capacity calculation
- [ ] **SMTX-04**: `getHeader()` function and `HeaderKey` type are removed from `@ickb/utils`; all call sites inline CCC client calls (`client.getTransactionWithHeader()`, `client.getHeaderByNumber()`); header caching handled transparently by `ccc.Client.cache`
- [ ] **SMTX-05**: UDT handler registration (`addUdtHandlers()`) is replaced by direct `Udt` instance usage or standalone utility functions
- [x] **SMTX-06**: 64-output NervosDAO limit check is consolidated into a single utility function (currently scattered across 6 locations)
- [ ] **SMTX-07**: `IckbUdtManager` multi-representation UDT balance logic (xUDT + receipts + deposits) survives removal intact -- conservation law `Input UDT + Input Receipts = Output UDT + Input Deposits` is preserved
- [ ] **SMTX-08**: `IckbSdk.estimate()` and `IckbSdk.maturity()` continue working after SmartTransaction removal
- [ ] **SMTX-09**: All 5 library packages (`@ickb/utils`, `@ickb/dao`, `@ickb/order`, `@ickb/core`, `@ickb/sdk`) compile and pass type checking after removal
- [ ] **SMTX-10**: Deprecated CCC API calls (`udtBalanceFrom`, `getInputsUdtBalance`, `getOutputsUdtBalance`, `completeInputsByUdt`) are replaced with `@ckb-ccc/udt` equivalents

### CCC Utility Deduplication

- [ ] **DEDUP-01**: Local `max()` / `min()` replaced with `ccc.numMax()` / `ccc.numMin()` across all packages
- [ ] **DEDUP-02**: Local `gcd()` replaced with `ccc.gcd()` across all packages
- [ ] **DEDUP-03**: Local `isHex()` replaced with `ccc.isHex()` in `@ickb/utils`
- [ ] **DEDUP-04**: Local `hexFrom()` refactored to explicit calls -- CCC's `hexFrom()` only handles `HexLike` (not `bigint | Entity`), so call sites should use `ccc.numToHex()` for bigint and `ccc.hexFrom(entity.toBytes())` for entities (per STACK.md evaluation)
- [ ] **DEDUP-05**: iCKB-unique utilities (`binarySearch`, `asyncBinarySearch`, `shuffle`, `unique`, `collect`, `BufferedGenerator`, `MinHeap`) are preserved unchanged

### CCC Udt Integration

- [ ] **UDT-01**: Feasibility assessment completed: can `IckbUdt extends udt.Udt` override `infoFrom()` or `getInputsInfo()`/`getOutputsInfo()` to account for receipt cells and deposit cells alongside xUDT cells
- [ ] **UDT-02**: Header access pattern for receipt value calculation is designed -- determine whether `client.getCellWithHeader()`, `client.getHeaderByTxHash()`, or direct CCC client calls are used within the Udt override (`getHeader()` utility removed in Phase 1)
- [ ] **UDT-03**: Decision documented: subclass CCC `Udt` vs. keep custom `UdtHandler` interface vs. hybrid approach
- [ ] **UDT-04**: If subclassing is viable, `IckbUdt` class is implemented in `@ickb/core` with multi-representation balance calculation
- [ ] **UDT-05**: If subclassing is not viable, `IckbUdtManager` is refactored to work with plain `ccc.Transaction` (no SmartTransaction dependency) while maintaining a compatible interface

## v2 Requirements

Deferred to next milestone. Tracked but not in current roadmap.

### API & Publication

- **API-01**: Clean public API surface -- audit all `export *` barrel files, mark internal symbols with `@internal`
- **API-02**: npm publication with provenance -- publish updated packages after API audit
- **API-03**: Type export audit -- ensure `.d.ts` correctness, no `any` leaks in public API

### App Migration

- **APP-01**: Bot app migrated from Lumos to CCC + new library packages
- **APP-02**: Interface app migrated from Lumos to CCC + new library packages (straight swap, same UI)
- **APP-03**: Tester app migrated from Lumos to CCC + new library packages

### Ecosystem Cleanup

- **CLEAN-01**: Complete Lumos removal -- remove all `@ckb-lumos/*`, `@ickb/lumos-utils`, `@ickb/v1-core` dependencies
- **CLEAN-02**: Upstream CCC contribution -- identify reusable patterns for CCC PRs

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| UI/UX redesign for interface app | Straight migration only -- conflates concerns, delays migration |
| New reference/example apps | Existing 5 apps already demonstrate all library capabilities |
| On-chain contract changes | All contracts deployed with zero-args locks (immutable, non-upgradable) |
| Mobile app | Web-first, web-only for now |
| CCC framework fork | We adopt CCC, not fork it -- PRs go upstream |
| Custom Molecule codec library | CCC already provides `mol.*` -- custom codecs duplicate effort |
| Custom blockchain indexer | CCC's `findCells`/`findCellsOnChain` covers all current needs |
| Multi-chain / L2 token bridging | Separate concern requiring different architecture |
| Embedded wallet/signer management | CCC provides comprehensive signer abstraction |
| Database/state persistence layer | All state is on-chain -- database creates stale-state problems |
| SmartTransaction as ecosystem standard | Abandoned by CCC maintainers and broader ecosystem |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status | Notes |
|-------------|-------|--------|-------|
| SMTX-01 | Phase 1 | Pending | Feature-slice: all signatures migrated to TransactionLike across all packages |
| SMTX-02 | Phase 1 | Pending | |
| SMTX-03 | Phase 6 | Pending | |
| SMTX-04 | Phase 1 | Pending | getHeader()/HeaderKey removed, CCC client calls inlined |
| SMTX-05 | Phase 4, 5 | Pending | addUdtHandlers() removed in Phase 1; replacement pattern finalized in Phase 4-5 after Phase 3 decision |
| SMTX-06 | Phase 1 | Complete | DAO check contributed to CCC core via ccc-dev/ (01-01) |
| SMTX-07 | Phase 5 | Pending | |
| SMTX-08 | Phase 6 | Pending | |
| SMTX-09 | Phase 7 | Pending | |
| SMTX-10 | Phase 4, 5 | Pending | Deprecated calls in dao/order (Phase 4) and core (Phase 5) |
| DEDUP-01 | Phase 2 | Pending | |
| DEDUP-02 | Phase 2 | Pending | |
| DEDUP-03 | Phase 2 | Pending | |
| DEDUP-04 | Phase 2 | Pending | |
| DEDUP-05 | Phase 2 | Pending | |
| UDT-01 | Phase 3 | Pending | |
| UDT-02 | Phase 3 | Pending | |
| UDT-03 | Phase 3 | Pending | |
| UDT-04 | Phase 5 | Pending | |
| UDT-05 | Phase 5 | Pending | |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0

---
*Requirements defined: 2026-02-21*
*Last updated: 2026-02-22 after 01-01 execution (SMTX-06 completed)*
