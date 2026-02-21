# Feature Research

**Domain:** CCC-based CKB protocol library suite (NervosDAO liquidity / iCKB)
**Researched:** 2026-02-21
**Confidence:** HIGH (based on codebase analysis, CCC docs, existing protocol architecture, npm ecosystem survey)

## Feature Landscape

### Table Stakes (Users Expect These)

Features that library consumers (app developers, frontends, the bot) expect to exist. Missing any of these means the library suite is not production-ready for npm publication.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **TS-1: SmartTransaction removal** | SmartTransaction extends `ccc.Transaction` with abandoned ecosystem semantics; consumers expect to work with plain `ccc.Transaction` | HIGH | Core refactor touching all 5 packages and all managers. Replace with utility functions that operate on `ccc.Transaction` directly. UDT handler map and header cache must be externalized or passed as parameters. |
| **TS-2: CCC utility deduplication** | Library consumers expect no redundant code when CCC already provides equivalents | LOW | Adopt `ccc.numMax`/`ccc.numMin` for `max`/`min`, CCC's `gcd()`, `isHex()`, `hexFrom()`. Keep iCKB-unique utilities (`binarySearch`, `shuffle`, `unique`, `collect`, `BufferedGenerator`, `MinHeap`). |
| **TS-3: Clean public API surface** | npm packages must export only intentional public API, not internal implementation details | MEDIUM | Audit all `export *` barrel files. Mark internal symbols with `@internal` or move to non-exported files. Ensure each package's entry point (`index.ts`) is curated. |
| **TS-4: Complete Lumos removal** | Consumers expect zero `@ckb-lumos/*` dependencies in the published library packages | MEDIUM | Library packages (`packages/*`) already use CCC. Lumos remains only in legacy apps (`bot`, `interface`, `tester`). App migration is the gate. Legacy packages `@ickb/lumos-utils` and `@ickb/v1-core` should not be dependencies of any new package. |
| **TS-5: Bot app migration to CCC** | Bot is the primary protocol operator; it must use the new library packages to validate they work end-to-end | HIGH | 897-line file using `@ickb/v1-core` + `@ckb-lumos/*`. Needs full rewrite to use `@ickb/sdk` + `@ickb/core` + CCC signers. Validates the entire library stack under real production load. |
| **TS-6: Interface app migration to CCC** | The user-facing DApp must use the new packages; shipping two implementations is unsustainable | MEDIUM | Straight migration (same UI). Swap `@ickb/v1-core` + `@ckb-lumos/*` for `@ickb/sdk` + CCC. React + TanStack Query architecture stays. ~1,158 lines across 8 files. Already uses CCC for wallet connection. |
| **TS-7: Tester app migration to CCC** | Tester validates protocol behavior; must exercise the new packages | MEDIUM | 469-line simulation file. Similar migration pattern to bot. |
| **TS-8: Correct NervosDAO operation semantics** | Deposit, withdrawal request, and withdrawal must work correctly with all DAO constraints (64-output limit, epoch-based since, header deps) | Already done | Already implemented in `DaoManager`. Validated by existing faucet/sampler apps. Maintain and verify during SmartTransaction removal. |
| **TS-9: iCKB conservation law enforcement** | `Input UDT + Input Receipts = Output UDT + Input Deposits` must be maintained in all transaction construction | Already done | Enforced by on-chain contract. Library must construct transactions that satisfy this invariant. `IckbUdtManager.getInputsUdtBalance` already accounts for all three representations. |
| **TS-10: Multi-network support (mainnet/testnet)** | Protocol is deployed on both networks; library must support both via `IckbSdk.from("mainnet" | "testnet")` | Already done | Already implemented in `constants.ts` with per-network dep groups and bot scripts. Devnet support via custom config objects. |
| **TS-11: npm publication with provenance** | CKB ecosystem expects packages on npm with `access: public` and `provenance: true` for supply chain verification | LOW | Already configured. Changeset-based versioning (`1001.0.0`). Ensure `package.json` files have correct `exports`, `types`, `main` fields pointing to built output. |
| **TS-12: Proper TypeScript type exports** | Library consumers expect full type information, strict mode compatibility, and no `any` leaks in public API | MEDIUM | Strict mode already enforced (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `noImplicitOverride`). Audit public-facing types for completeness. Ensure `.d.ts` files are generated and referenced. |

### Differentiators (Competitive Advantage)

