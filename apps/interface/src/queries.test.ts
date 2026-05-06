import { ccc } from "@ckb-ccc/ccc";
import { describe, expect, it } from "vitest";
import { isPlainCapacityCell } from "@ickb/utils";

function byte32FromByte(hexByte: string): `0x${string}` {
  if (!/^[0-9a-f]{2}$/iu.test(hexByte)) {
    throw new Error("Expected exactly one byte as two hex chars");
  }
  return `0x${hexByte.repeat(32)}`;
}

function script(codeHashByte: string): ccc.Script {
  return ccc.Script.from({
    codeHash: byte32FromByte(codeHashByte),
    hashType: "type",
    args: "0x",
  });
}

describe("isPlainCapacityCell", () => {
  it("accepts only no-type empty-data cells", () => {
    const plain = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("11"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(1000),
        lock: script("22"),
      },
      outputData: "0x",
    });
    const typed = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("33"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(2000),
        lock: script("22"),
        type: script("44"),
      },
      outputData: "0x",
    });
    const dataCell = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("55"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(3000),
        lock: script("22"),
      },
      outputData: "0xab",
    });

    expect(isPlainCapacityCell(plain)).toBe(true);
    expect(isPlainCapacityCell(typed)).toBe(false);
    expect(isPlainCapacityCell(dataCell)).toBe(false);
  });
});
