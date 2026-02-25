# iCKB Stack v2

## What This Is

A CCC-based TypeScript library suite and reference apps for interacting with the on-chain iCKB protocol (NervosDAO liquidity via pooled deposits and iCKB xUDT tokens). The library packages (`@ickb/utils`, `@ickb/dao`, `@ickb/order`, `@ickb/core`, `@ickb/sdk`) provide the building blocks; the apps (`bot`, `interface`, `faucet`, `sampler`, `tester`) demonstrate usage and run protocol operations.

## Core Value

Clean, CCC-aligned library packages published to npm that frontends can depend on to interact with iCKB contracts — no Lumos, no abandoned abstractions, no duplicated functionality with CCC.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ CCC-based package structure (`@ickb/utils`, `@ickb/dao`, `@ickb/order`, `@ickb/core`, `@ickb/sdk`) — existing
- ✓ Manager pattern with `ScriptDeps` interface for composability — existing
- ✓ Async generator cell discovery with lazy evaluation — existing
- ✓ Molecule codec integration with CCC's `mol.union`, `ccc.Entity.Base`, `@ccc.codec` — existing
- ✓ Epoch class adopted from CCC (local Epoch deleted) — existing
- ✓ Faucet and sampler apps migrated to CCC — existing

### Active

- [ ] Remove SmartTransaction — replace with `ccc.Transaction` + utility functions
- [ ] Adopt CCC UDT handling — investigate subclassing `Udt` for iCKB's multi-representation value (xUDT + receipts + deposits)
- [ ] Systematic CCC alignment audit — replace local utilities with CCC equivalents from merged upstream PRs
- [ ] Migrate bot app from Lumos to CCC + new packages
- [ ] Migrate interface app from Lumos to CCC + new packages (straight swap, same UI)
- [ ] Migrate tester app from Lumos to CCC + new packages
- [ ] Remove all Lumos dependencies (`@ckb-lumos/*`, `@ickb/lumos-utils`, `@ickb/v1-core`)
- [ ] Clean APIs suitable for npm publication
- [ ] Identify reusable patterns that could become CCC upstream PRs
- [ ] Track CCC PR #328 (FeePayer) — potential CCC-native replacement for SmartTransaction's fee/balancing role

### Out of Scope

- UI/UX redesign for interface app — straight migration only
- New reference/example apps — existing apps serve as reference
- On-chain contract changes — contracts are immutable and non-upgradable
- Mobile app — web-first
- CCC framework changes — we adopt CCC, not fork it (PRs go upstream)

## Context

**Protocol:** iCKB tokenizes NervosDAO deposits. CKB deposited into NervosDAO is locked for ~30 days. iCKB represents that locked value as a liquid xUDT token. Key invariant: `Input UDT + Input Receipts = Output UDT + Input Deposits`. All contracts are deployed with zero-args locks (immutable, trustless).

**iCKB UDT particularity:** iCKB value has three on-chain representations: (1) xUDT tokens (standard UDT), (2) receipt cells (pending conversion), (3) DAO deposit cells (locked CKB). CCC's `Udt` class only understands form (1). The relationship between all three forms is governed by the conservation law enforced by the `ickb_logic` type script. This makes CCC UDT adoption non-trivial — subclassing `Udt` to account for all three representations is a key design investigation.

**SmartTransaction history:** `SmartTransaction` extends `ccc.Transaction` with UDT handler management and fee/change completion. The concept was proposed as an ecosystem-wide pattern but abandoned due to no adoption from CCC maintainers or other projects. The class itself still works and is used by all 5 library packages. Replacement: utility functions operating on plain `ccc.Transaction`.

**CCC upstream contributions:** 12 PRs authored by this project's maintainer have been merged into CCC, covering: `shouldAddInputs` for completeFee (#225), `findCellsOnChain` (#258), auto capacity completion (#259), optimized completeFee (#260), UDT balance utilities (#228), multiple scripts for SignerCkbScriptReadonly (#265), `CellAny` type (#262), `reduce`/`reduceAsync` (#267), fixed-size mol union (#174), Epoch class (#314), UDT info querying (#261), `bytesLen`/`bytesLenUnsafe` (#353). PR #328 (FeePayer abstraction) is still open.

**Local utility overlap with CCC core:** Several local utilities now have CCC equivalents that should be adopted: `gcd()`, `isHex()`, `hexFrom()`, `max()`/`min()` (use `numMax`/`numMin`). Utilities unique to iCKB (no CCC equivalent): `binarySearch()`, `asyncBinarySearch()`, `shuffle()`, `unique()`, `collect()`, `BufferedGenerator`, `MinHeap`.

**Migration status:** Library packages are on CCC. Apps split: faucet/sampler already migrated; bot/interface/tester still on legacy Lumos (`@ckb-lumos/*`, `@ickb/lumos-utils@1.4.2`, `@ickb/v1-core@1.4.2`).

**Local CCC dev build:** `forks/ccc/` supports using local CCC builds for testing. `.pnpmfile.cjs` transparently rewires `@ckb-ccc/*` to local packages. `forks/forker/patch.sh` rewrites exports to `.ts` source. This enables testing upstream changes before they're published.

## Constraints

- **On-chain contracts**: Immutable — library must match existing contract behavior exactly
- **CCC compatibility**: Must work with `@ckb-ccc/core ^1.12.2` (catalog-pinned)
- **Node.js**: >= 24 (enforced via engines)
- **Package manager**: pnpm 10.30.1 (pinned with SHA-512)
- **TypeScript**: Strict mode with `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `noImplicitOverride`
- **Versioning**: All packages use `1001.0.0` (Epoch Semantic Versioning), managed by changesets
- **Publishing**: npm with `access: public` and `provenance: true`

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Remove SmartTransaction, use ccc.Transaction directly | SmartTransaction concept abandoned by ecosystem, no adoption from CCC maintainers | — Pending |
| Investigate CCC Udt subclassing for iCKB | iCKB value is multi-representation (xUDT + receipts + deposits); need to determine if CCC's Udt can be extended | — Pending |
| Library refactor before app migration | Clean packages first, then migrate apps on stable foundation | — Pending |
| Interface app: straight migration only | No UI/UX redesign — swap Lumos internals for CCC packages | — Pending |
| Track CCC PR #328 (FeePayer) | Could become CCC-native solution for what SmartTransaction does for fee completion | — Pending |

---
*Last updated: 2026-02-20 after initialization*
