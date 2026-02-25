# Phase 2: CCC Utility Adoption - Research

**Researched:** 2026-02-23
**Domain:** CCC utility function alignment / deduplication
**Confidence:** HIGH

## Summary

Phase 2 replaces five local utility functions in `@ickb/utils` (`max`, `min`, `gcd`, `isHex`, `hexFrom`) with their CCC equivalents, then deletes the local implementations. The CCC equivalents (`ccc.numMax`, `ccc.numMin`, `ccc.gcd`, `ccc.isHex`, `ccc.numToHex`, `ccc.hexFrom`) are all verified to exist in the CCC core barrel at `@ckb-ccc/core` (verified against `forks/ccc/packages/core/src/`).

The main complexity is that the replacements are not all 1:1 drop-ins. The local `max()`/`min()` is generic `<T>` and both current call sites pass `number` (not `bigint`), while `ccc.numMax()`/`ccc.numMin()` return `bigint`. The local `hexFrom()` accepts `bigint | Entity | BytesLike`, while CCC's `hexFrom()` only accepts `HexLike` (= `BytesLike`). All external `hexFrom` call sites pass `ccc.Entity` instances, which have a `.toHex()` method that produces the same result. The `gcd` and `isHex` replacements are straightforward. Seven iCKB-unique utilities are confirmed to have no CCC equivalents and remain unchanged.

**Primary recommendation:** Execute as a single plan: replace all call sites in one pass, delete all five local functions, verify with `pnpm check:full`. The total change footprint is small (~15 call sites across 5 files plus the utility definitions).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DEDUP-01 | Local `max()`/`min()` replaced with `ccc.numMax()`/`ccc.numMin()` across all packages | Two `max()` call sites found: `order/entities.ts:172` (number type, bit-length comparison) and `sdk/codec.ts:80` (number type, bin max). Zero `min()` external call sites. CCC `numMax`/`numMin` accept `NumLike` and return `Num` (bigint); `number` call sites need `Number()` wrapping or `Math.max()` fallback -- see Type Mismatch pitfall below |
| DEDUP-02 | Local `gcd()` replaced with `ccc.gcd()` across all packages | One call site: `order/entities.ts:167`, passes exactly 2 `bigint` args. CCC `gcd(a: NumLike, b: NumLike): Num` is a direct drop-in. Local variadic signature unused beyond 2 args |
| DEDUP-03 | Local `isHex()` replaced with `ccc.isHex()` in `@ickb/utils` | Local `isHex` has zero external callers (only used internally by local `hexFrom`). CCC `isHex(v: unknown): v is Hex` is behaviorally equivalent. Delete local `isHex` and replace the one internal usage |
| DEDUP-04 | Local `hexFrom()` refactored to explicit calls | Five external call sites in 3 files plus one internal call in `unique()`. All external calls pass `ccc.Entity` instances -- use `entity.toHex()`. One app call site (`faucet/main.ts`) passes `Uint8Array` -- use `ccc.hexFrom()`. The `unique()` internal call passes `ccc.Entity` -- use `i.toHex()`. No external call sites pass `bigint`, so `ccc.numToHex()` is not needed at any current call site |
| DEDUP-05 | iCKB-unique utilities preserved unchanged | Confirmed no CCC equivalents for: `binarySearch`, `asyncBinarySearch`, `shuffle`, `unique`, `collect`, `BufferedGenerator`, `MinHeap`, `sum`. All remain in `@ickb/utils`. Note: `unique()` internally uses local `hexFrom` -- must update its internals to use `entity.toHex()` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@ckb-ccc/core` | ^1.12.2 (catalog-pinned) | CCC core -- provides `numMax`, `numMin`, `gcd`, `isHex`, `hexFrom`, `numToHex` | All replacement functions live here; already a dependency of every package |

### Supporting
No additional libraries needed. This phase only rearranges existing imports.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ccc.numMax()` for `number` call sites | `Math.max()` | `Math.max()` is native JS, avoids bigint conversion; `ccc.numMax()` requires `Number()` wrap for number-typed contexts. See DEDUP-01 type mismatch analysis |

**Installation:** No new packages needed.

## Architecture Patterns

### Pattern 1: Entity-to-Hex via `.toHex()` Method
**What:** CCC `Entity` base class provides a `toHex()` method that calls `hexFrom(this.toBytes())` internally. This is the canonical way to get a hex string from any CCC entity.
**When to use:** Anywhere the local `hexFrom(entity)` was used with a `ccc.Entity` argument.
**Example:**
```typescript
// Source: forks/ccc/packages/core/src/codec/entity.ts:135-137
// Before (local hexFrom):
const key = hexFrom(cell.cellOutput.lock);

// After (Entity.toHex()):
const key = cell.cellOutput.lock.toHex();
```

