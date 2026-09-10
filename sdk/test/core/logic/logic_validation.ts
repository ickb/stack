import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogicManager } from "../../../src/core/logic.ts";
import {
  DAO_OUTPUT_LIMIT,
  DaoManager,
  DaoOutputLimitError,
} from "../../../src/dao/index.ts";
import { LOGIC_MANAGER_DEPOSIT_SUITE, script } from "./support/logic_support.ts";

describe(LOGIC_MANAGER_DEPOSIT_SUITE, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the protocol minimum on unoccupied capacity", () => {
    const manager = new LogicManager(script("11"), [], new DaoManager(script("22"), []));

    expect(() =>
      manager.deposit(
        ccc.Transaction.default(),
        1,
        ccc.fixedPointFrom(1081),
        script("33"),
      ),
    ).toThrow("iCKB deposit minimum is 1000 CKB free capacity (1082 CKB total capacity)");
  });

  it("keeps the protocol maximum on unoccupied capacity", () => {
    const manager = new LogicManager(script("11"), [], new DaoManager(script("22"), []));

    expect(() =>
      manager.deposit(
        ccc.Transaction.default(),
        1,
        ccc.fixedPointFrom(1000083),
        script("33"),
      ),
    ).toThrow(
      "iCKB deposit maximum is 1000000 CKB free capacity (1000082 CKB total capacity)",
    );
  });

  it("rejects non-safe-integer deposit quantities before allocation", () => {
    const manager = new LogicManager(script("11"), [], new DaoManager(script("22"), []));

    for (const quantity of [1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        manager.deposit(
          ccc.Transaction.default(),
          quantity,
          ccc.fixedPointFrom(1082),
          script("33"),
        ),
      ).toThrow("iCKB deposit quantity must be a safe integer");
    }
  });

  it("rejects deposit quantities that cannot fit in one DAO transaction", () => {
    const manager = new LogicManager(script("11"), [], new DaoManager(script("22"), []));

    expect(() =>
      manager.deposit(
        ccc.Transaction.default(),
        64,
        ccc.fixedPointFrom(1082),
        script("33"),
      ),
    ).toThrow(DaoOutputLimitError);
  });

  it("rejects output 65 after appending the receipt", () => {
    const manager = new LogicManager(script("11"), [], new DaoManager(script("22"), []));
    const tx = ccc.Transaction.default();
    for (let index = 1; index < DAO_OUTPUT_LIMIT; index += 1) {
      tx.addOutput({ capacity: 1n, lock: script("44") }, "0x");
    }

    expect(() => manager.deposit(tx, 1, ccc.fixedPointFrom(1082), script("33"))).toThrow(
      DaoOutputLimitError,
    );
  });
});
