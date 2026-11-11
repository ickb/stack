import { ccc } from "@ckb-ccc/ccc";
import type { buildConversionTransaction, ConversionKind } from "@ickb/sdk";
import { byte32FromByte, headerLike, script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTransactionPreview } from "../../src/action/transaction.ts";
import {
  buildConversionTransactionMock,
  failedPlan,
  state,
  successfulPlan,
  txWithInput,
  walletConfigWith,
} from "./fixtures/transaction.ts";

// Each test scripts the SDK's build through the fixture's `walletConfigWith`.
vi.mock(import("@ickb/sdk"), async (importOriginal) => ({
  ...(await importOriginal()),
  buildConversionTransaction: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildTransactionPreview", () => {
  it("delegates planning and completion to the SDK and reports the planned fee", async () => {
    const tx = txWithInput("99");
    const buildConversionTransaction = buildConversionTransactionMock(
      successfulPlan({
        tx,
        plannedFee: 42n,
        estimatedMaturity: 123n,
        orderOccupiedCapacity: 9n,
      }),
    );
    const txState = state();
    const config = walletConfigWith({ buildConversionTransaction });

    const txInfo = await buildTransactionPreview(txState, true, 7n, config);

    expect(buildConversionTransaction).toHaveBeenCalledTimes(1);
    expect(buildConversionTransaction.mock.calls[0]?.[0]).toEqual({
      direction: "ckb-to-ickb",
      amount: 7n,
      signer: config.signer,
      state: txState,
    });
    expect(txInfo).toMatchObject({
      ok: true,
      tx,
      plannedFee: 42n,
      estimatedMaturity: 123n,
      orderOccupiedCapacity: 9n,
    });
  });

  it("delegates iCKB-to-CKB direction without leaking app managers", async () => {
    const buildConversionTransaction = buildConversionTransactionMock();
    const config = walletConfigWith({ buildConversionTransaction });

    await buildTransactionPreview(state({ ickbAvailable: 5n }), false, 5n, config);

    expect(buildConversionTransaction.mock.calls[0]?.[0]).toMatchObject({
      direction: "ickb-to-ckb",
      amount: 5n,
    });
  });

  it.each<ConversionKind>(["collect-only", "direct", "order", "direct-plus-order"])(
    "preserves SDK conversion intent %s",
    async (kind) => {
      const config = walletConfigWith({
        buildConversionTransaction: buildConversionTransactionMock(
          successfulPlan({ conversionKind: kind }),
        ),
      });

      await expect(
        buildTransactionPreview(state({ ckbAvailable: 1n }), true, 1n, config),
      ).resolves.toMatchObject({
        conversionKind: kind,
      });
    },
  );
});

describe("buildTransactionPreview failure messages", () => {
  it("maps SDK planner failures to interface copy", async () => {
    const cases: Array<["insufficient-ckb" | "insufficient-ickb", string]> = [
      ["insufficient-ckb", "More CKB than you have"],
      ["insufficient-ickb", "More iCKB than you have"],
    ];

    for (const [reason, message] of cases) {
      const config = walletConfigWith({
        buildConversionTransaction: buildConversionTransactionMock(failedPlan(reason)),
      });

      await expect(
        buildTransactionPreview(state({ ckbAvailable: 1n }), true, 1n, config),
      ).resolves.toEqual({ ok: false, error: message });
    }
  });

  it("names the SDK's minimum, rounded up", async () => {
    for (const [isCkb2Udt, minimum, message] of [
      [true, 33_222_000_000n, "Enter at least 340 CKB"],
      [true, 1_040_000_000n, "Enter at least 11 CKB"],
      [false, 95n, "Enter at least 0.00000095 iCKB"],
      [false, 5n, "Enter at least 0.00000005 iCKB"],
      // A minimum already round stays as it is.
      [true, 1_200_000_000n, "Enter at least 12 CKB"],
    ] as const) {
      const config = walletConfigWith({
        buildConversionTransaction: buildConversionTransactionMock({
          ok: false,
          reason: "amount-too-small",
          minimum,
        }),
      });

      await expect(
        buildTransactionPreview(state({ ckbAvailable: 1n }), isCkb2Udt, 1n, config),
      ).resolves.toMatchObject({ error: message });
    }
  });

  it("says nothing to do at amount zero with nothing to collect, without the SDK", async () => {
    // The SDK throws for that request: the screen asks hasCollectable first.
    const buildConversionTransaction = buildConversionTransactionMock();
    const config = walletConfigWith({ buildConversionTransaction });

    await expect(
      buildTransactionPreview(state({ ckbAvailable: 1n }), true, 0n, config),
    ).resolves.toEqual({ ok: false, error: "Nothing to do" });
    expect(buildConversionTransaction).not.toHaveBeenCalled();
  });

  it("asks the SDK for a collection when there is something to collect", async () => {
    const receipt = {
      cell: ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("ab"), index: 0n },
        cellOutput: { capacity: 0n, lock: script("11") },
        outputData: "0x",
      }),
      header: headerLike(),
      ckbValue: 0n,
      udtValue: 0n,
    };
    const buildConversionTransaction = buildConversionTransactionMock(
      successfulPlan({ conversionKind: "collect-only" }),
    );
    const config = walletConfigWith({ buildConversionTransaction });

    await expect(
      buildTransactionPreview(
        state({ receipts: [receipt], hasCollectable: true }),
        true,
        0n,
        config,
      ),
    ).resolves.toMatchObject({ ok: true, conversionKind: "collect-only" });
    expect(buildConversionTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("buildTransactionPreview deadline", () => {
  it("carries the SDK's broadcast deadline into the preview", async () => {
    const broadcastBefore = {
      epoch: ccc.Epoch.from([7n, 0n, 1n]),
      tipMaxAgeMs: 1_800_000,
    };
    const buildConversionTransaction = buildConversionTransactionMock(
      successfulPlan({ broadcastBefore }),
    );
    const config = walletConfigWith({ buildConversionTransaction });

    const txInfo = await buildTransactionPreview(state(), false, 1n, config);

    expect(txInfo).toMatchObject({ ok: true, broadcastBefore });
    // A plan without cell space leaves the field out rather than undefined.
    expect(txInfo).not.toHaveProperty("orderOccupiedCapacity");
  });
});

describe("buildTransactionPreview completion", () => {
  it("does not complete locally: the SDK returns the funded transaction", async () => {
    const completeFeeBy = vi
      .spyOn(ccc.Transaction.prototype, "completeFeeBy")
      .mockResolvedValue([0, false]);

    const config = walletConfigWith({});
    await buildTransactionPreview(state({ ckbAvailable: 1n }), true, 1n, config);

    expect(completeFeeBy).not.toHaveBeenCalled();
  });
});

describe("buildTransactionPreview thrown failures", () => {
  it("surfaces thrown SDK failures as TxInfo errors", async () => {
    const plannerFailure = walletConfigWith({
      buildConversionTransaction: vi
        .fn<typeof buildConversionTransaction>()
        .mockRejectedValue(new Error("planner failed")),
    });
    await expect(
      buildTransactionPreview(state({ ckbAvailable: 1n }), true, 1n, plannerFailure),
    ).resolves.toMatchObject({ error: "planner failed" });
  });

  it("names what ran out when completion falls short past the planner's checks", async () => {
    const config = walletConfigWith({
      buildConversionTransaction: buildConversionTransactionMock({
        ok: false,
        reason: "insufficient-capacity",
        cause: new ccc.ErrorTransactionInsufficientCapacity(61n),
      }),
    });

    await expect(
      buildTransactionPreview(state({ ckbAvailable: 1n }), true, 1n, config),
    ).resolves.toEqual({
      ok: false,
      error: "Not enough spare CKB for the cells and the fee",
    });
  });
});
