# Testing Patterns

**Analysis Date:** 2026-02-17

## Important Context

**Legacy vs. New code:**
- `@ickb/lumos-utils@1.4.2` and `@ickb/v1-core@1.4.2` are **LEGACY and DEPRECATED**. They have no tests in this monorepo (they were published separately).
- The `packages/` directory contains the **NEW replacement libraries** -- these are the packages that need tests.
- All `@ckb-lumos/*` packages are **DEPRECATED** -- do not write tests that depend on Lumos.
- CCC PRs for UDT and Epochs have been **MERGED** upstream.
- `SmartTransaction` was **ABANDONED** -- do not expand its test coverage; it exists in `packages/utils/src/transaction.ts` but header caching now uses CCC's client cache.

**Current test status:** No `.test.ts` files exist yet in the `packages/` or `apps/` source directories. Vitest is fully configured and ready. The CI pipeline runs `pnpm check` which includes `pnpm test:ci`, but with no test files `vitest run` passes vacuously. Writing tests is a greenfield effort.

## Test Framework

**Runner:**
- Vitest 3.2.4
- Root config: `vitest.config.mts`
- Per-package config: `packages/*/vitest.config.mts`

**Assertion Library:**
- Vitest native assertions via `expect()`

**Coverage Tool:**
- `@vitest/coverage-v8` 3.2.4

**Run Commands:**
```bash
pnpm test              # Run all tests in watch mode (packages/* only)
pnpm test:ci           # Run all tests once (CI mode)
pnpm test:cov          # Run tests with V8 coverage report
```

Per-package (from within a package directory):
```bash
pnpm test              # Run tests for this package in watch mode
pnpm test:ci           # Run tests for this package once
```

## Test Configuration

**Root `vitest.config.mts`:**
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*"],
    coverage: {
      include: ["packages/*"],
    },
  },
});
```

**Per-package `vitest.config.mts` (identical for all packages):**
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
    },
  },
});
```

**Key configuration details:**
- Tests run via Vitest workspace projects -- root config delegates to per-package configs
- Test files must match `src/**/*.test.ts` (co-located with source)
- Coverage tracks all `src/**/*.ts` files
- Apps (`apps/*`) do NOT have vitest project entries in the root config -- tests are packages-only
- Each package's `package.json` has `"test": "vitest"` and `"test:ci": "vitest run"` scripts

## Test File Organization

**Location:**
- Co-located with source files inside `packages/*/src/`
- Tests live alongside the code they test

**Naming:**
- Use `.test.ts` suffix (not `.spec.ts`)
- Name should match the source file: `codec.ts` -> `codec.test.ts`, `heap.ts` -> `heap.test.ts`

**Expected structure when adding tests:**
```
packages/utils/
├── src/
│   ├── capacity.ts
│   ├── capacity.test.ts      # <-- tests go here
│   ├── codec.ts
│   ├── codec.test.ts         # <-- tests go here
│   ├── heap.ts
│   ├── heap.test.ts          # <-- tests go here
│   ├── index.ts
│   ├── transaction.ts
│   ├── udt.ts
│   ├── utils.ts
│   └── utils.test.ts         # <-- tests go here
└── vitest.config.mts
```

## Test Structure

**Suite Organization:**
Use `describe` for grouping by class or function, `it` or `test` for individual behaviors:

```typescript
import { describe, expect, it } from "vitest";
import { Ratio } from "./entities.js";

describe("Ratio", () => {
  describe("from", () => {
    it("creates from plain object", () => {
      const ratio = Ratio.from({ ckbScale: 3n, udtScale: 4n });
      expect(ratio.ckbScale).toBe(3n);
      expect(ratio.udtScale).toBe(4n);
    });

    it("short-circuits on Ratio instance", () => {
      const ratio = new Ratio(10n, 20n);
      expect(Ratio.from(ratio)).toBe(ratio);
    });
  });

  describe("validate", () => {
    it("accepts populated ratio", () => {
      const r = new Ratio(100n, 200n);
      expect(() => r.validate()).not.toThrow();
      expect(r.isValid()).toBe(true);
    });

    it("accepts empty ratio", () => {
      const r = Ratio.empty();
      expect(() => r.validate()).not.toThrow();
      expect(r.isValid()).toBe(true);
    });

    it("rejects half-populated ratio", () => {
      const r = new Ratio(100n, 0n);
      expect(() => r.validate()).toThrow("not empty, not populated");
      expect(r.isValid()).toBe(false);
    });
  });
});
```

