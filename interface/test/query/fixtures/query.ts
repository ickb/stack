import { ccc } from "@ckb-ccc/ccc";
import { IckbSdk } from "@ickb/sdk";
import { byte32FromByte } from "@ickb/testkit";
import { QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";
import type { getL1State } from "../../../src/query/queries.ts";
import type { WalletConfig } from "../../../src/shared/utils.ts";

export function walletConfigForState(
  lock: ccc.Script,
  state: Awaited<ReturnType<WalletConfig["sdk"]["getL1AccountState"]>>,
): Parameters<typeof getL1State>[0] {
  const cccClient = testClient();
  return {
    chain: "testnet",
    cccClient,
    resetClient: vi.fn<() => void>(),
    queryClient: new QueryClient(),
    signer: testSigner(cccClient),
    address: "ckt1test",
    accountLocks: [lock],
    primaryLock: lock,
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
    estimatedMaturity: state.system.tip.timestamp,
  });
  return sdk;
}

export function testSigner(
  client: ccc.Client = new ccc.ClientPublicTestnet({ url: "https://example.invalid" }),
): ccc.Signer {
  return new ccc.SignerCkbPrivateKey(client, `0x${"11".repeat(32)}`);
}

export function testClient(): ccc.Client {
  return new ccc.ClientPublicTestnet({ url: "https://example.invalid" });
}

export function script(codeHashByte: string): ccc.Script {
  return ccc.Script.from({
    codeHash: byte32FromByte(codeHashByte),
    hashType: "type",
    args: "0x",
  });
}

export function cell(capacity: bigint, lock: ccc.Script, outputData = "0x"): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte("aa"), index: 0n },
    cellOutput: { capacity, lock },
    outputData,
  });
}
