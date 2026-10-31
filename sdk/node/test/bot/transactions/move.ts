import { ccc } from "@ckb-ccc/core";
import { StubClient } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { getConfig } from "../../../../src/constants.ts";
import { IckbUdt } from "../../../../src/udt.ts";
import { SignerCombined } from "../../../../src/utils/signer.ts";
import { buildTransaction } from "../../../src/bot/transaction.ts";
import { BAND_ICKB_BALANCE, botRuntime, botState, hash } from "../fixtures/bot.ts";

describe("buildTransaction with a second key", () => {
  it("moves a second key's iCKB-only cell, the primary key's CKB paying the fee", async () => {
    const client = new StubClient();
    const second = new ccc.SignerCkbPrivateKey(client, `0x${"22".repeat(32)}`);
    const signer = new SignerCombined([
      new ccc.SignerCkbPrivateKey(client, `0x${"11".repeat(32)}`),
      second,
    ]);
    const { script: primaryLock } = await signer.getRecommendedAddressObj();
    const { script: secondLock } = await second.getRecommendedAddressObj();
    const { ickbUdt } = getConfig("testnet");
    const plain = ccc.Cell.from({
      outPoint: { txHash: hash("71"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(1000), lock: primaryLock },
      outputData: "0x",
    });
    const ickbAt = (lock: ccc.Script): ccc.Cell =>
      ccc.Cell.from({
        outPoint: { txHash: hash("72"), index: 0n },
        cellOutput: {
          capacity: IckbUdt.minimumXudtCellCapacity(lock),
          lock,
          type: ickbUdt.script,
        },
        outputData: ccc.numLeToBytes(BAND_ICKB_BALANCE, 16),
      });
    const ickb = ickbAt(secondLock);
    const runtime = botRuntime({
      client,
      primaryLock,
      completeTransaction: async (tx, state) =>
        runtime.sdk.completeTransaction(tx, { ...state, signer }),
    });
    const state = (cells: ccc.Cell[]): ReturnType<typeof botState> =>
      botState({
        ckb: plain.cellOutput.capacity + ickb.cellOutput.capacity,
        ickb: BAND_ICKB_BALANCE,
        cells,
        system: { ...botState({}).system, feeRate: 1000n },
      });

    // The same cells at the primary lock only compact, which never sends; the second key's
    // cell holds only its own storage, so without the primary key's CKB nothing pays the fee.
    await expect(
      buildTransaction(runtime, state([plain, ickbAt(primaryLock)])),
    ).resolves.toMatchObject({ kind: "skipped", reason: "no_actions" });
    await expect(buildTransaction(runtime, state([ickb]))).resolves.toMatchObject({
      kind: "skipped",
      reason: "no_fundable_candidate",
    });
    const result = await buildTransaction(runtime, state([plain, ickb]));

    if (result.kind !== "built") {
      throw new Error("Expected a built move");
    }
    expect(result.decision.core).toEqual({ kind: "none", attempts: 1 });
    const { tx } = result;
    expect(tx.inputs.map(({ previousOutput }) => previousOutput)).toEqual([
      ickb.outPoint,
      plain.outPoint,
    ]);
    expect(tx.outputs.every(({ lock }) => lock.eq(primaryLock))).toBe(true);
    expect(tx.getOutputsUdtBalance(ickbUdt.script)).toBe(BAND_ICKB_BALANCE);
    // Completion priced every key's witness: signing changes no size.
    const signed = await signer.signTransaction(tx.clone());
    expect(signed.estimateFee(1000n)).toBe(result.plannedFee);
  });
});
