import type { ccc } from "@ckb-ccc/core";
import { jsonRpcRequestor, rawTransactionStatus } from "./utils.ts";

/**
 * The header of the block that committed `txHash`, without the transaction body, which no
 * caller reads. A client with a JSON-RPC requestor, the connector's composed client
 * included, asks the node for the status only (verbosity 1) and then the header by number,
 * which CCC caches once confirmed; a cold read of the pool then moves a few bytes per
 * deposit instead of every deposit transaction. Any other client keeps the typed lookup.
 */
export async function getTransactionHeader(
  client: ccc.Client,
  txHash: ccc.Hex,
): Promise<ccc.ClientBlockHeader | undefined> {
  const requestor = jsonRpcRequestor(client);
  if (requestor === undefined) {
    return (await client.getTransactionWithHeader(txHash))?.header;
  }
  const { blockNumber } = rawTransactionStatus(
    await requestor.request("get_transaction", [txHash, "0x1"]),
  );
  return blockNumber === undefined ? undefined : client.getHeaderByNumber(blockNumber);
}

/**
 * The committing headers of a batch of transactions, each hash read once. A batch is one
 * coherent read: the cells came from one scan, so every header must exist.
 */
export async function transactionHeaders(
  client: ccc.Client,
  txHashes: Iterable<ccc.Hex>,
): Promise<Map<ccc.Hex, ccc.ClientBlockHeader>> {
  const distinct = [...new Set(txHashes)];
  const headers = await Promise.all(
    distinct.map(async (txHash) => getTransactionHeader(client, txHash)),
  );
  return new Map(
    distinct.map((txHash, index) => {
      const header = headers[index];
      if (header === undefined) {
        throw new Error(`Header not found for txHash ${txHash}`);
      }
      return [txHash, header];
    }),
  );
}

/** The headers of a batch of block numbers, each read once; every block must exist. */
export async function headersByNumber(
  client: ccc.Client,
  blockNumbers: Iterable<ccc.Num>,
): Promise<Map<ccc.Num, ccc.ClientBlockHeader>> {
  const distinct = [...new Set(blockNumbers)];
  const headers = await Promise.all(
    distinct.map(async (blockNumber) => client.getHeaderByNumber(blockNumber)),
  );
  return new Map(
    distinct.map((blockNumber, index) => {
      const header = headers[index];
      if (header === undefined) {
        throw new Error(`Header not found for block number ${String(blockNumber)}`);
      }
      return [blockNumber, header];
    }),
  );
}
