import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseArgs,
  publicScript,
  redactErrorMessage,
  runPreflight,
  usage,
} from "./ickb-live-preflight.mjs";

test("preflight CLI parses config and role arguments", () => {
  assert.deepEqual(parseArgs(["--config", "config/bot-testnet.json", "--role", "bot"]), {
    configPath: "config/bot-testnet.json",
    role: "bot",
  });
  assert.deepEqual(parseArgs(["--", "--help"]), { role: "preflight", help: true });
  assert.deepEqual(parseArgs(["--help"]), { role: "preflight", help: true });
  assert.throws(() => parseArgs([]), /Missing required --config/u);
  assert.throws(() => parseArgs(["--config", "x", "--role", "Bot!"]), /Invalid --role/u);
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

test("preflight CLI redacts private key and RPC URL in errors", () => {
  const privateKey = `0x${"11".repeat(32)}`;
  const rpcUrl = "https://user:pass@testnet.example/path?token=secret";
  const redacted = "https://redacted:redacted@testnet.example/...?token=redacted";
  const error = new Error(`failed with ${privateKey} using ${rpcUrl} user pass secret`);

  const message = redactErrorMessage(error, {
    privateKey,
    rpcUrl,
    redactedRpcUrl: redacted,
    redactSecretText,
  });

  assert.equal(
    message,
    `failed with <redacted-private-key> using ${redacted} ` +
      "<redacted-rpc-username> <redacted-rpc-password> <redacted-rpc-query>",
  );
  assert.doesNotMatch(message, /0x11/u);
  assert.doesNotMatch(message, /secret/u);
  assert.doesNotMatch(message, /\buser\b|\bpass\b/u);
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
    assert.equal(report.chainIdentity.redactedRpcUrl, "https://redacted:redacted@testnet.example/...?token=redacted");
    assert.equal(report.chainIdentity.matches.genesisHash, true);
    assert.equal(report.key.recommendedAddress, "ckt1generatedoffline");
    assert.deepEqual(report.key.primaryLock, {
      codeHash: "0x" + "11".repeat(32),
      hashType: "type",
      args: "0x" + "22".repeat(20),
    });
    assert.equal(report.balances.CKB.total, "0");
    assert.equal(report.inventory.userOrderCount, null);
    assert.equal(report.inventory.userOrderScan, "skipped-global-scan");
    assert.doesNotMatch(json, new RegExp(privateKey, "u"));
    assert.doesNotMatch(json, /secret/u);
    assert.doesNotMatch(json, /user:pass/u);
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

function mockDependencies() {
  const expectedGenesis = "0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606";
  const nodeUtils = {
    parseRuntimeConfig: (text) => {
      const parsed = JSON.parse(text);
      return {
        ...parsed,
        sleepIntervalMs: parsed.sleepIntervalSeconds * 1000,
      };
    },
    redactRpcUrl: () => "https://redacted:redacted@testnet.example/...?token=redacted",
    redactSecretText,
    createPublicClient: () => ({
      url: "mock",
      addressPrefix: "ckt",
      getTipHeader: async () => ({ hash: "0x" + "44".repeat(32), number: 3n, timestamp: 4n }),
      getFeeRate: async () => 1000n,
    }),
    verifyChainPreflight: async () => ({
      chain: "testnet",
      redactedRpcUrl: "https://redacted:redacted@testnet.example/...?token=redacted",
      expected: { genesisHash: expectedGenesis, addressPrefix: "ckt" },
      observed: {
        genesisHash: expectedGenesis,
        addressPrefix: "ckt",
        tip: { hash: "0x" + "33".repeat(32), number: 1n, timestamp: 2n },
      },
      matches: { genesisHash: true, addressPrefix: true },
    }),
    signerAccountLocks: async (_signer, primaryLock) => [primaryLock],
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
          getAccountState: async () => ({ receipts: [], withdrawalGroups: [] }),
        }),
      },
      projectAccountAvailability: () => ({
        ckbAvailable: 0n,
        ckbPending: 0n,
        ickbAvailable: 0n,
        readyWithdrawals: [],
        pendingWithdrawals: [],
      }),
    },
    core: {
      ickbExchangeRatio: () => ({ ckbScale: 1n, udtScale: 1n }),
      convert: (_toIckb, value) => value,
    },
  };
}

function redactSecretText(text, secrets = {}) {
  let redacted = text;
  if (secrets.privateKey) {
    redacted = redacted.split(secrets.privateKey).join("<redacted-private-key>");
  }
  if (secrets.rpcUrl) {
    redacted = redacted
      .split(secrets.rpcUrl).join(secrets.redactedRpcUrl)
      .split("user").join("<redacted-rpc-username>")
      .split("pass").join("<redacted-rpc-password>")
      .split("secret").join("<redacted-rpc-query>");
  }
  return redacted;
}

function bigintReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}
