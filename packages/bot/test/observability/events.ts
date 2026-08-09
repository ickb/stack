import { ccc } from "@ckb-ccc/core";
import { describe, expect, it, vi } from "vitest";
import {
  BotEventEmitter,
  createRunId,
  transactionSummary,
} from "../../src/observability/events.ts";
import {
  BOT_DECISION_SKIPPED,
  BOT_OBSERVABILITY_SUITE,
  CREDENTIAL_CONFIG_FILE,
  emptyCellDep,
  emptyInput,
  emptyScript,
  record,
} from "./fixtures/observability.ts";

describe(BOT_OBSERVABILITY_SUITE, () => {
  it("emits one structured JSON-compatible event", () => {
    const written: unknown[] = [];
    const emitter = new BotEventEmitter({
      chain: "testnet",
      runId: "run-1",
      write: (event): void => {
        written.push(event);
      },
    });

    const event = emitter.emit(7, BOT_DECISION_SKIPPED, {
      reason: "no_actions",
      amount: 9007199254740993n,
      witnesses: [`0x${"11".repeat(80)}`],
      witness: `0x${"22".repeat(80)}`,
      output_data: `0x${"33".repeat(80)}`,
      transactionShape: { witnesses: 1 },
      txHash: `0x${"44".repeat(32)}`,
      tx: { inputs: [], outputs: [], witnesses: [] },
      lock: { codeHash: "0xabc", hashType: "type", args: "0xdef" },
      cell: {
        cellOutput: {
          lock: { codeHash: "0xabc", hashType: "type", args: "0xdef" },
        },
      },
      env: "testnet",
      environment: { BOT_CONFIG_FILE: CREDENTIAL_CONFIG_FILE },
      config: { chain: "testnet" },
    });

    expect(written).toHaveLength(1);
    expect(event).toBe(written[0]);
    expect(written[0]).toMatchObject({
      version: 1,
      app: "bot",
      chain: "testnet",
      runId: "run-1",
      iterationId: 7,
      type: BOT_DECISION_SKIPPED,
      reason: "no_actions",
      amount: "9007199254740993",
      witnesses: [`0x${"11".repeat(80)}`],
      environment: { BOT_CONFIG_FILE: CREDENTIAL_CONFIG_FILE },
    });
    const writtenEvent = record(written[0], "written event");
    expect(writtenEvent["txHash"]).toBe(`0x${"44".repeat(32)}`);
    expect(typeof writtenEvent["timestamp"]).toBe("string");
  });
});

describe(BOT_OBSERVABILITY_SUITE, () => {
  it("emits functions and circular values as JSON-safe fields", () => {
    const written: unknown[] = [];
    const emitter = new BotEventEmitter({
      chain: "testnet",
      runId: "run-1",
      write: (event): void => {
        written.push(event);
      },
    });
    const circular: Record<string, unknown> = { label: "root" };
    circular["self"] = circular;

    emitter.emit(7, BOT_DECISION_SKIPPED, {
      evidence: {
        toJSON: (): Record<string, string> => ({ ignored: "custom serializer" }),
        circular,
        observedAt: new Date("2026-01-02T03:04:05.006Z"),
        invalidAt: new Date(NaN),
      },
    });

    expect(written[0]).toMatchObject({
      evidence: {
        toJSON: "[Unsupported log value]",
        circular: { label: "root", self: "[Circular]" },
        observedAt: "2026-01-02T03:04:05.006Z",
        invalidAt: null,
      },
    });
  });
});

describe(BOT_OBSERVABILITY_SUITE, () => {
  it("writes JSON lines to stdout by default", () => {
    const output: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      new BotEventEmitter({ chain: "testnet", runId: "run-1" }).emit(
        7,
        BOT_DECISION_SKIPPED,
        { amount: 1n },
      );
    } finally {
      stdoutWrite.mockRestore();
    }

    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      amount: "1",
      type: BOT_DECISION_SKIPPED,
    });
  });

  it("creates run ids with timestamp and process evidence", () => {
    expect(createRunId()).toMatch(/^\d{4}-\d\d-\d\dT.*Z-[\da-z]+$/u);
  });
});

describe(BOT_OBSERVABILITY_SUITE, () => {
  it("summarizes transaction shape with the decision shape fields", () => {
    const tx = ccc.Transaction.from({
      inputs: [emptyInput("11"), emptyInput("12")],
      outputs: [{ capacity: 0n, lock: emptyScript("21") }],
      cellDeps: [emptyCellDep("31"), emptyCellDep("32"), emptyCellDep("33")],
      headerDeps: [`0x${"41".repeat(32)}`],
      witnesses: ["0x", "0x"],
    });

    expect(transactionSummary(tx, 4n, 5n)).toEqual({
      fee: 4n,
      feeRate: 5n,
      shape: {
        inputs: 2,
        outputs: 1,
        cellDeps: 3,
        headerDeps: 1,
        witnesses: 2,
      },
    });
  });

  it("preserves public chain tip block metadata", () => {
    const written: unknown[] = [];
    const emitter = new BotEventEmitter({
      chain: "testnet",
      runId: "run-1",
      write: (event): void => {
        written.push(event);
      },
    });
    const blockHash = `0x${"11".repeat(32)}`;

    emitter.emit(1, "bot.state.read", {
      chainTip: {
        blockNumber: 123n,
        blockHash,
        timestamp: 456n,
      },
    });

    expect(written[0]).toMatchObject({
      chainTip: {
        blockNumber: "123",
        blockHash,
        timestamp: "456",
      },
    });
  });
});

