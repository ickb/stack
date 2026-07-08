import { describe, expect, it } from "vitest";
import {
  isRetryableCkbStateRaceError,
  isRetryableRpcResponseShapeError,
  isRetryableRpcTransportError,
} from "../src/index.ts";
import {
  FETCH_FAILED_MESSAGE,
  TRANSACTION_FAILED_TO_RESOLVE_MESSAGE,
} from "./support/node_utils_support.ts";

describe("retryable error classifiers", () => {
  it("classifies retryable RPC transport failures", async () => {
    const { isRetryableRpcTransportError: importedIsRetryableRpcTransportError } =
      await import("../src/index.ts");

    expect(
      importedIsRetryableRpcTransportError(new TypeError(FETCH_FAILED_MESSAGE)),
    ).toBe(true);
    expect(
      importedIsRetryableRpcTransportError(
        new Error(FETCH_FAILED_MESSAGE, { cause: new TypeError(FETCH_FAILED_MESSAGE) }),
      ),
    ).toBe(true);
    expect(
      importedIsRetryableRpcTransportError(
        new Error("Failed to load transaction header for txHash 0x11 at 0x1100000000", {
          cause: new TypeError(FETCH_FAILED_MESSAGE),
        }),
      ),
    ).toBe(true);
    expect(importedIsRetryableRpcTransportError(new Error(FETCH_FAILED_MESSAGE))).toBe(
      false,
    );
    expect(
      importedIsRetryableRpcTransportError(
        new Error("Invalid testnet RPC chain identity"),
      ),
    ).toBe(false);
    expect(isRetryableRpcTransportError(new TypeError(FETCH_FAILED_MESSAGE))).toBe(true);
  });

  it("classifies retryable RPC response shape failures", () => {
    expect(
      isRetryableRpcResponseShapeError(
        new Error("Id mismatched, got null, expected 319"),
      ),
    ).toBe(true);
    expect(
      isRetryableRpcResponseShapeError(new Error("Id mismatched, got 318, expected 319")),
    ).toBe(true);
    expect(
      isRetryableRpcResponseShapeError(
        new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"),
      ),
    ).toBe(true);
    expect(
      isRetryableRpcResponseShapeError(new Error("Invalid testnet RPC chain identity")),
    ).toBe(false);
    expect(
      isRetryableRpcResponseShapeError({
        message: "Id mismatched, got null, expected 319",
      }),
    ).toBe(false);
  });
});

describe("retryable CKB state-race classifier", () => {
  it("classifies observed CKB state-race send failures", () => {
    expect(
      isRetryableCkbStateRaceError(
        Object.assign(new Error("Client request error PoolRejectedRBF"), {
          code: -1111,
          data: 'RBFRejected("Tx\'s current fee is 11795, expect it to >= 12326 to replace old txs")',
          currentFee: 11795n,
          leastFee: 12326n,
        }),
      ),
    ).toBe(true);
    expect(
      isRetryableCkbStateRaceError(
        Object.assign(new Error(TRANSACTION_FAILED_TO_RESOLVE_MESSAGE), {
          code: -301,
          data: `Resolve(Unknown(OutPoint(0x${"11".repeat(32)}00000000)))`,
        }),
      ),
    ).toBe(true);
    expect(
      isRetryableCkbStateRaceError({
        code: -301,
        data: `Resolve(Dead(OutPoint(0x${"11".repeat(32)}00000000)))`,
      }),
    ).toBe(true);
    expect(
      isRetryableCkbStateRaceError(
        Object.assign(
          new Error("Client request error PoolRejectedDuplicatedTransaction"),
          {
            code: -1107,
            data: `Duplicated(Byte32(0x${"22".repeat(32)}))`,
            txHash: `0x${"22".repeat(32)}`,
          },
        ),
      ),
    ).toBe(true);
    expect(
      isRetryableCkbStateRaceError({
        code: -301,
        data: "Resolve(InvalidHeader(Byte32(0x...)))",
      }),
    ).toBe(false);
    expect(
      isRetryableCkbStateRaceError({
        code: -302,
        data: `Resolve(Unknown(OutPoint(0x${"11".repeat(32)}00000000)))`,
      }),
    ).toBe(false);
    expect(isRetryableCkbStateRaceError(null)).toBe(false);
    expect(isRetryableCkbStateRaceError("RBFRejected")).toBe(false);
    expect(isRetryableCkbStateRaceError({ code: -301 })).toBe(false);
    expect(isRetryableCkbStateRaceError(new Error("RBFRejected"))).toBe(false);
  });
});
