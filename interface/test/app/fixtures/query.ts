import { ccc } from "@ckb-ccc/ccc";
import { ickb } from "@ickb/sdk";
import { byte32FromByte, offlineTestnetClient } from "@ickb/testkit";
import { QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";
import type { getL1State } from "../../../src/app/queries.ts";

/**
 * A wallet config whose signer's read is `state` and whose every build is short of CKB,
 * through the test file's mocks of `ickb.readState` and `ickb.buildConversionTransaction`.
 */
export function walletConfigReading(state: ickb.State): Parameters<typeof getL1State>[0] {
  vi.mocked(ickb.readState).mockResolvedValue(state);
  const cccClient = offlineTestnetClient();
  vi.mocked(ickb.buildConversionTransaction).mockResolvedValue({
    ok: false,
    reason: "insufficient-ckb",
  });
  return {
    chain: "testnet",
    cccClient,
    queryClient: new QueryClient(),
    signer: testSigner(cccClient),
    address: "ckt1test",
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
