import process from "node:process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logExecution, toJsonLogRecord, writeJsonLine } from "../../src/shared/index.ts";
import { byte32FromByte } from "./support/node_utils_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function writtenLine(write: () => void): Record<string, unknown> {
  const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  write();
  expect(stdoutWrite).toHaveBeenCalledTimes(1);
  const line = String(stdoutWrite.mock.calls[0]?.[0]);
  expect(line).toMatch(/\n$/u);
  const parsed: unknown = JSON.parse(line);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected JSON object");
  }
  return Object.fromEntries(Object.entries(parsed));
}

describe("toJsonLogRecord", () => {
  it("keeps an error's hidden fields, its enumerable ones, and its cause chain", () => {
    const cause = Object.assign(new Error("resolve"), {
      code: -301,
      outPoint: { txHash: byte32FromByte("11"), index: 0n },
    });
    const error = new Error("failed", { cause });

    expect(toJsonLogRecord({ error })).toMatchObject({
      error: {
        name: "Error",
        message: "failed",
        cause: {
          name: "Error",
          message: "resolve",
          code: -301,
          outPoint: { txHash: byte32FromByte("11"), index: "0" },
        },
      },
    });
    expect(toJsonLogRecord({ error })["error"]).toHaveProperty("stack");
  });

  it("marks cycles instead of recursing, through errors and plain objects alike", () => {
    const error = new Error("failed");
    Object.defineProperty(error, "cause", { value: error });
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    expect(
      toJsonLogRecord({ error, circular, twice: [circular, circular] }),
    ).toMatchObject({
      error: { message: "failed", cause: "[Circular]" },
      circular: { self: "[Circular]" },
      twice: [{ self: "[Circular]" }, { self: "[Circular]" }],
    });
  });
});

describe("JSON line logging", () => {
  it("logs one JSON entry with the type and timestamp envelope and its elapsed time", () => {
    vi.spyOn(Date, "now").mockReturnValue(2500);

    const line = writtenLine(() => {
      logExecution(
        "stimulus.turn",
        { amount: 9007199254740993n, txHash: byte32FromByte("44") },
        new Date(1000),
      );
    });

    expect(line).toEqual({
      type: "stimulus.turn",
      timestamp: "1970-01-01T00:00:01.000Z",
      amount: "9007199254740993",
      txHash: byte32FromByte("44"),
      elapsedMs: 1500,
    });
    // The envelope comes first, so a reader sees the type before the payload.
    expect(Object.keys(line)[0]).toBe("type");
  });

  it("serializes bigints, dates, nullish values, and functions as JSON does", () => {
    const line = writtenLine(() => {
      writeJsonLine({
        amount: 9007199254740993n,
        observedAt: new Date("2026-01-02T03:04:05.006Z"),
        invalidAt: new Date(NaN),
        nullable: null,
        missing: undefined,
        values: [null, undefined, 1n],
        callback: (): string => "dropped",
      });
    });

    expect(line).toEqual({
      amount: "9007199254740993",
      observedAt: "2026-01-02T03:04:05.006Z",
      invalidAt: null,
      nullable: null,
      values: [null, null, "1"],
    });
  });
});
