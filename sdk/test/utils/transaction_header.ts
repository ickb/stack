import { ccc } from "@ckb-ccc/core";
import { chainState, FakeClient, headerLike } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { getTransactionHeader } from "../../src/utils/transaction_header.ts";

const TX_HASH: ccc.Hex = `0x${"ab".repeat(32)}`;

function jsonRpcClient(
  status: unknown,
  header: ccc.ClientBlockHeader | undefined,
): { client: ccc.Client; methods: string[] } {
  const methods: string[] = [];
  const client = ccc.ClientPublicTestnet.new({
    transport: {
      request: async (payload): Promise<ccc.JsonRpcResponse> => {
        await Promise.resolve();
        methods.push(payload.method);
        if (payload.method === "get_transaction") {
          expect(payload.params).toEqual([TX_HASH, "0x1"]);
          return { id: payload.id, jsonrpc: "2.0", result: status };
        }
        if (payload.method === "get_header_by_number") {
          return {
            id: payload.id,
            jsonrpc: "2.0",
            result: header === undefined ? null : rawHeader(header),
          };
        }
        throw new Error(`Unexpected ${payload.method}`);
      },
    },
  });
  return { client, methods };
}

/** The node's JSON shape of a header, the inverse of CCC's parser for the fields it reads. */
function rawHeader(header: ccc.ClientBlockHeader): Record<string, string> {
  const dao = new Uint8Array(32);
  for (const [index, value] of [
    header.dao.c,
    header.dao.ar,
    header.dao.s,
    header.dao.u,
  ].entries()) {
    dao.set(ccc.numLeToBytes(value, 8), index * 8);
  }
  return {
    compact_target: ccc.numToHex(header.compactTarget),
    dao: ccc.hexFrom(dao),
    epoch: ccc.numToHex(header.epoch.toNum()),
    extra_hash: header.extraHash,
    hash: header.hash,
    nonce: ccc.numToHex(header.nonce),
    number: ccc.numToHex(header.number),
    parent_hash: header.parentHash,
    proposals_hash: header.proposalsHash,
    timestamp: ccc.numToHex(header.timestamp),
    transactions_root: header.transactionsRoot,
    version: ccc.numToHex(header.version),
  };
}

describe("getTransactionHeader", () => {
  it("reads the status only, then the header by number, on a JSON-RPC client", async () => {
    const header = ccc.ClientBlockHeader.from(headerLike({ number: 77n }));
    const { client, methods } = jsonRpcClient(
      { transaction: null, tx_status: { status: "committed", block_number: "0x4d" } },
      header,
    );

    await expect(getTransactionHeader(client, TX_HASH)).resolves.toMatchObject({
      number: 77n,
      hash: header.hash,
    });
    expect(methods).toEqual(["get_transaction", "get_header_by_number"]);
  });

  it("reports no header for a transaction that is not committed or a malformed status", async () => {
    for (const status of [
      { transaction: null, tx_status: { status: "pending", block_number: null } },
      { transaction: null, tx_status: null },
      { transaction: null },
      null,
      "malformed",
    ]) {
      const { client, methods } = jsonRpcClient(status, undefined);
      await expect(getTransactionHeader(client, TX_HASH)).resolves.toBeUndefined();
      expect(methods).toEqual(["get_transaction"]);
    }
  });

  it("keeps the typed lookup on other clients", async () => {
    const client = new FakeClient(chainState());

    await expect(getTransactionHeader(client, TX_HASH)).resolves.toBeUndefined();
  });
});
