import { ccc } from "@ckb-ccc/ccc";
import { IckbSdk, Ratio, WALLET_LOCK_UP, type SystemState } from "@ickb/sdk";
import { byte32FromByte, offlineTestnetClient } from "@ickb/testkit";
import { QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";
import type { getL1State } from "../../../src/app/queries.ts";
import type { WalletConfig } from "../../../src/shared/utils.ts";

/** An empty pool and book at a one-to-one rate, under the wallet's timing rules. */
export function sampledSystem(tip: ccc.ClientBlockHeader): SystemState {
  return {
    feeRate: 1n,
    tip,
    exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
    // A cap's 100,000 iCKB at one to one.
    depositCapacity: ccc.fixedPointFrom(100_000),
    orderPool: [],
    poolDeposits: [],
    lockUp: WALLET_LOCK_UP,
  };
}

export function walletConfigForState(
  lock: ccc.Script,
  state: Awaited<ReturnType<WalletConfig["sdk"]["getL1AccountState"]>>,
): Parameters<typeof getL1State>[0] {
  const cccClient = offlineTestnetClient();
  return {
    chain: "testnet",
    cccClient,
    resetClient: vi.fn<() => void>(),
    queryClient: new QueryClient(),
    signer: testSigner(cccClient),
    address: "ckt1test",
    accountLocks: [lock],
    sdk: stateSdk(state),
  };
}

export function stateSdk(
  state: Awaited<ReturnType<WalletConfig["sdk"]["getL1AccountState"]>>,
): Parameters<typeof getL1State>[0]["sdk"] {
  const sdk = IckbSdk.fromChain("testnet");
  vi.spyOn(sdk, "getL1AccountState").mockResolvedValue(state);
  vi.spyOn(sdk, "buildConversionTransaction").mockResolvedValue({
    ok: false,
    reason: "nothing-to-do",
  });
  return sdk;
}

export function testSigner(client: ccc.Client = offlineTestnetClient()): ccc.Signer {
  return new ccc.SignerCkbPrivateKey(client, `0x${"11".repeat(32)}`);
}

export function cell(capacity: bigint, lock: ccc.Script, outputData = "0x"): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte("aa"), index: 0n },
    cellOutput: { capacity, lock },
    outputData,
  });
}
