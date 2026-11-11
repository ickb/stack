import { ccc } from "@ckb-ccc/ccc";
import { describe, expect, it } from "vitest";
import {
  actionLabel,
  actionMessage,
  conversionIntentText,
  timeUntilMaturity,
  unavailableConversionMessage,
  type ActionFlags,
} from "../../src/action/actionStatus.ts";
import { noCollectionMessage, noRequestMessage } from "../../src/action/transaction.ts";
import { activeTxInfo } from "./fixtures/transaction.ts";

const walletRejected = "wallet rejected";
const requestConversion = "request conversion";

describe("action status", () => {
  it("shows the last attempt's failure as recorded", () => {
    expect(actionMessage(activeTxInfo(), { ...flags(), failure: walletRejected })).toBe(
      "⚠️ wallet rejected",
    );
    expect(actionMessage(activeTxInfo(), { ...flags(), failure: noRequestMessage })).toBe(
      `⚠️ ${noRequestMessage}`,
    );
  });

  it("shows frozen, pending, and preview messages", () => {
    const txInfo = activeTxInfo();
    expect(actionMessage(txInfo, { ...flags(), isFrozen: true, message: "Frozen" })).toBe(
      "Frozen",
    );
    expect(actionMessage(txInfo, { ...flags(), isStateFetching: true })).toBe(
      "Refreshing wallet data...",
    );
    expect(actionMessage(txInfo, { ...flags(), isTxPreviewFetching: true })).toBe(
      "Checking conversion request...",
    );
    expect(
      actionMessage(txInfo, { ...flags(), amount: 0n, isTxPreviewFetching: true }),
    ).toBe("Checking converted funds...");
    expect(actionMessage(failedTxInfo("bad preview"), flags())).toBe("⚠️ bad preview");
    // The preview lags the typed amount, so an availability error is worded for the screen.
    expect(actionMessage(failedTxInfo(noCollectionMessage), flags())).toBe(
      `${noRequestMessage}.`,
    );
    expect(actionMessage(undefined, flags())).toBe(`${noRequestMessage}.`);
    expect(
      actionMessage(failedTxInfo(noRequestMessage), {
        ...flags(),
        amount: 0n,
        unavailableMessage: noCollectionMessage,
      }),
    ).toBe(`${noCollectionMessage}.`);
    expect(
      actionMessage(
        {
          ...txInfo,
          conversionKind: "order",
          orderOccupiedCapacity: ccc.fixedPointFrom(1295),
        },
        { ...flags(), hasCollectable: true },
      ),
    ).toBe(
      "Converts when a bot fills it, estimated below. Includes 1,295 CKB of cell space, returned when collected. Also collects converted funds.",
    );
    expect(actionMessage(txInfo, { ...flags(), hasCollectable: true })).toBe(
      "Part converts at a fixed time, the rest when a bot fills it, estimated below. Also collects converted funds.",
    );
    const collectOnly = { ...txInfo, conversionKind: "collect-only" as const };
    expect(
      actionMessage(collectOnly, { ...flags(), amount: 0n, hasCollectable: true }),
    ).toBe("Collects everything that was converting.");
    // The button reads the same either way, so the line names what stays.
    expect(
      actionMessage(collectOnly, {
        ...flags(),
        amount: 0n,
        hasCollectable: true,
        hasConverting: true,
      }),
    ).toBe("Collects what is ready, the rest keeps converting.");
    expect(
      actionMessage(
        { ...txInfo, conversionKind: "direct-plus-order" },
        { ...flags(), hasCollectable: true },
      ),
    ).toBe(
      "Part converts at a fixed time, the rest when a bot fills it, estimated below. Also collects converted funds.",
    );
    expect(
      actionMessage(txInfo, { ...flags(), amount: undefined, amountError: "Bad amount" }),
    ).toBe("⚠️ Bad amount");
    expect(
      actionMessage(txInfo, { ...flags(), amount: undefined, amountError: "" }),
    ).toBe("Finish entering the amount.");
  });

  it("shows explicit refresh status while preparing a fresh preview", () => {
    expect(
      actionMessage(activeTxInfo(), {
        ...flags(),
        isPreparing: true,
        message: "Refreshing",
      }),
    ).toBe("Refreshing");
  });

  it.each([
    ["order", "Converts when a bot fills it, estimated below."],
    [
      "direct-plus-order",
      "Part converts at a fixed time, the rest when a bot fills it, estimated below.",
    ],
  ] as const)("describes %s intent exactly", (kind, expected) => {
    expect(conversionIntentText(kind)).toBe(expected);
  });

  it("labels action availability", () => {
    expect(actionLabel(0n, true)).toBe("collect converted funds");
    expect(actionLabel(0n, false)).toBe("request conversion");
    expect(actionLabel(1n, true)).toBe(requestConversion);
    expect(unavailableConversionMessage(1n)).toBe(noRequestMessage);
    expect(unavailableConversionMessage(0n)).toBe(noCollectionMessage);
  });
});

describe("timeUntilMaturity", () => {
  it("formats ready, minute, hour, and day windows", () => {
    const minute = 60_000n;
    const hour = 60n * minute;
    const day = 24n * hour;

    expect(timeUntilMaturity(9n, 10n)).toBe("now");
    expect(timeUntilMaturity(10n, 10n)).toBe("now");
    expect(timeUntilMaturity(10n + minute, 10n)).toBe("in 1 minute");
    expect(timeUntilMaturity(10n + minute + 1n, 10n)).toBe("in 2 minutes");
    expect(timeUntilMaturity(10n + 90n * minute, 10n)).toBe("in 90 minutes");
    expect(timeUntilMaturity(10n + 90n * minute + 1n, 10n)).toBe("in 2 hours");
    expect(timeUntilMaturity(10n + 2n * hour, 10n)).toBe("in 2 hours");
    expect(timeUntilMaturity(10n + day, 10n)).toBe("in 24 hours");
    expect(timeUntilMaturity(10n + day + 1n, 10n)).toBe("in 2 days");
  });
});

function flags(): ActionFlags {
  return {
    amount: 100000000n,
    amountError: "",
    failure: "",
    hasCollectable: false,
    hasConverting: false,
    isFrozen: false,
    isPreparing: false,
    isStateFetching: false,
    isTxPreviewFetching: false,
    message: "",
    unavailableMessage: noRequestMessage,
  };
}

function failedTxInfo(error: string): Parameters<typeof actionMessage>[0] {
  return { ok: false, error };
}
