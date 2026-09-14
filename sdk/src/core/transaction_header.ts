import { ccc } from "@ckb-ccc/core";

/**
 * The header of the block that committed `txHash`, without the transaction body, which no
 * caller reads. A JSON-RPC client asks the node for the status only (verbosity 1) and then
 * the header by number, which CCC caches once confirmed; a cold read of the pool then
 * moves a few bytes per deposit instead of every deposit transaction. Other clients keep
 * the typed lookup.
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
