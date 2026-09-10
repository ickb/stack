import { describe, expect, it } from "vitest";
import {
  IckbError,
  isIckbError,
  type IckbErrorCode,
} from "../../src/conversion/sdk_error.ts";

describe("IckbError", () => {
  it.each<IckbErrorCode>(["insufficient_capacity"])(
    "preserves the stable %s code and cause",
    (code) => {
      const cause = new Error("rpc failed");
      const error = new IckbError("SDK operation failed", { code, cause });

      expect(error).toMatchObject({
        name: "IckbError",
        message: "SDK operation failed",
        code,
        retryable: false,
        cause,
      });
      expect(isIckbError(error)).toBe(true);
    },
  );

  it("rejects unrelated errors", () => {
    expect(isIckbError(new Error("scan stopped"))).toBe(false);
  });
});
