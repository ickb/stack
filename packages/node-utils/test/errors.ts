import { describe, expect, it } from "vitest";
import { errnoCode, errorMessage, isRecord } from "../src/index.ts";

describe("error helpers", () => {
  it("reads errno codes only from errors that carry one", () => {
    expect(errnoCode(Object.assign(new Error("missing"), { code: "ENOENT" }))).toBe(
      "ENOENT",
    );
    expect(errnoCode(new Error("plain"))).toBeUndefined();
    expect(errnoCode({ code: 7 })).toBeUndefined();
    expect(errnoCode(null)).toBeUndefined();
  });

  it("formats messages from errors and thrown values", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("text")).toBe("text");
    expect(errorMessage(42)).toBe("42");
  });

  it("recognizes plain records", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([1])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });
});