Features that set the iCKB library suite apart from other CKB protocol libraries (Lumos, CKB SDK JS, RGB++ SDK, NervDAO). Not required for launch, but make the library significantly more valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **D-1: Multi-representation UDT value tracking** | iCKB value exists as xUDT tokens + receipt cells + DAO deposit cells simultaneously. No other CKB library handles this. The `IckbUdtManager` already computes unified balance across all three forms. | Already done (needs refinement) | Current implementation lives inside `SmartTransaction` override. After SmartTransaction removal, this logic must be preserved as standalone functions or a CCC `Udt`-compatible interface. Key differentiator: a UDT whose balance cannot be determined by reading cell data alone -- requires header lookups and receipt decoding. |
| **D-2: CCC Udt subclassing investigation** | If CCC's `Udt` class (via SSRI) can be extended for iCKB's multi-representation value, it would make iCKB a first-class citizen in the CCC ecosystem. Other protocol tokens could follow the pattern. | HIGH | CCC's `@ckb-ccc/udt` package uses SSRI server for UDT operations. iCKB's exchange rate is deterministic from block headers, not from an SSRI server. Subclassing may not be the right approach -- a compatible interface or wrapper may be better. Requires investigation of CCC's `Udt` API surface. |
| **D-3: Conversion preview with maturity estimation** | `IckbSdk.estimate()` provides real-time conversion preview with fee calculation AND estimated order fulfillment time based on pool liquidity analysis. No other CKB DEX SDK provides maturity estimation. | Already done | `IckbSdk.estimate()` and `IckbSdk.maturity()` already implement this. Ensure these survive SmartTransaction removal. |
| **D-4: Pool snapshot-based liquidity analysis** | Bot cells carry deposit pool snapshots (compact binary encoding) that enable fast liquidity estimation without scanning all deposit cells. | Already done | `PoolSnapshot` codec in `sdk/src/codec.ts`. Bot writes snapshots; SDK reads them. Unique protocol feature. |
| **D-5: Async generator cell discovery pattern** | Lazy evaluation via `async *findDeposits()`, `async *findOrders()` etc. with configurable batch sizes. More memory-efficient than collecting all cells upfront. | Already done | Pattern used consistently across `DaoManager`, `LogicManager`, `OrderManager`, `UdtManager`, `CapacityManager`. This is a genuine DX advantage over Lumos's eager collection pattern. |
| **D-6: Composable manager pattern with ScriptDeps** | Uniform `{ script, cellDeps }` interface enables managers to compose into transactions without knowing about each other. Clean dependency injection. | Already done | `DaoManager`, `OrderManager`, `LogicManager`, `OwnedOwnerManager`, `CapacityManager` all implement `ScriptDeps`. Pattern enables devnet testing with custom configs. |
| **D-7: Exchange rate calculation from block headers** | Deterministic CKB-to-iCKB conversion without oracles. `ickbExchangeRatio()` derives the rate from `header.dao.ar` (accumulated rate). | Already done | `convert()` and `ickbExchangeRatio()` in `packages/core/src/udt.ts`. Unique to iCKB protocol. Includes soft cap penalty calculation. |
| **D-8: Limit order lifecycle management** | Full mint/match/melt lifecycle for on-chain limit orders. `OrderManager` handles order creation, partial fills (preserving value conservation), and cancellation. | Already done | 988-line `OrderManager`. Includes ratio comparison, concavity checks, DOS prevention via `ckb_min_match_log`. Differentiated from CKB DEX SDK by being specifically designed for iCKB/CKB pair with integrated exchange ratio. |
| **D-9: Upstream CCC contribution pipeline** | Project has a track record of 12 merged CCC PRs. Patterns developed here become CCC-native features. This is a moat -- the maintainer shapes the framework the library depends on. | Ongoing | Continue identifying reusable patterns (FeePayer PR #328, potential UDT extensions). Each upstream merge reduces local code and increases ecosystem value. |
| **D-10: Owned-owner withdrawal delegation** | Solves NervosDAO's lock-size constraint for withdrawal delegation. `OwnedOwnerManager` handles the 1:1 pairing of owned (withdrawal request) and owner (authorization) cells via relative offset. | Already done | Unique to iCKB protocol. No other NervosDAO integration handles delegated withdrawals. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems in this context. Explicitly document what NOT to build.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **AF-1: SmartTransaction as ecosystem standard** | Was proposed as a universal CKB transaction builder pattern | Abandoned by CCC maintainers and broader ecosystem. No adoption outside iCKB. Subclassing `ccc.Transaction` couples to CCC internals. | Use utility functions on plain `ccc.Transaction`. UDT handler logic becomes standalone. If CCC PR #328 (FeePayer) lands, adopt that for fee completion. |
| **AF-2: Custom Molecule codec library** | Tempting to build a richer codec layer than CCC's `mol.*` | CCC already provides `mol.union`, `ccc.Entity.Base`, `@ccc.codec`. Custom codecs duplicate effort and diverge from ecosystem. | Use CCC's Molecule codecs exclusively. Already migrated from custom `mol.*` APIs. |
| **AF-3: UI/UX redesign during migration** | Interface app migration feels like a chance to modernize the UI | Conflates two concerns. UI redesign delays migration. The goal is to swap internals, not redesign the product. | Straight migration only: same components, same React Query patterns, swap Lumos for CCC+SDK. UI redesign is a separate future effort (out of scope). |
| **AF-4: Custom blockchain indexer** | Some CKB projects build custom indexers for better query performance | CCC's `findCells`/`findCellsOnChain` with built-in caching covers all current needs. Custom indexer adds massive operational complexity for marginal gain at iCKB's scale. | Use CCC's client cell queries with the existing filter patterns. The async generator pattern already provides efficient lazy evaluation. |
| **AF-5: Multi-chain / L2 token bridging** | RGB++ protocol enables cross-chain iCKB. Tempting to add bridging to the library. | Bridging requires fundamentally different architecture (BTC time locks, RGB++ lock scripts, different transaction patterns). Premature integration creates coupling. | Keep library focused on L1. Bridging is a separate concern that can compose with these packages. If RGB++ bridge is needed later, it should be a separate package. |
| **AF-6: Embedded wallet/signer management** | Some SDKs bundle wallet management (key storage, mnemonic handling) | CCC already provides comprehensive signer abstraction (`ccc.Signer`, `ccc.SignerCkbPrivateKey`, JoyId integration). Duplicating this creates security liability. | Delegate all signing to CCC's signer infrastructure. The SDK accepts `ccc.Signer` or `ccc.Script` -- it never manages keys. |
| **AF-7: Database/state persistence layer** | Bot and interface could benefit from persistent state (order history, balance cache) | All state is on-chain. Adding a database creates consistency problems (stale state vs chain state). The current stateless design is a feature, not a limitation. | Continue reading all state from L1 via CCC client. Pool snapshots (D-4) provide efficient state approximation without a database. |
| **AF-8: New reference/example apps** | More apps might help adoption | Existing 5 apps (bot, interface, faucet, sampler, tester) already demonstrate all library capabilities. Adding more dilutes maintenance focus. | Polish existing apps. They serve as living documentation. |
| **AF-9: CCC framework fork** | Tempting to fork CCC to get features faster | Forking creates maintenance burden and diverges from ecosystem. Upstream PRs are the correct approach. | Submit PRs upstream (already doing this with 12 merged). Track CCC PR #328 (FeePayer). Use `ccc-dev/` local build for testing changes before they land upstream. |
| **AF-10: On-chain contract changes** | Protocol improvements seem natural alongside library work | All contracts are deployed with zero-args locks (immutable, non-upgradable). Even if desirable, contract changes are impossible. | Library must match existing on-chain contract behavior exactly. All protocol rules are fixed. |

## Feature Dependencies

```
SmartTransaction Removal (TS-1)
    |
    +-- enables --> CCC Utility Deduplication (TS-2)
    |                   (deduplicate utilities after core restructuring)
    |
    +-- enables --> Clean Public API (TS-3)
    |                   (can't finalize API until SmartTransaction is gone)
    |
    +-- enables --> Bot Migration (TS-5)
    |                   (bot should migrate to final API, not intermediate)
    |
    +-- enables --> Interface Migration (TS-6)
    |                   (same reasoning)
    |
    +-- enables --> Tester Migration (TS-7)
    |                   (same reasoning)
    |
    +-- preserves --> Multi-representation UDT (D-1)
    |                   (UDT balance logic must survive removal)
    |
    +-- preserves --> Conversion Preview (D-3)
    |                   (estimation logic must survive removal)

CCC Udt Investigation (D-2)
    |
    +-- requires --> SmartTransaction Removal (TS-1)
    |                   (must understand new API shape first)
    |
    +-- informs --> Multi-representation UDT (D-1)
                        (whether to use Udt interface or custom)

Bot Migration (TS-5)
    |
    +-- requires --> SmartTransaction Removal (TS-1)
    +-- requires --> Clean Public API (TS-3)
    +-- validates --> All library packages

Interface Migration (TS-6)
    |
    +-- requires --> SmartTransaction Removal (TS-1)
    +-- requires --> Clean Public API (TS-3)

Lumos Removal (TS-4)
    |
    +-- requires --> Bot Migration (TS-5)
    +-- requires --> Interface Migration (TS-6)
    +-- requires --> Tester Migration (TS-7)

npm Publication (TS-11)
    |
    +-- requires --> Clean Public API (TS-3)
    +-- requires --> Type Exports (TS-12)
    +-- requires --> SmartTransaction Removal (TS-1)
```

### Dependency Notes

- **TS-1 (SmartTransaction Removal) is the critical path.** Every downstream task depends on it. It must happen first and must preserve D-1 (multi-representation UDT) and D-3 (conversion preview) functionality.
- **TS-5 (Bot Migration) validates the entire stack.** The bot exercises deposits, withdrawals, order matching, fee completion, and UDT balancing under real conditions. It is the integration test for the library suite.
- **TS-4 (Lumos Removal) is the final gate.** It can only happen after all three legacy apps are migrated. It removes `@ickb/lumos-utils`, `@ickb/v1-core`, and all `@ckb-lumos/*` from the monorepo.
- **D-2 (CCC Udt Investigation) is exploratory.** It should not block other work. Findings inform the API design of D-1 but the library can ship with a custom `UdtHandler` interface regardless.
- **CCC PR #328 (FeePayer) is external.** Track it but do not depend on it. Design the SmartTransaction replacement so that FeePayer can be adopted later if it merges.

## MVP Definition

### Launch With (v1)

Minimum viable state for npm publication of clean CCC-aligned library packages.

- [ ] **TS-1: SmartTransaction removal** -- Replace with utility functions on `ccc.Transaction`. This is the single most important task. All manager methods must accept `ccc.Transaction` instead of `SmartTransaction`.
- [ ] **TS-2: CCC utility deduplication** -- Adopt CCC equivalents for `max`/`min`/`gcd`/`isHex`/`hexFrom`.
- [ ] **TS-3: Clean public API** -- Audit exports, ensure intentional public surface, proper type exports.
- [ ] **TS-5: Bot migration** -- Validates the library packages work end-to-end under production conditions.
- [ ] **D-1: Multi-representation UDT preservation** -- Ensure `IckbUdtManager` functionality survives SmartTransaction removal.
- [ ] **TS-11: npm publication** -- Publish updated packages with clean API and provenance.

### Add After Validation (v1.x)

Features to add once core library packages are stable and published.

- [ ] **TS-6: Interface migration** -- Trigger: bot migration succeeds, proving the API works.
- [ ] **TS-7: Tester migration** -- Trigger: bot migration succeeds.
- [ ] **TS-4: Lumos removal** -- Trigger: all three legacy apps migrated.
- [ ] **D-2: CCC Udt investigation** -- Trigger: SmartTransaction removal complete, CCC UDT API stabilizes.
- [ ] **TS-12: Type export audit** -- Trigger: public API finalized.

### Future Consideration (v2+)

Features to defer until library suite is stable and adopted.

- [ ] **D-9: Upstream CCC contributions** -- Continue identifying reusable patterns. Track FeePayer PR #328.
- [ ] **Pool snapshot optimization** -- Improve compact encoding or move to a more structured format if bot requirements grow.
- [ ] **Additional UDT support** -- If other xUDT tokens need similar multi-representation handling, generalize the pattern.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| TS-1: SmartTransaction removal | HIGH | HIGH | **P1** |
| TS-2: CCC utility deduplication | MEDIUM | LOW | **P1** |
| TS-3: Clean public API | HIGH | MEDIUM | **P1** |
| TS-5: Bot migration | HIGH | HIGH | **P1** |
| D-1: Multi-representation UDT | HIGH | MEDIUM | **P1** |
| TS-11: npm publication | HIGH | LOW | **P1** |
| TS-6: Interface migration | HIGH | MEDIUM | **P2** |
| TS-7: Tester migration | MEDIUM | MEDIUM | **P2** |
| TS-4: Lumos removal | MEDIUM | LOW | **P2** |
| TS-12: Type export audit | MEDIUM | LOW | **P2** |
| D-2: CCC Udt investigation | MEDIUM | HIGH | **P2** |
| D-3: Conversion preview | HIGH | Already done | **--** |
| D-4: Pool snapshot | HIGH | Already done | **--** |
| D-5: Async generators | HIGH | Already done | **--** |
| D-6: ScriptDeps pattern | HIGH | Already done | **--** |
| D-7: Exchange rate | HIGH | Already done | **--** |
| D-8: Order lifecycle | HIGH | Already done | **--** |
| D-9: Upstream contributions | MEDIUM | Ongoing | **P3** |
| D-10: Owned-owner delegation | HIGH | Already done | **--** |

**Priority key:**
- P1: Must have -- blocks npm publication of clean CCC-aligned packages
- P2: Should have -- add after P1 validates the library stack
- P3: Nice to have -- ongoing improvement

## Competitor Feature Analysis

| Feature | NervDAO (CCC) | Lumos NervosDAO | CKB DEX SDK | iCKB Library Suite |
|---------|---------------|-----------------|-------------|-------------------|
| NervosDAO deposit/withdraw | Yes (UI only) | Yes (framework) | No | Yes (library + apps) |
| Liquid staking token | No | No | No | Yes (iCKB xUDT) |
| Multi-representation value | No | No | No | Yes (xUDT + receipts + deposits) |
| Limit order matching | No | No | Yes (generic) | Yes (iCKB-specific, integrated rate) |
| Exchange rate calculation | No | No | No | Yes (deterministic from headers) |
| Pool liquidity analysis | No | No | No | Yes (pool snapshots) |
| Maturity estimation | No | No | No | Yes (order fulfillment time) |
| CCC-native (no Lumos) | Yes | No (IS Lumos) | Partial | Yes (target state) |
| npm published | No (app only) | Yes | Yes | Yes (5 packages) |
| Delegated DAO withdrawals | No | No | No | Yes (owned-owner pattern) |
| Wallet abstraction | Yes (multi-wallet) | Yes (secp256k1) | Yes (multiple locks) | Yes (via CCC signers) |
| TypeScript strict mode | Unknown | No | Unknown | Yes (strictest settings) |

**Analysis:** The iCKB library suite has no direct competitor. NervDAO is a UI application, not a library. Lumos is a general framework being superseded by CCC. CKB DEX SDK handles generic order matching but not protocol-specific logic. The iCKB suite is the only npm-published library that provides NervosDAO liquid staking with multi-representation UDT handling, integrated exchange rates, and limit order matching -- all built on the modern CCC framework.

## Sources

- Codebase analysis: `packages/*/src/*.ts` (direct reading) -- HIGH confidence
- CCC GitHub repository: [ckb-devrel/ccc](https://github.com/ckb-devrel/ccc) -- HIGH confidence
- CCC documentation: [docs.ckbccc.com](https://docs.ckbccc.com/) -- HIGH confidence
- CCC UDT package: [ckb-devrel/ccc/packages/udt](https://github.com/ckb-devrel/ccc/tree/master/packages/udt) -- MEDIUM confidence (limited docs)
- CCC FeePayer PR: [ckb-devrel/ccc/pull/328](https://github.com/ckb-devrel/ccc/pull/328) -- MEDIUM confidence (open PR, subject to change)
- NervDAO: [ckb-devrel/nervdao](https://github.com/ckb-devrel/nervdao) -- MEDIUM confidence
- @ickb/utils on npm: [npmjs.com/@ickb/utils](https://www.npmjs.com/package/@ickb/utils/v/1000.0.42?activeTab=versions) -- HIGH confidence
- iCKB protocol overview: [nervos.org/knowledge-base/Unlocking_CKB_Liquidity_iCKB](https://www.nervos.org/knowledge-base/Unlocking_CKB_Liquidity_iCKB) -- HIGH confidence
- Nervos CKB docs: [docs.nervos.org](https://docs.nervos.org/) -- HIGH confidence
- CKB DEX SDK: [nervina-labs/ckb-dex-sdk](https://github.com/nervina-labs/ckb-dex-sdk) -- MEDIUM confidence
- Enhanced UDT Standard discussion: [Nervos Talk](https://talk.nervos.org/t/enhanced-udt-standard/8354) -- LOW confidence (discussion, not specification)

---
*Feature research for: CCC-based iCKB protocol library suite*
*Researched: 2026-02-21*
