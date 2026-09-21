import { describe, expect, it } from "vitest";
import { formatCkb } from "../../src/shared/format.ts";

describe("node formatting", () => {
  it("formats CKB values without losing bigint precision", () => {
    const whole = 123456789012345678901234567890n;

    expect(formatCkb(100000000n)).toBe("1");
    expect(formatCkb(whole * 100000000n + 12345670n)).toBe(`${whole.toString()}.1234567`);
    expect(formatCkb(-100000000n - 1n)).toBe("-1.00000001");
  });
});
