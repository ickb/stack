import process from "node:process";
import { describe, expect, it, vi } from "vitest";
import {
  jsonLogReplacer,
  logExecution,
  recordExecutionError,
  writeJsonLine,
} from "../../src/shared/index.ts";
import {
  byte32FromByte,
  script,
  TRANSACTION_CONFIRMATION_TIMEOUT_MESSAGE,
  TRANSACTION_FAILED_TO_RESOLVE_MESSAGE,
  transactionError,
} from "./support/node_utils_support.ts";

const UNKNOWN_ERROR_MESSAGE = "Unknown error";

describe("loop error logging", () => {
  it("serializes error-like values for JSON logs", () => {
    const executionLog: Record<string, unknown> = {};

    recordExecutionError(executionLog, new Error("failed"));
    expect(executionLog["error"]).toMatchObject({ name: "Error", message: "failed" });
    expect(executionLog["error"]).toHaveProperty("stack");
    const emptyLog: Record<string, unknown> = {};
    recordExecutionError(emptyLog, undefined);
    expect(emptyLog["error"]).toBe("Empty Error");
  });

  it("converts bigint values in the JSON log replacer", () => {
    expect(jsonLogReplacer("amount", 1n)).toBe("1");
    expect(jsonLogReplacer("status", "sent")).toBe("sent");
  });

  it("serializes functions as unsupported log values", () => {
    const executionLog: Record<string, unknown> = {};

    recordExecutionError(executionLog, unsupportedLogValue);

    expect(executionLog["error"]).toBe("[Unsupported log value]");
  });

  it("preserves public CKB RPC Error metadata in execution logs", () => {
    const executionLog: Record<string, unknown> = {};
    const error = Object.assign(new Error(TRANSACTION_FAILED_TO_RESOLVE_MESSAGE), {
      code: -301,
      data: `Resolve(Unknown(OutPoint(0x${"11".repeat(32)}00000000)))`,
      outPoint: { txHash: `0x${"11".repeat(32)}`, index: 0n },
    });

    recordExecutionError(executionLog, error);
    expect(executionLog["error"]).toMatchObject({
      name: "Error",
      message: TRANSACTION_FAILED_TO_RESOLVE_MESSAGE,
      code: -301,
      data: `Resolve(Unknown(OutPoint(0x${"11".repeat(32)}00000000)))`,
      outPoint: { txHash: `0x${"11".repeat(32)}`, index: "0" },
    });
  });
});

describe("loop transaction error logging", () => {
  it("records timeout errors and preserves the broadcast hash without touching the exit code", () => {
    const txHash = byte32FromByte("33");
    const executionLog: Record<string, unknown> = { txHash };

    recordExecutionError(executionLog, transactionError(true, txHash));
    expect(process.exitCode).toBeUndefined();
    expect(executionLog["txHash"]).toBe(txHash);
    expect(executionLog["error"]).toMatchObject({
      name: "TransactionConfirmationError",
      message: TRANSACTION_CONFIRMATION_TIMEOUT_MESSAGE,
      txHash,
      status: "sent",
      isTimeout: true,
    });
  });

  it("records non-timeout transaction confirmation failures distinctly", () => {
    const txHash = byte32FromByte("34");
    const executionLog: Record<string, unknown> = { txHash };

    recordExecutionError(executionLog, transactionError(false, txHash));
    expect(executionLog["error"]).toMatchObject({
      name: "TransactionConfirmationError",
      message: TRANSACTION_CONFIRMATION_TIMEOUT_MESSAGE,
      txHash,
      status: "rejected",
      isTimeout: false,
    });
  });
});

describe("loop error shape logging", () => {
  it("uses an unknown message for error-like values without string messages", () => {
    const executionLog: Record<string, unknown> = {};
    const error = { stack: "stack", message: 1 };

    recordExecutionError(executionLog, error);

    expect(executionLog["error"]).toMatchObject({
      message: UNKNOWN_ERROR_MESSAGE,
      stack: "stack",
    });

    const missingMessageLog: Record<string, unknown> = {};
    recordExecutionError(missingMessageLog, { stack: "stack" });
    expect(missingMessageLog["error"]).toMatchObject({
      message: UNKNOWN_ERROR_MESSAGE,
      stack: "stack",
    });

    const nonStringStackLog: Record<string, unknown> = {};
    recordExecutionError(nonStringStackLog, { stack: 1 });
    expect(nonStringStackLog["error"]).toMatchObject({
      message: UNKNOWN_ERROR_MESSAGE,
      stack: "",
    });
  });

  it("serializes circular error causes without recursing", () => {
    const executionLog: Record<string, unknown> = {};
    const error = new Error("failed");
    Object.defineProperty(error, "cause", { value: error });

    recordExecutionError(executionLog, error);

    expect(executionLog["error"]).toMatchObject({
      message: "failed",
      cause: "[Circular]",
    });
  });
});

describe("non-Error loop failure logging", () => {
  it("preserves CKB debugging metadata from non-Error loop failures", () => {
    const rpcUrl = "https://testnet.example/rpc/path";
    const executionLog: Record<string, unknown> = {};
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    recordExecutionError(executionLog, loopFailure(rpcUrl, circular));
    const serialized = JSON.stringify(executionLog);
    expect(serialized).toContain(rpcUrl);
    expect(executionLog["error"]).toMatchObject({
      message: `failed via ${rpcUrl}`,
      rpcUrl,
      amount: "9007199254740993",
      nested: { rpc_url: rpcUrl, message: "nested public evidence" },
      circular: { self: "[Circular]" },
    });
  });
});

