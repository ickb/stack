import { ccc } from "@ckb-ccc/core";
import { DaoManager } from "@ickb/dao";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogicManager } from "../../src/logic.ts";
import {
  LOGIC_MANAGER_DEPOSIT_SUITE,
  script,
  testClient,
} from "./support/logic_support.ts";

describe(LOGIC_MANAGER_DEPOSIT_SUITE, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the protocol minimum on unoccupied capacity", async () => {
    const manager = new LogicManager(script("11"), [], new DaoManager(script("22"), []));

    await expect(
      manager.deposit(
        ccc.Transaction.default(),
        1,
        ccc.fixedPointFrom(1081),
        script("33"),
        testClient(),
      ),
    ).rejects.toThrow(
      "iCKB deposit minimum is 1000 CKB free capacity (1082 CKB total capacity)",
    );
  });

  it("keeps the protocol maximum on unoccupied capacity", async () => {
    const manager = new LogicManager(script("11"), [], new DaoManager(script("22"), []));

    await expect(
      manager.deposit(
        ccc.Transaction.default(),
        1,
        ccc.fixedPointFrom(1000083),
        script("33"),
        testClient(),
      ),
    ).rejects.toThrow(
      "iCKB deposit maximum is 1000000 CKB free capacity (1000082 CKB total capacity)",
    );
  });

  it("rejects non-safe-integer deposit quantities before allocation", async () => {
    const manager = new LogicManager(script("11"), [], new DaoManager(script("22"), []));

    for (const quantity of [1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        manager.deposit(
          ccc.Transaction.default(),
          quantity,
          ccc.fixedPointFrom(1082),
          script("33"),
          testClient(),
        ),
      ).rejects.toThrow("iCKB deposit quantity must be a safe integer");
    }
  });

  it("rejects deposit quantities that cannot fit in one DAO transaction", async () => {
    const manager = new LogicManager(script("11"), [], new DaoManager(script("22"), []));

    await expect(
      manager.deposit(
        ccc.Transaction.default(),
        64,
        ccc.fixedPointFrom(1082),
        script("33"),
        testClient(),
      ),
    ).rejects.toThrow("iCKB deposit quantity maximum is 63");
  });
});
