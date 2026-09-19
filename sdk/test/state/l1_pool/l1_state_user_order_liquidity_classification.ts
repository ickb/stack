import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrderManager } from "../../../src/order/order.ts";
import { makeOrderGroup } from "../../conversion/planning/support/sdk_order_support.ts";
import { headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import {
  emptyCellScan,
  FeeRateStubClient,
  l1SdkWithManagers,
  tipHeaderHandler,
} from "../l1_account/support/sdk_l1_support.ts";
import { L1_STATE_SUITE } from "./support/l1_pool_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(L1_STATE_SUITE, () => {
  it("does not classify user-owned matchable orders as system liquidity", async () => {
    const userLock = script("11");
    const nonUserLock = script("12");
    const orderScript = script("55");
    const udt = script("66");
    const orderManager = new OrderManager(orderScript, [], udt);
    const sdk = l1SdkWithManagers({
      orderManager,
      udt,
    });
    const ownerOrder = makeOrderGroup({
      orderScript,
      udtScript: udt,
      ownerLock: userLock,
      txHashByte: "a1",
    });
    const marketOrder = makeOrderGroup({
      orderScript,
      udtScript: udt,
      ownerLock: nonUserLock,
      txHashByte: "a2",
      orderTxHashByte: "a3",
      ratio: { ckbScale: 2n, udtScale: 1n },
      orderCapacity: ccc.fixedPointFrom(300),
      udtValue: 1n,
    });
    vi.spyOn(orderManager, "findOrders").mockResolvedValue([
      ownerOrder.group,
      marketOrder.group,
    ]);

    const client = new FeeRateStubClient({
      getTipHeader: tipHeaderHandler(headerLike(1n)),
      findCellsPagedNoCache: emptyCellScan,
    });

    const state = await sdk.getL1AccountState(client, [userLock]);

    expect(state.user.orders).toEqual([ownerOrder.group]);
    expect(state.system.orderPool).toEqual([marketOrder.group]);
  });
});

describe(`${L1_STATE_SUITE} system order liquidity`, () => {
  it("classifies non-user UDT-to-CKB orders as system liquidity", async () => {
    const { client, marketOrder, sdk, userLock } = l1StateWithMarketOrder({
      ratio: { ckbScale: (1n << 64n) - 1n, udtScale: 1n },
      txHashByte: "b1",
    });

    const state = await sdk.getL1AccountState(client, [userLock]);

    expect(state.user.orders).toEqual([]);
    expect(state.system.orderPool).toEqual([marketOrder.group]);
  });

  it("leaves non-user orders outside liquidity when neither side beats midpoint", async () => {
    const { client, sdk, userLock } = l1StateWithMarketOrder({
      ratio: { ckbScale: 1n, udtScale: 1n << 63n },
      txHashByte: "c1",
    });

    const state = await sdk.getL1AccountState(client, [userLock]);

    expect(state.user.orders).toEqual([]);
    expect(state.system.orderPool).toEqual([]);
  });
});

function l1StateWithMarketOrder({
  ratio,
  txHashByte,
}: {
  ratio: { ckbScale: bigint; udtScale: bigint };
  txHashByte: string;
}): {
  client: FeeRateStubClient;
  marketOrder: ReturnType<typeof makeOrderGroup>;
  sdk: ReturnType<typeof l1SdkWithManagers>;
  userLock: ReturnType<typeof script>;
} {
  const userLock = script("11");
  const nonUserLock = script("12");
  const orderScript = script("55");
  const udt = script("66");
  const orderManager = new OrderManager(orderScript, [], udt);
  const sdk = l1SdkWithManagers({ orderManager, udt });
  const marketOrder = makeOrderGroup({
    orderScript,
    udtScript: udt,
    ownerLock: nonUserLock,
    txHashByte,
    ratio,
    isCkb2Udt: false,
    orderCapacity: ccc.fixedPointFrom(300),
    udtValue: 1n,
  });
  vi.spyOn(orderManager, "findOrders").mockResolvedValue([marketOrder.group]);

  const client = new FeeRateStubClient({
    getTipHeader: tipHeaderHandler(headerLike(1n)),
    findCellsPagedNoCache: emptyCellScan,
  });

  return { client, marketOrder, sdk, userLock };
}
