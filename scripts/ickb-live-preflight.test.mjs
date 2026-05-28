import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ckbReserveForRole,
  isPublicChainIdentityError,
  parseArgs,
  publicScript,
  publicErrorMessage,
  runPreflight,
  usage,
} from "./ickb-live-preflight.mjs";

test("preflight CLI parses config and role arguments", () => {
  assert.deepEqual(parseArgs(["--config", "config/bot-testnet.json", "--role", "bot_live"]), {
    configPath: "config/bot-testnet.json",
    role: "bot_live",
  });
  assert.deepEqual(parseArgs(["--", "--help"]), { role: "preflight", help: true });
  assert.deepEqual(parseArgs(["--help"]), { role: "preflight", help: true });
  assert.throws(() => parseArgs([]), /Missing required --config/u);
  assert.throws(() => parseArgs(["--config", "x", "--role", "Bot!"]), /Invalid --role/u);
  assert.throws(() => parseArgs(["--config", "x", "--role", "bot-"]), /Invalid --role/u);
  assert.throws(() => parseArgs(["--config", "x", "--role", "bot_"]), /Invalid --role/u);
  assert.throws(() => parseArgs(["--config", "x", "--role", `b${"o".repeat(31)}t`]), /Invalid --role/u);
  assert.match(usage(), /--config <ignored-json-config>/u);
});

test("preflight CLI exposes public script shape only", () => {
  assert.deepEqual(publicScript({
    codeHash: "0x11",
    hashType: "type",
    args: "0x22",
    extra: "ignored",
  }), {
    codeHash: "0x11",
    hashType: "type",
    args: "0x22",
  });
});

test("preflight CLI keeps public error messages and classifies chain identity errors", () => {
  assert.equal(publicErrorMessage(new Error("public failure")), "public failure");
  assert.equal(publicErrorMessage(undefined), "Unknown error");
  assert.equal(
    isPublicChainIdentityError(new Error("Invalid testnet RPC chain identity: genesis hash expected 0x1 observed 0x2")),
    true,
  );
  assert.equal(isPublicChainIdentityError(new Error("Missing testnet genesis header")), true);
  assert.equal(isPublicChainIdentityError(new Error("Invalid private key")), false);
});

test("preflight CLI exposes role-specific CKB reserves", () => {
  assert.equal(ckbReserveForRole("bot").toString(), "100000000000");
  assert.equal(ckbReserveForRole("tester").toString(), "200000000000");
  assert.equal(ckbReserveForRole("tester-watch").toString(), "200000000000");
  assert.equal(ckbReserveForRole("tester_watch").toString(), "200000000000");
  assert.throws(() => ckbReserveForRole("tester-"), /Invalid role/u);
});

