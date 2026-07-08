import { describe, expect, it, vi } from "vitest";
import { ccc } from "@ckb-ccc/core";
import { handleLoopError, logExecution } from "@ickb/node-utils";
import { OrderCell, OrderData, Ratio } from "@ickb/order";
import { byte32FromByte, headerLike, script } from "@ickb/testkit";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freshMatchableOrderSkip } from "./freshMatchableOrderSkip.js";
import {
  enforceTesterPlainCkbReserve,
  isRetryableTesterError,
  isUnrepresentableTesterEstimateError,
  planTesterTransaction,
  postTransactionPlainCkbBalance,
  randomTesterScenario,
  readTesterFeePolicy,
  readTesterRuntimeConfig,
  readTesterScenario,
  shouldSleepBeforeTesterAttempt,
  testerAttemptedTransactionEvidence,
  testerEstimatedTooSmallSkip,
  testerExecutionActions,
  testerNoActionableAutoScenarioSkip,
  resolveTesterScenario,
  testerReserveSkip,
  TesterTerminalError,
} from "./index.js";
import { type TesterState } from "./runtime.js";

describe("readTesterRuntimeConfig", () => {
  it("requires a JSON config file", async () => {
    await expect(readTesterRuntimeConfig({})).rejects.toThrow("Empty env TESTER_CONFIG_FILE");
  });

  it("reads JSON config files", async () => {
    const privateKey = `0x${"11".repeat(32)}`;
    const dir = await mkdtemp(join(tmpdir(), "ickb-tester-config-"));
    try {
      const configPath = join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({
        chain: "testnet",
        privateKey,
        rpcUrl: "http://127.0.0.1:8114/",
        sleepIntervalSeconds: 10,
        maxIterations: 1,
      }), { mode: 0o600 });

      await expect(readTesterRuntimeConfig({ TESTER_CONFIG_FILE: configPath })).resolves.toEqual({
        chain: "testnet",
        privateKey,
        rpcUrl: "http://127.0.0.1:8114/",
        sleepIntervalMs: 10000,
        maxIterations: 1,
        maxRetryableAttempts: undefined,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("readTesterScenario", () => {
  it("keeps auto selection until balances are known and accepts explicit tester scenarios", () => {
    expect(randomTesterScenario(() => 0)).toBe("random-order");
    expect(randomTesterScenario(() => 0.99)).toBe("dust-ickb-conversion");
    expect(readTesterScenario({})).toBe("auto");
    expect(readTesterScenario({ TESTER_SCENARIO: "auto" })).toBe("auto");
    expect(readTesterScenario({ TESTER_SCENARIO: "sdk-conversion" })).toBe("sdk-conversion");
    expect(readTesterScenario({ TESTER_SCENARIO: "extra-large-limit-order" })).toBe("extra-large-limit-order");
    expect(readTesterScenario({ TESTER_SCENARIO: "multi-order-limit-orders" })).toBe("multi-order-limit-orders");
    expect(readTesterScenario({ TESTER_SCENARIO: "two-ckb-to-ickb-limit-orders" })).toBe("two-ckb-to-ickb-limit-orders");
    expect(readTesterScenario({ TESTER_SCENARIO: "all-ckb-limit-order" })).toBe("all-ckb-limit-order");
    expect(readTesterScenario({ TESTER_SCENARIO: "ickb-to-ckb-limit-order" })).toBe("ickb-to-ckb-limit-order");
    expect(readTesterScenario({ TESTER_SCENARIO: "bounded-ickb-to-ckb-limit-order" })).toBe("bounded-ickb-to-ckb-limit-order");
    expect(readTesterScenario({ TESTER_SCENARIO: "two-ickb-to-ckb-limit-orders" })).toBe("two-ickb-to-ckb-limit-orders");
    expect(readTesterScenario({ TESTER_SCENARIO: "mixed-direction-limit-orders" })).toBe("mixed-direction-limit-orders");
    expect(readTesterScenario({ TESTER_SCENARIO: "dust-ckb-conversion" })).toBe("dust-ckb-conversion");
    expect(readTesterScenario({ TESTER_SCENARIO: "dust-ickb-conversion" })).toBe("dust-ickb-conversion");
    expect(() => readTesterScenario({ TESTER_SCENARIO: "interface-like" })).toThrow("Invalid env TESTER_SCENARIO");
    expect(() => readTesterScenario({ TESTER_SCENARIO: "unsafe" })).toThrow("Invalid env TESTER_SCENARIO");
  });
});

describe("tester private key output boundary", () => {
  it("does not leak configured canary secrets across representative crash output", async () => {
    const privateKey = `0x${"42".repeat(32)}`;
    const rpcUrl = "https://user:pass@testnet.example/path?token=secret";
    const dir = await mkdtemp(join(tmpdir(), "ickb-tester-private-key-boundary-"));
    const output: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      const configPath = join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({
        chain: "testnet",
        privateKey,
        rpcUrl,
        sleepIntervalSeconds: 10,
        maxIterations: 1,
      }), { mode: 0o600 });
      const runtimeConfig = await readTesterRuntimeConfig({ TESTER_CONFIG_FILE: configPath });
      const executionLog: Record<string, unknown> = {
        chain: runtimeConfig.chain,
        maxIterations: runtimeConfig.maxIterations,
        startTime: "fixture",
      };

      handleLoopError(executionLog, new Error("tester deterministic crash"));
      logExecution(executionLog, new Date());

      expect(runtimeConfig.privateKey).toBe(privateKey);
      expect(runtimeConfig.rpcUrl).toBe(rpcUrl);
      expect(output.join("\n")).not.toContain(privateKey);
      expect(output.join("\n")).not.toContain(rpcUrl);
    } finally {
      stdoutWrite.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("readTesterFeePolicy", () => {
  it("defaults to the normal live order fee", () => {
    expect(readTesterFeePolicy({})).toEqual({ fee: 1n, feeBase: 100000n });
  });

  it("accepts bounded fee overrides", () => {
    expect(readTesterFeePolicy({ TESTER_FEE: "0", TESTER_FEE_BASE: "100000" })).toEqual({
      fee: 0n,
      feeBase: 100000n,
    });
    expect(readTesterFeePolicy({ TESTER_FEE: "1000", TESTER_FEE_BASE: "100000" })).toEqual({
      fee: 1000n,
      feeBase: 100000n,
    });
  });

  it("rejects malformed or unsafe fee overrides", () => {
    expect(() => readTesterFeePolicy({ TESTER_FEE: "1.5" })).toThrow("Invalid env TESTER_FEE");
    expect(() => readTesterFeePolicy({ TESTER_FEE_BASE: "0" })).toThrow("Invalid env TESTER_FEE_BASE");
    expect(() => readTesterFeePolicy({ TESTER_FEE_BASE: "1000001" })).toThrow("Invalid env TESTER_FEE_BASE");
    expect(() => readTesterFeePolicy({ TESTER_FEE: "100000", TESTER_FEE_BASE: "100000" })).toThrow(
      "TESTER_FEE must be less than TESTER_FEE_BASE",
    );
  });
});

describe("isRetryableTesterError", () => {
  it("recognizes the live state-scan tip race", () => {
    expect(isRetryableTesterError(new Error("L1 state scan crossed chain tip; retry with a fresh state"))).toBe(true);
    expect(isRetryableTesterError(new Error("Not enough CKB"))).toBe(false);
  });
});

describe("isUnrepresentableTesterEstimateError", () => {
  it("recognizes fee-adjusted ratio overflow as an unbuildable tester estimate", () => {
    expect(isUnrepresentableTesterEstimateError(new Error("Ratio scale exceeds Uint64"))).toBe(true);
    expect(isUnrepresentableTesterEstimateError(new Error("L1 state scan crossed chain tip; retry with a fresh state"))).toBe(false);
  });
});

describe("shouldSleepBeforeTesterAttempt", () => {
  it("runs the first attempt immediately and sleeps before later attempts", () => {
    expect(shouldSleepBeforeTesterAttempt(0)).toBe(false);
    expect(shouldSleepBeforeTesterAttempt(1)).toBe(true);
  });
});

describe("planTesterTransaction", () => {
  it("does not silently downsize extra-large limit orders", () => {
    const depositCapacity = 1000n;
    const state = testerState({ availableCkbBalance: 202000000000n });

    expect(planTesterTransaction(state, depositCapacity, "extra-large-limit-order")).toEqual({
      direction: "ckb-to-ickb",
      amount: 2000n,
      ckbAmount: 2000n,
      udtAmount: 0n,
      orderCount: 1,
    });
  });

  it("fails extra-large limit orders when funding cannot preserve reserve", () => {
    const depositCapacity = 1000n;
    const state = testerState({ availableCkbBalance: 3000n });

    expect(() => planTesterTransaction(state, depositCapacity, "extra-large-limit-order")).toThrow(
      "Not enough CKB for extra-large limit order scenario",
    );
    expect(() => planTesterTransaction(state, depositCapacity, "extra-large-limit-order")).toThrow(
      TesterTerminalError,
    );
  });

  it("spends all available CKB except reserve for all-CKB limit orders", () => {
    const state = testerState({ availableCkbBalance: ccc.fixedPointFrom(650000) });

    expect(planTesterTransaction(state, 1000n, "all-ckb-limit-order")).toEqual({
      direction: "ckb-to-ickb",
      amount: ccc.fixedPointFrom(647000),
      ckbAmount: ccc.fixedPointFrom(647000),
      udtAmount: 0n,
      orderCount: 1,
    });
  });

  it("plans two CKB-to-iCKB limit orders with all available CKB except reserve", () => {
    const state = testerState({ availableCkbBalance: ccc.fixedPointFrom(650000) });

    expect(planTesterTransaction(state, 1000n, "two-ckb-to-ickb-limit-orders")).toEqual({
      direction: "ckb-to-ickb",
      amount: ccc.fixedPointFrom(647000),
      ckbAmount: ccc.fixedPointFrom(647000),
      udtAmount: 0n,
      orderCount: 2,
    });
  });

  it("fails two CKB-to-iCKB limit orders when funding cannot preserve reserve", () => {
    const state = testerState({ availableCkbBalance: ccc.fixedPointFrom(2000) });

    expect(() => planTesterTransaction(state, 1000n, "two-ckb-to-ickb-limit-orders")).toThrow(
      "Not enough CKB for two CKB-to-iCKB limit orders scenario",
    );
    expect(() => planTesterTransaction(state, 1000n, "two-ckb-to-ickb-limit-orders")).toThrow(
      TesterTerminalError,
    );
  });

  it("fails all-CKB limit orders when funding cannot preserve reserve", () => {
    const state = testerState({ availableCkbBalance: ccc.fixedPointFrom(2000) });

    expect(() => planTesterTransaction(state, 1000n, "all-ckb-limit-order")).toThrow(
      "Not enough CKB for all-CKB limit order scenario",
    );
    expect(() => planTesterTransaction(state, 1000n, "all-ckb-limit-order")).toThrow(
      TesterTerminalError,
    );
  });

  it("spends all available iCKB for iCKB-to-CKB limit orders", () => {
    const state = testerState({ availableCkbBalance: 0n, availableIckbBalance: ccc.fixedPointFrom(123) });

    expect(planTesterTransaction(state, 1000n, "ickb-to-ckb-limit-order")).toEqual({
      direction: "ickb-to-ckb",
      amount: ccc.fixedPointFrom(123),
      ckbAmount: 0n,
      udtAmount: ccc.fixedPointFrom(123),
      orderCount: 1,
    });
  });

  it("caps bounded iCKB-to-CKB limit orders at one deposit-cap unit", () => {
    const state = testerState({ availableCkbBalance: ccc.fixedPointFrom(2500), availableIckbBalance: ccc.fixedPointFrom(123456) });

    expect(planTesterTransaction(state, ccc.fixedPointFrom(1000), "bounded-ickb-to-ckb-limit-order")).toEqual({
      direction: "ickb-to-ckb",
      amount: ccc.fixedPointFrom(100000),
      ckbAmount: 0n,
      udtAmount: ccc.fixedPointFrom(100000),
      orderCount: 1,
    });
    expect(planTesterTransaction(
      testerState({ availableCkbBalance: ccc.fixedPointFrom(2500), availableIckbBalance: ccc.fixedPointFrom(123) }),
      ccc.fixedPointFrom(1000),
      "bounded-ickb-to-ckb-limit-order",
    )).toMatchObject({ amount: ccc.fixedPointFrom(123), udtAmount: ccc.fixedPointFrom(123) });
  });

  it("plans two iCKB-to-CKB limit orders with all available iCKB", () => {
    const state = testerState({ availableCkbBalance: 0n, availableIckbBalance: ccc.fixedPointFrom(123) });

    expect(planTesterTransaction(state, 1000n, "two-ickb-to-ckb-limit-orders")).toEqual({
      direction: "ickb-to-ckb",
      amount: ccc.fixedPointFrom(123),
      ckbAmount: 0n,
      udtAmount: ccc.fixedPointFrom(123),
      orderCount: 2,
    });
  });

  it("fails two iCKB-to-CKB limit orders when funding cannot create two orders", () => {
    const state = testerState({ availableCkbBalance: 0n, availableIckbBalance: 1n });

    expect(() => planTesterTransaction(state, 1000n, "two-ickb-to-ckb-limit-orders")).toThrow(
      "Not enough iCKB for two iCKB-to-CKB limit orders scenario",
    );
    expect(() => planTesterTransaction(state, 1000n, "two-ickb-to-ckb-limit-orders")).toThrow(
      TesterTerminalError,
    );
  });

  it("plans mixed-direction limit orders with available CKB and iCKB", () => {
    const state = testerState({
      availableCkbBalance: ccc.fixedPointFrom(650000),
      availableIckbBalance: ccc.fixedPointFrom(123),
    });

    expect(planTesterTransaction(state, 1000n, "mixed-direction-limit-orders")).toEqual({
      direction: "ckb-to-ickb",
      amount: ccc.fixedPointFrom(647123),
      ckbAmount: ccc.fixedPointFrom(647000),
      udtAmount: ccc.fixedPointFrom(123),
      orderCount: 2,
    });
  });

  it("fails mixed-direction limit orders when either side is unavailable", () => {
    expect(() => planTesterTransaction(
      testerState({ availableCkbBalance: ccc.fixedPointFrom(2000), availableIckbBalance: ccc.fixedPointFrom(123) }),
      1000n,
      "mixed-direction-limit-orders",
    )).toThrow("Not enough CKB for mixed-direction limit orders scenario");
    expect(() => planTesterTransaction(
      testerState({ availableCkbBalance: ccc.fixedPointFrom(650000), availableIckbBalance: 0n }),
      1000n,
      "mixed-direction-limit-orders",
    )).toThrow("Not enough iCKB for mixed-direction limit orders scenario");
  });

  it("creates dust conversion scenarios with normal fee handling", () => {
    expect(planTesterTransaction(
      testerState({ availableCkbBalance: ccc.fixedPointFrom(3000) }),
      1000n,
      "dust-ckb-conversion",
    )).toEqual({ direction: "ckb-to-ickb", amount: 1n, ckbAmount: 1n, udtAmount: 0n, orderCount: 1 });
    expect(planTesterTransaction(
      testerState({ availableCkbBalance: 0n, availableIckbBalance: 10n }),
      1000n,
      "dust-ickb-conversion",
    )).toEqual({ direction: "ickb-to-ckb", amount: 1n, ckbAmount: 0n, udtAmount: 1n, orderCount: 1 });
  });

  it("plans SDK conversion scenarios as full deposit-cap conversions", () => {
    const ckbState = testerState({ availableCkbBalance: ccc.fixedPointFrom(3000) });
    expect(planTesterTransaction(ckbState, 1000n, "sdk-conversion")).toEqual({
      direction: "ckb-to-ickb",
      amount: 1000n,
      ckbAmount: 1000n,
      udtAmount: 0n,
      orderCount: 1,
    });
  });

  it("plans random orders from iCKB only when CKB is below reserve", () => {
    const state = testerState({
      availableCkbBalance: ccc.fixedPointFrom(1999),
      availableIckbBalance: ccc.fixedPointFrom(123),
    });
    const random = vi.spyOn(Math, "random").mockReturnValue(0.999999);
    try {
      const plan = planTesterTransaction(state, 1000n, "random-order");
      expect(plan).toMatchObject({
        direction: "ickb-to-ckb",
        ckbAmount: 0n,
        orderCount: 1,
      });
      expect(plan.amount).toBeGreaterThan(1n << 33n);
      expect(plan.amount).toBeLessThanOrEqual(ccc.fixedPointFrom(123));
      expect(plan.udtAmount).toBe(plan.amount);
    } finally {
      random.mockRestore();
    }
  });

  it("does not auto-select random orders when only dust is available", () => {
    expect(resolveTesterScenario(
      testerState({ availableCkbBalance: ccc.fixedPointFrom(2000) + 1n, availableIckbBalance: 0n }),
      "auto",
      undefined,
      1000n,
      () => 0.99,
    )).toBeUndefined();
  });

  it("auto-selects random orders when near-reserve capital can fund actionable iCKB stimulus", () => {
    const liveNearReserveState = testerState({
      availableCkbBalance: 229423868188n,
      availableIckbBalance: 147394003472899n,
      exchangeRatio: { ckbScale: 10000000000000000n, udtScale: 11845567055823930n },
      feeRate: 33222n,
    });

    expect(resolveTesterScenario(
      liveNearReserveState,
      "auto",
      undefined,
      11845567055823n,
      () => 0,
    )).toBe("random-order");
  });

  it("formats auto with no actionable scenario as a nonterminal estimate skip", () => {
    expect(testerNoActionableAutoScenarioSkip()).toEqual({
      reason: "estimated-conversion-too-small",
      requestedTesterScenario: "auto",
      attemptedTesterScenarios: ["random-order", "sdk-conversion", "bounded-ickb-to-ckb-limit-order"],
    });
  });

  it("samples random order amounts above the matcher minimum", () => {
    const state = testerState({ availableCkbBalance: ccc.fixedPointFrom(3000), availableIckbBalance: 0n });
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const plan = planTesterTransaction(state, ccc.fixedPointFrom(1000), "random-order");
      expect(plan.direction).toBe("ckb-to-ickb");
      expect(plan.amount).toBeGreaterThan(1n << 33n);
      expect(plan.amount).toBeLessThanOrEqual(ccc.fixedPointFrom(1000));
      expect(plan.ckbAmount).toBe(plan.amount);
    } finally {
      random.mockRestore();
    }
  });

  it("plans SDK conversions only in a buildable funded direction", () => {
    expect(planTesterTransaction(
      testerState({ availableCkbBalance: ccc.fixedPointFrom(2000) + 1n, availableIckbBalance: ccc.fixedPointFrom(123) }),
      1000n,
      "sdk-conversion",
    )).toEqual({
      direction: "ickb-to-ckb",
      amount: ccc.fixedPointFrom(123),
      ckbAmount: 0n,
      udtAmount: ccc.fixedPointFrom(123),
      orderCount: 1,
    });
  });

  it("resolves generic multi-order scenarios to any funded multi-order type", () => {
    expect(resolveTesterScenario(testerState({
      availableCkbBalance: ccc.fixedPointFrom(650000),
      availableIckbBalance: ccc.fixedPointFrom(123),
    }), "multi-order-limit-orders")).toBe("mixed-direction-limit-orders");
    expect(planTesterTransaction(testerState({
      availableCkbBalance: ccc.fixedPointFrom(650000),
      availableIckbBalance: ccc.fixedPointFrom(123),
    }), 1000n, "multi-order-limit-orders")).toMatchObject({
      direction: "ckb-to-ickb",
      orderCount: 2,
    });
    expect(resolveTesterScenario(testerState({
      availableCkbBalance: ccc.fixedPointFrom(650000),
      availableIckbBalance: 0n,
    }), "multi-order-limit-orders")).toBe("two-ckb-to-ickb-limit-orders");
    expect(resolveTesterScenario(testerState({
      availableCkbBalance: 0n,
      availableIckbBalance: ccc.fixedPointFrom(123),
    }), "multi-order-limit-orders")).toBe("two-ickb-to-ckb-limit-orders");
    expect(resolveTesterScenario(testerState({
      availableCkbBalance: ccc.fixedPointFrom(3000) + 1n,
      availableIckbBalance: ccc.fixedPointFrom(123),
    }), "multi-order-limit-orders")).toBe("mixed-direction-limit-orders");
    expect(() => resolveTesterScenario(testerState({
      availableCkbBalance: ccc.fixedPointFrom(2000),
      availableIckbBalance: 1n,
    }), "multi-order-limit-orders")).toThrow("Not enough funds for multi-order limit orders scenario");
    expect(resolveTesterScenario(testerState({ availableCkbBalance: 0n }), "sdk-conversion")).toBe("sdk-conversion");
  });

  it("resolves auto only to scenarios funded by current balances", () => {
    const ckbOnlyState = testerState({ availableCkbBalance: ccc.fixedPointFrom(3000), availableIckbBalance: 0n });
    expect(resolveTesterScenario(ckbOnlyState, "auto", undefined, ccc.fixedPointFrom(1000), () => 0)).toBe("random-order");
    expect(resolveTesterScenario(ckbOnlyState, "auto", undefined, ccc.fixedPointFrom(1000), () => 0.99)).toBe("sdk-conversion");

    const ickbOnlyState = testerState({ availableCkbBalance: 0n, availableIckbBalance: ccc.fixedPointFrom(123) });
    expect(resolveTesterScenario(ickbOnlyState, "auto", undefined, ccc.fixedPointFrom(1000), () => 0)).toBe("random-order");
    expect(resolveTesterScenario(ickbOnlyState, "auto", undefined, ccc.fixedPointFrom(1000), () => 0.5)).toBe("sdk-conversion");
    expect(resolveTesterScenario(ickbOnlyState, "auto", undefined, ccc.fixedPointFrom(1000), () => 0.99)).toBe("bounded-ickb-to-ckb-limit-order");

    const mixedMultiOrderState = testerState({
      availableCkbBalance: ccc.fixedPointFrom(650000),
      availableIckbBalance: ccc.fixedPointFrom(123),
    });
    const autoSamples = [0, 0.2, 0.4, 0.6, 0.8, 0.99].map((sample) => resolveTesterScenario(
      mixedMultiOrderState,
      "auto",
      undefined,
      ccc.fixedPointFrom(1000),
      () => sample,
    ));
    expect(autoSamples).not.toContain("all-ckb-limit-order");
    expect(autoSamples).not.toContain("ickb-to-ckb-limit-order");
    expect(autoSamples).not.toContain("two-ckb-to-ickb-limit-orders");
    expect(autoSamples).not.toContain("two-ickb-to-ckb-limit-orders");
    expect(autoSamples).not.toContain("mixed-direction-limit-orders");
    expect(autoSamples).not.toContain("dust-ckb-conversion");
    expect(autoSamples).not.toContain("dust-ickb-conversion");

    expect(resolveTesterScenario(
      testerState({ availableCkbBalance: ccc.fixedPointFrom(2000), availableIckbBalance: 0n }),
      "auto",
      undefined,
      1000n,
      () => 0,
    )).toBeUndefined();
  });

  it("computes post-transaction plain CKB reserve from unspent inputs and account outputs", () => {
    const lock = script("11");
    const otherLock = script("22");
    const spent = capacityCell(ccc.fixedPointFrom(1000), lock, "01");
    const unspent = capacityCell(ccc.fixedPointFrom(2000), lock, "02");
    const typed = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("03"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(4000), lock, type: script("33") },
      outputData: "0x",
    });
    const data = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("04"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(8000), lock },
      outputData: "0x1234",
    });
    const tx = ccc.Transaction.default();
    tx.inputs.push(ccc.CellInput.from({ previousOutput: spent.outPoint }));
    tx.addOutput({ capacity: ccc.fixedPointFrom(300), lock });
    tx.addOutput({ capacity: ccc.fixedPointFrom(500), lock, type: script("33") });
    tx.addOutput({ capacity: ccc.fixedPointFrom(700), lock: otherLock });
    tx.addOutput({ capacity: ccc.fixedPointFrom(900), lock }, "0x1234");

    expect(postTransactionPlainCkbBalance(
      tx,
      testerState({ availableCkbBalance: ccc.fixedPointFrom(3000), capacityCells: [spent, unspent, typed, data] }),
      [lock],
    )).toBe(ccc.fixedPointFrom(2300));
  });

  it("formats post-transaction reserve skip details", () => {
    expect(testerReserveSkip(ccc.fixedPointFrom(2000))).toBeUndefined();
    expect(testerReserveSkip(0n)).toEqual({
      reason: "post-tx-ckb-reserve",
      reserve: "2000",
      postTxCkbBalance: "0",
    });
  });

  it("reports total collected owned orders separately from matchable cancelled orders", () => {
    const actions = testerExecutionActions(
      "auto",
      "ickb-to-ckb-limit-order",
      undefined,
      [estimatedOrder("ickb-to-ckb", ccc.fixedPointFrom(12), ccc.fixedPointFrom(10), ccc.fixedPointFrom(11), ccc.fixedPointFrom(1))],
      { fee: 1n, feeBase: 1000n },
      testerState({
        availableCkbBalance: ccc.fixedPointFrom(100),
        userOrders: [matchableOrder(byte32FromByte("10")), nonMatchableOrder(byte32FromByte("11"))],
      }),
    );

    expect(actions).toEqual({
      requestedTesterScenario: "auto",
      testerScenario: "ickb-to-ckb-limit-order",
      newOrder: {
        giveIckb: "11",
        takeCkb: "10",
        fee: "1",
        feeNumerator: "1",
        feeBase: "1000",
      },
      collectedOrders: 2,
      cancelledOrders: 1,
    });
  });

  it("keeps unbroadcast post-build reserve skips under attempted evidence", () => {
    const evidence = testerAttemptedTransactionEvidence(
      "auto",
      "ickb-to-ckb-limit-order",
      undefined,
      {
        attemptedOrder: {
          giveIckb: "11",
          takeCkb: "10",
          fee: "1",
          feeNumerator: "1",
          feeBase: "1000",
        },
      },
    );

    expect(evidence).toEqual({
      requestedTesterScenario: "auto",
      testerScenario: "ickb-to-ckb-limit-order",
      attemptedOrder: {
        giveIckb: "11",
        takeCkb: "10",
        fee: "1",
        feeNumerator: "1",
        feeBase: "1000",
      },
    });
    expect(evidence).not.toHaveProperty("newOrder");
    expect(evidence).not.toHaveProperty("newOrders");
  });

  it("does not claim exact SDK conversion order evidence", () => {
    const actions = testerExecutionActions(
      "sdk-conversion",
      "sdk-conversion",
      { kind: "order" },
      [estimatedOrder("ckb-to-ickb", ccc.fixedPointFrom(12), ccc.fixedPointFrom(12), ccc.fixedPointFrom(11), ccc.fixedPointFrom(1))],
      { fee: 1n, feeBase: 1000n },
      testerState({ availableCkbBalance: ccc.fixedPointFrom(3000) }),
    );

    expect(actions).toEqual({
      testerScenario: "sdk-conversion",
      conversion: { kind: "order" },
      collectedOrders: 0,
      cancelledOrders: 0,
    });
  });

  it("keeps attempted order evidence available for unbuildable estimates", () => {
    const skip = testerEstimatedTooSmallSkip(
      "auto",
      "dust-ckb-conversion",
      [{ direction: "ckb-to-ickb", amount: 1n, amounts: { ckbValue: 1n, udtValue: 0n } }],
      [],
      { fee: 1n, feeBase: 100000n },
    );

    expect(skip).toEqual({
      reason: "estimated-conversion-too-small",
      requestedTesterScenario: "auto",
      testerScenario: "dust-ckb-conversion",
      attemptedOrder: {
        giveCkb: "0.00000001",
        feeNumerator: "1",
        feeBase: "100000",
      },
    });
  });

  it("keeps converted attempted order evidence for zero estimates", () => {
    const skip = testerEstimatedTooSmallSkip(
      "dust-ickb-conversion",
      "dust-ickb-conversion",
      [{ direction: "ickb-to-ckb", amount: 1n, amounts: { ckbValue: 0n, udtValue: 1n } }],
      [estimatedOrder("ickb-to-ckb", 1n, 0n, 1n, 0n)],
      { fee: 1n, feeBase: 100000n },
    );

    expect(skip).toEqual({
      reason: "estimated-conversion-too-small",
      testerScenario: "dust-ickb-conversion",
      attemptedOrder: {
        giveIckb: "0.00000001",
        takeCkb: "0",
        fee: "0",
        feeNumerator: "1",
        feeBase: "100000",
      },
    });
  });

  it("checks the post-transaction CKB reserve for iCKB-to-CKB transactions", () => {
    const lock = script("11");
    const spent = capacityCell(ccc.fixedPointFrom(1000), lock, "05");
    const tx = ccc.Transaction.default();
    tx.inputs.push(ccc.CellInput.from({ previousOutput: spent.outPoint }));
    tx.addOutput({ capacity: ccc.fixedPointFrom(100), lock });

    expect(enforceTesterPlainCkbReserve(
      tx,
      testerState({ availableCkbBalance: ccc.fixedPointFrom(1000), capacityCells: [spent] }),
      [lock],
      "ickb-to-ckb-limit-order",
    )).toEqual({
      reason: "post-tx-ckb-reserve",
      reserve: "2000",
      postTxCkbBalance: "100",
    });
  });

  it("allows below-reserve transactions that improve plain CKB", () => {
    const lock = script("11");
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(100), lock });

    expect(enforceTesterPlainCkbReserve(
      tx,
      testerState({ availableCkbBalance: 0n }),
      [lock],
      "ickb-to-ckb-limit-order",
    )).toBeUndefined();
  });

  it("allows below-reserve transactions that preserve plain CKB", () => {
    const lock = script("11");
    const spent = capacityCell(ccc.fixedPointFrom(1000), lock, "06");
    const tx = ccc.Transaction.default();
    tx.inputs.push(ccc.CellInput.from({ previousOutput: spent.outPoint }));
    tx.addOutput({ capacity: ccc.fixedPointFrom(1000), lock });

    expect(enforceTesterPlainCkbReserve(
      tx,
      testerState({ availableCkbBalance: ccc.fixedPointFrom(1000), capacityCells: [spent] }),
      [lock],
      "ickb-to-ckb-limit-order",
    )).toBeUndefined();
  });

  it("still blocks below-reserve transactions that drain plain CKB", () => {
    const lock = script("11");
    const spent = capacityCell(ccc.fixedPointFrom(1000), lock, "07");
    const tx = ccc.Transaction.default();
    tx.inputs.push(ccc.CellInput.from({ previousOutput: spent.outPoint }));
    tx.addOutput({ capacity: ccc.fixedPointFrom(999), lock });

    expect(enforceTesterPlainCkbReserve(
      tx,
      testerState({ availableCkbBalance: ccc.fixedPointFrom(1000), capacityCells: [spent] }),
      [lock],
      "ickb-to-ckb-limit-order",
    )).toEqual({
      reason: "post-tx-ckb-reserve",
      reserve: "2000",
      postTxCkbBalance: "999",
    });
  });

  it("fails explicit CKB reserve stress scenarios when completed transactions violate reserve", () => {
    const lock = script("11");
    const spent = capacityCell(ccc.fixedPointFrom(3000), lock, "08");
    const tx = ccc.Transaction.default();
    tx.inputs.push(ccc.CellInput.from({ previousOutput: spent.outPoint }));
    tx.addOutput({ capacity: ccc.fixedPointFrom(1999), lock });

    expect(() => enforceTesterPlainCkbReserve(
      tx,
      testerState({ availableCkbBalance: ccc.fixedPointFrom(3000), capacityCells: [spent] }),
      [lock],
      "all-ckb-limit-order",
    )).toThrow(TesterTerminalError);
  });
});

describe("freshMatchableOrderSkip", () => {
  it("explains skips caused by unavailable transaction lookup", async () => {
    const txHash = byte32FromByte("11");
    const runtime = {
      client: {
        getTransaction: (): Promise<undefined> => Promise.resolve(undefined),
      },
    };

    await expect(freshMatchableOrderSkip(
      runtime as never,
      [matchableOrder(txHash)],
      headerLike({ number: 200000n, epoch: ccc.Epoch.from([0n, 0n, 1n]) }),
      0n,
    )).resolves.toEqual({
      reason: "matchable-order-transaction-missing",
      txHash,
    });
  });

  it("explains skips caused by fresh matchable orders", async () => {
    const txHash = byte32FromByte("22");
    const runtime = {
      client: {
        getTransaction: (): Promise<{ blockNumber: bigint }> => Promise.resolve({ blockNumber: 100000n }),
      },
    };

    await expect(freshMatchableOrderSkip(
      runtime as never,
      [matchableOrder(txHash)],
      headerLike({ number: 100180n, epoch: ccc.Epoch.from([0n, 0n, 1n]) }),
      0n,
    )).resolves.toEqual({
      reason: "fresh-matchable-order",
      txHash,
      blockNumber: 100000n,
      tipNumber: 100180n,
      maxElapsedBlocks: 180n,
    });
  });

  it("does not skip stale or non-matchable orders", async () => {
    const runtime = {
      client: {
        getTransaction: (): Promise<{ blockNumber: bigint }> => Promise.resolve({ blockNumber: 100000n }),
      },
    };

    await expect(freshMatchableOrderSkip(
      runtime as never,
      [matchableOrder(byte32FromByte("33")), nonMatchableOrder(byte32FromByte("44"))],
      headerLike({ number: 100181n, epoch: ccc.Epoch.from([0n, 0n, 1n]) }),
      0n,
    )).resolves.toBeUndefined();
  });

  it("does not skip fresh owned orders that are not marketable at the midpoint", async () => {
    const runtime = {
      client: {
        getTransaction: (): Promise<{ blockNumber: bigint }> => Promise.resolve({ blockNumber: 100000n }),
      },
    };

    await expect(freshMatchableOrderSkip(
      runtime as never,
      [unmarketableOrder(byte32FromByte("45"))],
      headerLike({ number: 100180n, epoch: ccc.Epoch.from([0n, 0n, 1n]) }),
      0n,
    )).resolves.toBeUndefined();
  });

  it("does not skip fresh owned orders whose gain is below the live fee", async () => {
    const runtime = {
      client: {
        getTransaction: vi.fn<() => Promise<{ blockNumber: bigint }>>(() => Promise.resolve({ blockNumber: 100000n })),
      },
    };

    await expect(freshMatchableOrderSkip(
      runtime as never,
      [matchableOrder(byte32FromByte("46"))],
      headerLike({ number: 100180n, epoch: ccc.Epoch.from([0n, 0n, 1n]) }),
      ccc.fixedPointFrom(1000),
    )).resolves.toBeUndefined();
    expect(runtime.client.getTransaction).not.toHaveBeenCalled();
  });

  it("does not let fresh bot-updated descendants block new tester stimulus", async () => {
    const descendantTxHash = byte32FromByte("47");
    const mintTxHash = byte32FromByte("48");
    const runtime = {
      client: {
        getTransaction: vi.fn<() => Promise<{ blockNumber: bigint }>>(() => Promise.resolve({ blockNumber: 100000n })),
      },
    };

    await expect(freshMatchableOrderSkip(
      runtime as never,
      [matchedDescendantOrder(descendantTxHash, mintTxHash)],
      headerLike({ number: 100180n, epoch: ccc.Epoch.from([0n, 0n, 1n]) }),
      0n,
    )).resolves.toBeUndefined();
    expect(runtime.client.getTransaction).not.toHaveBeenCalled();
  });
});

function matchableOrder(txHash: ccc.Hex): never {
  return order(txHash, true, { type: "relative", value: { distance: 1n, padding: new Uint8Array(32) } });
}

function matchedDescendantOrder(txHash: ccc.Hex, masterTxHash: ccc.Hex): never {
  return order(txHash, true, { type: "absolute", value: { txHash: masterTxHash, index: 1n } });
}

function nonMatchableOrder(txHash: ccc.Hex): never {
  return order(txHash, false, { type: "relative", value: { distance: 1n, padding: new Uint8Array(32) } });
}

function unmarketableOrder(txHash: ccc.Hex): never {
  return order(
    txHash,
    true,
    { type: "relative", value: { distance: 1n, padding: new Uint8Array(32) } },
    Ratio.from({ ckbScale: 20_000_000_000_000_000n, udtScale: 1n }),
  );
}

function order(
  txHash: ccc.Hex,
  isMatchable: boolean,
  master: Parameters<typeof OrderData.from>[0]["master"],
  ckbToUdt = Ratio.from({ ckbScale: 1n, udtScale: 2n }),
): never {
  const udtScript = script("66");
  const outputData = OrderData.from({
    udtValue: 0n,
    master,
    info: { ckbToUdt, udtToCkb: Ratio.empty(), ckbMinMatchLog: 0 },
  }).toBytes();
  const minimalCell = ccc.Cell.from({
    outPoint: { txHash, index: 0n },
    cellOutput: { lock: script("55"), type: udtScript },
    outputData,
  });
  return {
    order: OrderCell.mustFrom(ccc.Cell.from({
      outPoint: { txHash, index: 0n },
      cellOutput: {
        capacity: minimalCell.cellOutput.capacity + (isMatchable ? ccc.fixedPointFrom(100) : 0n),
        lock: script("55"),
        type: udtScript,
      },
      outputData,
    })),
  } as never;
}

function estimatedOrder(
  direction: "ckb-to-ickb" | "ickb-to-ckb",
  amount: bigint,
  ckbValue: bigint,
  udtValue: bigint,
  ckbFee: bigint,
): never {
  return {
    direction,
    amount,
    amounts: { ckbValue, udtValue },
    estimate: {
      convertedAmount: direction === "ckb-to-ickb" ? udtValue : ckbValue,
      ckbFee,
    },
  } as never;
}

function testerState(values: {
  availableCkbBalance: bigint;
  availableIckbBalance?: bigint;
  exchangeRatio?: TesterState["system"]["exchangeRatio"];
  feeRate?: bigint;
  capacityCells?: ccc.Cell[];
  userOrders?: never[];
}): TesterState {
  const availableIckbBalance = values.availableIckbBalance ?? 0n;
  const exchangeRatio = values.exchangeRatio ?? { ckbScale: 1n, udtScale: 1n };
  const feeRate = values.feeRate ?? 1000n;
  return {
    system: {
      exchangeRatio,
      feeRate,
      tip: headerLike({ timestamp: 0n }),
      orderPool: [],
      ckbAvailable: values.availableCkbBalance,
      ckbMaturing: [],
    } as TesterState["system"],
    account: {
      capacityCells: values.capacityCells ?? [],
      nativeUdtCells: [],
      nativeUdtCapacity: 0n,
      nativeUdtBalance: 0n,
      receipts: [],
      withdrawalGroups: [],
    },
    userOrders: values.userOrders ?? [],
    conversionContext: {
      system: {
        exchangeRatio,
        feeRate,
        tip: headerLike({ timestamp: 0n }),
        orderPool: [],
        ckbAvailable: values.availableCkbBalance,
        ckbMaturing: [],
      } as TesterState["system"],
      receipts: [],
      readyWithdrawals: [],
      availableOrders: [],
      ckbAvailable: values.availableCkbBalance,
      ickbAvailable: availableIckbBalance,
      estimatedMaturity: 0n,
    },
    availableCkbBalance: values.availableCkbBalance,
    availableIckbBalance,
  };
}

function capacityCell(capacity: bigint, lock: ccc.Script, txByte: string): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(txByte), index: 0n },
    cellOutput: { capacity, lock },
    outputData: "0x",
  });
}
