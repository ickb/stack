import { ccc } from "@ckb-ccc/core";
import { ickbExchangeRatio } from "@ickb/core";
import { OrderManager, type OrderGroup } from "@ickb/order";
import type { Runtime } from "./runtime.ts";

const MAX_ELAPSED_BLOCKS = 180n;

interface FreshMatchableOrderSkip {
  reason: "fresh-matchable-order";
  txHash: ccc.Hex;
  blockNumber: bigint;
  tipNumber: bigint;
  maxElapsedBlocks: bigint;
}

// BEFORE EDITING, STOP AND PROVE, LOCAL SAFETY IS NOT ENOUGH:
// - OWNER: tester fresh-order guard.
// - INVARIANT: fresh actionable tester-owned mints block new tester stimulus across directions.
// - FAILURE MODE: direction-narrow skips let tester transactions collect or cancel tester-owned orders, creating self-stimulus instead of clean bot stimulus.
/**
 * Skips tester stimulus while a fresh tester-owned mint is still actionable.
 *
 * @remarks The guard is direction-agnostic so tester transactions do not collect
 * or cancel fresh orders that should be left for the bot stimulus path.
 */
export async function freshMatchableOrderSkip(
  runtime: Runtime,
  orders: OrderGroup[],
  tip: ccc.ClientBlockHeader,
  {
    feeRate,
    ownedTxHash,
  }: {
    feeRate: ccc.Num;
    ownedTxHash?: ccc.Hex;
  },
): Promise<FreshMatchableOrderSkip | undefined> {
  const tx2BlockNumber = new Map<string, bigint>();
  let firstFreshMint: FreshMatchableOrderSkip | undefined;

  for (const group of orders) {
    if (!group.order.data.isMint()) {
      continue;
    }
    if (!isActionableOrder(group, tip, feeRate)) {
      continue;
    }
    const txHash = group.origin.cell.outPoint.txHash;

    let blockNumber = tx2BlockNumber.get(txHash);
    if (blockNumber === undefined) {
      let tx = await runtime.client.cache.getTransactionResponse(txHash);
      tx ??= await runtime.client.getTransaction(txHash);
      if (tx?.blockNumber === undefined) {
        throw new MissingFreshOrderOriginError(txHash);
      }

      blockNumber = tx.blockNumber;
      tx2BlockNumber.set(txHash, blockNumber);
    }

    if (blockNumber + MAX_ELAPSED_BLOCKS >= tip.number) {
      const freshMint: FreshMatchableOrderSkip = {
        reason: "fresh-matchable-order",
        txHash,
        blockNumber,
        tipNumber: tip.number,
        maxElapsedBlocks: MAX_ELAPSED_BLOCKS,
      };
      firstFreshMint ??= freshMint;
      if (txHash === ownedTxHash) {
        return freshMint;
      }
    }
  }
  return firstFreshMint;
}

/**
 * Raised when the fresh-order guard cannot prove an actionable order age.
 */
export class MissingFreshOrderOriginError extends Error {
  constructor(txHash: ccc.Hex, options?: ErrorOptions) {
    super(
      `Missing origin transaction block number for fresh-order guard: ${txHash}`,
      options,
    );
    this.name = "MissingFreshOrderOriginError";
  }
}

function isActionableOrder(
  group: OrderGroup,
  tip: ccc.ClientBlockHeader,
  feeRate: ccc.Num,
): boolean {
  const result = OrderManager.bestMatch(
    [group],
    {
      ckbValue: ccc.fixedPointFrom(1000000),
      udtValue: ccc.fixedPointFrom(1000000),
    },
    ickbExchangeRatio(tip),
    { feeRate, ckbAllowanceStep: ccc.fixedPointFrom(1), maxPartials: 1 },
  );
  return result.match.partials.length > 0 || result.kind === "incomplete";
}