**Conventions:**
- Top-level `describe()` per class or exported function
- Nested `describe()` per method being tested
- Each `it()` tests a single behavior or edge case
- Test names describe the expected behavior, not the implementation
- Use data-driven parameterized tests for exhaustive case coverage

## Parameterized / Data-Driven Tests

For functions with many edge cases, use array-based parameterization:

```typescript
describe("binarySearch", () => {
  const cases: [number, (i: number) => boolean, number][] = [
    [10, (i) => i > 5, 6],
    [10, (i) => i >= 0, 0],
    [10, () => false, 10],
    [0, () => true, 0],
  ];

  cases.forEach(([n, f, expected]) =>
    it(`binarySearch(${n}, f) returns ${expected}`, () => {
      expect(binarySearch(n, f)).toBe(expected);
    }),
  );
});
```

## Mocking

**Framework:** Vitest built-in mocking via `vi.fn()`, `vi.mock()`, `vi.spyOn()`

**What to Mock:**
- `ccc.Client` methods when testing code that calls RPC (e.g., `getHeaderByNumber`, `getTipHeader`, `findCells`)
- Network I/O in manager classes (`DaoManager`, `LogicManager`, `OrderManager`)
- Never mock the molecule codec layer -- test encode/decode with real data

**What NOT to Mock:**
- Pure computation functions (`binarySearch`, `gcd`, `shuffle`, `min`, `max`, `sum`)
- Epoch arithmetic (`Epoch.from`, `add`, `sub`, `compare`)
- Codec encode/decode (`Ratio.encode`, `OrderData.decode`, `CheckedInt32LE`)
- Entity validation (`validate`, `isValid`)

**Suggested mocking pattern for CCC client:**
```typescript
import { vi, describe, it, expect } from "vitest";

const mockClient = {
  getHeaderByNumber: vi.fn(),
  getTipHeader: vi.fn(),
  findCells: vi.fn(async function* () {}),
  findCellsOnChain: vi.fn(async function* () {}),
} as unknown as ccc.Client;
```

## Fixtures and Factories

**Test Data:**
- Define inline within test files
- Use real blockchain-style hex strings and bigint values:
```typescript
const testCell = ccc.Cell.from({
  outPoint: { txHash: "0x" + "ab".repeat(32), index: 0 },
  cellOutput: {
    capacity: ccc.fixedPointFrom("1000"),
    lock: ccc.Script.from({ codeHash: "0x" + "00".repeat(32), hashType: "type", args: "0x" }),
  },
  outputData: "0x",
});
```

**No separate fixtures directory.** Keep test data close to test logic.

**Factory helpers:** If a test file needs repeated construction, define a local factory function:
```typescript
function makeRatio(ckb: bigint, udt: bigint): Ratio {
  return new Ratio(ckb, udt);
}
```

## Coverage

**Requirements:** Not currently enforced. No minimum threshold configured.

**View Coverage:**
```bash
pnpm test:cov          # Generates V8 coverage report
```

**Coverage scope:**
- Root config: `packages/*` directories
- Per-package: `src/**/*.ts` files
- Apps are excluded from coverage

## Test Types

**Unit Tests (primary focus for `packages/`):**
- Scope: Individual classes, functions, pure logic
- Location: `packages/*/src/*.test.ts`
- Priority targets for new tests:
  1. `packages/utils/src/utils.ts` - `binarySearch`, `asyncBinarySearch`, `gcd`, `min`, `max`, `sum`, `hexFrom`, `isHex`, `shuffle`
  2. `packages/utils/src/codec.ts` - `CheckedInt32LE` encode/decode
  3. `packages/utils/src/heap.ts` - `MinHeap` operations (push, pop, remove, fix)
  5. `packages/order/src/entities.ts` - `Ratio`, `Info`, `Relative`, `OrderData` encode/decode/validate
  6. `packages/order/src/cells.ts` - `OrderCell.mustFrom`, `OrderCell.tryFrom`, `OrderGroup`
  7. `packages/dao/src/dao.ts` - `DaoManager.isDeposit`, `isWithdrawalRequest`
  8. `packages/core/src/entities.ts` - Entity encode/decode roundtrips

**Integration Tests:**
- Scope: Multi-component interactions requiring a mock CCC client
- Example: `LogicManager.deposit()` combining DaoManager + UdtHandler
- Example: `IckbSdk.estimate()` combining exchange ratios with order info