describe("JSON line logging", () => {
  it("logs one JSON entry with elapsed seconds", () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const now = vi.spyOn(Date, "now").mockReturnValue(2500);
    const executionLog: Record<string, unknown> = {
      amount: 9007199254740993n,
      txHash: byte32FromByte("44"),
    };

    logExecution(executionLog, new Date(1000));

    expect(stdoutWrite).toHaveBeenCalledTimes(1);
    const logLine = String(stdoutWrite.mock.calls[0]?.[0]);
    expect(logLine).toBe(
      `${JSON.stringify({
        amount: "9007199254740993",
        txHash: byte32FromByte("44"),
        ElapsedSeconds: 2,
      })}\n`,
    );
    expect(JSON.parse(logLine)).toMatchObject({
      amount: "9007199254740993",
      ElapsedSeconds: 2,
    });
    now.mockRestore();
    stdoutWrite.mockRestore();
  });

  it("writes one JSON line with bigint-safe event serialization", () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    writeJsonLine({
      type: "bot.decision.skipped",
      amount: 9007199254740993n,
      observedAt: new Date("2026-01-02T03:04:05.006Z"),
      invalidAt: new Date(NaN),
    });

    expect(stdoutWrite).toHaveBeenCalledTimes(1);
    const parsed = jsonRecord(String(stdoutWrite.mock.calls[0]?.[0]));
    expect(parsed).toEqual({
      type: "bot.decision.skipped",
      amount: "9007199254740993",
      observedAt: "2026-01-02T03:04:05.006Z",
      invalidAt: null,
    });
    expect(String(stdoutWrite.mock.calls[0]?.[0])).toMatch(/\n$/u);
    stdoutWrite.mockRestore();
  });

  it("preserves nullish values in non-error JSON logs", () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    writeJsonLine({ nullable: null, missing: undefined, values: [null, undefined] });

    const parsed = jsonRecord(String(stdoutWrite.mock.calls[0]?.[0]));
    expect(parsed).toEqual({ nullable: null, values: [null, null] });
    expect(Object.hasOwn(parsed, "missing")).toBe(false);
    stdoutWrite.mockRestore();
  });

  it("preserves CKB debugging metadata", () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const txHash = byte32FromByte("55");

    writeJsonLine(debugLogValue(txHash));

    const parsed = jsonRecord(String(stdoutWrite.mock.calls[0]?.[0]));
    expect(parsed["txHash"]).toBe(txHash);
    expect(parsed["witness"]).toBe(`witnesses: 0x${"22".repeat(80)}`);
    expect(parsed["witnesses"]).toEqual([`0x${"22".repeat(80)}`]);
    expect(parsed["inputs"]).toEqual([{}]);
    expect(parsed["outputsData"]).toEqual([`0x${"22".repeat(80)}`]);
    expect(parsed["signedTx"]).toBe(`signed transaction 0x${"33".repeat(80)}`);
    expect(parsed["cell"]).toHaveProperty("cellOutput");
    expect(parsed["transactionShape"]).toEqual({ inputs: 1, outputs: 2, witnesses: 3 });
    expect(parsed["environment"]).toEqual({
      BOT_CONFIG_FILE: "/run/credentials/config.json",
    });
    expect(parsed["config"]).toEqual({ chain: "testnet" });
    stdoutWrite.mockRestore();
  });
});

function jsonRecord(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected JSON object");
  }
  return Object.fromEntries(Object.entries(parsed));
}

function unsupportedLogValue(): string {
  return "unsupported";
}

function loopFailure(
  rpcUrl: string,
  circular: Record<string, unknown>,
): Record<string, unknown> {
  return {
    message: `failed via ${rpcUrl}`,
    rpcUrl,
    amount: 9007199254740993n,
    nested: { rpc_url: rpcUrl, message: "nested public evidence" },
    circular,
  };
}

function debugLogValue(txHash: string): Record<string, unknown> {
  return {
    txHash,
    witness: `witnesses: 0x${"22".repeat(80)}`,
    witnesses: [`0x${"22".repeat(80)}`],
    inputs: [{}],
    outputs: [{}],
    outputsData: [`0x${"22".repeat(80)}`],
    cellDeps: [{}],
    headerDeps: [{}],
    signedTx: `signed transaction 0x${"33".repeat(80)}`,
    tx: { inputs: [], outputs: [], witnesses: [] },
    rawTransaction: { inputs: [], outputs: [], witnesses: [] },
    script: JSON.stringify({
      codeHash: `0x${"44".repeat(32)}`,
      hashType: "type",
      args: `0x${"55".repeat(20)}`,
    }),
    lock: { codeHash: `0x${"44".repeat(32)}`, hashType: "type", args: "0x" },
    cell: { cellOutput: { lock: script("66") } },
    transactionShape: { inputs: 1, outputs: 2, witnesses: 3 },
    env: "testnet",
    environment: { BOT_CONFIG_FILE: "/run/credentials/config.json" },
    config: { chain: "testnet" },
  };
}
