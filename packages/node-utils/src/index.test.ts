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
  parsePrivateKey,
  readSecretEnv,
  parseSleepInterval,
  parseSupportedChain,
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

  it("parses supported chain names from env values", () => {
    expect(parseSupportedChain("mainnet", "CHAIN")).toBe("mainnet");
    expect(parseSupportedChain("testnet", "CHAIN")).toBe("testnet");
  });

  it("rejects missing and unsupported chain env values", () => {
    expect(() => parseSupportedChain(undefined, "CHAIN")).toThrow(
      "Invalid env CHAIN: Empty",
    );
    expect(() => parseSupportedChain("devnet", "CHAIN")).toThrow(
      "Invalid env CHAIN: devnet",
    );
  });

  it("parses positive sleep intervals as milliseconds", () => {
    expect(parseSleepInterval("1", "SLEEP_INTERVAL")).toBe(1000);
    expect(parseSleepInterval("2.5", "SLEEP_INTERVAL")).toBe(2500);
  });

  it("rejects missing and sub-second sleep intervals", () => {
    for (const value of [undefined, "", "abc", "NaN", "Infinity", "0", "0.5"]) {
      expect(() => parseSleepInterval(value, "SLEEP_INTERVAL")).toThrow(
        "Invalid env SLEEP_INTERVAL",
      );
    }
  });

  it("parses private keys as exact 0x-prefixed lowercase hex", () => {
    const privateKey = `0x${"11".repeat(32)}`;

    expect(parsePrivateKey(privateKey, "BOT_PRIVATE_KEY")).toBe(privateKey);
    for (const value of [
      "11".repeat(32),
      `0X${"11".repeat(32)}`,
      `0x${"AA".repeat(32)}`,
      ` 0x${"11".repeat(32)}`,
      `0x${"11".repeat(32)} `,
      `0x${"11".repeat(31)}`,
    ]) {
      expect(() => parsePrivateKey(value, "BOT_PRIVATE_KEY")).toThrow(
        "Invalid env BOT_PRIVATE_KEY",
      );
    }
  });

  it("reads a secret from one env source", async () => {
    await expect(readSecretEnv(
      "0xabc",
      "BOT_PRIVATE_KEY",
      undefined,
      "BOT_PRIVATE_KEY_FILE",
    )).resolves.toBe("0xabc");
    await expect(readSecretEnv(
      undefined,
      "BOT_PRIVATE_KEY",
      undefined,
      "BOT_PRIVATE_KEY_FILE",
    )).rejects.toThrow("Empty env BOT_PRIVATE_KEY or BOT_PRIVATE_KEY_FILE");
    await expect(readSecretEnv(
      "0xabc",
      "BOT_PRIVATE_KEY",
      "/tmp/secret",
      "BOT_PRIVATE_KEY_FILE",
    )).rejects.toThrow("Set only one of BOT_PRIVATE_KEY or BOT_PRIVATE_KEY_FILE");
  });

  it("reads a secret from a file env source", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ickb-secret-"));
    try {
      const secretPath = join(dir, "secret");
      await writeFile(secretPath, "0xabc\n", { mode: 0o600 });
      const crlfSecretPath = join(dir, "crlf-secret");
      await writeFile(crlfSecretPath, "0xdef\r\n", { mode: 0o600 });

      await expect(readSecretEnv(
        undefined,
        "BOT_PRIVATE_KEY",
        secretPath,
        "BOT_PRIVATE_KEY_FILE",
      )).resolves.toBe("0xabc");
      await expect(readSecretEnv(
        "",
        "BOT_PRIVATE_KEY",
        crlfSecretPath,
        "BOT_PRIVATE_KEY_FILE",
      )).resolves.toBe("0xdef");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid secret files without exposing file contents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ickb-secret-"));
    try {
      const emptyPath = join(dir, "empty");
      await writeFile(emptyPath, "\n", { mode: 0o600 });

      await expect(readSecretEnv(
        undefined,
        "BOT_PRIVATE_KEY",
        emptyPath,
        "BOT_PRIVATE_KEY_FILE",
      )).rejects.toThrow("Empty file from env BOT_PRIVATE_KEY_FILE");

      await expect(readSecretEnv(
        undefined,
        "BOT_PRIVATE_KEY",
        join(dir, "missing"),
        "BOT_PRIVATE_KEY_FILE",
      )).rejects.toThrow("Invalid file from env BOT_PRIVATE_KEY_FILE");
      await expect(readSecretEnv(
        undefined,
        "BOT_PRIVATE_KEY",
        "",
        "BOT_PRIVATE_KEY_FILE",
      )).rejects.toThrow("Empty env BOT_PRIVATE_KEY or BOT_PRIVATE_KEY_FILE");
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

function transactionError(isTimeout: boolean, txHash = byte32FromByte("11")): Error {
  return Object.assign(new Error("Transaction confirmation timed out"), {
    name: "TransactionConfirmationError",
    txHash,
    status: isTimeout ? "sent" : "rejected",
    isTimeout,
  });
}
