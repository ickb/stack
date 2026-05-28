import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, headerLike, script } from "@ickb/testkit";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import * as nodeUtils from "./index.js";
import {
  accountPlainCkbBalance,
  assertChainPreflight,
  CHAIN_IDENTITIES,
  createPublicClient,
  formatCkb,
  handleLoopError,
  isRetryableCkbStateRaceError,
  isRetryableRpcTransportError,
  logExecution,
  parseMaxIterations,
  parseRuntimeConfig,
  parsePrivateKey,
  postTransactionAccountPlainCkbBalance,
  readRuntimeConfigEnv,
  parseSleepInterval,
  randomSleepIntervalMs,
  readChainPreflight,
  reachedMaxIterations,
  signerAccountLocks,
  STOP_EXIT_CODE,
  verifyChainPreflight,
  writeJsonLine,
  type ChainPreflightClient,
} from "./index.js";

describe("node utilities", () => {
  it("does not export generic secret-policing helpers", () => {
    expect("assertNoPrivateKeyMaterial" in nodeUtils).toBe(false);
    expect("assertNoSecretMaterial" in nodeUtils).toBe(false);
    expect("SecretMaterialLogError" in nodeUtils).toBe(false);
    expect("PrivateKeyMaterialLogError" in nodeUtils).toBe(false);
    expect("sanitizeLogValue" in nodeUtils).toBe(false);
  });

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
    expect(parseSleepInterval(1073741, "BOT_CONFIG_FILE")).toBe(1073741000);
  });

  it("rejects missing and sub-second sleep intervals", () => {
    for (const value of [undefined, Number.NaN, Infinity, 0, 0.5, 1073741.824, 9007199254741]) {
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
    expect(randomSleepIntervalMs(1073741823, sequence(0.999999, 0.999999))).toBeLessThanOrEqual(2147483647);
  });

  it("parses private keys as exact 0x-prefixed lowercase hex", () => {
    const privateKey = `0x${"11".repeat(32)}`;
    const secp256k1Order = "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141";

    expect(parsePrivateKey(privateKey, "BOT_CONFIG_FILE")).toBe(privateKey);
    for (const value of [
      "11".repeat(32),
      `0X${"11".repeat(32)}`,
      `0x${"AA".repeat(32)}`,
      ` 0x${"11".repeat(32)}`,
      `0x${"11".repeat(32)} `,
      `0x${"11".repeat(31)}`,
      `0x${"00".repeat(32)}`,
      secp256k1Order,
      "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364142",
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
      maxRetryableAttempts: undefined,
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
      maxRetryableAttempts: undefined,
    });
    expect(parseRuntimeConfig(JSON.stringify({
      chain: "testnet",
      privateKey,
      sleepIntervalSeconds: 5,
    }), "BOT_CONFIG_FILE")).toEqual({
      chain: "testnet",
      privateKey,
      rpcUrl: undefined,
      sleepIntervalMs: 5000,
      maxIterations: undefined,
      maxRetryableAttempts: undefined,
    });
    expect(parseRuntimeConfig(JSON.stringify({
      chain: "testnet",
      privateKey,
      sleepIntervalSeconds: 5,
      maxRetryableAttempts: 3,
    }), "BOT_CONFIG_FILE")).toEqual({
      chain: "testnet",
      privateKey,
      rpcUrl: undefined,
      sleepIntervalMs: 5000,
      maxIterations: undefined,
      maxRetryableAttempts: 3,
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
      JSON.stringify({ chain: "testnet", privateKey: `${privateKey}\n`, sleepIntervalSeconds: 60 }),
      JSON.stringify({ chain: "testnet", privateKey, rpcUrl: "", sleepIntervalSeconds: 60 }),
      JSON.stringify({ chain: "testnet", privateKey, rpcUrl: "file:///tmp/socket", sleepIntervalSeconds: 60 }),
      JSON.stringify({ chain: "testnet", privateKey, rpcUrl: "https://rpc.example/ bad", sleepIntervalSeconds: 60 }),
      JSON.stringify({ chain: "testnet", privateKey, rpcUrl: 8114, sleepIntervalSeconds: 60 }),
      JSON.stringify({ chain: "testnet", privateKey, sleepIntervalSeconds: "60" }),
      JSON.stringify({ chain: "testnet", privateKey, sleepIntervalSeconds: 0 }),
      JSON.stringify({ chain: "testnet", privateKey, sleepIntervalSeconds: 60, maxIterations: "1" }),
      JSON.stringify({ chain: "testnet", privateKey, sleepIntervalSeconds: 60, maxRetryableAttempts: "1" }),
      JSON.stringify({ chain: "testnet", privateKey, sleepIntervalSeconds: 60, maxRetryableAttempts: 0 }),
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
    const originalInitCwd = process.env.INIT_CWD;
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
        maxRetryableAttempts: undefined,
      });
      await expect(readRuntimeConfigEnv(undefined, "BOT_CONFIG_FILE")).rejects.toThrow(
        "Empty env BOT_CONFIG_FILE",
      );
      await expect(readRuntimeConfigEnv(join(dir, "missing"), "BOT_CONFIG_FILE")).rejects.toThrow(
        "Invalid file from env BOT_CONFIG_FILE",
      );
      process.env.INIT_CWD = dir;
      await expect(readRuntimeConfigEnv("config.json", "BOT_CONFIG_FILE")).resolves.toMatchObject({
        chain: "testnet",
        privateKey,
      });
      await expect(readRuntimeConfigEnv(resolve("config.json"), "BOT_CONFIG_FILE")).rejects.toThrow(
        "Invalid file from env BOT_CONFIG_FILE",
      );
    } finally {
      if (originalInitCwd === undefined) {
        delete process.env.INIT_CWD;
      } else {
        process.env.INIT_CWD = originalInitCwd;
      }
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

  it("counts account plain CKB from owned plain capacity cells only", () => {
    const lock = script("11");
    const otherLock = script("22");
    const unspent = capacityCell(ccc.fixedPointFrom(2000), lock, "bb");
    const typed = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("cc"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(4000), lock, type: script("33") },
      outputData: "0x",
    });
    const data = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("dd"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(8000), lock },
      outputData: "0x1234",
    });

    expect(accountPlainCkbBalance([unspent, typed, data, capacityCell(100n, otherLock, "ee")], [lock])).toBe(
      ccc.fixedPointFrom(2000),
    );
  });

  it("counts post-transaction account plain CKB from unspent cells and new outputs", () => {
    const lock = script("11");
    const otherLock = script("22");
    const spent = capacityCell(ccc.fixedPointFrom(1000), lock, "aa");
    const unspent = capacityCell(ccc.fixedPointFrom(2000), lock, "bb");
    const typed = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("cc"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(4000), lock, type: script("33") },
      outputData: "0x",
    });
    const data = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("dd"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(8000), lock },
      outputData: "0x1234",
    });
    const tx = ccc.Transaction.default();
    tx.inputs.push(ccc.CellInput.from({ previousOutput: spent.outPoint }));
    tx.outputs.push(
      ccc.CellOutput.from({ capacity: ccc.fixedPointFrom(300), lock }),
      ccc.CellOutput.from({ capacity: ccc.fixedPointFrom(500), lock, type: script("33") }),
      ccc.CellOutput.from({ capacity: ccc.fixedPointFrom(700), lock: otherLock }),
    );
    tx.outputsData.push("0x", "0x", "0x");

    expect(postTransactionAccountPlainCkbBalance(
      tx,
      [spent, unspent, typed, data],
      [lock],
    )).toBe(ccc.fixedPointFrom(2300));
  });

  it("creates network-specific public clients and forwards custom RPC URLs", () => {
    const mainnet = createPublicClient("mainnet", "https://mainnet.example");
    const testnet = createPublicClient("testnet", undefined);
    const defaultTestnet = new ccc.ClientPublicTestnet();

    expect(mainnet).toBeInstanceOf(ccc.ClientPublicMainnet);
    expect(testnet).toBeInstanceOf(ccc.ClientPublicTestnet);
    expect(mainnet.addressPrefix).toBe("ckb");
    expect(testnet.addressPrefix).toBe("ckt");
    expect((mainnet as ccc.ClientPublicMainnet).url).toBe(
      "https://mainnet.example",
    );
    expect((testnet as ccc.ClientPublicTestnet).url).toBe(defaultTestnet.url);
  });

  it("pins official CKB chain identities for preflight checks", () => {
    expect(CHAIN_IDENTITIES.mainnet).toMatchObject({
      chain: "mainnet",
      networkName: "ckb",
      genesisHash: "0x92b197aa1fba0f63633922c61c92375c9c074a93e85963554f5499fe1450d0e5",
      genesisMessage: "lina 0x18e020f6b1237a3d06b75121f25a7efa0550e4b3f44f974822f471902424c104",
      genesisSource: "https://raw.githubusercontent.com/nervosnetwork/ckb/develop/resource/specs/mainnet.toml",
      addressPrefix: "ckb",
    });
    expect(CHAIN_IDENTITIES.testnet).toMatchObject({
      chain: "testnet",
      networkName: "ckb_testnet",
      genesisHash: "0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606",
      genesisMessage: "aggron-v4",
      genesisSource: "https://raw.githubusercontent.com/nervosnetwork/ckb/develop/resource/specs/testnet.toml",
      addressPrefix: "ckt",
    });
  });

  it("reads and verifies public chain identity evidence", async () => {
    const client = preflightClient({
      addressPrefix: "ckt",
      genesisHash: CHAIN_IDENTITIES.testnet.genesisHash,
      tipHash: byte32FromByte("22"),
      tipNumber: 123n,
      tipTimestamp: 456n,
    });

    await expect(readChainPreflight(client, "testnet")).resolves.toEqual({
      chain: "testnet",
      expected: CHAIN_IDENTITIES.testnet,
      observed: {
        genesisHash: CHAIN_IDENTITIES.testnet.genesisHash,
        addressPrefix: "ckt",
        tip: {
          hash: byte32FromByte("22"),
          number: 123n,
          timestamp: 456n,
        },
      },
      matches: {
        genesisHash: true,
        addressPrefix: true,
      },
    });
    await expect(verifyChainPreflight(client, "testnet")).resolves.toMatchObject({
      chain: "testnet",
      matches: { genesisHash: true, addressPrefix: true },
    });
  });

  it("rejects mismatched public chain identity evidence", () => {
    expect(() => assertChainPreflight({
      chain: "testnet",
      expected: CHAIN_IDENTITIES.testnet,
      observed: {
        genesisHash: CHAIN_IDENTITIES.mainnet.genesisHash,
        addressPrefix: "ckb",
        tip: { hash: byte32FromByte("22"), number: 1n, timestamp: 2n },
      },
      matches: { genesisHash: false, addressPrefix: false },
    })).toThrow(
      "Invalid testnet RPC chain identity: genesis hash expected " +
        CHAIN_IDENTITIES.testnet.genesisHash +
        " observed " +
        CHAIN_IDENTITIES.mainnet.genesisHash +
        "; address prefix expected ckt observed ckb",
    );
  });

  it("hides non-public preflight failure details before loop logging starts", async () => {
    const client = preflightClient({
      addressPrefix: "ckt",
      genesisHash: CHAIN_IDENTITIES.testnet.genesisHash,
      tipHash: byte32FromByte("22"),
      tipNumber: 123n,
      tipTimestamp: 456n,
    });
    client.getHeaderByNumber = (): Promise<ccc.ClientBlockHeader | undefined> => {
      throw new Error("RPC failed via https://user:pass@testnet.example/path?token=secret");
    };

    await expect(verifyChainPreflight(client, "testnet")).rejects.toThrow(
      "Failed to verify testnet RPC chain identity",
    );
    await expect(verifyChainPreflight(client, "testnet")).rejects.not.toThrow(/user|pass|secret|testnet\.example/u);
  });

  it("hides non-Error preflight failures before loop logging starts", async () => {
    const client = preflightClient({
      addressPrefix: "ckt",
      genesisHash: CHAIN_IDENTITIES.testnet.genesisHash,
      tipHash: byte32FromByte("22"),
      tipNumber: 123n,
      tipTimestamp: 456n,
    });
    client.getHeaderByNumber = (): Promise<ccc.ClientBlockHeader | undefined> => {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Covers defensive handling for non-Error RPC failures.
      return Promise.reject({
        reason: "failed",
        amount: 9007199254740993n,
        reasonCode: "transport",
      });
    };

    await expect(verifyChainPreflight(client, "testnet")).rejects.toThrow(
      "Failed to verify testnet RPC chain identity",
    );
  });

  it("normalizes retryable preflight transport failures", async () => {
    const client = preflightClient({
      addressPrefix: "ckt",
      genesisHash: CHAIN_IDENTITIES.testnet.genesisHash,
      tipHash: byte32FromByte("22"),
      tipNumber: 123n,
      tipTimestamp: 456n,
    });
    client.getHeaderByNumber = (): Promise<ccc.ClientBlockHeader | undefined> => {
      throw new TypeError("fetch failed");
    };

    await expect(verifyChainPreflight(client, "testnet")).rejects.toMatchObject({
      message: "fetch failed",
      cause: { name: "TypeError", message: "fetch failed" },
    });
    await expect(verifyChainPreflight(client, "testnet").catch((error: unknown) => {
      expect(isRetryableRpcTransportError(error)).toBe(true);
    })).resolves.toBeUndefined();
  });

  it("classifies retryable RPC transport failures", async () => {
    const { isRetryableRpcTransportError } = await import("./index.js");

    expect(isRetryableRpcTransportError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableRpcTransportError(new Error("fetch failed", { cause: new TypeError("fetch failed") }))).toBe(true);
    expect(isRetryableRpcTransportError(new Error("fetch failed"))).toBe(false);
    expect(isRetryableRpcTransportError(new Error("Invalid testnet RPC chain identity"))).toBe(false);
  });

  it("classifies observed CKB state-race send failures", () => {
    expect(isRetryableCkbStateRaceError(Object.assign(new Error("Client request error PoolRejectedRBF"), {
      code: -1111,
      data: "RBFRejected(\"Tx's current fee is 11795, expect it to >= 12326 to replace old txs\")",
      currentFee: 11795n,
      leastFee: 12326n,
    }))).toBe(true);
    expect(isRetryableCkbStateRaceError(Object.assign(new Error("Client request error TransactionFailedToResolve"), {
      code: -301,
      data: `Resolve(Unknown(OutPoint(0x${"11".repeat(32)}00000000)))`,
    }))).toBe(true);
    expect(isRetryableCkbStateRaceError({
      code: -301,
      data: `Resolve(Dead(OutPoint(0x${"11".repeat(32)}00000000)))`,
    })).toBe(true);
    expect(isRetryableCkbStateRaceError(Object.assign(new Error("Client request error PoolRejectedDuplicatedTransaction"), {
      code: -1107,
      data: `Duplicated(Byte32(0x${"22".repeat(32)}))`,
      txHash: `0x${"22".repeat(32)}`,
    }))).toBe(true);

    expect(isRetryableCkbStateRaceError({ code: -301, data: "Resolve(InvalidHeader(Byte32(0x...)))" })).toBe(false);
    expect(isRetryableCkbStateRaceError({ code: -302, data: `Resolve(Unknown(OutPoint(0x${"11".repeat(32)}00000000)))` })).toBe(false);
    expect(isRetryableCkbStateRaceError(new Error("RBFRejected"))).toBe(false);
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

  it("preserves public CKB RPC Error metadata in execution logs", () => {
    const executionLog: Record<string, unknown> = {};
    const error = Object.assign(new Error("Client request error TransactionFailedToResolve"), {
      code: -301,
      data: `Resolve(Unknown(OutPoint(0x${"11".repeat(32)}00000000)))`,
      outPoint: {
        txHash: `0x${"11".repeat(32)}`,
        index: 0n,
      },
    });

    expect(handleLoopError(executionLog, error)).toBe(false);
    expect(executionLog.error).toMatchObject({
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
      isTimeout: true,
    });

    process.exitCode = undefined;
  });

  it("records non-timeout transaction confirmation failures distinctly", () => {
    const txHash = byte32FromByte("34");
    const executionLog: Record<string, unknown> = { txHash };

    expect(handleLoopError(executionLog, transactionError(false, txHash))).toBe(false);
    expect(executionLog.error).toMatchObject({
      name: "TransactionConfirmationError",
      message: "Transaction confirmation timed out",
      txHash,
      status: "rejected",
      isTimeout: false,
    });
  });

  it("preserves CKB debugging metadata from non-Error loop failures", () => {
    const rpcUrl = "https://testnet.example/rpc/path";
    const executionLog: Record<string, unknown> = {};
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(handleLoopError(executionLog, {
      message: `failed via ${rpcUrl}`,
      rpcUrl,
      amount: 9007199254740993n,
      nested: {
        rpc_url: rpcUrl,
        message: "nested public evidence",
      },
      circular,
    })).toBe(false);
    const serialized = JSON.stringify(executionLog);

    expect(serialized).toContain(rpcUrl);
    expect(executionLog.error).toMatchObject({
      message: "failed via " + rpcUrl,
      rpcUrl,
      amount: "9007199254740993",
      nested: {
        rpc_url: rpcUrl,
        message: "nested public evidence",
      },
      circular: { self: "[Circular]" },
    });
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

  it("preserves CKB debugging metadata", () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const txHash = byte32FromByte("55");

    writeJsonLine({
      txHash,
      witness: "witnesses: 0x" + "22".repeat(80),
      witnesses: ["0x" + "22".repeat(80)],
      inputs: [{}],
      outputs: [{}],
      outputsData: ["0x" + "22".repeat(80)],
      cellDeps: [{}],
      headerDeps: [{}],
      signedTx: "signed transaction 0x" + "33".repeat(80),
      tx: { inputs: [], outputs: [], witnesses: [] },
      rawTransaction: { inputs: [], outputs: [], witnesses: [] },
      script: JSON.stringify({
        codeHash: "0x" + "44".repeat(32),
        hashType: "type",
        args: "0x" + "55".repeat(20),
      }),
      lock: { codeHash: "0x" + "44".repeat(32), hashType: "type", args: "0x" },
      cell: { cellOutput: { lock: script("66") } },
      transactionShape: { inputs: 1, outputs: 2, witnesses: 3 },
      env: "testnet",
      environment: { BOT_CONFIG_FILE: "/run/credentials/config.json" },
      config: { chain: "testnet" },
    });

    const parsed = JSON.parse(String(stdoutWrite.mock.calls[0]?.[0])) as {
      txHash: string;
      witness: string;
      witnesses: string[];
      inputs: unknown[];
      outputs: unknown[];
      outputsData: string[];
      cellDeps: unknown[];
      headerDeps: unknown[];
      signedTx: string;
      tx: { inputs: unknown[]; outputs: unknown[]; witnesses: unknown[] };
      rawTransaction: { inputs: unknown[]; outputs: unknown[]; witnesses: unknown[] };
      script: string;
      lock: { codeHash: string; hashType: string; args: string };
      cell: { cellOutput: { lock: unknown } };
      transactionShape: { inputs: number; outputs: number; witnesses: number };
      env: string;
      environment: { BOT_CONFIG_FILE: string };
      config: { chain: string };
    };
    expect(parsed.txHash).toBe(txHash);
    expect(parsed.witness).toBe("witnesses: 0x" + "22".repeat(80));
    expect(parsed.witnesses).toEqual(["0x" + "22".repeat(80)]);
    expect(parsed.inputs).toEqual([{}]);
    expect(parsed.outputs).toEqual([{}]);
    expect(parsed.outputsData).toEqual(["0x" + "22".repeat(80)]);
    expect(parsed.cellDeps).toEqual([{}]);
    expect(parsed.headerDeps).toEqual([{}]);
    expect(parsed.signedTx).toBe("signed transaction 0x" + "33".repeat(80));
    expect(parsed.tx).toEqual({ inputs: [], outputs: [], witnesses: [] });
    expect(parsed.rawTransaction).toEqual({ inputs: [], outputs: [], witnesses: [] });
    expect(parsed.script).toBe(JSON.stringify({
      codeHash: "0x" + "44".repeat(32),
      hashType: "type",
      args: "0x" + "55".repeat(20),
    }));
    expect(parsed.lock).toEqual({ codeHash: "0x" + "44".repeat(32), hashType: "type", args: "0x" });
    expect(parsed.cell).toHaveProperty("cellOutput");
    expect(parsed.transactionShape).toEqual({ inputs: 1, outputs: 2, witnesses: 3 });
    expect(parsed.env).toBe("testnet");
    expect(parsed.environment).toEqual({ BOT_CONFIG_FILE: "/run/credentials/config.json" });
    expect(parsed.config).toEqual({ chain: "testnet" });

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

function capacityCell(capacity: bigint, lock: ccc.Script, txByte: string): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(txByte), index: 0n },
    cellOutput: { capacity, lock },
    outputData: "0x",
  });
}

function preflightClient({
  addressPrefix,
  genesisHash,
  tipHash,
  tipNumber,
  tipTimestamp,
}: {
  addressPrefix: string;
  genesisHash: `0x${string}`;
  tipHash: `0x${string}`;
  tipNumber: bigint;
  tipTimestamp: bigint;
}): ChainPreflightClient {
  return {
    addressPrefix,
    getHeaderByNumber: async (blockNumber): Promise<ccc.ClientBlockHeader | undefined> => {
      await Promise.resolve();
      if (blockNumber !== 0n) {
        return;
      }
      return headerLike({ hash: genesisHash, number: 0n });
    },
    getTipHeader: async (): Promise<ccc.ClientBlockHeader> => {
      await Promise.resolve();
      return headerLike({ hash: tipHash, number: tipNumber, timestamp: tipTimestamp });
    },
  };
}