### Pattern 2: Direct CCC Import Replacement
**What:** Replace `import { fn } from "@ickb/utils"` with `ccc.fn()` calls, since CCC is already imported as `import { ccc } from "@ckb-ccc/core"` in every file.
**When to use:** For `gcd`, where the CCC equivalent is a direct function call.
**Example:**
```typescript
// Source: forks/ccc/packages/core/src/utils/index.ts:276-285
// Before:
import { gcd } from "@ickb/utils";
const g = gcd(aScale, bScale);

// After:
const g = ccc.gcd(aScale, bScale);
// Remove gcd from @ickb/utils import
```

### Pattern 3: Handling the max/min Number-vs-BigInt Gap
**What:** CCC's `numMax`/`numMin` return `bigint`, but call sites use `number` arithmetic. For number-typed contexts, use `Math.max()`/`Math.min()` directly to avoid unnecessary `number→bigint→number` round-trips.
**When to use:** When replacing `max()`/`min()` at `number`-typed call sites.
**Example:**
```typescript
// entities.ts -- call site uses number context, arguments are .length (number)
// Before:
const maxBitLen = max(aScale.toString(2).length, bScale.toString(2).length);
if (maxBitLen > 64) {
  const shift = BigInt(maxBitLen - 64);

// After -- use Math.max() directly since all args and consumers are number-typed:
const maxBitLen = Math.max(aScale.toString(2).length, bScale.toString(2).length);
if (maxBitLen > 64) {
  const shift = BigInt(maxBitLen - 64);
```

```typescript
// codec.ts -- Math.ceil/Math.log2 require number, bins are number[]
// Before:
return Math.ceil(Math.log2(1 + max(1, ...bins)));

// After:
return Math.ceil(Math.log2(1 + Math.max(1, ...bins)));
```

### Anti-Patterns to Avoid
- **Replacing `hexFrom(entity)` with `ccc.hexFrom(entity)`**: CCC's `hexFrom` does NOT accept `Entity` -- it only accepts `HexLike` (`BytesLike`). Must use `entity.toHex()` or `ccc.hexFrom(entity.toBytes())`.
- **Assuming `numMax`/`numMin` returns `number`**: They return `bigint`. Every call site in `number` context needs explicit `Number()` conversion.
- **Removing `sum()` or other iCKB-unique utilities**: `sum` is not listed in DEDUP-05 explicitly but has no CCC equivalent and must be preserved.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Numeric max/min for bigint | Local generic `max<T>`/`min<T>` | `ccc.numMax()`/`ccc.numMin()` | CCC handles `NumLike` input coercion, already tested |
| GCD calculation | Local `gcd()` | `ccc.gcd()` | CCC version handles negative numbers and `NumLike` coercion |
| Hex validation | Local `isHex()` | `ccc.isHex()` | CCC version accepts `unknown`, serves as proper type guard |
| Bytes-to-hex conversion | Local `hexFrom()` for `BytesLike` | `ccc.hexFrom()` | CCC version is the canonical implementation |
| Entity-to-hex conversion | Local `hexFrom()` for `Entity` | `entity.toHex()` | Method on the entity itself, avoids type-incompatible wrapper |
| BigInt-to-hex conversion | Local `hexFrom()` for `bigint` | `ccc.numToHex()` | CCC version validates non-negative, returns `0x`-prefixed hex |

**Key insight:** All five local functions were originally written before CCC provided equivalents. Now that CCC has them, maintaining local copies is pure duplication that diverges over time.

## Common Pitfalls

### Pitfall 1: Type Mismatch on numMax/numMin Return
**What goes wrong:** `ccc.numMax()` returns `bigint` but call sites expect `number`. TypeScript will error on arithmetic with `Math.ceil`, `Math.log2`, or numeric comparison without explicit conversion.
**Why it happens:** The local `max<T>` is generic over any comparable type; CCC's `numMax` is bigint-specific.
**How to avoid:** Use `Math.max()`/`Math.min()` for pure `number` contexts to avoid unnecessary `number→bigint→number` round-trips. Reserve `ccc.numMax()`/`ccc.numMin()` for `bigint`-typed contexts where they are a natural fit.
**Warning signs:** TypeScript errors like "Type 'bigint' is not assignable to type 'number'" at the two `max` call sites.

