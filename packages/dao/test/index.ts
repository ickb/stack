import { describe, expect, it } from "vitest";
import * as dao from "../src/index.ts";

describe("dao package barrel", () => {
  it("exposes DAO output-limit behavior through the public index", () => {
    const error = new dao.DaoOutputLimitError(dao.DAO_OUTPUT_LIMIT + 1);

    expect(dao.DaoManager.depositData()).toBe("0x0000000000000000");
    expect(error.message).toContain("65 output cells");
  });
});