**Contract-Alignment Tests (critical):**
- Scope: Verify TS logic produces identical results to Rust contract validation
- Priority targets:
  1. Exchange rate: `iCKB = capacity * AR_0 / AR_m` with soft cap penalty -- must match `forks/contracts/scripts/contracts/ickb_logic/src/entry.rs` `deposit_to_ickb()`
  2. Molecule encoding: `ReceiptData`, `OwnedOwnerData`, `Ratio`, `OrderInfo`, `MintOrderData`, `MatchOrderData` -- must match `forks/contracts/schemas/encoding.mol`
  3. Order value conservation: `in_ckb * ckb_mul + in_udt * udt_mul <= out_ckb * ckb_mul + out_udt * udt_mul` -- must match `forks/contracts/scripts/contracts/limit_order/src/entry.rs` `validate()`
  4. Concavity check: `c2u.ckb_mul * u2c.udt_mul >= c2u.udt_mul * u2c.ckb_mul` -- must match limit_order contract
  5. Deposit size bounds: min 1,000 CKB, max 1,000,000 CKB unoccupied capacity
  6. Owned owner distance calculation: TS MetaPoint arithmetic must match contract's `extract_owned_metapoint()`
- Approach: Use known input/output vectors derived from the Rust contract logic or construct test cases from the Molecule schema

**E2E Tests:**
- Not applicable -- apps interact with live blockchain nodes
- Integration testing of apps happens via manual testing against devnet/testnet

## Common Patterns

**Testing validate/isValid pairs:**
```typescript
describe("Ratio", () => {
  it("validates populated ratio", () => {
    const r = new Ratio(100n, 200n);
    expect(() => r.validate()).not.toThrow();
    expect(r.isValid()).toBe(true);
  });

  it("validates empty ratio", () => {
    const r = Ratio.empty();
    expect(() => r.validate()).not.toThrow();
    expect(r.isValid()).toBe(true);
  });

  it("rejects half-populated ratio", () => {
    const r = new Ratio(100n, 0n);
    expect(() => r.validate()).toThrow("not empty, not populated");
    expect(r.isValid()).toBe(false);
  });
});
```

**Testing codec roundtrips:**
```typescript
describe("CheckedInt32LE", () => {
  it("roundtrips valid values", () => {
    const values = [0, 1, -1, 2147483647, -2147483648];
    for (const v of values) {
      const encoded = CheckedInt32LE.encode(v);
      const decoded = CheckedInt32LE.decode(encoded);
      expect(decoded).toBe(v);
    }
  });

  it("rejects out-of-bounds values", () => {
    expect(() => CheckedInt32LE.encode(2147483648)).toThrow("out of int32 bounds");
    expect(() => CheckedInt32LE.encode(-2147483649)).toThrow("out of int32 bounds");
  });
});
```

**Testing async generators:**
```typescript
import { collect } from "./utils.js";

it("collects async iterable into array", async () => {
  async function* gen(): AsyncGenerator<number> {
    yield 1;
    yield 2;
    yield 3;
  }
  const result = await collect(gen());
  expect(result).toEqual([1, 2, 3]);
});
```

**Testing entity `from()` short-circuit:**
```typescript
it("returns same instance when already correct type", () => {
  const original = new Ratio(10n, 20n);
  expect(Ratio.from(original)).toBe(original); // identity check
});
```

**Testing comparison methods:**
```typescript
describe("Ratio.compare", () => {
  it("compares by cross-multiplication", () => {
    const a = new Ratio(3n, 4n);  // 3/4
    const b = new Ratio(2n, 3n);  // 2/3
    expect(a.compare(b)).toBeGreaterThan(0);  // 3*3 - 2*4 = 1
    expect(b.compare(a)).toBeLessThan(0);
  });

  it("returns 0 for equal ratios", () => {
    const a = new Ratio(1n, 2n);
    const b = new Ratio(1n, 2n);
    expect(a.compare(b)).toBe(0);
  });
});
```

## CI Integration

**Current state in `.github/workflows/check.yaml`:**
```yaml
- name: Check (lint, build and test)
  run: pnpm check
```

The `pnpm check` script runs: `pnpm clean:deep && pnpm install && pnpm lint && pnpm build:all && pnpm test:ci`. Tests are included but with no test files, `vitest run` passes vacuously.

**CI runs on:** `[pull_request, push]` events, `ubuntu-latest`, Node.js 24, pnpm.

---

*Testing analysis: 2026-02-17*
