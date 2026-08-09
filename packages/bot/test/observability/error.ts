import { describe, expect, it } from "vitest";
import { errorSummary } from "../../src/observability/error.ts";
import {
  BOT_OBSERVABILITY_SUITE,
  CREDENTIAL_CONFIG_FILE,
  OUTER_PUBLIC_FAILURE,
  POOL_REJECTED_RBF_MESSAGE,
  RBF_REJECTED_DATA,
  SCAN_RACED_CHAIN_TIP,
  nestedRecord,
  record,
} from "./fixtures/observability.ts";

const ENUMERABLE_ERROR_MESSAGE = "enumerable message";

describe(BOT_OBSERVABILITY_SUITE, () => {
  it("keeps stack traces by default but can summarize retryable errors", () => {
    const error = new Error(SCAN_RACED_CHAIN_TIP);
    const summary = errorSummary(error);

    expect(summary).toMatchObject({
      name: "Error",
      message: SCAN_RACED_CHAIN_TIP,
    });
    expect(typeof summary).toBe("object");
    expect(summary).not.toBeNull();
    expect(record(summary, "summary")["stack"]).toContain(SCAN_RACED_CHAIN_TIP);
    expect(errorSummary(error, { includeStack: false })).toEqual({
      name: "Error",
      message: SCAN_RACED_CHAIN_TIP,
    });
  });

  it("preserves public CKB RPC error fields from Error objects", () => {
    const rbfError = Object.assign(new Error(POOL_REJECTED_RBF_MESSAGE), {
      code: -1111,
      data: RBF_REJECTED_DATA,
      currentFee: 11795n,
      leastFee: 12326n,
    });
    const resolveError = Object.assign(
      new Error("Client request error TransactionFailedToResolve"),
      {
        code: -301,
        data: `Resolve(Unknown(OutPoint(0x${"11".repeat(32)}00000000)))`,
        outPoint: {
          txHash: `0x${"11".repeat(32)}`,
          index: 0n,
        },
      },
    );

    expect(errorSummary(rbfError, { includeStack: false })).toEqual({
      name: "Error",
      message: POOL_REJECTED_RBF_MESSAGE,
      code: -1111,
      data: RBF_REJECTED_DATA,
      currentFee: "11795",
      leastFee: "12326",
    });
    expect(errorSummary(resolveError, { includeStack: false })).toEqual({
      name: "Error",
      message: "Client request error TransactionFailedToResolve",
      code: -301,
      data: `Resolve(Unknown(OutPoint(0x${"11".repeat(32)}00000000)))`,
      outPoint: {
        txHash: `0x${"11".repeat(32)}`,
        index: "0",
      },
    });
  });
});

describe(BOT_OBSERVABILITY_SUITE, () => {
  it("preserves transaction-shaped error messages in structured error summaries", () => {
    const error = new Error(`failed with witness 0x${"22".repeat(80)}`);

    const summary = record(errorSummary(error), "summary");

    expect(summary["name"]).toBe("Error");
    expect(summary["message"]).toBe(`failed with witness 0x${"22".repeat(80)}`);
    expect(summary["stack"]).toContain("failed with witness");
  });

  it("preserves serialized transaction-shaped error messages", () => {
    const error = new Error(`failed {"witnesses":["0x${"22".repeat(80)}"],"inputs":[]}`);

    const summary = record(errorSummary(error), "summary");

    expect(summary["message"]).toBe(
      `failed {"witnesses":["0x${"22".repeat(80)}"],"inputs":[]}`,
    );
  });

  it("preserves nested error causes in structured error summaries", () => {
    const cause = new Error("inner public failure");
    const error = new Error(OUTER_PUBLIC_FAILURE, { cause });

    const summary = record(errorSummary(error), "summary");

    expect(summary["cause"]).toMatchObject({
      name: "Error",
      message: "inner public failure",
    });
  });

  it("tracks circular references in custom Error properties", () => {
    const details: Record<string, unknown> = {};
    const error = Object.assign(new Error(OUTER_PUBLIC_FAILURE), { details });
    error.details["self"] = error;

    const summary = record(errorSummary(error, { includeStack: false }), "summary");

    expect(summary).toEqual({
      name: "Error",
      message: OUTER_PUBLIC_FAILURE,
      details: { self: "[Circular]" },
    });
  });

  it("tracks circular native error causes", () => {
    const error = new Error(OUTER_PUBLIC_FAILURE);
    Object.defineProperty(error, "cause", { value: error });

    expect(errorSummary(error, { includeStack: false })).toEqual({
      name: "Error",
      message: OUTER_PUBLIC_FAILURE,
      cause: { message: "Circular error reference" },
    });
  });

  it("filters enumerable built-in Error fields from own property details", () => {
    const error = new Error("outer");
    Object.defineProperty(error, "message", {
      enumerable: true,
      value: ENUMERABLE_ERROR_MESSAGE,
    });
    Object.assign(error, { code: "PUBLIC_CODE" });

    expect(errorSummary(error, { includeStack: false })).toEqual({
      name: "Error",
      message: ENUMERABLE_ERROR_MESSAGE,
      code: "PUBLIC_CODE",
    });
  });

  it("omits enumerable Error properties when all own properties are built in", () => {
    const error = new Error("outer");
    Object.defineProperty(error, "message", {
      enumerable: true,
      value: ENUMERABLE_ERROR_MESSAGE,
    });

    expect(errorSummary(error, { includeStack: false })).toEqual({
      name: "Error",
      message: ENUMERABLE_ERROR_MESSAGE,
    });
  });
});

