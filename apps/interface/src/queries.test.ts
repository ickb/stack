import { ccc } from "@ckb-ccc/ccc";
import { Ratio, type OrderGroup } from "@ickb/order";
import { byte32FromByte } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { getL1State, l1StateOptions, l1StateQueryKey } from "./queries.ts";
import type { WalletConfig } from "./utils.ts";

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
  it("keys L1 state by account locks as well as address", () => {
    const primaryLock = script("11");
    const firstAccountLock = script("22");
    const secondAccountLock = script("33");
    const walletConfig = {
      chain: "testnet",
      address: "ckt1same",
      primaryLock,
      accountLocks: [firstAccountLock],
    } as WalletConfig;

    expect(l1StateQueryKey(walletConfig)).toEqual([
      "testnet",
      "ckt1same",
      `primary=${primaryLock.toHex()};accounts=${firstAccountLock.toHex()}`,
      "l1State",
    ]);
    expect(l1StateQueryKey({
      ...walletConfig,
      accountLocks: [secondAccountLock],
    })).not.toEqual(l1StateQueryKey(walletConfig));
  });

  it("disables live state polling while a transaction is frozen", () => {
    const walletConfig = {
      chain: "testnet",
      address: "ckt1same",
      primaryLock: script("11"),
      accountLocks: [script("22")],
    } as WalletConfig;

    expect(l1StateOptions(walletConfig, false).enabled).toBe(true);
    expect(l1StateOptions(walletConfig, true).enabled).toBe(false);
  });

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
        getL1AccountState: async () => {
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
            account: {
              capacityCells: [cell(nativeCapacity, lock)],
              nativeUdtCells: [],
              nativeUdtCapacity: 7n,
              nativeUdtBalance: 11n,
              receipts: [receipt],
              withdrawalGroups: [readyWithdrawal, pendingWithdrawal],
            },
          };
        },
      } as unknown as WalletConfig["sdk"],
    };

    const state = await getL1State(walletConfig);

    expect(state.ckbNative).toBe(nativeCapacity);
    expect(state.ickbNative).toBe(11n);
    expect(state.ckbAvailable).toBe(nativeCapacity + 142n);
    expect(state.ickbAvailable).toBe(248n);
    expect(state.ckbBalance).toBe(nativeCapacity + 173n);
    expect(state.ickbBalance).toBe(248n);
    expect(state.hasMatchable).toBe(true);
    expect(state.stateId).toBe([
      "chain=testnet",
      `locks=primary=${lock.toHex()};accounts=${lock.toHex()}`,
      "tip=missing-tip.hash/missing-tip.number/10",
      "fee=1",
      "ratio=1/1",
      "pool=0;;;deposits=",
      `balances=${String(nativeCapacity + 142n)}/248`,
      `capacityCells=${cell(nativeCapacity, lock).outPoint.toHex()}`,
      "nativeUdtCells=",
      "maturity=60",
      "receipts=13/17@missing-outpoint",
      "readyWithdrawals=19/0@missing-outpoint@missing-outpoint",
      "availableOrders=10/20@missing-outpoint@missing-outpoint@missing-outpoint,100/200@missing-outpoint@missing-outpoint@missing-outpoint",
      "pendingWithdrawals=31/0@missing-outpoint@missing-outpoint",
      "pendingOrders=",
    ].join("|"));
  });

  it("changes stateId when transaction-preview inputs change without count changes", async () => {
    const lock = script("11");
    const tip = { timestamp: 10n } as ccc.ClientBlockHeader;
    const stateIdFor = async (options?: {
      feeRate?: bigint;
      exchangeRatio?: Ratio;
      nativeCapacity?: bigint;
      nativeCapacityTxHashByte?: string;
      nativeUdtTxHashByte?: string;
      ckbMaturing?: { ckbCumulative: bigint; maturity: bigint }[];
    }): Promise<string> => {
      const walletConfig: WalletConfig = {
        chain: "testnet",
        cccClient: {} as ccc.Client,
        queryClient: {} as WalletConfig["queryClient"],
        signer: {} as ccc.Signer,
        address: "ckt1test",
        accountLocks: [lock],
        primaryLock: lock,
        sdk: {
          getL1AccountState: async () => {
            await Promise.resolve();
            const capacityCell = cell(options?.nativeCapacity ?? ccc.fixedPointFrom(100), lock);
            capacityCell.outPoint.txHash = byte32FromByte(options?.nativeCapacityTxHashByte ?? "aa");
            const nativeUdtCell = cell(1n, lock);
            nativeUdtCell.outPoint.txHash = byte32FromByte(options?.nativeUdtTxHashByte ?? "bb");
            return {
              system: {
                feeRate: options?.feeRate ?? 1n,
                tip,
                exchangeRatio: options?.exchangeRatio ?? Ratio.from({ ckbScale: 1n, udtScale: 1n }),
                orderPool: [],
                ckbAvailable: 0n,
                ckbMaturing: options?.ckbMaturing ?? [],
              },
              user: { orders: [] },
              account: {
                capacityCells: [capacityCell],
                nativeUdtCells: [nativeUdtCell],
                nativeUdtCapacity: 0n,
                nativeUdtBalance: 0n,
                receipts: [],
                withdrawalGroups: [],
              },
            };
          },
        } as unknown as WalletConfig["sdk"],
      };

      return (await getL1State(walletConfig)).stateId;
    };

    const base = await stateIdFor();

    await expect(stateIdFor({ feeRate: 2n })).resolves.not.toBe(base);
    await expect(stateIdFor({
      exchangeRatio: Ratio.from({ ckbScale: 2n, udtScale: 1n }),
    })).resolves.not.toBe(base);
    await expect(stateIdFor({ nativeCapacity: ccc.fixedPointFrom(101) })).resolves.not.toBe(base);
    await expect(stateIdFor({ nativeCapacityTxHashByte: "ab" })).resolves.not.toBe(base);
    await expect(stateIdFor({ nativeUdtTxHashByte: "bc" })).resolves.not.toBe(base);
    await expect(stateIdFor({
      ckbMaturing: [{ ckbCumulative: 1n, maturity: 20n }],
    })).resolves.not.toBe(base);
  });
});