test("preflight run reports public evidence for a generated unfunded key", async () => {
  const privateKey = `0x${randomBytes(32).toString("hex")}`;
  const rawRpcUrl = "https://user:pass@testnet.example/path?token=secret";
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-preflight-"));
  try {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      chain: "testnet",
      privateKey,
      rpcUrl: rawRpcUrl,
      sleepIntervalSeconds: 1,
      maxIterations: 1,
      maxRetryableAttempts: 3,
    }));

    const report = await runPreflight({
      configPath,
      role: "bot",
      root: dir,
      dependencies: { ...mockDependencies(), checkIgnored: () => true },
    });
    const json = JSON.stringify(report, bigintReplacer);

    assert.equal(report.role, "bot");
    assert.equal(report.chain, "testnet");
    assert.equal(report.bounded, true);
    assert.equal(report.maxIterations, 1);
    assert.equal(report.maxRetryableAttempts, 3);
    assert.equal(report.rpcConfigured, true);
    assert.equal(report.chainIdentity.matches.genesisHash, true);
    assert.equal(report.key.recommendedAddress, "ckt1generatedoffline");
    assert.deepEqual(report.key.primaryLock, {
      codeHash: "0x" + "11".repeat(32),
      hashType: "type",
      args: "0x" + "22".repeat(20),
    });
    assert.equal(report.balances.CKB.total, "0");
    assert.equal(report.balances.CKB.reserve, "100000000000");
    assert.equal(report.balances.CKB.spendable, "0");
    assert.equal(report.capital.depositCapacity, "10000000000000");
    assert.equal(report.capital.minimumCkbCapital, "10500000000000");
    assert.equal(report.capital.totalEquivalentCkb, "0");
    assert.equal(report.inventory.userOrderCount, null);
    assert.equal(report.inventory.userOrderScan, "skipped-global-scan");
    assert.doesNotMatch(json, new RegExp(privateKey, "u"));
    assert.doesNotMatch(json, /secret/u);
    assert.doesNotMatch(json, /user:pass/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preflight reports CKB reserve and spendable balance separately", async () => {
  const privateKey = `0x${randomBytes(32).toString("hex")}`;
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-preflight-"));
  try {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      chain: "testnet",
      privateKey,
      sleepIntervalSeconds: 1,
      maxIterations: 1,
    }));

    const dependencies = mockDependencies({
      plainCkbBalance: 150000000000n,
      projection: {
        ckbAvailable: 190000000000n,
        ckbPending: 25000000000n,
        ickbAvailable: 20000000000n,
        readyWithdrawals: [],
        pendingWithdrawals: [],
      },
    });
    const report = await runPreflight({
      configPath,
      role: "bot",
      root: dir,
      dependencies: { ...dependencies, checkIgnored: () => true },
    });

    assert.deepEqual(report.balances.CKB, {
      available: "150000000000",
      projectedAvailable: "190000000000",
      reserve: "100000000000",
      spendable: "50000000000",
      unavailable: "25000000000",
      total: "215000000000",
    });
    assert.equal(report.capital.totalEquivalentCkb, "235000000000");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preflight reports tester reserve and spendable balance separately", async () => {
  const privateKey = `0x${randomBytes(32).toString("hex")}`;
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-preflight-"));
  try {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      chain: "testnet",
      privateKey,
      sleepIntervalSeconds: 1,
      maxIterations: 1,
    }));

    const dependencies = mockDependencies({
      plainCkbBalance: 250000000000n,
      projection: {
        ckbAvailable: 280000000000n,
        ckbPending: 25000000000n,
        ickbAvailable: 20000000000n,
        readyWithdrawals: [],
        pendingWithdrawals: [],
      },
    });
    const report = await runPreflight({
      configPath,
      role: "tester",
      root: dir,
      dependencies: { ...dependencies, checkIgnored: () => true },
    });

    assert.deepEqual(report.balances.CKB, {
      available: "250000000000",
      projectedAvailable: "280000000000",
      reserve: "200000000000",
      spendable: "50000000000",
      unavailable: "25000000000",
      total: "305000000000",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preflight run accepts configs that omit custom RPC URLs", async () => {
  const privateKey = `0x${randomBytes(32).toString("hex")}`;
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-preflight-"));
  try {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      chain: "testnet",
      privateKey,
      sleepIntervalSeconds: 1,
      maxIterations: 1,
    }));

    const calls = [];
    const dependencies = mockDependencies({ createPublicClientCalls: calls });
    const report = await runPreflight({
      configPath,
      role: "tester",
      root: dir,
      dependencies: { ...dependencies, checkIgnored: () => true },
    });

    assert.equal(report.role, "tester");
    assert.equal(report.rpcConfigured, false);
    assert.deepEqual(calls, [{ chain: "testnet", rpcUrl: undefined }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preflight accepts absolute config paths through a symlinked repo root", async () => {
  const privateKey = `0x${randomBytes(32).toString("hex")}`;
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-preflight-root-"));
  const realRoot = join(dir, "real");
  const symlinkRoot = join(dir, "link");
  try {
    await mkdir(realRoot);
    await symlink(realRoot, symlinkRoot, "dir");
    await writeFile(join(realRoot, "config.json"), JSON.stringify({
      chain: "testnet",
      privateKey,
      sleepIntervalSeconds: 1,
      maxIterations: 1,
    }));

    const report = await runPreflight({
      configPath: join(symlinkRoot, "config.json"),
      role: "bot",
      root: symlinkRoot,
      dependencies: { ...mockDependencies(), checkIgnored: () => true },
    });

    assert.equal(report.role, "bot");
    await assert.rejects(
      () => runPreflight({
        configPath: join(dir, "outside.json"),
        role: "bot",
        root: symlinkRoot,
        dependencies: { ...mockDependencies(), checkIgnored: () => true },
      }),
      /Config path must stay inside the repo/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preflight preserves parse failure cause without leaking config contents", async () => {
  const privateKey = `0x${"11".repeat(32)}`;
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-preflight-"));
  try {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      chain: "testnet",
      privateKey,
      rpcUrl: "not-a-url",
      sleepIntervalSeconds: 1,
      maxIterations: 1,
    }));

    const parseError = new Error("Invalid env LIVE_PREFLIGHT_CONFIG_FILE");

    await assert.rejects(
      () => runPreflight({
        configPath,
        role: "bot",
        root: dir,
        dependencies: {
          checkIgnored: () => true,
          nodeUtils: {
            parseRuntimeConfig: () => {
              throw parseError;
            },
          },
        },
      }),
      (error) => {
        assert(error instanceof Error);
        assert.match(error.message, /Invalid live preflight config/u);
        assert.doesNotMatch(error.message, new RegExp(privateKey, "u"));
        assert.equal(error.cause, parseError);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preflight marks retryable transport failures without leaking RPC URLs", async () => {
  const privateKey = `0x${randomBytes(32).toString("hex")}`;
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-preflight-"));
  try {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      chain: "testnet",
      privateKey,
      rpcUrl: "https://testnet.example/path?token=secret",
      sleepIntervalSeconds: 1,
      maxIterations: 1,
    }));
    const dependencies = mockDependencies();
    const fetchFailure = new TypeError("fetch failed");
    dependencies.nodeUtils.verifyChainPreflight = async () => {
      throw fetchFailure;
    };
    dependencies.nodeUtils.isRetryableRpcTransportError = (error) => error === fetchFailure;

    await assert.rejects(
      () => runPreflight({
        configPath,
        role: "bot",
        root: dir,
        dependencies: { ...dependencies, checkIgnored: () => true },
      }),
      (error) => {
        assert(error instanceof Error);
        assert.equal(error.name, "RetryablePreflightError");
        assert.equal(error.message, "fetch failed");
        assert.doesNotMatch(error.message, /token=secret/u);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preflight preserves public wrong-chain evidence for supervisor classification", async () => {
  const privateKey = `0x${randomBytes(32).toString("hex")}`;
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-preflight-"));
  try {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      chain: "testnet",
      privateKey,
      sleepIntervalSeconds: 1,
      maxIterations: 1,
    }));
    const dependencies = mockDependencies();
    dependencies.nodeUtils.verifyChainPreflight = async () => {
      throw new Error("Invalid testnet RPC chain identity: genesis hash expected 0x1 observed 0x2");
    };

    await assert.rejects(
      () => runPreflight({
        configPath,
        role: "bot",
        root: dir,
        dependencies: { ...dependencies, checkIgnored: () => true },
      }),
      (error) => {
        assert(error instanceof Error);
        assert.equal(error.message, "Invalid testnet RPC chain identity: genesis hash expected 0x1 observed 0x2");
        assert.doesNotMatch(error.message, new RegExp(privateKey, "u"));
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preflight refuses non-ignored and out-of-repo config paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-preflight-"));
  try {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({}));

    await assert.rejects(
      () => runPreflight({
        configPath,
        role: "bot",
        root: dir,
        dependencies: { checkIgnored: () => false },
      }),
      /Refusing to read non-ignored config path: config\.json/u,
    );
    await assert.rejects(
      () => runPreflight({
        configPath: join(dir, "..", "config.json"),
        role: "bot",
        root: dir,
        dependencies: { checkIgnored: () => true },
      }),
      /Config path must stay inside the repo/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preflight refuses symlink config paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-preflight-"));
  try {
    await writeFile(join(dir, "target.json"), JSON.stringify({}));
    const configPath = join(dir, "config.json");
    await symlink(join(dir, "target.json"), configPath);

    await assert.rejects(
      () => runPreflight({
        configPath,
        role: "bot",
        root: dir,
        dependencies: { checkIgnored: () => true },
      }),
      /Refusing to read symlink config path/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preflight refuses symlinked config parent paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-preflight-"));
  try {
    await writeFile(join(dir, "target.json"), JSON.stringify({}));
    await symlink(dir, join(dir, "config"), "dir");

    await assert.rejects(
      () => runPreflight({
        configPath: join(dir, "config", "target.json"),
        role: "bot",
        root: dir,
        dependencies: { checkIgnored: () => true },
      }),
      /Refusing to read config through symlinked path: config/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function mockDependencies(options = {}) {
  const expectedGenesis = "0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606";
  const nodeUtils = {
    parseRuntimeConfig: (text) => {
      const parsed = JSON.parse(text);
      return {
        ...parsed,
        rpcUrl: parsed.rpcUrl,
        sleepIntervalMs: parsed.sleepIntervalSeconds * 1000,
        maxRetryableAttempts: parsed.maxRetryableAttempts,
      };
    },
    createPublicClient: (chain, rpcUrl) => {
      options.createPublicClientCalls?.push({ chain, rpcUrl });
      return {
        url: "mock",
        addressPrefix: "ckt",
        getTipHeader: async () => ({ hash: "0x" + "44".repeat(32), number: 3n, timestamp: 4n }),
        getFeeRate: async () => 1000n,
      };
    },
    verifyChainPreflight: async () => ({
      chain: "testnet",
      expected: { genesisHash: expectedGenesis, addressPrefix: "ckt" },
      observed: {
        genesisHash: expectedGenesis,
        addressPrefix: "ckt",
        tip: { hash: "0x" + "33".repeat(32), number: 1n, timestamp: 2n },
      },
      matches: { genesisHash: true, addressPrefix: true },
    }),
    isRetryableRpcTransportError: () => false,
    signerAccountLocks: async (_signer, primaryLock) => [primaryLock],
    accountPlainCkbBalance: () => options.plainCkbBalance ?? 0n,
    formatCkb: (value) => value.toString(),
  };
  const primaryLock = {
    codeHash: "0x" + "11".repeat(32),
    hashType: "type",
    args: "0x" + "22".repeat(20),
  };
  return {
    nodeUtils,
    ccc: {
      SignerCkbPrivateKey: class {
        async getRecommendedAddressObj() {
          return {
            script: primaryLock,
            toString: () => "ckt1generatedoffline",
          };
        }
      },
    },
    sdk: {
      getConfig: () => ({}),
      IckbSdk: {
        fromConfig: () => ({
          getAccountState: async () => ({ capacityCells: [], receipts: [], withdrawalGroups: [] }),
        }),
      },
      projectAccountAvailability: () => ({
        ...(options.projection ?? {
          ckbAvailable: 0n,
          ckbPending: 0n,
          ickbAvailable: 0n,
          readyWithdrawals: [],
          pendingWithdrawals: [],
        }),
      }),
    },
    core: {
      ickbExchangeRatio: () => ({ ckbScale: 1n, udtScale: 1n }),
      ICKB_DEPOSIT_CAP: 10000000000000n,
      convert: (_toIckb, value) => value,
    },
  };
}

function bigintReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}
