import { describe, expect, it } from "vitest";
import { IckbError, isIckbError, type IckbErrorCode } from "../../src/sdk.ts";

describe("IckbError", () => {
  it.each<IckbErrorCode>(["account_scan_limit", "insufficient_capacity"])(
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
      expect(isIckbError(error, code)).toBe(true);
    },
  );

  it("rejects unrelated errors and different codes", () => {
    const error = new IckbError("scan stopped", { code: "account_scan_limit" });

    expect(isIckbError(new Error("scan stopped"))).toBe(false);
    expect(isIckbError(error, "insufficient_capacity")).toBe(false);
  });
});
