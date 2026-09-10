import { describe, expect, it } from "vitest";
import {
  actionDisabled,
  actionDone,
  actionLabel,
  actionMessage,
  canPreviewTx,
  conversionIntentText,
  currentTxInfo,
  failureForPreview,
  isAvailabilityMessage,
  isTxInfoValid,
  shownMaturityText,
  unavailableConversionMessage,
} from "../../src/action/actionStatus.ts";
import { timeUntilMaturity } from "../../src/action/actionTime.ts";
import { noCollectionMessage, noRequestMessage } from "../../src/action/transaction.ts";
import { txInfoPadding, type TxInfo } from "../../src/shared/utils.ts";
import { txWithInput } from "./fixtures/transaction.ts";

const walletRejected = "wallet rejected";
const requestConversion = "request conversion";
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Minimal L1 state sentinel is enough for canPreviewTx branch coverage.
const l1State = {} as Parameters<typeof canPreviewTx>[1];

describe("action status", () => {
  it("prioritizes stored failures and availability messages", () => {
    expect(
      actionMessage({
        ...messageParams(),
        failure: walletRejected,
        showFailure: true,
      }),
    ).toBe("⚠️ wallet rejected");
    expect(
      actionMessage({
        ...messageParams(),
        failure: noRequestMessage,
        showFailure: true,
      }),
    ).toBe(`${noRequestMessage}.`);
    expect(isAvailabilityMessage(noCollectionMessage)).toBe(true);
    expect(isAvailabilityMessage(walletRejected)).toBe(false);
  });

  it("shows frozen, pending, and preview messages", () => {
    expect(actionMessage({ ...messageParams(), isFrozen: true, message: "Frozen" })).toBe(
      "Frozen",
    );
    expect(actionMessage({ ...messageParams(), isStateFetching: true })).toBe(
      "Refreshing wallet data...",
    );
    expect(actionMessage({ ...messageParams(), isTxPreviewFetching: true })).toBe(
      "Checking conversion request...",
    );
    expect(
      actionMessage({
        ...messageParams(),
        amount: 0n,
        isTxPreviewFetching: true,
      }),
    ).toBe("Checking converted funds...");
    expect(actionMessage({ ...messageParams(), txError: "bad preview" })).toBe(
      "⚠️ bad preview",
    );
    expect(actionMessage({ ...messageParams(), hasActivity: false })).toBe(
      `${noRequestMessage}.`,
    );
    expect(actionMessage({ ...messageParams(), isValid: false })).toBe(
      "Transaction preview is not ready.",
    );
    expect(
      actionMessage({
        ...messageParams(),
        conversionNotice: {
          kind: "maturity-unavailable",
          inputIckb: 2n * 100000000n,
          outputCkb: 3n * 100000000n,
          incentiveCkb: 0n,
          maturityEstimateUnavailable: true,
        },
      }),
    ).toBe("This request converts 2 iCKB to about 3 CKB. Timing is not available yet.");
    expect(
      actionMessage({
        ...messageParams(),
        conversionNotice: {
          kind: "dust-ickb-to-ckb",
          inputIckb: 1n * 100000000n,
          outputCkb: 2n * 100000000n,
          incentiveCkb: 25_000_000n,
          maturityEstimateUnavailable: false,
        },
      }),
    ).toBe(
      "This small request converts 1 iCKB to about 2 CKB with a 0.25 CKB matcher incentive.",
    );
    expect(actionMessage({ ...messageParams(), amount: 0n })).toBe("");
    expect(actionMessage({ ...messageParams(), hasCollectable: true })).toBe(
      "Also collects converted funds.",
    );
    expect(
      actionMessage({
        ...messageParams(),
        amount: 0n,
        conversionKind: "collect-only",
        hasCollectable: true,
      }),
    ).toBe("Intent: Collect converted funds.");
    expect(
      actionMessage({
        ...messageParams(),
        conversionKind: "direct-plus-order",
        hasCollectable: true,
      }),
    ).toBe(
      "Intent: Direct conversion plus a standing order for the remainder. Also collects converted funds.",
    );
    expect(
      actionMessage({ ...messageParams(), amount: undefined, amountError: "Bad amount" }),
    ).toBe("⚠️ Bad amount");
    expect(
      actionMessage({ ...messageParams(), amount: undefined, amountError: "" }),
    ).toBe("Finish entering the amount.");
  });

  it("shows explicit refresh status while preparing a fresh preview", () => {
    expect(
      actionMessage({ ...messageParams(), isPreparing: true, message: "Refreshing" }),
    ).toBe("Refreshing");
  });

  it.each([
    ["collect-only", "Intent: Collect converted funds."],
    ["direct", "Intent: Direct conversion."],
    ["order", "Intent: Create a standing order."],
    [
      "direct-plus-order",
      "Intent: Direct conversion plus a standing order for the remainder.",
    ],
  ] as const)("describes %s intent exactly", (kind, expected) => {
    expect(conversionIntentText(kind)).toBe(expected);
  });

  it("derives action state from preview and fetch status", () => {
    const txInfo = activeTxInfo();

    expect(canPreviewTx(false, l1State, 1n)).toBe(true);
    expect(canPreviewTx(true, l1State, 1n)).toBe(false);
    expect(canPreviewTx(false, undefined, 1n)).toBe(false);
    expect(canPreviewTx(false, l1State, undefined)).toBe(false);
    expect(currentTxInfo(true, txInfo, undefined)).toBe(txInfo);
    expect(currentTxInfo(false, txInfo, undefined)).toBe(txInfoPadding);
    expect(currentTxInfo(false, txInfoPadding, txInfo)).toBe(txInfo);
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
    ).toBe("Waiting for CKB liquidity");
  });

  it("labels action availability and completion", () => {
    expect(actionLabel(0n, true)).toBe("collect converted funds");
    expect(actionLabel(0n, false)).toBe("request conversion");
    expect(actionLabel(1n, true)).toBe(requestConversion);
    expect(unavailableConversionMessage(1n)).toBe(noRequestMessage);
    expect(unavailableConversionMessage(0n)).toBe(noCollectionMessage);
    expect(actionDisabled(true, false, true)).toBe(true);
    expect(actionDisabled(false, true, true)).toBe(true);
    expect(actionDisabled(false, false, false)).toBe(true);
    expect(actionDisabled(false, false, true)).toBe(false);
    expect(actionDone(false, false)).toBe(true);
    expect(actionDone(true, false)).toBe(false);
    expect(actionDone(false, true)).toBe(false);
  });

  it("scopes attempt failures to the exact preview identity", () => {
    const failure = { identity: "state-a:C:1", message: walletRejected };
    expect(failureForPreview(failure, "state-a:C:1")).toBe(walletRejected);
    expect(failureForPreview(failure, "state-a:C:2")).toBe("");
    expect(failureForPreview(failure, "state-a:I:1")).toBe("");
    expect(failureForPreview(failure, "state-b:C:1")).toBe("");
  });
});

describe("timeUntilMaturity", () => {
  it("formats ready, minute, hour, and day windows", () => {
    const minute = 60_000n;
    const hour = 60n * minute;
    const day = 24n * hour;

    expect(timeUntilMaturity(9n, 10n)).toBe("⌛️ Ready");
    expect(timeUntilMaturity(10n, 10n)).toBe("⌛️ Ready");
    expect(timeUntilMaturity(10n + minute + 1n, 10n)).toBe("⏳ 2 minutes");
    expect(timeUntilMaturity(10n + 2n * hour, 10n)).toBe("⏳ 2 hours");
    expect(timeUntilMaturity(10n + day + 1n, 10n)).toBe("⏳ 2 days");
  });
});

function messageParams(): Parameters<typeof actionMessage>[0] {
  return {
    amount: 100000000n,
    amountError: "",
    conversionKind: undefined,
    conversionNotice: undefined,
    failure: "",
    hasActivity: true,
    hasCollectable: false,
    isFrozen: false,
    isPreparing: false,
    isStateFetching: false,
    isTxPreviewFetching: false,
    isValid: true,
    message: "",
    showFailure: false,
    txError: "",
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