### Pitfall 2: Forgetting to Update `unique()` Internal Call
**What goes wrong:** `unique()` in `@ickb/utils` calls local `hexFrom(i)` internally. If `hexFrom` is deleted but `unique()` isn't updated, it breaks.
**Why it happens:** `unique()` is listed in DEDUP-05 as "preserved unchanged", but its implementation depends on local `hexFrom`.
**How to avoid:** Update `unique()`'s internal call from `hexFrom(i)` to `i.toHex()`. The function's external behavior and signature remain unchanged (satisfying DEDUP-05), but the implementation detail changes.
**Warning signs:** Compile error in `utils.ts` after deleting `hexFrom`.

### Pitfall 3: App Code Using Local hexFrom
**What goes wrong:** `apps/faucet/src/main.ts` imports `hexFrom` from `@ickb/utils`. Deleting it breaks the app.
**Why it happens:** The faucet app is already migrated to CCC but still uses local `hexFrom` for `Uint8Array` conversion.
**How to avoid:** Update `apps/faucet/src/main.ts` to use `ccc.hexFrom(getRandomValues(new Uint8Array(32)))` directly.
**Warning signs:** Import error in faucet app after deletion.

### Pitfall 4: Breaking Public API Without Changeset
**What goes wrong:** `hexFrom`, `isHex`, `max`, `min`, `gcd` are all public exports from `@ickb/utils`. Deleting them is a breaking API change.
**Why it happens:** `export * from "./utils.js"` re-exports everything.
**How to avoid:** Generate a changeset entry documenting the removal. The project uses Epoch Semantic Versioning at `1001.0.0`, so this is expected.
**Warning signs:** Missing changeset in PR.

### Pitfall 5: CCC gcd() Is Binary, Not Variadic
**What goes wrong:** Local `gcd(res: bigint, ...rest: bigint[])` accepts any number of arguments. CCC's `gcd(a: NumLike, b: NumLike)` takes exactly two.
**Why it happens:** Different API design -- CCC chose binary.
**How to avoid:** The single existing call site already passes exactly 2 args: `gcd(aScale, bScale)`. No issue for current code. If a future call site needs variadic GCD, it would need `reduce`.
**Warning signs:** TypeScript arity error if any missed call site passes 3+ args (none exist today).

## Code Examples

Verified patterns from CCC source (`forks/ccc/packages/core/src/`):

### numMax / numMin (from num/index.ts:30-62)
```typescript
// Signature: ccc.numMax(a: NumLike, ...numbers: NumLike[]): Num
// Signature: ccc.numMin(a: NumLike, ...numbers: NumLike[]): Num
// Returns: bigint (Num)

// For number-typed contexts, use Math.max() directly (avoids number→bigint→number round-trip):
const maxBitLen = Math.max(aScale.toString(2).length, bScale.toString(2).length);
```

### gcd (from utils/index.ts:276-285)
```typescript
// Signature: ccc.gcd(a: NumLike, b: NumLike): Num
// Returns: bigint (Num)
// Handles negative inputs (takes absolute value)

const g = ccc.gcd(aScale, bScale);
```

### isHex (from hex/index.ts:27-39)
```typescript
// Signature: ccc.isHex(v: unknown): v is Hex
// Validates: starts with "0x", even length, chars 0-9 a-f

if (ccc.isHex(someValue)) {
  // someValue is typed as ccc.Hex
}
```

### hexFrom (from hex/index.ts:53-60)
```typescript
// Signature: ccc.hexFrom(hex: HexLike): Hex
// Accepts: string, Uint8Array, ArrayBuffer, number[]
// Does NOT accept: bigint, Entity

const hex = ccc.hexFrom(new Uint8Array([1, 2, 3])); // "0x010203"
```

### numToHex (from num/index.ts:113-119)
```typescript
// Signature: ccc.numToHex(val: NumLike): Hex
// Returns: "0x" + bigint.toString(16)
// Throws if negative
// NOTE: may produce odd-length hex (e.g., "0xa" for 10)

const hex = ccc.numToHex(255n); // "0xff"
```

### Entity.toHex() (from codec/entity.ts:135-137)
```typescript
// Method on any Entity subclass (Script, OutPoint, etc.)
// Equivalent to hexFrom(entity.toBytes())

const hex = cell.cellOutput.lock.toHex();  // Script -> Hex
const hex2 = outPoint.toHex();              // OutPoint -> Hex
```

## Complete Call Site Inventory

### `max()` (2 external call sites, 0 `min()` external call sites)

| File | Line | Usage | Type | Replacement |
|------|------|-------|------|-------------|
| `packages/order/src/entities.ts` | 172 | `max(aScale.toString(2).length, bScale.toString(2).length)` | `number` | `Math.max(...)` |
| `packages/sdk/src/codec.ts` | 80 | `max(1, ...bins)` | `number` | `Math.max(1, ...bins)` |

