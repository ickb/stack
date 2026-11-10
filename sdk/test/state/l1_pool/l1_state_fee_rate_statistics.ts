import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";
import { byte32FromByte } from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import { WALLET_LOCK_UP } from "../../../src/dao.ts";
import { IckbSdk } from "../../../src/sdk.ts";
import { headerHash } from "../../../src/utils/verified_client.ts";

describe("IckbSdk.getL1State fee rate statistics", () => {
  it("uses CCC minimum fee rate when CKB returns null fee statistics", async () => {
    const feeRateStatistics = vi.fn(() => null);
    const client = clientWithFeeRateStatistics(feeRateStatistics);

    const state = await new IckbSdk().getL1AccountState(client, [], WALLET_LOCK_UP);

    expect(feeRateStatistics).toHaveBeenCalledTimes(1);
    expect(state.system.feeRate).toBe(1000n);
  });

  it("caps the sampled fee rate at the caller's maximum through CCC", async () => {
    const client = clientWithFeeRateStatistics(() => ({
      mean: "0x7a120",
      median: "0x7a120",
    }));

    await expect(
      new IckbSdk().getL1AccountState(client, [], WALLET_LOCK_UP),
    ).resolves.toMatchObject({ system: { feeRate: 500_000n } });
    await expect(
      new IckbSdk().getL1AccountState(client, [], WALLET_LOCK_UP, 2000n),
    ).resolves.toMatchObject({ system: { feeRate: 2000n } });
  });

  it("lets a cap replace CCC's default ceiling", async () => {
    const median = ccc.numToHex(cccA.DEFAULT_MAX_FEE_RATE * 5n);
    const client = clientWithFeeRateStatistics(() => ({ mean: median, median }));

    await expect(
      new IckbSdk().getL1AccountState(
        client,
        [],
        WALLET_LOCK_UP,
        cccA.DEFAULT_MAX_FEE_RATE * 5n,
      ),
    ).resolves.toMatchObject({ system: { feeRate: cccA.DEFAULT_MAX_FEE_RATE * 5n } });
  });

  it("refuses a cap of zero or less", async () => {
    const client = clientWithFeeRateStatistics(() => null);

    for (const cap of [0n, -5n]) {
      await expect(
        new IckbSdk().getL1AccountState(client, [], WALLET_LOCK_UP, cap),
      ).rejects.toThrow("maxFeeRate must be positive");
    }
  });

  it("refuses a lock-up policy that could never send a fresh, ready request", async () => {
    const client = clientWithFeeRateStatistics(() => null);
    const epoch = (numerator: bigint, denominator: bigint): ccc.Epoch =>
      ccc.Epoch.from([0n, numerator, denominator]);
    for (const policy of [
      { ...WALLET_LOCK_UP, broadcastReserve: epoch(0n, 1n) },
      { ...WALLET_LOCK_UP, broadcastReserve: WALLET_LOCK_UP.minLockUp },
      { ...WALLET_LOCK_UP, maxLockUp: WALLET_LOCK_UP.minLockUp },
      {
        ...WALLET_LOCK_UP,
        minLockUp: ccc.Epoch.OneNervosDaoCycle,
        maxLockUp: ccc.Epoch.OneNervosDaoCycle.add(epoch(1n, 2n)),
      },
    ]) {
      const read = new IckbSdk().getL1AccountState(client, [], policy);
      await expect(read).rejects.toThrow(RangeError);
      await expect(read).rejects.toThrow(/^lockUp must satisfy /);
    }
  });

  it("propagates unrelated fee rate failures", async () => {
    const feeRateError = new TypeError(
      "Cannot destructure property 'mean' while parsing object null metadata",
    );
    const client = clientWithFeeRateStatistics(() => {
      throw feeRateError;
    });

    await expect(
      new IckbSdk().getL1AccountState(client, [], WALLET_LOCK_UP),
    ).rejects.toBe(feeRateError);
  });
});

// Built once: the tip names this exact header, timestamp included, as its parent.
const PARENT = jsonHeader(2n, byte32FromByte("cc"));

function clientWithFeeRateStatistics(feeRateStatistics: () => unknown): ccc.Client {
  return ccc.ClientPublicTestnet.new({
    transport: {
      request: async (payload): Promise<ccc.JsonRpcResponse> => {
        await Promise.resolve();
        if (payload.method === "get_fee_rate_statistics") {
          return { id: payload.id, jsonrpc: "2.0", result: feeRateStatistics() };
        }
        return {
          id: payload.id,
          jsonrpc: "2.0",
          result: await responseFor(payload.method),
        };
      },
    },
  });
}

async function responseFor(method: string): Promise<unknown> {
  await Promise.resolve();
  switch (method) {
    case "get_tip_header": {
      return jsonHeader(3n, PARENT.hash);
    }
    case "get_header_by_number": {
      return PARENT;
    }
    case "get_cells": {
      return { last_cursor: "0x", objects: [] };
    }
    default: {
      throw new Error(`Unexpected JSON-RPC method: ${method}`);
    }
  }
}

/** A real, fresh header: the SDK checks its hash against its fields and the tip's age. */
function jsonHeader(number: bigint, parentHash: ccc.Hex): { hash: ccc.Hex } {
  const fields = {
    compact_target: "0x0",
    dao: "0x0000000000000000e80300000000000000000000000000000000000000000000",
    epoch: "0x1",
    extra_hash: byte32FromByte("aa"),
    nonce: "0x0",
    number: ccc.numToHex(number),
    parent_hash: parentHash,
    proposals_hash: byte32FromByte("dd"),
    timestamp: ccc.numToHex(Date.now()),
    transactions_root: byte32FromByte("ee"),
    version: "0x0",
  } as const;
  const hash = headerHash(
    cccA.JsonRpcTransformers.blockHeaderTo({ ...fields, hash: byte32FromByte("bb") }),
  );
  return { ...fields, hash };
}
