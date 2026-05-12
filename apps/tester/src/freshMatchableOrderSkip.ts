import { ccc } from "@ckb-ccc/core";
import { type OrderGroup } from "@ickb/order";
import { type Runtime } from "./runtime.js";

const MAX_ELAPSED_BLOCKS = 100800n;

type FreshMatchableOrderSkip =
  | {
      reason: "matchable-order-transaction-missing";
      txHash: ccc.Hex;
    }
  | {
      reason: "fresh-matchable-order";
      txHash: ccc.Hex;
      blockNumber: bigint;
      tipNumber: bigint;
      maxElapsedBlocks: bigint;
    };

export async function freshMatchableOrderSkip(
  runtime: Runtime,
  orders: OrderGroup[],
  tip: ccc.ClientBlockHeader,
): Promise<FreshMatchableOrderSkip | undefined> {
  const tx2BlockNumber = new Map<string, bigint>();

  for (const group of orders) {
    if (!group.order.isMatchable()) {
      continue;
    }

    const txHash = group.order.cell.outPoint.txHash;
    let blockNumber = tx2BlockNumber.get(txHash);
    if (blockNumber === undefined) {
      const tx = await runtime.client.getTransaction(txHash);
      if (tx?.blockNumber === undefined) {
        return { reason: "matchable-order-transaction-missing", txHash };
      }

      blockNumber = tx.blockNumber;
      tx2BlockNumber.set(txHash, blockNumber);
    }

    if (blockNumber + MAX_ELAPSED_BLOCKS >= tip.number) {
      return {
        reason: "fresh-matchable-order",
        txHash,
        blockNumber,
        tipNumber: tip.number,
        maxElapsedBlocks: MAX_ELAPSED_BLOCKS,
      };
    }
  }
}
