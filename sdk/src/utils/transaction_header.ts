import { ccc } from "@ckb-ccc/core";

/**
 * The header of the block that committed `txHash`, without the transaction body, which no
 * caller reads. A JSON-RPC client asks the node for the status only (verbosity 1) and then
 * the header by number, which CCC caches once confirmed; a cold read of the pool then
 * moves a few bytes per deposit instead of every deposit transaction. The interface's
 * client, the connector's composition proxy over the public client, is not a JSON-RPC
 * client and keeps the typed lookup.
 */
export async function getTransactionHeader(
  client: ccc.Client,
  txHash: ccc.Hex,
): Promise<ccc.ClientBlockHeader | undefined> {
  if (!(client instanceof ccc.ClientJsonRpc)) {
    return (await client.getTransactionWithHeader(txHash))?.header;
  }
  const blockNumber = committedBlockNumber(
    await client.requestor.request("get_transaction", [txHash, "0x1"]),
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

/** The block number of a committed status record; anything else is not committed. */
function committedBlockNumber(response: unknown): ccc.Num | undefined {
  if (
    typeof response !== "object" ||
    response === null ||
    !("tx_status" in response) ||
    typeof response.tx_status !== "object" ||
    response.tx_status === null ||
    !("block_number" in response.tx_status) ||
    typeof response.tx_status.block_number !== "string"
  ) {
    return undefined;
  }
  return ccc.numFrom(response.tx_status.block_number);
}
