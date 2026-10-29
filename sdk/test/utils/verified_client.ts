import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";
import { script, StubClient } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifiedClient } from "../../src/utils/verified_client.ts";
import { TESTNET_HEADERS } from "./fixtures/testnet_headers.ts";

const [GENESIS_RAW, BLOCK_RAW] = TESTNET_HEADERS;
const GENESIS = cccA.JsonRpcTransformers.blockHeaderTo(GENESIS_RAW);
const BLOCK = cccA.JsonRpcTransformers.blockHeaderTo(BLOCK_RAW);

/** The block header with its DAO rate understated by one, under the real hash. */
function understated(raw: cccA.JsonRpcBlockHeader): ccc.ClientBlockHeader {
  const dao = ccc.bytesFrom(raw.dao);
  dao.set(ccc.numLeToBytes(ccc.numLeFromBytes(dao.subarray(8, 16)) - 1n, 8), 8);
  return cccA.JsonRpcTransformers.blockHeaderTo({ ...raw, dao: ccc.hexFrom(dao) });
}

/** A client answering `header` from every header read. */
function answering(header: ccc.ClientBlockHeader | undefined): ccc.Client {
  const cell = ccc.Cell.from({
    outPoint: { txHash: `0x${"11".repeat(32)}`, index: 0n },
    cellOutput: { capacity: 0n, lock: script("22") },
    outputData: "0x",
  });
  const transaction = ccc.ClientTransactionResponse.from({
    transaction: ccc.Transaction.default(),
    status: "committed",
  });
  const answer = async (): Promise<ccc.ClientBlockHeader | undefined> => {
    await Promise.resolve();
    return header;
  };
  return verifiedClient(
    new StubClient({
      getTipHeader: async (): Promise<ccc.ClientBlockHeader> =>
        (await answer()) ?? GENESIS,
      getHeaderByNumber: answer,
      getHeaderByHash: answer,
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        const answered = await answer();
        return answered === undefined ? undefined : { transaction, header: answered };
      },
      getCellWithHeader: async (): ReturnType<ccc.Client["getCellWithHeader"]> => {
        const answered = await answer();
        return answered === undefined ? undefined : { cell, header: answered };
      },
    }),
  );
}

/** Every header read the wrapper covers, as a caller would make it. */
const READS: Record<string, (client: ccc.Client) => Promise<unknown>> = {
  getTipHeader: async (client) => client.getTipHeader(),
  getHeaderByNumber: async (client) => client.getHeaderByNumber(0n),
  getHeaderByHash: async (client) => client.getHeaderByHash(GENESIS.hash),
  getTransactionWithHeader: async (client) =>
    client.getTransactionWithHeader(GENESIS.hash),
  getCellWithHeader: async (client) =>
    client.getCellWithHeader({ txHash: GENESIS.hash, index: 0n }),
};

afterEach(() => {
  vi.useRealTimers();
});

describe("verifiedClient", () => {
  it("hands out real testnet headers, genesis and a mined block, as the node answered them", async () => {
    for (const header of [GENESIS, BLOCK]) {
      const client = answering(header);
      await expect(client.getTipHeader()).resolves.toBe(header);
      await expect(client.getHeaderByNumber(header.number)).resolves.toBe(header);
      await expect(client.getHeaderByHash(header.hash)).resolves.toBe(header);
      await expect(client.getTransactionWithHeader(header.hash)).resolves.toMatchObject({
        header,
      });
      await expect(
        client.getCellWithHeader({ txHash: header.hash, index: 0n }),
      ).resolves.toMatchObject({ header });
    }
  });

  it("refuses a header whose fields do not hash to its hash, on every read", async () => {
    const altered = understated(BLOCK_RAW);
    expect(altered.hash).toBe(BLOCK.hash);
    expect(altered.dao.ar).toBe(BLOCK.dao.ar - 1n);
    for (const read of Object.values(READS)) {
      await expect(read(answering(altered))).rejects.toThrow(
        `Header ${BLOCK.hash} carries the fields of`,
      );
    }
  });

  it("refuses a real header of another block than the one asked for", async () => {
    const client = answering(BLOCK);
    await expect(client.getHeaderByNumber(GENESIS.number)).rejects.toThrow(
      `Header ${BLOCK.hash} answers for block 0`,
    );
    await expect(client.getHeaderByHash(GENESIS.hash)).rejects.toThrow(
      `Header ${BLOCK.hash} answers for ${GENESIS.hash}`,
    );
  });

  it("passes an absent header through", async () => {
    const client = answering(undefined);
    await expect(client.getHeaderByNumber(1n)).resolves.toBeUndefined();
    await expect(client.getHeaderByHash(BLOCK.hash)).resolves.toBeUndefined();
    await expect(client.getTransactionWithHeader(BLOCK.hash)).resolves.toBeUndefined();
    await expect(
      client.getCellWithHeader({ txHash: GENESIS.hash, index: 0n }),
    ).resolves.toBeUndefined();
  });

  it("bounds the tip's age only when asked, against the local clock", async () => {
    // The real block is the tip; the clock decides whether it is stale.
    const bound = 300_000;
    const bounded = verifiedClient(answering(BLOCK), bound);

    vi.useFakeTimers({ now: Number(BLOCK.timestamp) + bound });
    await expect(bounded.getTipHeader()).resolves.toBe(BLOCK);
    vi.useFakeTimers({ now: Number(BLOCK.timestamp) + bound + 1 });
    await expect(bounded.getTipHeader()).rejects.toThrow(
      `Tip ${BLOCK.hash} is more than ${String(bound)} ms old`,
    );
    await expect(verifiedClient(answering(BLOCK)).getTipHeader()).resolves.toBe(BLOCK);
  });

  it("hands out a transaction only under the hash of its body", async () => {
    const response = ccc.ClientTransactionResponse.from({
      transaction: ccc.Transaction.from({
        outputs: [{ capacity: 1n, lock: script("22") }],
      }),
      status: "committed",
    });
    const real = response.transaction.hash();
    const other: ccc.Hex = `0x${"33".repeat(32)}`;
    const answer = async (
      txHash: ccc.HexLike,
    ): Promise<ccc.ClientTransactionResponse | undefined> => {
      await Promise.resolve();
      return ccc.hexFrom(txHash) === `0x${"44".repeat(32)}` ? undefined : response;
    };
    const client = verifiedClient(
      new StubClient({ getTransaction: answer, getTransactionNoCache: answer }),
    );
    for (const method of ["getTransaction", "getTransactionNoCache"] as const) {
      const read = async (
        txHash: ccc.Hex,
      ): Promise<ccc.ClientTransactionResponse | undefined> => client[method](txHash);
      await expect(read(real)).resolves.toBe(response);
      await expect(read(other)).rejects.toThrow(
        `Transaction ${other} was answered with a body of another hash`,
      );
      await expect(read(`0x${"44".repeat(32)}`)).resolves.toBeUndefined();
    }
  });

  it("forwards everything else to the wrapped client", () => {
    const inner = new StubClient();
    const client = verifiedClient(inner, 1);

    expect(client.addressPrefix).toBe(inner.addressPrefix);
    expect(client.cache).toBe(inner.cache);
    expect(client).toMatchObject({ tipMaxAgeMs: 1 });
  });
});
