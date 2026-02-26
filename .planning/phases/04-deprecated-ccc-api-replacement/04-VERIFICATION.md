---
phase: 04-deprecated-ccc-api-replacement
verified: 2026-02-26T12:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 4: Deprecated CCC API Replacement — Verification Report

**Phase Goal:** UdtHandler dependency in @ickb/order is replaced with plain ccc.Script (udtScript); UDT cellDeps management removed from OrderManager (caller/CCC Udt handles externally during balance completion); @ickb/dao verified clean (no UdtHandler, no deprecated APIs); Phase 3 decision doc corrected to match actual codebase state
**Verified:** 2026-02-26T12:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | OrderManager constructor accepts `udtScript: ccc.Script` as its third parameter | VERIFIED | `packages/order/src/order.ts` line 26: `public readonly udtScript: ccc.Script,` |
| 2 | OrderManager methods do not add UDT cellDeps to transactions | VERIFIED | No `tx.addCellDeps(this.udtHandler.cellDeps)` in order.ts; grep returns exit 1 (no matches) |
| 3 | @ickb/order does not import UdtHandler from @ickb/utils | VERIFIED | Import block at top of order.ts has no `UdtHandler`; `grep -r "UdtHandler" packages/order/src/` returns exit 1 |
| 4 | SDK constructs OrderManager with ickbUdt.script (a ccc.Script), not full IckbUdtManager instance | VERIFIED | `packages/sdk/src/constants.ts` line 78: `new OrderManager(d.order.script, d.order.cellDeps, ickbUdt.script)` |
| 5 | pnpm check:full passes with zero errors | VERIFIED | `pnpm check` exit code 0; lint, build, test all pass; only warnings are chunk size and missing codec exports (pre-existing, unrelated to Phase 4) |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/order/src/order.ts` | OrderManager with udtScript: ccc.Script parameter, no UDT cellDeps | VERIFIED | Contains `public readonly udtScript: ccc.Script` at line 26; no `udtHandler` references; @remarks JSDoc on mint (line 162), addMatch (line 218), melt (line 499) |
| `packages/sdk/src/constants.ts` | SDK caller passing ickbUdt.script to OrderManager | VERIFIED | Line 78: `new OrderManager(d.order.script, d.order.cellDeps, ickbUdt.script)` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/sdk/src/constants.ts` | `packages/order/src/order.ts` | OrderManager constructor call | VERIFIED | Line 78 matches pattern `new OrderManager(.*ickbUdt\.script)` |
| `packages/order/src/order.ts` | `@ckb-ccc/core` | ccc.Script type for udtScript | VERIFIED | Line 26: `udtScript: ccc.Script`; imports `ccc` from `@ckb-ccc/core` at line 1 |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SMTX-05 | 04-01-PLAN.md | UDT handler registration replaced by direct Udt instance usage or standalone utility functions | PARTIAL (Phase 4 contribution verified) | Phase 4 scope: OrderManager.udtHandler replaced with udtScript: ccc.Script, UDT cellDeps removed (caller responsibility). Per REQUIREMENTS.md traceability, SMTX-05 spans Phases 1, 4, and 5. Phase 4's portion is fully delivered. Final completion awaits Phase 5 (UdtHandler/UdtManager deletion from @ickb/utils). |

**Note on SMTX-05 scope:** The requirement spans three phases. Phase 4 owns the OrderManager portion only. `UdtHandler` interface and `UdtManager` class intentionally remain in `@ickb/utils` and `@ickb/core` — their deletion is Phase 5 work. The REQUIREMENTS.md traceability table and the Phase 3 decision doc both confirm this split. No orphaned requirements found.

---

### Supplementary Verifications

**@ickb/dao clean check:**
- `grep -r "UdtHandler|udtHandler" packages/dao/src/` — exit 1 (no matches). Clean.
- `grep -r "udtBalanceFrom|getInputsUdtBalance|getOutputsUdtBalance|completeInputsByUdt" packages/dao/src/` — exit 1 (no matches). Clean.

**Phase 3 decision doc correction:**
- `03-DECISION.md` line 373 contains: `*Updated 2026-02-26 based on Phase 4 discuss-phase. See 04-CONTEXT.md for full decisions.*`
- Line 266 references `udtScript: ccc.Script (Phase 4)` in the change table.
- Line 378 states `udtHandler: UdtHandler replaced with udtScript: ccc.Script`.
- Correction is present and accurate.

**Commit verification:**
- Commit `9e6e3d8` exists: `feat(04-01): replace UdtHandler with udtScript in OrderManager`
- Modified files: `packages/order/src/order.ts` and `packages/sdk/src/constants.ts` — exactly the planned files.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/order/src/order.ts` | 33 | JSDoc still says "UDT handler's script" in `isOrder()` description | Info | Cosmetic only — code uses `this.udtScript` correctly; JSDoc description is stale prose, not a stub |
| `packages/order/src/order.ts` | 534 | JSDoc says "lock-script cells matching order & UDT handler" in `findOrders()` | Info | Cosmetic only — implementation uses `this.udtScript` correctly at line 637 |

Neither anti-pattern affects correctness or the phase goal. Both are stale JSDoc prose from before the refactor.

---

### Human Verification Required

None. All phase goals are verifiable programmatically:
- Parameter type changes are statically verified by TypeScript (pnpm check passes).
- cellDeps calls are verifiable by grep.
- SDK wiring is verifiable by grep.
- Phase 3 decision doc correction is verifiable by grep.

---

### Summary

Phase 4 goal is fully achieved. Every must-have truth is verified against the actual codebase:

1. `OrderManager` constructor parameter is `udtScript: ccc.Script` — confirmed in source.
2. All three `tx.addCellDeps(this.udtHandler.cellDeps)` calls are removed from `mint()`, `addMatch()`, `melt()` — grep returns no matches.
3. `UdtHandler` import is absent from `@ickb/order` — grep returns no matches across the entire `packages/order/src/` directory.
4. SDK passes `ickbUdt.script` (not `ickbUdt`) to the OrderManager constructor — confirmed at constants.ts line 78.
5. `pnpm check` passes with exit code 0, confirming TypeScript type safety across all 5 library packages.

The presence of `UdtHandler` in `@ickb/utils` and `@ickb/core` is expected and intentional — those are deferred to Phase 5 per the roadmap and REQUIREMENTS.md traceability.

Two stale JSDoc strings (lines 33 and 534 of order.ts) describe the old "UDT handler" concept — these are cosmetic and do not affect goal achievement.

SMTX-05 is "In Progress" spanning Phases 1, 4, and 5. Phase 4's contribution (OrderManager refactor) is complete. Phase 5 will complete it by deleting `UdtHandler`/`UdtManager` from `@ickb/utils`.

---

_Verified: 2026-02-26T12:00:00Z_
_Verifier: AI Coworker (gsd-verifier)_
