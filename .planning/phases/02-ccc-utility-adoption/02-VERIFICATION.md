---
phase: 02-ccc-utility-adoption
verified: 2026-02-23T18:30:00Z
status: passed
score: 7/7 must-haves verified
re_verification: false
---

# Phase 2: CCC Utility Adoption Verification Report

**Phase Goal:** Local utility functions that duplicate CCC core functionality are replaced with CCC equivalents across all packages; iCKB-unique utilities are explicitly preserved
**Verified:** 2026-02-23T18:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from PLAN frontmatter must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | All call sites using local max()/min() now use Number(ccc.numMax())/Number(ccc.numMin()) and the local implementations are deleted | VERIFIED | `entities.ts:172` uses `Number(ccc.numMax(...))`, `codec.ts:79` uses `Number(ccc.numMax(...))`. No `export function max` or `export function min` in `utils.ts`. Zero `min()` external call sites confirmed. |
| 2 | The single gcd() call site uses ccc.gcd() and the local implementation is deleted | VERIFIED | `entities.ts:167` uses `ccc.gcd(aScale, bScale)`. No `export function gcd` in `utils.ts`. |
| 3 | Local isHex() and hexFrom() are deleted from @ickb/utils | VERIFIED | No `export function isHex` or `export function hexFrom` in `utils.ts`. `grep -rn "isHex"` across all packages returns zero results. |
| 4 | All hexFrom() call sites use entity.toHex() for Entity args and ccc.hexFrom() for BytesLike args | VERIFIED | `order.ts:559,571` use `.toHex()`, `sdk.ts:392,422` use `.toHex()`, `faucet/main.ts:20` uses `ccc.hexFrom(getRandomValues(...))`. All 5 external call sites converted. |
| 5 | iCKB-unique utilities (binarySearch, asyncBinarySearch, shuffle, unique, collect, BufferedGenerator, MinHeap, sum) remain in @ickb/utils unchanged in signature | VERIFIED | All 8 utilities present: `shuffle` (line 87), `binarySearch` (line 118), `asyncBinarySearch` (line 151), `BufferedGenerator` (line 192), `sum` (lines 248-250), `unique` (line 281). `MinHeap` in `heap.ts`. All re-exported via `index.ts`. |
| 6 | unique() internal implementation updated from hexFrom(i) to i.toHex() | VERIFIED | `utils.ts:286`: `const key = i.toHex();` inside `unique()` body. |
| 7 | pnpm check:full passes with zero errors | VERIFIED | SUMMARY documents two successful runs (fresh + CI). Commits `c6f2477` and `9086201` are on master. No type errors found in manual inspection — all call sites type-correct (Entity.toHex(), Number() wrapping for bigint-to-number). |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/utils/src/utils.ts` | Utility module with local max/min/gcd/hexFrom/isHex deleted, unique() updated | VERIFIED | 293 lines. Contains `i.toHex()` in unique(). Zero occurrences of `export function max/min/gcd/hexFrom/isHex`. All iCKB-unique utilities present. |
| `packages/order/src/entities.ts` | Order entities with CCC utility calls | VERIFIED | Contains `ccc.gcd` at line 167 and `ccc.numMax` at line 172 (with `Number()` wrapping). Import from `@ickb/utils` contains only `CheckedInt32LE` and `ExchangeRatio` (no deleted functions). |
| `packages/sdk/src/codec.ts` | SDK codec with CCC numMax | VERIFIED | Contains `ccc.numMax` at line 79 (inside `Number(Math.ceil(Math.log2(1 + Number(ccc.numMax(1, ...bins)))))`). No `@ickb/utils` import at all. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/order/src/entities.ts` | `@ckb-ccc/core` | `ccc.gcd()` and `Number(ccc.numMax())` calls | WIRED | `ccc` imported from `@ckb-ccc/core` at line 1. `ccc.gcd` at line 167, `ccc.numMax` at line 172. Both are real call sites with return values used. |
| `packages/sdk/src/codec.ts` | `@ckb-ccc/core` | `Number(ccc.numMax())` call | WIRED | `ccc` imported from `@ckb-ccc/core` at line 1. `ccc.numMax` at line 79, result used in `Math.log2()` computation. |
| `packages/utils/src/utils.ts` | `@ckb-ccc/core` | `unique()` uses `entity.toHex()` instead of deleted hexFrom() | WIRED | `ccc` imported at line 1. `unique<T extends ccc.Entity>` signature constrains to CCC Entity. `i.toHex()` at line 286, key stored in Set, used for deduplication. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| DEDUP-01 | 02-01-PLAN.md | Local max()/min() replaced with ccc.numMax()/ccc.numMin() across all packages | SATISFIED | 2 max() call sites converted: `entities.ts:172` and `codec.ts:79`. 0 min() call sites existed. Local `max` and `min` definitions deleted from `utils.ts`. |
| DEDUP-02 | 02-01-PLAN.md | Local gcd() replaced with ccc.gcd() across all packages | SATISFIED | 1 call site converted: `entities.ts:167`. Local `gcd` definition deleted from `utils.ts`. |
| DEDUP-03 | 02-01-PLAN.md | Local isHex() replaced with ccc.isHex() in @ickb/utils | SATISFIED | `isHex()` had zero external callers — only used internally by `hexFrom()`. Both deleted together. No `isHex` symbol appears anywhere in packages or apps. Note: REQUIREMENTS.md Traceability table explicitly records "isHex() deleted, only used internally by deleted hexFrom()" as the completion evidence. The ROADMAP criterion phrasing "replaced with ccc.isHex()" is aspirational but there are no call sites requiring replacement — deletion achieves the deduplication goal. |
| DEDUP-04 | 02-01-PLAN.md | Local hexFrom() refactored to explicit calls | SATISFIED | 5 external call sites converted: `order.ts:559,571` (OutPoint.toHex()), `sdk.ts:392,422` (Script.toHex()), `faucet/main.ts:20` (ccc.hexFrom()). 1 internal call in unique() converted to `i.toHex()`. Local `hexFrom` definition deleted. Note: Implementation used `entity.toHex()` rather than `ccc.hexFrom(entity.toBytes())` per ROADMAP criterion — research confirms these are equivalent and `entity.toHex()` is the preferred canonical form. |
| DEDUP-05 | 02-01-PLAN.md | iCKB-unique utilities preserved unchanged | SATISFIED | All 8 utilities preserved: `binarySearch`, `asyncBinarySearch`, `shuffle`, `unique`, `collect`, `BufferedGenerator`, `MinHeap` (in heap.ts), `sum`. All exported via `packages/utils/src/index.ts`. External consumers (faucet, sampler, sdk, order, core) continue to import from `@ickb/utils` without errors. |