### `gcd()` (1 external call site)

| File | Line | Usage | Type | Replacement |
|------|------|-------|------|-------------|
| `packages/order/src/entities.ts` | 167 | `gcd(aScale, bScale)` | `bigint` | `ccc.gcd(aScale, bScale)` |

### `isHex()` (0 external call sites -- only used inside local `hexFrom()`)

| File | Line | Usage | Replacement |
|------|------|-------|-------------|
| `packages/utils/src/utils.ts` | 381 | Internal to `hexFrom()` | Deleted along with `hexFrom` |

### `hexFrom()` (5 external call sites + 1 internal)

| File | Line | Usage | Arg Type | Replacement |
|------|------|-------|----------|-------------|
| `packages/utils/src/utils.ts` | 349 | `hexFrom(i)` in `unique()` | `ccc.Entity` | `i.toHex()` |
| `packages/sdk/src/sdk.ts` | 393 | `hexFrom(cell.cellOutput.lock)` | `ccc.Script` | `cell.cellOutput.lock.toHex()` |
| `packages/sdk/src/sdk.ts` | 423 | `hexFrom(wr.owner.cell.cellOutput.lock)` | `ccc.Script` | `wr.owner.cell.cellOutput.lock.toHex()` |
| `packages/order/src/order.ts` | 560 | `hexFrom(master.cell.outPoint)` | `ccc.OutPoint` | `master.cell.outPoint.toHex()` |
| `packages/order/src/order.ts` | 572 | `hexFrom(master)` | `ccc.OutPoint` | `master.toHex()` |
| `apps/faucet/src/main.ts` | 20 | `hexFrom(getRandomValues(...))` | `Uint8Array` | `ccc.hexFrom(getRandomValues(...))` |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Local `max<T>`/`min<T>` generic | `ccc.numMax`/`ccc.numMin` for bigint, `Math.max`/`Math.min` for number | CCC 1.x | Local generic no longer needed |
| Local `gcd()` variadic | `ccc.gcd(a, b)` binary | CCC 1.x (merged PR) | Direct replacement, single call site uses 2 args |
| Local `isHex()` on `string` | `ccc.isHex()` on `unknown` | CCC 1.x | Wider input acceptance, same validation |
| Local `hexFrom()` poly-typed | `entity.toHex()` + `ccc.hexFrom()` + `ccc.numToHex()` | CCC 1.x | Three distinct functions replace one overloaded function |

## Open Questions

1. **numMax/numMin vs Math.max/Math.min for number contexts** (RESOLVED)
   - Both `max()` call sites operate on `number` type. `ccc.numMax()` returns `bigint`, requiring `Number()` wrapping.
   - Resolution: Use `Math.max()`/`Math.min()` for number-typed contexts. `ccc.numMax()` introduces unnecessary `number→bigint→number` round-trips when all arguments and consumers are number-typed. Reserve `ccc.numMax()`/`ccc.numMin()` for bigint contexts where they are a natural fit.

2. **`sum()` preservation status**
   - What we know: `sum()` is in `utils.ts` alongside the functions being removed. It has no CCC equivalent. It's not listed in DEDUP-05's explicit preservation list.
   - What's unclear: Whether `sum()` should be listed as explicitly preserved or if it's implicitly safe.
   - Recommendation: Preserve `sum()` -- it has no CCC equivalent and is iCKB-unique. The DEDUP-05 list is illustrative, not exhaustive.

## Sources

### Primary (HIGH confidence)
- `forks/ccc/packages/core/src/num/index.ts` -- `numMax`, `numMin`, `numFrom`, `numToHex` signatures and implementations
- `forks/ccc/packages/core/src/utils/index.ts` -- `gcd` signature and implementation
- `forks/ccc/packages/core/src/hex/index.ts` -- `isHex`, `hexFrom` signatures and implementations
- `forks/ccc/packages/core/src/codec/entity.ts` -- `Entity.toHex()` method
- `forks/ccc/packages/core/src/barrel.ts` -- confirms all functions exported via CCC barrel
- `packages/utils/src/utils.ts` -- local implementations being replaced
- All call sites verified via ripgrep across `packages/` and `apps/`

### Secondary (MEDIUM confidence)
- None needed -- all findings from direct source inspection

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all CCC functions verified in source, signatures confirmed
- Architecture: HIGH -- all call sites inventoried with type analysis, replacement patterns verified
- Pitfalls: HIGH -- type mismatches identified from source-level analysis, no speculation

**Research date:** 2026-02-23
**Valid until:** 2026-03-23 (stable domain, no expected CCC API changes)
