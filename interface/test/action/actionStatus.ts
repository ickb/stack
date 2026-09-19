import { describe, expect, it } from "vitest";
import {
  actionLabel,
  actionMessage,
  conversionIntentText,
  isTxInfoValid,
  shownMaturityText,
  timeUntilMaturity,
  unavailableConversionMessage,
  type ActionFlags,
} from "../../src/action/actionStatus.ts";
import { noCollectionMessage, noRequestMessage } from "../../src/action/transaction.ts";
import { txInfoPadding, type TxInfo } from "../../src/shared/utils.ts";
import { txWithInput } from "./fixtures/transaction.ts";

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
    expect(actionMessage({ ...txInfo, error: "bad preview" }, flags())).toBe(
      "⚠️ bad preview",
    );
    // The preview lags the typed amount, so an availability error is worded for the screen.
    expect(actionMessage({ ...txInfo, error: noCollectionMessage }, flags())).toBe(
      `${noRequestMessage}.`,
    );
    expect(actionMessage(txInfoPadding, flags())).toBe(`${noRequestMessage}.`);
    expect(actionMessage({ ...txInfo, fee: 0n }, flags())).toBe(
      "Transaction preview is not ready.",
    );
    expect(
      actionMessage(
        {
          ...txInfo,
          conversionNotice: {
            kind: "maturity-unavailable",
            inputIckb: 2n * 100000000n,
            outputCkb: 3n * 100000000n,
            incentiveCkb: 0n,
            maturityEstimateUnavailable: true,
          },
        },
        flags(),
      ),
    ).toBe("This request converts 2 iCKB to about 3 CKB. Timing is not available yet.");
    expect(
      actionMessage(
        {
          ...txInfo,
          conversionNotice: {
            kind: "dust-ickb-to-ckb",
            inputIckb: 1n * 100000000n,
            outputCkb: 2n * 100000000n,
            incentiveCkb: 25_000_000n,
            maturityEstimateUnavailable: false,
          },
        },
        flags(),
      ),
    ).toBe(
      "This small request converts 1 iCKB to about 2 CKB and pays 0.25 CKB for the variable time.",
    );
    expect(actionMessage(txInfo, { ...flags(), amount: 0n })).toBe("");
    expect(actionMessage(txInfo, { ...flags(), hasCollectable: true })).toBe(
      "Also collects converted funds.",
    );
    expect(
      actionMessage(
        { ...txInfo, conversionKind: "collect-only" },
        { ...flags(), amount: 0n, hasCollectable: true },
      ),
    ).toBe("Collects your converted funds.");
    expect(
      actionMessage(
        { ...txInfo, conversionKind: "direct-plus-order" },
        { ...flags(), hasCollectable: true },
      ),
    ).toBe(
      "Part converts at a fixed time, the rest at a variable time, estimated below. Also collects converted funds.",
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
    ["collect-only", "Collects your converted funds."],
    ["direct", "Converts at a fixed time, shown below."],
    ["order", "Converts at a variable time, estimated below."],
    [
      "direct-plus-order",
      "Part converts at a fixed time, the rest at a variable time, estimated below.",
    ],
  ] as const)("describes %s intent exactly", (kind, expected) => {
    expect(conversionIntentText(kind)).toBe(expected);
  });

  it("derives validity and the maturity text from the preview", () => {
    const txInfo = activeTxInfo();

    expect(isTxInfoValid(txInfo, true)).toBe(true);
    expect(isTxInfoValid({ ...txInfo, fee: 0n }, true)).toBe(false);
    expect(isTxInfoValid({ ...txInfo, error: "bad" }, true)).toBe(false);
    expect(isTxInfoValid(txInfo, false)).toBe(false);
    expect(shownMaturityText(txInfo, "Ready")).toBe("Ready");
    expect(
      shownMaturityText(
        {
          ...txInfo,
          conversionNotice: {
            kind: "maturity-unavailable",
            inputIckb: 1n,
            outputCkb: 1n,
            incentiveCkb: 0n,
            maturityEstimateUnavailable: true,
          },
        },
        "Ready",
      ),
    ).toBe("waiting for CKB liquidity");
  });

  it("waits for the destination and names an invalid one", () => {
    expect(actionMessage(activeTxInfo(), { ...flags(), hasDestination: false })).toBe(
      "Checking the destination address...",
    );
    expect(
      actionMessage(activeTxInfo(), {
        ...flags(),
        hasDestination: false,
        destinationError: "Enter a valid Testnet address",
      }),
    ).toBe("⚠️ Enter a valid Testnet address");
  });

  it("says a move replaces the collection and follows a conversion", () => {
    const moveTo = "ckt1qzda…abcdef";
    const txInfo = activeTxInfo();
    expect(
      actionMessage({ ...txInfo, conversionKind: "collect-only", moveTo }, flags()),
    ).toBe("Moves everything to ckt1qzda…abcdef.");
    expect(
      actionMessage(
        { ...txInfo, conversionKind: "collect-only", moveTo },
        { ...flags(), hasCollectable: true },
      ),
    ).toBe("Also collects converted funds. Moves everything to ckt1qzda…abcdef.");
    expect(actionMessage({ ...txInfo, conversionKind: "order", moveTo }, flags())).toBe(
      "Converts at a variable time, estimated below. Moves everything to ckt1qzda…abcdef.",
    );
  });

  it("labels action availability", () => {
    expect(actionLabel(0n, true, false)).toBe("collect converted funds");
    expect(actionLabel(0n, false, false)).toBe("request conversion");
    expect(actionLabel(1n, true, false)).toBe(requestConversion);
    expect(actionLabel(1n, true, true)).toBe("move everything");
    expect(actionLabel(0n, false, true)).toBe("move everything");
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
    expect(timeUntilMaturity(10n + minute + 1n, 10n)).toBe("in 2 minutes");
    expect(timeUntilMaturity(10n + 2n * hour, 10n)).toBe("in 2 hours");
    expect(timeUntilMaturity(10n + day + 1n, 10n)).toBe("in 2 days");
  });
});

function flags(): ActionFlags {
  return {
    amount: 100000000n,
    amountError: "",
    destinationError: "",
    failure: "",
    hasCollectable: false,
    hasDestination: true,
    isFrozen: false,
    isPreparing: false,
    isStateFetching: false,
    isTxPreviewFetching: false,
    message: "",
    unavailableMessage: noRequestMessage,
  };
}

function activeTxInfo(): TxInfo {
  return {
    tx: txWithInput("11"),
    error: "",
    fee: 1n,
    estimatedMaturity: 0n,
  };
}