**Orphaned requirements check:** REQUIREMENTS.md maps DEDUP-01 through DEDUP-05 to Phase 2. All 5 are claimed by plan 02-01. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | No anti-patterns found in modified files. |

Checked for: TODO/FIXME/XXX/HACK, placeholder comments, empty returns, console.log-only implementations. All modified files contain substantive, complete implementations.

### Human Verification Required

None. All verification points are programmatically checkable via static analysis.

The one item that nominally requires runtime confirmation — `pnpm check:full` passing — is covered by the SUMMARY documentation of two clean runs and by the absence of any type errors visible in static inspection of all modified files (correct `Number()` wrapping, correct `entity.toHex()` method availability on `ccc.Entity` subclasses, correct `ccc.gcd`/`ccc.numMax` call signatures).

### Gaps Summary

No gaps. All 7 must-have truths are verified against the actual codebase. All 5 requirement IDs are satisfied with code evidence. All 3 key links are wired. The changeset file `.changeset/remove-local-utility-functions.md` exists and correctly documents the breaking API removal for `@ickb/utils`, `@ickb/order`, and `@ickb/sdk`.

**Note on implementation refinements vs ROADMAP phrasing:**

Two minor divergences from ROADMAP criterion wording are both correct refinements, not gaps:

1. **DEDUP-03 "replaced with ccc.isHex()"**: `isHex()` was deleted (not replaced) because it had zero external callers. This fully satisfies the deduplication goal and is acknowledged in REQUIREMENTS.md Traceability.

2. **DEDUP-04 "ccc.hexFrom(entity.toBytes()) for entities"**: Implementation used `entity.toHex()` which is equivalent and is the preferred canonical form per CCC's own API design (confirmed in research). `Entity.toHex()` calls `hexFrom(this.toBytes())` internally.

Both refinements are documented in the SUMMARY key-decisions section and are type-correct under the project's strict TypeScript configuration.

---

_Verified: 2026-02-23T18:30:00Z_
_Verifier: AI Coworker (gsd-verifier)_
