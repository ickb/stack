import { ccc } from "@ckb-ccc/core";
import { vi } from "vitest";
import type * as Complete from "../../../../src/complete.ts";

/**
 * The completion module with `completeTransaction` handing back the built transaction as is,
 * for tests of what the builders put in. A test file's `vi.mock` factory loads it, so it
 * imports the module it stands in for only as a type.
 */
export function passthroughCompletion(actual: typeof Complete): typeof Complete {
  return {
    ...actual,
    completeTransaction: vi.fn<typeof actual.completeTransaction>(async (txLike) => {
      await Promise.resolve();
      return { tx: ccc.Transaction.from(txLike), plannedFee: 0n };
    }),
  };
}
