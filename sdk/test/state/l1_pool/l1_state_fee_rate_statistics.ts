import { ccc } from "@ckb-ccc/core";
import { describe, expect, it, vi } from "vitest";
import { headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import {
  defaultL1Sdk,
  emptyCellScan,
  FeeRateStubClient,
  tipHeaderHandler,
} from "../l1_account/support/sdk_l1_support.ts";

describe("IckbSdk.getL1State fee rate statistics", () => {
  it("uses CCC minimum fee rate when CKB returns null fee statistics", async () => {
    const feeRateStatistics = vi.fn(() => null);
    const client = clientWithFeeRateStatistics(feeRateStatistics);

    const state = await defaultL1Sdk().getL1AccountState(client, []);

    expect(feeRateStatistics).toHaveBeenCalledTimes(1);
    expect(state.system.feeRate).toBe(1000n);
  });

  it("propagates unrelated fee rate failures", async () => {
    const feeRateError = new TypeError(
      "Cannot destructure property 'mean' while parsing object null metadata",
    );
    const client = clientWithFeeRateStatistics(() => {
      throw feeRateError;
    });

    await expect(defaultL1Sdk().getL1AccountState(client, [])).rejects.toBe(feeRateError);
  });

  it("rejects a negative fee rate returned by a custom client", async () => {
    const client = new FeeRateStubClient(
      {
        findCellsPagedNoCache: emptyCellScan,
        getTipHeader: tipHeaderHandler(headerLike(3n)),
      },
      -1n,
    );

    await expect(defaultL1Sdk().getL1AccountState(client, [])).rejects.toThrow(
      "Client fee rate must be non-negative",
    );
  });
});

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
      return {
        compact_target: "0x0",
        dao: "0x0000000000000000e80300000000000000000000000000000000000000000000",
        epoch: "0x1",
        extra_hash: byte32("aa"),
        hash: byte32("bb"),
        nonce: "0x0",
        number: "0x3",
        parent_hash: byte32("cc"),
        proposals_hash: byte32("dd"),
        timestamp: "0x0",
        transactions_root: byte32("ee"),
        version: "0x0",
      };
    }
    case "get_cells": {
      return { last_cursor: "0x", objects: [] };
    }
    default: {
      throw new Error(`Unexpected JSON-RPC method: ${method}`);
    }
  }
}

function byte32(byte: string): string {
  return `0x${byte.repeat(32)}`;
}
