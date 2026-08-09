import { handleLoopError, logExecution } from "@ickb/node-utils";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  randomTesterScenario,
  readTesterFeePolicy,
  readTesterRuntimeConfig,
  readTesterScenario,
} from "../../../../src/tester/index.ts";
import {
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  DUST_CKB_CONVERSION_SCENARIO,
  DUST_ICKB_CONVERSION_SCENARIO,
  EXTRA_LARGE_LIMIT_ORDER_SCENARIO,
  ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  LOCAL_RPC_URL,
  MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO,
  MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
  RANDOM_ORDER_SCENARIO,
  SDK_CONVERSION_SCENARIO,
  TESTNET_CHAIN,
  TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO,
  TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO,
} from "../../../support/tester/index.ts";

describe("readTesterRuntimeConfig", () => {
  it("requires a JSON config file", async () => {
    await expect(readTesterRuntimeConfig({})).rejects.toThrow(
      "Empty env TESTER_CONFIG_FILE",
    );
  });

  it("reads JSON config files", async () => {
    const privateKey = `0x${"11".repeat(32)}`;
    const dir = await mkdtemp(path.join(tmpdir(), "ickb-tester-config-"));
    try {
      const configPath = path.join(dir, "config.json");

      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Test writes to a mkdtemp-owned fixture path.
      await writeFile(
        configPath,
        JSON.stringify({
          chain: TESTNET_CHAIN,
          privateKey,
          rpcUrl: LOCAL_RPC_URL,
          sleepIntervalSeconds: 10,
          maxIterations: 1,
          maxRetryableAttempts: 3,
        }),
        { mode: 0o600 },
      );

      await expect(
        readTesterRuntimeConfig({ TESTER_CONFIG_FILE: configPath }),
      ).resolves.toEqual({
        chain: TESTNET_CHAIN,
        privateKey,
        rpcUrl: LOCAL_RPC_URL,
        sleepIntervalMs: 10000,
        maxIterations: 1,
        maxRetryableAttempts: 3,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
describe("readTesterScenario", () => {
  it("keeps auto selection until balances are known and accepts explicit tester scenarios", () => {
    expect(randomTesterScenario(() => 0)).toBe(RANDOM_ORDER_SCENARIO);
    expect(randomTesterScenario(() => 0.99)).toBe(DUST_ICKB_CONVERSION_SCENARIO);
    expect(randomTesterScenario(() => 2, [])).toBe(RANDOM_ORDER_SCENARIO);
    expect(readTesterScenario({})).toBe("auto");
    expect(readTesterScenario({ TESTER_SCENARIO: "auto" })).toBe("auto");
    expect(readTesterScenario({ TESTER_SCENARIO: SDK_CONVERSION_SCENARIO })).toBe(
      SDK_CONVERSION_SCENARIO,
    );
    expect(
      readTesterScenario({ TESTER_SCENARIO: EXTRA_LARGE_LIMIT_ORDER_SCENARIO }),
    ).toBe(EXTRA_LARGE_LIMIT_ORDER_SCENARIO);
    expect(
      readTesterScenario({
        TESTER_SCENARIO: MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
      }),
    ).toBe(MULTI_ORDER_LIMIT_ORDERS_SCENARIO);
    expect(
      readTesterScenario({
        TESTER_SCENARIO: TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO,
      }),
    ).toBe(TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO);
    expect(readTesterScenario({ TESTER_SCENARIO: ALL_CKB_LIMIT_ORDER_SCENARIO })).toBe(
      ALL_CKB_LIMIT_ORDER_SCENARIO,
    );
    expect(
      readTesterScenario({ TESTER_SCENARIO: ICKB_TO_CKB_LIMIT_ORDER_SCENARIO }),
    ).toBe(ICKB_TO_CKB_LIMIT_ORDER_SCENARIO);
    expect(
      readTesterScenario({
        TESTER_SCENARIO: BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
      }),
    ).toBe(BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO);
    expect(
      readTesterScenario({
        TESTER_SCENARIO: TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO,
      }),
    ).toBe(TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO);
    expect(
      readTesterScenario({
        TESTER_SCENARIO: MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO,
      }),
    ).toBe(MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO);
    expect(readTesterScenario({ TESTER_SCENARIO: DUST_CKB_CONVERSION_SCENARIO })).toBe(
      DUST_CKB_CONVERSION_SCENARIO,
    );
    expect(readTesterScenario({ TESTER_SCENARIO: DUST_ICKB_CONVERSION_SCENARIO })).toBe(
      DUST_ICKB_CONVERSION_SCENARIO,
    );
    expect(() => readTesterScenario({ TESTER_SCENARIO: "interface-like" })).toThrow(
      "Invalid env TESTER_SCENARIO",
    );
    expect(() => readTesterScenario({ TESTER_SCENARIO: "unsafe" })).toThrow(
      "Invalid env TESTER_SCENARIO",
    );
  });
});
describe("tester private key output boundary", () => {
  it("does not leak configured canary secrets across representative crash output", async () => {
    const privateKey = `0x${"42".repeat(32)}`;
    const rpcUrl = "https://user:pass@testnet.example/path?token=secret";
    const configuredRpcUrl = new URL(rpcUrl);
    const rpcUserinfoCanary = `${configuredRpcUrl.username}:${configuredRpcUrl.password}`;
    configuredRpcUrl.searchParams.set("userinfoCanary", rpcUserinfoCanary);
    configuredRpcUrl.username = "";
    configuredRpcUrl.password = "";
    const rpcUrlCanary = configuredRpcUrl.href;
    const dir = await mkdtemp(path.join(tmpdir(), "ickb-tester-private-key-boundary-"));
    const output: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      const configPath = path.join(dir, "config.json");

      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Test writes to a mkdtemp-owned fixture path.
      await writeFile(
        configPath,
        JSON.stringify({
          chain: TESTNET_CHAIN,
          privateKey,
          rpcUrl: rpcUrlCanary,
          sleepIntervalSeconds: 10,
          maxIterations: 1,
        }),
        { mode: 0o600 },
      );
      const runtimeConfig = await readTesterRuntimeConfig({
        TESTER_CONFIG_FILE: configPath,
      });
      const executionLog: Record<string, unknown> = {
        chain: runtimeConfig.chain,
        maxIterations: runtimeConfig.maxIterations,
        startTime: "fixture",
      };

      handleLoopError(executionLog, new Error("tester deterministic crash"));
      logExecution(executionLog, new Date());

      expect(runtimeConfig.privateKey).toBe(privateKey);
      expect(runtimeConfig.rpcUrl).toBe(rpcUrlCanary);
      const outputText = output.join("\n");
      expect(outputText).not.toContain(privateKey);
      expect(outputText).not.toContain(rpcUrl);
      expect(outputText).not.toContain(rpcUrlCanary);
      expect(outputText).not.toContain(rpcUserinfoCanary);
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
    expect(
      readTesterFeePolicy({ TESTER_FEE: "1000", TESTER_FEE_BASE: "100000" }),
    ).toEqual({
      fee: 1000n,
      feeBase: 100000n,
    });
  });

  it("rejects malformed or unsafe fee overrides", () => {
    expect(() => readTesterFeePolicy({ TESTER_FEE: "1.5" })).toThrow(
      "Invalid env TESTER_FEE",
    );
    expect(() => readTesterFeePolicy({ TESTER_FEE_BASE: "0" })).toThrow(
      "Invalid env TESTER_FEE_BASE",
    );
    expect(() => readTesterFeePolicy({ TESTER_FEE_BASE: "1000001" })).toThrow(
      "Invalid env TESTER_FEE_BASE",
    );
    expect(() =>
      readTesterFeePolicy({ TESTER_FEE: "100000", TESTER_FEE_BASE: "100000" }),
    ).toThrow("TESTER_FEE must be less than TESTER_FEE_BASE");
  });
});
