import { describe, expect, it } from "vitest";
import * as core from "../../src/core/index.ts";

describe("core package barrel", () => {
  it("converts values through the public index", () => {
    const ratio = { ckbScale: 2n, udtScale: 3n };

    expect(core.convert(true, 9n, ratio)).toBe(6n);
    expect(core.convert(false, 6n, ratio)).toBe(9n);
  });

  it("retains concrete entity constructors and codecs", () => {
    const owner: core.OwnerData = new core.OwnerData(-2n);
    const receipt: core.ReceiptData = new core.ReceiptData(3n, 4n);

    expect(core.OwnerData.byteLength).toBe(4);
    expect(core.OwnerData.decode(core.OwnerData.encode(owner)).eq(owner)).toBe(true);
    expect(core.OwnerData.fromBytes(owner.toBytes()).clone().eq(owner)).toBe(true);
    expect(core.ReceiptData.byteLength).toBe(12);
    expect(core.ReceiptData.decode(core.ReceiptData.encode(receipt)).eq(receipt)).toBe(
      true,
    );
    expect(core.ReceiptData.fromBytes(receipt.toBytes()).clone().eq(receipt)).toBe(true);
  });

  it("does not expose generated entity bases", () => {
    for (const name of [
      "OwnerEntityBase",
      "ReceiptEntityBase",
      "OwnerBase",
      "ReceiptBase",
    ]) {
      expect(core).not.toHaveProperty(name);
    }
  });
});
