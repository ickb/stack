import { describe, expect, it } from "vitest";
import * as nodeUtils from "../src/index.ts";
import { formatCkb } from "../src/index.ts";

describe("node utility exports and formatting", () => {
  it("does not export generic secret-policing helpers", () => {
    expect("assertNoPrivateKeyMaterial" in nodeUtils).toBe(false);
    expect("assertNoSecretMaterial" in nodeUtils).toBe(false);
    expect("SecretMaterialLogError" in nodeUtils).toBe(false);
    expect("PrivateKeyMaterialLogError" in nodeUtils).toBe(false);
    expect("sanitizeLogValue" in nodeUtils).toBe(false);
  });

  it("formats CKB values without losing bigint precision", () => {
    const whole = 123456789012345678901234567890n;

    expect(formatCkb(100000000n)).toBe("1");
    expect(formatCkb(whole * 100000000n + 12345670n)).toBe(`${whole.toString()}.1234567`);
    expect(formatCkb(-100000000n - 1n)).toBe("-1.00000001");
  });
});
