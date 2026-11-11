import { ccc } from "@ckb-ccc/ccc";
import { IckbSdk, readState, type State } from "@ickb/sdk";
import { byte32FromByte, offlineTestnetClient } from "@ickb/testkit";
import { QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";
import type { getL1State } from "../../../src/app/queries.ts";

/**
 * A wallet config whose signer's read is `state`, through the `readState` mock of the test
 * file, and whose SDK refuses every build as short of CKB.
 */
export function walletConfigReading(state: State): Parameters<typeof getL1State>[0] {
  vi.mocked(readState).mockResolvedValue(state);
  const cccClient = offlineTestnetClient();
  const sdk = new IckbSdk();
  vi.spyOn(sdk, "buildConversionTransaction").mockResolvedValue({
    ok: false,
    reason: "insufficient-ckb",
  });
  return {
    chain: "testnet",
    cccClient,
    resetClient: vi.fn<() => void>(),
    queryClient: new QueryClient(),
    signer: testSigner(cccClient),
    address: "ckt1test",
    sdk,
  };
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
