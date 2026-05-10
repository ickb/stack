import { ccc } from "@ckb-ccc/ccc";
import { Ratio, type OrderGroup } from "@ickb/order";
import { describe, expect, it } from "vitest";
import { getL1State } from "./queries.ts";
import type { WalletConfig } from "./utils.ts";

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

function cell(capacity: bigint, lock: ccc.Script): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte("aa"), index: 0n },
    cellOutput: { capacity, lock },
    outputData: "0x",
  });
}

function orderGroup(
  ckbValue: bigint,
  udtValue: bigint,
  isMatchable: boolean,
  maturity?: bigint,
): OrderGroup {
  return {
    ckbValue,
    udtValue,
    order: {
      isDualRatio: (): boolean => false,
      isMatchable: (): boolean => isMatchable,
      maturity,
    },
  } as OrderGroup;
}

describe("getL1State", () => {
  it("projects account state through the SDK and makes collected orders available", async () => {
    const lock = script("11");
    const tip = { timestamp: 10n } as ccc.ClientBlockHeader;
    const nativeCapacity = ccc.fixedPointFrom(50);
    const receipt = { ckbValue: 13n, udtValue: 17n };
    const readyWithdrawal = {
      ckbValue: 19n,
      udtValue: 0n,
      owned: { isReady: true },
    };
    const pendingWithdrawal = {
      ckbValue: 31n,
      udtValue: 0n,
      owned: {
        isReady: false,
        maturity: { toUnix: (): bigint => 60n },
      },
    };
    const availableOrder = orderGroup(10n, 20n, false);
    const pendingOrder = orderGroup(100n, 200n, true, 40n);
    const walletConfig: WalletConfig = {
      chain: "testnet",
      cccClient: {} as ccc.Client,
      queryClient: {} as WalletConfig["queryClient"],
      signer: {} as ccc.Signer,
      address: "ckt1test",
      accountLocks: [lock],
      primaryLock: lock,
      sdk: {
        getL1State: async () => {
          await Promise.resolve();
          return {
            system: {
              feeRate: 1n,
              tip,
              exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
              orderPool: [],
              ckbAvailable: 0n,
              ckbMaturing: [],
            },
            user: { orders: [availableOrder, pendingOrder] },
          };
        },
        getAccountState: async () => {
          await Promise.resolve();
          return {
            capacityCells: [cell(nativeCapacity, lock)],
            nativeUdtCapacity: 7n,
            nativeUdtBalance: 11n,
            receipts: [receipt],
            withdrawalGroups: [readyWithdrawal, pendingWithdrawal],
          };
        },
      } as unknown as WalletConfig["sdk"],
      managers: {} as WalletConfig["managers"],
    };

    const state = await getL1State(walletConfig);

    expect(state.ckbNative).toBe(nativeCapacity);
    expect(state.ickbNative).toBe(11n);
    expect(state.ckbAvailable).toBe(nativeCapacity + 142n);
    expect(state.ickbAvailable).toBe(248n);
    expect(state.ckbBalance).toBe(nativeCapacity + 173n);
    expect(state.ickbBalance).toBe(248n);
    expect(state.hasMatchable).toBe(false);
    expect(state.stateId).toBe("testnet:10:1:1:1:2:0");
  });
});
