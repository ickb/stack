import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, script } from "@ickb/testkit";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  createPublicClient,
  formatCkb,
  handleLoopError,
  logExecution,
  parseMaxIterations,
  parseRuntimeConfig,
  parsePrivateKey,
  readRuntimeConfigEnv,
  parseSleepInterval,
  randomSleepIntervalMs,
  reachedMaxIterations,
  signerAccountLocks,
  STOP_EXIT_CODE,
  writeJsonLine,
} from "./index.js";

describe("node utilities", () => {
  it("formats CKB values without losing bigint precision", () => {
    const whole = 123456789012345678901234567890n;

    expect(formatCkb(whole * 100000000n + 12345670n)).toBe(
      `${whole.toString()}.1234567`,
    );
    expect(formatCkb(-100000000n - 1n)).toBe("-1.00000001");
  });

  it("parses positive sleep intervals as milliseconds", () => {
    expect(parseSleepInterval(1, "BOT_CONFIG_FILE")).toBe(1000);
    expect(parseSleepInterval(2.5, "BOT_CONFIG_FILE")).toBe(2500);
  });

  it("rejects missing and sub-second sleep intervals", () => {
    for (const value of [undefined, Number.NaN, Infinity, 0, 0.5]) {
      expect(() => parseSleepInterval(value, "BOT_CONFIG_FILE")).toThrow(
        "Invalid env BOT_CONFIG_FILE",
      );
    }
  });

  it("parses bounded-run iteration limits", () => {
    expect(parseMaxIterations(undefined, "BOT_CONFIG_FILE")).toBeUndefined();
    expect(parseMaxIterations(1, "BOT_CONFIG_FILE")).toBe(1);
    expect(parseMaxIterations(2, "BOT_CONFIG_FILE")).toBe(2);
    expect(reachedMaxIterations(0, 1)).toBe(false);
    expect(reachedMaxIterations(1, 1)).toBe(true);
    expect(reachedMaxIterations(10, undefined)).toBe(false);
    expect(() => parseMaxIterations(0, "BOT_CONFIG_FILE")).toThrow(
      "Invalid env BOT_CONFIG_FILE",
    );
    expect(() => parseMaxIterations(1.5, "BOT_CONFIG_FILE")).toThrow(
      "Invalid env BOT_CONFIG_FILE",
    );
  });

  it("randomizes sleep with triangular jitter centered on the interval", () => {
    expect(randomSleepIntervalMs(1000, sequence(0, 0))).toBe(0);
    expect(randomSleepIntervalMs(1000, sequence(0.5, 0.5))).toBe(1000);
    expect(randomSleepIntervalMs(1000, sequence(0.999, 0.999))).toBe(1998);

    const samples = Array.from({ length: 1000 }, (_, index) => index / 1000);
    const average = samples.reduce((sum, first) => (
      sum + randomSleepIntervalMs(1000, sequence(first, 1 - first))
    ), 0) / samples.length;
    expect(average).toBe(1000);
  });

  it("parses private keys as exact 0x-prefixed lowercase hex", () => {
    const privateKey = `0x${"11".repeat(32)}`;

    expect(parsePrivateKey(privateKey, "BOT_CONFIG_FILE")).toBe(privateKey);
    for (const value of [
      "11".repeat(32),
      `0X${"11".repeat(32)}`,
      `0x${"AA".repeat(32)}`,
      ` 0x${"11".repeat(32)}`,
      `0x${"11".repeat(32)} `,
      `0x${"11".repeat(31)}`,
    ]) {
      expect(() => parsePrivateKey(value, "BOT_CONFIG_FILE")).toThrow(
        "Invalid env BOT_CONFIG_FILE",
      );
    }
  });

  it("parses exact runtime JSON config", () => {
    const privateKey = `0x${"11".repeat(32)}`;

    expect(parseRuntimeConfig(JSON.stringify({
      chain: "testnet",
      privateKey,
      rpcUrl: "https://rpc.example/path?token=abc",
      sleepIntervalSeconds: 60,
      maxIterations: 2,
    }), "BOT_CONFIG_FILE")).toEqual({
      chain: "testnet",
      privateKey,
      rpcUrl: "https://rpc.example/path?token=abc",
      sleepIntervalMs: 60000,
      maxIterations: 2,
    });
    expect(parseRuntimeConfig(JSON.stringify({
      chain: "mainnet",
      privateKey,
      rpcUrl: "https://mainnet.example/",
      sleepIntervalSeconds: 1,
    }), "BOT_CONFIG_FILE")).toEqual({
      chain: "mainnet",
      privateKey,
      rpcUrl: "https://mainnet.example/",
      sleepIntervalMs: 1000,
      maxIterations: undefined,
    });
  });

  it("rejects invalid runtime JSON config without exposing contents", () => {
    const privateKey = `0x${"11".repeat(32)}`;
    const invalidValues = [
      "not-json",
      JSON.stringify([]),
      JSON.stringify({ chain: "devnet", privateKey, sleepIntervalSeconds: 60 }),
      JSON.stringify({ chain: privateKey, privateKey, rpcUrl: "https://rpc.example/", sleepIntervalSeconds: 60 }),
      JSON.stringify({ chain: "testnet", privateKey, sleepIntervalSeconds: 60, extra: true }),
      JSON.stringify({ chain: "testnet", privateKey, sleepIntervalSeconds: 60 }),
      JSON.stringify({ chain: "testnet", privateKey: `${privateKey}\n`, sleepIntervalSeconds: 60 }),
      JSON.stringify({ chain: "testnet", privateKey, rpcUrl: "file:///tmp/socket", sleepIntervalSeconds: 60 }),
      JSON.stringify({ chain: "testnet", privateKey, rpcUrl: "https://rpc.example/ bad", sleepIntervalSeconds: 60 }),
      JSON.stringify({ chain: "testnet", privateKey, sleepIntervalSeconds: "60" }),
      JSON.stringify({ chain: "testnet", privateKey, sleepIntervalSeconds: 0 }),
      JSON.stringify({ chain: "testnet", privateKey, sleepIntervalSeconds: 60, maxIterations: "1" }),
    ];

    for (const value of invalidValues) {
      expect(() => parseRuntimeConfig(value, "BOT_CONFIG_FILE")).toThrow(
        "Invalid env BOT_CONFIG_FILE",
      );
      expect(() => parseRuntimeConfig(value, "BOT_CONFIG_FILE")).not.toThrow(/rpc\.example|0x11/u);
    }
  });

  it("reads runtime JSON config from a file env source", async () => {
    const privateKey = `0x${"11".repeat(32)}`;
    const dir = await mkdtemp(join(tmpdir(), "ickb-runtime-config-"));
    try {
      const configPath = join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({
        chain: "testnet",
        privateKey,
        rpcUrl: "http://127.0.0.1:8114/",
        sleepIntervalSeconds: 60,
      }), { mode: 0o600 });

      await expect(readRuntimeConfigEnv(configPath, "BOT_CONFIG_FILE")).resolves.toEqual({
        chain: "testnet",
        privateKey,
        rpcUrl: "http://127.0.0.1:8114/",
        sleepIntervalMs: 60000,
        maxIterations: undefined,
      });
      await expect(readRuntimeConfigEnv(undefined, "BOT_CONFIG_FILE")).rejects.toThrow(
        "Empty env BOT_CONFIG_FILE",
      );
      await expect(readRuntimeConfigEnv(join(dir, "missing"), "BOT_CONFIG_FILE")).rejects.toThrow(
        "Invalid file from env BOT_CONFIG_FILE",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the primary signer lock first and deduplicates account locks", async () => {
    const primaryLock = script("11");
    const primaryLockCopy = ccc.Script.from(primaryLock);
    const otherLock = script("22");
    const signer = {
      getAddressObjs: async () => {
        await Promise.resolve();
        return [{ script: otherLock }, { script: primaryLockCopy }];
      },
    } as ccc.Signer;

    await expect(signerAccountLocks(signer, primaryLock)).resolves.toEqual([
      primaryLock,
      otherLock,
    ]);
  });

  it("creates network-specific public clients and forwards custom RPC URLs", () => {
    const mainnet = createPublicClient("mainnet", "https://mainnet.example");
    const testnet = createPublicClient("testnet", undefined);

    expect(mainnet).toBeInstanceOf(ccc.ClientPublicMainnet);
    expect(testnet).toBeInstanceOf(ccc.ClientPublicTestnet);
    expect(mainnet.addressPrefix).toBe("ckb");
    expect(testnet.addressPrefix).toBe("ckt");
    expect((mainnet as ccc.ClientPublicMainnet).url).toBe(
      "https://mainnet.example",
    );
  });

  it("serializes error-like values for JSON logs", () => {
    const executionLog: Record<string, unknown> = {};

    expect(handleLoopError(executionLog, new Error("failed"))).toBe(false);
    expect(executionLog.error).toMatchObject({
      name: "Error",
      message: "failed",
    });
    expect(executionLog.error).toHaveProperty("stack");

    const emptyLog: Record<string, unknown> = {};
    expect(handleLoopError(emptyLog, undefined)).toBe(false);
    expect(emptyLog.error).toBe("Empty Error");
  });

  it("stops after broadcast confirmation timeouts", () => {
    expect(STOP_EXIT_CODE).toBe(2);
    expect(handleLoopError({}, transactionError(true))).toBe(true);
    expect(process.exitCode).toBe(STOP_EXIT_CODE);
    process.exitCode = undefined;

    expect(handleLoopError({}, transactionError(false))).toBe(false);
    expect(handleLoopError({}, new Error("failed"))).toBe(false);
  });

  it("records timeout errors, preserves broadcast hash, and sets exit code 2", () => {
    const txHash = byte32FromByte("33");
    const executionLog: Record<string, unknown> = { txHash };

    expect(handleLoopError(executionLog, transactionError(true, txHash))).toBe(true);
    expect(process.exitCode).toBe(STOP_EXIT_CODE);
    expect(executionLog.txHash).toBe(txHash);
    expect(executionLog.error).toMatchObject({
      name: "TransactionConfirmationError",
      message: "Transaction confirmation timed out",
      txHash,
      status: "sent",
    });

    process.exitCode = undefined;
  });

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
      JSON.stringify({
        amount: "9007199254740993",
        txHash: byte32FromByte("44"),
        ElapsedSeconds: 2,
      }) + "\n",
    );
    expect(JSON.parse(logLine)).toMatchObject({
      amount: "9007199254740993",
      txHash: byte32FromByte("44"),
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
    });

    expect(stdoutWrite).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(stdoutWrite.mock.calls[0]?.[0])) as {
      type: string;
      amount: string;
    };
    expect(parsed).toEqual({
      type: "bot.decision.skipped",
      amount: "9007199254740993",
    });
    expect(String(stdoutWrite.mock.calls[0]?.[0])).toMatch(/\n$/u);

    stdoutWrite.mockRestore();
  });

  it("preserves public CKB metadata in JSON logs", () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const txHash = byte32FromByte("55");

    writeJsonLine({
      txHash,
      witness: "witnesses: 0x" + "22".repeat(80),
      signedTx: "signed transaction 0x" + "33".repeat(80),
      script: JSON.stringify({
        codeHash: "0x" + "44".repeat(32),
        hashType: "type",
        args: "0x" + "55".repeat(20),
      }),
      env: "testnet",
    });

    const parsed = JSON.parse(String(stdoutWrite.mock.calls[0]?.[0])) as {
      txHash: string;
      witness: string;
      signedTx: string;
      script: string;
      env: string;
    };
    expect(parsed.txHash).toBe(txHash);
    expect(parsed.witness).toBe("witnesses: 0x" + "22".repeat(80));
    expect(parsed.signedTx).toBe("signed transaction 0x" + "33".repeat(80));
    expect(parsed.script).toBe(JSON.stringify({
      codeHash: "0x" + "44".repeat(32),
      hashType: "type",
      args: "0x" + "55".repeat(20),
    }));
    expect(parsed.env).toBe("testnet");

    stdoutWrite.mockRestore();
  });
});

function sequence(...values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? 0;
}

function transactionError(isTimeout: boolean, txHash = byte32FromByte("11")): Error {
  return Object.assign(new Error("Transaction confirmation timed out"), {
    name: "TransactionConfirmationError",
    txHash,
    status: isTimeout ? "sent" : "rejected",
    isTimeout,
  });
}
