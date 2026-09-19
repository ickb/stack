import { describe, expect, it } from "vitest";
import { IckbError, type IckbErrorCode } from "../../src/conversion/error.ts";

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
        cause,
      });
    },
  );
});
