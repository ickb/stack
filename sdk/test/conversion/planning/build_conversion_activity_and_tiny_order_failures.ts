import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConversionTransaction } from "../../../src/build.ts";
import { completeTransaction } from "../../../src/complete.ts";
import { baseTip, state } from "../../transaction/base/support/sdk_core_support.ts";
import {
  spentOutPoints,
  stubSigner,
} from "../deposits_and_limits/support/sdk_fixture_support.ts";
import { placeholderWithdrawal } from "../withdrawal_quotes/support/sdk_cell_support.ts";

// The built transaction as is: these tests read what the builders put in.
vi.mock(import("../../../src/complete.ts"), async (importOriginal) =>
  (
    await import("../deposits_and_limits/support/passthrough_completion.ts")
  ).passthroughCompletion(await importOriginal()),
);

afterEach(() => {
  vi.restoreAllMocks();
});

const CKB_TO_ICKB = "ckb-to-ickb";
const ICKB_TO_CKB = "ickb-to-ckb";

const AMOUNT_TOO_SMALL = "amount-too-small";
const FULL_WORKSPACE_TIMEOUT_MS = 20_000;
describe("buildConversionTransaction", () => {
  it("refuses a negative amount and returns typed failures past the balance", async () => {
    await expect(
      buildConversionTransaction({
        direction: CKB_TO_ICKB,
        amount: -1n,
        signer: stubSigner,
        state: state(),
      }),
    ).rejects.toThrow(new RangeError("Conversion amount is negative"));
    await expect(
      buildConversionTransaction({
        direction: CKB_TO_ICKB,
        amount: 2n,
        signer: stubSigner,
        state: state({ ckbAvailable: 1n }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "insufficient-ckb" });
    await expect(
      buildConversionTransaction({
        direction: ICKB_TO_CKB,
        amount: 2n,
        signer: stubSigner,
        state: state({ ickbAvailable: 1n }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "insufficient-ickb" });
  });

  it("refuses a direction that is neither of the two, at any amount", async () => {
    const sideways = new TypeError("Unknown conversion direction: sideways");

    for (const amount of [0n, 1n]) {
      await expect(
        buildConversionTransaction({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- A plain-JS caller's typo, which TypeScript cannot see.
          direction: JSON.parse('"sideways"'),
          amount,
          signer: stubSigner,
          state: state({ ckbAvailable: 1n, ickbAvailable: 1n }),
        }),
      ).rejects.toThrow(sideways);
    }
  });

  it("returns typed failures for tiny orders", async () => {
    await expect(
      buildConversionTransaction({
        direction: CKB_TO_ICKB,
        amount: 1n,
        signer: stubSigner,
        state: state({
          ckbAvailable: 1n,
          ickbAvailable: 0n,
        }),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: AMOUNT_TOO_SMALL,
      // Ten mining fees at fee rate 1, plus one, at the 0.01% order fee.
      minimum: 110_000n,
    });
    await expect(
      buildConversionTransaction({
        direction: ICKB_TO_CKB,
        amount: 1n,
        signer: stubSigner,
        state: state({ ickbAvailable: 1n }),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: AMOUNT_TOO_SMALL,
      // A sell can pay its whole value as fee: ten mining fees plus one, at par.
      minimum: 11n,
    });
  });

  it("returns collect-only success when the collection has activity", async () => {
    const result = await buildConversionTransaction({
      direction: CKB_TO_ICKB,
      amount: 0n,
      signer: stubSigner,
      state: state({
        readyWithdrawals: [placeholderWithdrawal],
        hasCollectable: true,
        // A collection takes only what is ready, so it is done at the tip.
        estimatedMaturity: 99n,
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      conversionKind: "collect-only",
      estimatedMaturity: baseTip.timestamp,
    });
    if (!result.ok) {
      throw new Error("Expected a collection");
    }
    // The collection spends the ready withdrawal request and its owner marker.
    expect(spentOutPoints(result.tx)).toEqual([
      placeholderWithdrawal.owned.cell.outPoint.toHex(),
      placeholderWithdrawal.owner.cell.outPoint.toHex(),
    ]);
  });

  it("returns a collection's shortfall as the build's value", async () => {
    const cause = new ccc.ErrorTransactionInsufficientCapacity(1n);
    vi.mocked(completeTransaction).mockResolvedValueOnce({
      ok: false,
      reason: "insufficient-capacity",
      cause,
    });

    await expect(
      buildConversionTransaction({
        direction: CKB_TO_ICKB,
        amount: 0n,
        signer: stubSigner,
        state: state({ readyWithdrawals: [placeholderWithdrawal], hasCollectable: true }),
      }),
    ).resolves.toEqual({ ok: false, reason: "insufficient-capacity", cause });
  });

  it("refuses amount zero without anything to collect", async () => {
    const cell = ccc.Cell.from({
      outPoint: { txHash: `0x${"78".repeat(32)}`, index: 0 },
      cellOutput: { capacity: ccc.fixedPointFrom(200), lock: script("11") },
      outputData: "0x",
    });

    // Liquid cells alone would only be compacted, which is not worth a fee.
    await expect(
      buildConversionTransaction({
        direction: CKB_TO_ICKB,
        amount: 0n,
        signer: stubSigner,
        state: state({ cells: [cell] }),
      }),
    ).rejects.toThrow(new Error("Nothing to collect"));
  });
});

describe("buildConversionTransaction order-only paths", () => {
  it(
    "builds an order-only iCKB-to-CKB conversion while collecting ready withdrawals",
    async () => {
      await expect(
        buildConversionTransaction({
          direction: ICKB_TO_CKB,
          amount: ccc.fixedPointFrom(1),
          signer: stubSigner,
          state: state({
            readyWithdrawals: [placeholderWithdrawal],
            ickbAvailable: ccc.fixedPointFrom(1),
          }),
        }),
      ).resolves.toMatchObject({ ok: true, conversionKind: "order" });
    },
    FULL_WORKSPACE_TIMEOUT_MS,
  );
});
