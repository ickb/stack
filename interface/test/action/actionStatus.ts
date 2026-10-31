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
      actionMessage(
        {
          ...txInfo,
          conversionKind: "order",
          conversionNotice: {
            inputIckb: 1n * 100000000n,
            outputCkb: 2n * 100000000n,
            incentiveCkb: 25_000_000n,
          },
        },
        flags(),
      ),
    ).toBe(
      "Converts when a bot fills it, estimated below. This small request converts 1 iCKB to about 2 CKB and pays 0.25 CKB for the variable time.",
    );
    expect(actionMessage(txInfo, { ...flags(), hasCollectable: true })).toBe(
      "Converts at a fixed time, shown below. Also collects converted funds.",
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
    ["direct", "Converts at a fixed time, shown below."],
    ["order", "Converts when a bot fills it, estimated below."],
    [
      "direct-plus-order",
      "Part converts at a fixed time, the rest when a bot fills it, estimated below.",
    ],
  ] as const)("describes %s intent exactly", (kind, expected) => {
    expect(conversionIntentText(kind)).toBe(expected);
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

  it("says a send to another address replaces the collection and may need another run", () => {
    const move = { to: "ckt1qzda…abcdef", isComplete: true };
    const txInfo = { ...activeTxInfo(), conversionKind: "collect-only" as const };
    expect(actionMessage({ ...txInfo, move }, flags())).toBe(
      "Sends all CKB and iCKB in this wallet to ckt1qzda…abcdef, without converting. Funds still converting stay here: collect them from this wallet later.",
    );
    expect(
      actionMessage(
        { ...txInfo, move: { ...move, isComplete: false } },
        { ...flags(), hasCollectable: true },
      ),
    ).toBe(
      "Sends all CKB and iCKB in this wallet to ckt1qzda…abcdef, without converting. Also collects converted funds. Funds still converting stay here: collect them from this wallet later. Run it again until everything has been sent.",
    );
  });

  it("labels action availability", () => {
    expect(actionLabel(0n, true, false)).toBe("collect converted funds");
    expect(actionLabel(0n, false, false)).toBe("request conversion");
    expect(actionLabel(1n, true, false)).toBe(requestConversion);
    expect(actionLabel(0n, false, true)).toBe("send all CKB and iCKB");
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
    hasConverting: false,
    hasDestination: true,
    isFrozen: false,
    isPreparing: false,
    isStateFetching: false,
    isTxPreviewFetching: false,
    message: "",
    unavailableMessage: noRequestMessage,
  };
}

function failedTxInfo(error: string): Parameters<typeof actionMessage>[0] {
  return { ok: false, error, estimatedMaturity: 0n };
}
