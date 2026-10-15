import { ccc } from "@ckb-ccc/ccc";
import { describe, expect, it } from "vitest";
import { isCkbSigner } from "../../src/app/interfaceConfig.ts";
import { TypeSigner } from "./fixtures/signer.ts";

describe("isCkbSigner", () => {
  it("accepts only CKB signer types", () => {
    expect(isCkbSigner(new TypeSigner(ccc.SignerType.CKB))).toBe(true);
    expect(isCkbSigner(new TypeSigner(ccc.SignerType.BTC))).toBe(false);
    expect(isCkbSigner(new TypeSigner(ccc.SignerType.EVM))).toBe(false);
  });
});
