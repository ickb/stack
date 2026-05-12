import { describe, expectTypeOf, it } from "vitest";
import type { OrderGroupSkipReason } from "./index.js";

describe("package root exports", () => {
  it("exports the skipped order group callback reason", () => {
    expectTypeOf<OrderGroupSkipReason>().toEqualTypeOf<
      | "missing-master"
      | "missing-origin"
      | "ambiguous-origin"
      | "missing-order"
      | "ambiguous-order"
      | "invalid-group"
    >();
  });
});
