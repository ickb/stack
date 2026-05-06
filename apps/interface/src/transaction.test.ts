import { ccc } from "@ckb-ccc/ccc";
import { Ratio } from "@ickb/order";
import { describe, expect, it, vi } from "vitest";
import { buildTransactionPreview, selectReadyDeposits } from "./transaction.ts";
import type { TransactionContext } from "./transaction.ts";
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

function context(overrides: Partial<TransactionContext> = {}): TransactionContext {
  return {
    system: {
      feeRate: 1n,
      tip: { timestamp: 0n } as ccc.ClientBlockHeader,
      exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
      orderPool: [],
      ckbAvailable: 0n,
      ckbMaturing: [],
    },
    receipts: [],
    readyWithdrawals: [],
    availableOrders: [],
    ckbAvailable: 0n,
    ickbAvailable: 0n,
    estimatedMaturity: 0n,
    ...overrides,
  };
}

function identityTx(txLike: ccc.TransactionLike): ccc.Transaction {
  return ccc.Transaction.from(txLike);
}

function resolvedTx(txLike: ccc.TransactionLike): Promise<ccc.Transaction> {
  return Promise.resolve(ccc.Transaction.from(txLike));
}

function emptyDeposits(): AsyncGenerator<never> {
  return (async function* (): AsyncGenerator<never> {
    await Promise.resolve();
    yield* [] as never[];
  })();
}

function walletConfig(overrides: Partial<WalletConfig> = {}): WalletConfig {
  return {
    chain: "testnet",
    cccClient: {} as ccc.Client,
    queryClient: {} as WalletConfig["queryClient"],
    signer: {} as ccc.Signer,
    address: "ckt1test",
    accountLocks: [],
    primaryLock: script("11"),
    sdk: {
      collect: identityTx,
      request: resolvedTx,
    } as unknown as WalletConfig["sdk"],
    managers: {
      ickbUdt: {
        completeBy: resolvedTx,
      } as unknown as WalletConfig["managers"]["ickbUdt"],
      logic: {
        completeDeposit: identityTx,
        deposit: resolvedTx,
        findDeposits: emptyDeposits,
      } as unknown as WalletConfig["managers"]["logic"],
      ownedOwner: {
        withdraw: resolvedTx,
        requestWithdrawal: resolvedTx,
      } as unknown as WalletConfig["managers"]["ownedOwner"],
      order: {} as WalletConfig["managers"]["order"],
    },
    ...overrides,
  };
}

describe("selectReadyDeposits", () => {
  it("finds an exact-count subset when the greedy maturity path fails", () => {
    const deposits = [{ udtValue: 6n }, { udtValue: 5n }, { udtValue: 5n }];

    expect(selectReadyDeposits(deposits as never[], 2, 10n)).toEqual([
      deposits[1],
      deposits[2],
    ]);
  });

  it("prefers the fullest exact-count subset under the cap", () => {
    const deposits = [{ udtValue: 1n }, { udtValue: 4n }, { udtValue: 5n }];

    expect(selectReadyDeposits(deposits as never[], 2, 10n)).toEqual([
      deposits[1],
      deposits[2],
    ]);
  });

  it("keeps earlier deposits when equally full subsets tie", () => {
    const deposits = [{ udtValue: 5n }, { udtValue: 5n }, { udtValue: 5n }];

    expect(selectReadyDeposits(deposits as never[], 2, 10n)).toEqual([
      deposits[0],
      deposits[1],
    ]);
  });

  it("bounds the search to the direct-withdrawal preview cap", () => {
    const deposits = [
      ...Array.from({ length: 30 }, () => ({ udtValue: 6n })),
      { udtValue: 5n },
      { udtValue: 5n },
    ];

    expect(selectReadyDeposits(deposits as never[], 2, 10n)).toEqual([]);
  });

  it("returns no subset when no exact-count fit exists", () => {
    const deposits = [{ udtValue: 6n }, { udtValue: 5n }, { udtValue: 5n }];

    expect(selectReadyDeposits(deposits as never[], 2, 9n)).toEqual([]);
  });
});

describe("buildTransactionPreview", () => {
  it("reports the preview threshold instead of a generic build failure", async () => {
    vi.spyOn(ccc, "isDaoOutputLimitExceeded").mockResolvedValue(false);
    vi.spyOn(ccc.Transaction.prototype, "completeFeeBy").mockResolvedValue([0, false]);
    vi.spyOn(ccc.Transaction.prototype, "getFee").mockResolvedValue(0n);

    const txInfo = await buildTransactionPreview(
      context({ ckbAvailable: 1n }),
      true,
      1n,
      walletConfig(),
    );

    expect(txInfo.error).toBe(
      "Amount too small to exceed the minimum match and fee threshold",
    );
  });
});