describe(BOT_OBSERVABILITY_SUITE, () => {
  it("preserves public RPC debugging data in structured object error summaries", () => {
    const rpcUrl = "https://testnet.example/rpc/path";

    const summary = record(
      errorSummary({
        message: `object ${rpcUrl}`,
        rpcUrl,
        amount: 9007199254740993n,
      }),
      "summary",
    );
    const serialized = JSON.stringify(summary);

    expect(serialized).toContain(rpcUrl);
    expect(nestedRecord(summary, "details")["rpcUrl"]).toBe(rpcUrl);
  });

  it("preserves public nested object error fields", () => {
    const rpcUrl = "https://testnet.example/rpc/path";

    const summary = record(
      errorSummary({
        message: `failed ${rpcUrl}`,
        nested: { publicReason: "visible evidence" },
      }),
      "summary",
    );
    const details = nestedRecord(summary, "details");
    const nested = nestedRecord(details, "nested");

    expect(details["message"]).toBe(`failed ${rpcUrl}`);
    expect(nested["publicReason"]).toBe("visible evidence");
  });
});

it("summarizes thrown primitives without inventing structured fields", () => {
  expect(errorSummary("plain failure")).toBe("plain failure");
  expect(errorSummary(404)).toBe("404");
  expect(errorSummary(false)).toBe("false");
  expect(errorSummary(null)).toBe("Empty Error");
});

it("summarizes thrown objects with JSON-safe debugging details preserved", () => {
  const summary = record(
    errorSummary({
      code: "RPC_FAILURE",
      amount: 9007199254740993n,
      message: "failed with public evidence",
      lock: { codeHash: "0xabc", hashType: "type", args: "0xdef" },
      cell: {
        cellOutput: { lock: { codeHash: "0xabc", hashType: "type", args: "0xdef" } },
      },
      witnesses: [`0x${"22".repeat(80)}`],
      signedTx: `0x${"33".repeat(80)}`,
      env: { BOT_CONFIG_FILE: CREDENTIAL_CONFIG_FILE },
      config: { chain: "testnet" },
    }),
    "summary",
  );

  expect(summary).toMatchObject({
    message: "Non-Error object",
    details: {
      code: "RPC_FAILURE",
      amount: "9007199254740993",
      message: "failed with public evidence",
      witnesses: [`0x${"22".repeat(80)}`],
    },
  });
});

it("preserves transaction-shaped details from nested object causes", () => {
  const summary = record(
    errorSummary(
      new Error("outer", {
        cause: {
          message: "inner public evidence",
          inputs: [{}],
          outputsData: [`0x${"22".repeat(80)}`],
          cellDeps: [{}],
          headerDeps: [{}],
        },
      }),
    ),
    "summary",
  );

  expect(summary["cause"]).toEqual({
    message: "Non-Error object",
    details: {
      message: "inner public evidence",
      inputs: [{}],
      outputsData: [`0x${"22".repeat(80)}`],
      cellDeps: [{}],
      headerDeps: [{}],
    },
  });
});

it("preserves enumerable tx status fields from public error objects", () => {
  const summary = record(
    errorSummary(
      Object.assign(new Error("confirmation failed"), {
        txHash: `0x${"44".repeat(32)}`,
        status: "pending",
        isTimeout: true,
      }),
      { includeStack: false },
    ),
    "summary",
  );

  expect(summary).toEqual({
    name: "Error",
    message: "confirmation failed",
    txHash: `0x${"44".repeat(32)}`,
    status: "pending",
    isTimeout: true,
  });
});