it("keeps stable event identity when payload fields collide", () => {
  const written: unknown[] = [];
  const emitter = new BotEventEmitter({
    chain: "testnet",
    runId: "run-1",
    write: (event): void => {
      written.push(event);
    },
  });

  emitter.emit(7, BOT_DECISION_SKIPPED, {
    version: 999,
    app: "wrong",
    chain: "mainnet",
    runId: "wrong",
    iterationId: 999,
    timestamp: "not-iso",
    type: "wrong",
  });

  expect(written[0]).toMatchObject({
    version: 1,
    app: "bot",
    chain: "testnet",
    runId: "run-1",
    iterationId: 7,
    type: BOT_DECISION_SKIPPED,
  });
  expect(record(written[0], "written event")["timestamp"]).not.toBe("not-iso");
});

it("ignores custom serializers before adding event identity", () => {
  const written: unknown[] = [];
  const emitter = new BotEventEmitter({
    chain: "testnet",
    runId: "run-1",
    write: (event): void => {
      written.push(event);
    },
  });
  const value = {
    toJSON: (): string => "not a record",
    hidden: "ignored",
  };

  emitter.emit(7, BOT_DECISION_SKIPPED, value);

  expect(written[0]).toMatchObject({
    version: 1,
    app: "bot",
    chain: "testnet",
    runId: "run-1",
    iterationId: 7,
    type: BOT_DECISION_SKIPPED,
  });
  expect(written[0]).toMatchObject({
    toJSON: "[Unsupported log value]",
    hidden: "ignored",
  });
});

it("treats non-record payloads from JS callers as empty fields", () => {
  const written: unknown[] = [];
  const emitter = new BotEventEmitter({
    chain: "testnet",
    runId: "run-1",
    write: (event): void => {
      written.push(event);
    },
  });

  emitMalformedFields(emitter, 7, "not a record");
  emitMalformedFields(emitter, 8, []);

  expect(written).toMatchObject([
    { iterationId: 7, type: BOT_DECISION_SKIPPED },
    { iterationId: 8, type: BOT_DECISION_SKIPPED },
  ]);
});

it("emits public chain preflight evidence", () => {
  const written: unknown[] = [];
  const emitter = new BotEventEmitter({
    chain: "testnet",
    runId: "run-1",
    write: (event): void => {
      written.push(event);
    },
  });
  const genesisHash = `0x${"11".repeat(32)}`;
  const tipHash = `0x${"22".repeat(32)}`;

  emitter.emit(0, "bot.chain.preflight", {
    rpcConfigured: true,
    expected: { chain: "testnet", genesisHash, addressPrefix: "ckt" },
    observed: {
      genesisHash,
      addressPrefix: "ckt",
      tip: { hash: tipHash, number: 123n, timestamp: 456n },
    },
    matches: { genesisHash: true, addressPrefix: true },
  });

  expect(written[0]).toMatchObject({
    type: "bot.chain.preflight",
    rpcConfigured: true,
    expected: { chain: "testnet", genesisHash, addressPrefix: "ckt" },
    observed: {
      genesisHash,
      addressPrefix: "ckt",
      tip: { hash: tipHash, number: "123", timestamp: "456" },
    },
    matches: { genesisHash: true, addressPrefix: true },
  });
});
it("emits run context without private key material", () => {
  const written: unknown[] = [];
  const emitter = new BotEventEmitter({
    chain: "testnet",
    runId: "run-1",
    write: (event): void => {
      written.push(event);
    },
  });

  emitter.emit(0, "bot.run.started", {
    maxIterations: 1,
    bounded: true,
    runtime: {
      maxIterations: 1,
      bounded: true,
      sleepIntervalMs: 60000,
      rpcConfigured: true,
    },
    config: { chain: "testnet" },
    rpcHost: "testnet.example",
  });

  expect(written[0]).toMatchObject({
    type: "bot.run.started",
    maxIterations: 1,
    bounded: true,
    runtime: {
      maxIterations: 1,
      bounded: true,
      sleepIntervalMs: 60000,
      rpcConfigured: true,
    },
    config: { chain: "testnet" },
    rpcHost: "testnet.example",
  });
});

function emitMalformedFields(
  emitter: BotEventEmitter,
  iterationId: number,
  fields: unknown,
): void {
  Reflect.apply(emitter.emit.bind(emitter), emitter, [
    iterationId,
    BOT_DECISION_SKIPPED,
    fields,
  ]);
}
