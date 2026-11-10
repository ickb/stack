import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WALLET_LOCK_UP } from "../../../src/dao.ts";
import { findOrders } from "../../../src/order/order.ts";
import { IckbSdk } from "../../../src/sdk.ts";
import { ickbExchangeRatio } from "../../../src/udt.ts";
import { makeOrderGroup } from "../../conversion/planning/support/sdk_order_support.ts";
import { headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import { anchoredAt, FeeRateStubClient } from "../l1_account/support/sdk_l1_support.ts";

// The order book is the test's input, not a scan the client serves.
vi.mock(import("../../../src/order/order.ts"), async (importOriginal) => ({
  ...(await importOriginal()),
  findOrders: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IckbSdk.getL1AccountState", () => {
  it("does not classify user-owned matchable orders as system liquidity", async () => {
    const userLock = script("11");
    const nonUserLock = script("12");
    const sdk = new IckbSdk();
    const ownerOrder = makeOrderGroup({
      ownerLock: userLock,
      txHashByte: "a1",
    });
    const marketOrder = makeOrderGroup({
      ownerLock: nonUserLock,
      txHashByte: "a2",
      orderTxHashByte: "a3",
      ratio: { ckbScale: 2n, udtScale: 1n },
      orderCapacity: ccc.fixedPointFrom(300),
      udtValue: 1n,
    });
    vi.mocked(findOrders).mockResolvedValue([ownerOrder.group, marketOrder.group]);

    const client = new FeeRateStubClient({
      ...anchoredAt(headerLike(1n, { timestamp: BigInt(Date.now()) })),
      cells: (): ccc.Cell[] => [],
    });

    const state = await sdk.getL1AccountState(client, [userLock], WALLET_LOCK_UP);

    expect(state.userOrders).toEqual([ownerOrder.group]);
    expect(state.system.orderPool).toEqual([marketOrder.group]);
  });
});

describe("IckbSdk.getL1AccountState system order liquidity", () => {
  it("classifies non-user UDT-to-CKB orders as system liquidity", async () => {
    const { client, marketOrder, sdk, userLock } = l1StateWithMarketOrder({
      ratio: { ckbScale: (1n << 64n) - 1n, udtScale: 1n },
      txHashByte: "b1",
    });

    const state = await sdk.getL1AccountState(client, [userLock], WALLET_LOCK_UP);

    expect(state.userOrders).toEqual([]);
    expect(state.system.orderPool).toEqual([marketOrder.group]);
  });

  it("leaves non-user orders outside liquidity when neither side beats midpoint", async () => {
    const { client, sdk, userLock } = l1StateWithMarketOrder({
      ratio: { ckbScale: 1n, udtScale: 1n << 63n },
      txHashByte: "c1",
    });

    const state = await sdk.getL1AccountState(client, [userLock], WALLET_LOCK_UP);

    expect(state.userOrders).toEqual([]);
    expect(state.system.orderPool).toEqual([]);
  });

  // The bot gains nothing filling an order at the DAO ratio.
  it.each([true, false])(
    "leaves an order at par outside liquidity, buying: %s",
    async (isCkb2Udt) => {
      const { client, sdk, userLock } = l1StateWithMarketOrder({
        ratio: ickbExchangeRatio(headerLike(1n)),
        txHashByte: "d1",
        isCkb2Udt,
      });

      const state = await sdk.getL1AccountState(client, [userLock], WALLET_LOCK_UP);

      expect(state.system.orderPool).toEqual([]);
    },
  );
});

function l1StateWithMarketOrder({
  ratio,
  txHashByte,
  isCkb2Udt = false,
}: {
  ratio: { ckbScale: bigint; udtScale: bigint };
  txHashByte: string;
  isCkb2Udt?: boolean;
}): {
  client: FeeRateStubClient;
  marketOrder: ReturnType<typeof makeOrderGroup>;
  sdk: IckbSdk;
  userLock: ReturnType<typeof script>;
} {
  const userLock = script("11");
  const nonUserLock = script("12");
  const sdk = new IckbSdk();
  const marketOrder = makeOrderGroup({
    ownerLock: nonUserLock,
    txHashByte,
    ratio,
    isCkb2Udt,
    orderCapacity: ccc.fixedPointFrom(300),
    udtValue: 1n,
  });
  vi.mocked(findOrders).mockResolvedValue([marketOrder.group]);

  const client = new FeeRateStubClient({
    ...anchoredAt(headerLike(1n, { timestamp: BigInt(Date.now()) })),
    cells: (): ccc.Cell[] => [],
  });

  return { client, marketOrder, sdk, userLock };
}
