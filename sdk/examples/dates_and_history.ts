import type { ccc } from "@ckb-ccc/core";
import { ickb } from "@ickb/sdk";

export async function datesAndHistory(signer: ccc.Signer): Promise<void> {
  const state = await ickb.readState(signer);
  for (const position of [...state.pendingOrders, ...state.pendingWithdrawals]) {
    const { createdAt, readyAt } = ickb.datesOf(state, position);
    console.log("Made", new Date(Number(createdAt)), "ready", new Date(Number(readyAt)));
  }

  // Newest first, across every address of the wallet; a break stops the reads.
  for await (const { timestamp, operations } of ickb.readHistory(signer)) {
    const kinds = operations.map((op) => op.kind);
    console.log(new Date(Number(timestamp)), kinds);
  }
}
