import assert from "node:assert/strict";
import { constants } from "node:fs";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildRuntimeConfig,
  generateSecp256k1PrivateKey,
  parseArgs,
  runGenerateConfig,
  usage,
} from "./ickb-generate-config.mjs";

test("config generator parses defaults and explicit options", () => {
  assert.deepEqual(parseArgs([]), {
    chain: "testnet",
    role: "bot",
    sleepIntervalSeconds: 1,
    maxIterations: 1,
    force: false,
    rpcUrl: "https://testnet.ckb.dev/",
    out: "config/bot-testnet.json",
  });
  assert.deepEqual(parseArgs([
    "--chain", "mainnet",
    "--role", "tester",
    "--out", "config/custom.json",
    "--rpc-url", "https://user:pass@mainnet.example/path?token=secret",
    "--sleep-interval-seconds", "10",
    "--no-max-iterations",
    "--force",
  ]), {
    chain: "mainnet",
    role: "tester",
    sleepIntervalSeconds: 10,
    maxIterations: undefined,
    force: true,
    out: "config/custom.json",
    rpcUrl: "https://user:pass@mainnet.example/path?token=secret",
  });
  assert.throws(() => parseArgs(["--chain", "devnet"]), /Invalid --chain/u);
  assert.throws(() => parseArgs(["--role", "Bot"]), /Invalid --role/u);
  assert.match(usage(), /ickb-generate-config/u);
  assert.match(usage(), /--sleep-interval-seconds/u);
  assert.match(usage(), /--max-iterations/u);
  assert.match(usage(), /--no-max-iterations/u);
  assert.match(usage(), /--force/u);
});

test("config generator rejects RPC URLs the runtime parser rejects", () => {
  assert.throws(
    () => parseArgs(["--rpc-url", "https://testnet.example/path with spaces"]),
    /Invalid --rpc-url/u,
  );
  assert.throws(
    () => parseArgs(["--rpc-url", "https://testnet.example/\t"]),
    /Invalid --rpc-url/u,
  );
});

test("config generator uses secp256k1 range rejection", () => {
  const zero = Buffer.alloc(32);
  const order = Buffer.from("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141", "hex");
  const aboveOrder = Buffer.from("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364142", "hex");
  const valid = Buffer.from("01".repeat(32), "hex");
  const samples = [zero, order, aboveOrder, valid];

  const privateKey = generateSecp256k1PrivateKey(() => samples.shift() ?? valid);

  assert.equal(privateKey, `0x${"01".repeat(32)}`);
});

test("config generator refuses symlinked output paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-generate-config-"));
  try {
    await mkdir(join(dir, "target"));
    await symlink(join(dir, "target"), join(dir, "config"), "dir");

    await assert.rejects(
      () => runGenerateConfig({
        argv: ["--out", "config/bot-testnet.json"],
        root: dir,
        dependencies: {
          checkIgnored: () => true,
          mkdir: async () => undefined,
        },
      }),
      /symlinked parent directory/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("config generator opens output with no-follow and exclusive defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-generate-config-"));
  const opened = [];
  const dirs = new Set([dir]);
  try {
    await runGenerateConfig({
      argv: ["--out", "config/bot-testnet.json"],
      root: dir,
      dependencies: {
        randomBytes: () => Buffer.from("44".repeat(32), "hex"),
        checkIgnored: () => true,
        mkdir: async (path) => {
          dirs.add(path);
        },
        lstat: async (path) => {
          if (dirs.has(path)) {
            return { isSymbolicLink: () => false };
          }
          const error = new Error("missing");
          error.code = "ENOENT";
          throw error;
        },
        realpath: async (path) => path,
        open: async (path, flags, mode) => {
          opened.push({ path, flags, mode });
          return {
            writeFile: async () => undefined,
            chmod: async () => undefined,
            close: async () => undefined,
          };
        },
      },
    });

    assert.equal(opened.length, 1);
    assert.equal(opened[0].flags & constants.O_NOFOLLOW, constants.O_NOFOLLOW);
    assert.equal(opened[0].flags & constants.O_EXCL, constants.O_EXCL);
    assert.equal(opened[0].mode, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("config generator checks existing ancestors before creating missing parents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-generate-config-"));
  const mkdirCalls = [];
  const dirs = new Set([dir]);
  try {
    await runGenerateConfig({
      argv: ["--out", "config/nested/bot-testnet.json"],
      root: dir,
      dependencies: {
        randomBytes: () => Buffer.from("55".repeat(32), "hex"),
        checkIgnored: () => true,
        lstat: async (path) => {
          if (dirs.has(path)) {
            return { isSymbolicLink: () => false };
          }
          const error = new Error("missing");
          error.code = "ENOENT";
          throw error;
        },
        mkdir: async (path) => {
          mkdirCalls.push(path);
          dirs.add(path);
        },
        realpath: async (path) => path,
        open: async () => ({
          writeFile: async () => undefined,
          chmod: async () => undefined,
          close: async () => undefined,
        }),
      },
    });

    assert.deepEqual(mkdirCalls.map((path) => path.slice(dir.length + 1)), [
      "config",
      "config/nested",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("config generator builds strict runtime config shape", () => {
  assert.deepEqual(buildRuntimeConfig({
    chain: "testnet",
    privateKey: `0x${"11".repeat(32)}`,
    rpcUrl: "https://testnet.ckb.dev/",
    sleepIntervalSeconds: 1,
    maxIterations: 1,
  }), {
    chain: "testnet",
    privateKey: `0x${"11".repeat(32)}`,
    rpcUrl: "https://testnet.ckb.dev/",
    sleepIntervalSeconds: 1,
    maxIterations: 1,
  });
  assert.deepEqual(buildRuntimeConfig({
    chain: "mainnet",
    privateKey: `0x${"22".repeat(32)}`,
    rpcUrl: "https://mainnet.ckb.dev/",
    sleepIntervalSeconds: 60,
    maxIterations: undefined,
  }), {
    chain: "mainnet",
    privateKey: `0x${"22".repeat(32)}`,
    rpcUrl: "https://mainnet.ckb.dev/",
    sleepIntervalSeconds: 60,
  });
});

test("config generator writes only ignored configs and reports public metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-generate-config-"));
  const written = [];
  const dirs = new Set([dir]);
  try {
    const result = await runGenerateConfig({
      argv: ["--out", "config/bot-testnet.json", "--rpc-url", "https://user:pass@testnet.example/path?token=secret"],
      root: dir,
      dependencies: {
        randomBytes: () => Buffer.from("33".repeat(32), "hex"),
        checkIgnored: (_root, relativePath) => relativePath.startsWith("config/"),
        mkdir: async (path) => {
          dirs.add(path);
        },
        lstat: async (path) => {
          if (dirs.has(path)) {
            return { isSymbolicLink: () => false };
          }
          const error = new Error("missing");
          error.code = "ENOENT";
          throw error;
        },
        realpath: async (path) => path,
        writeFile: async (path, text, options) => {
          written.push({ path, text, options });
        },
      },
    });

    assert.equal(written.length, 1);
    assert.match(String(written[0].path), /config\/bot-testnet\.json$/u);
    assert.deepEqual(written[0].options, { flag: "wx", mode: 0o600 });
    assert.deepEqual(JSON.parse(written[0].text), {
      chain: "testnet",
      privateKey: `0x${"33".repeat(32)}`,
      rpcUrl: "https://user:pass@testnet.example/path?token=secret",
      sleepIntervalSeconds: 1,
      maxIterations: 1,
    });
    assert.deepEqual(result, {
      outputPath: "config/bot-testnet.json",
      role: "bot",
      chain: "testnet",
      redactedRpcUrl: "https://redacted:redacted@testnet.example/...?token=redacted",
      sleepIntervalSeconds: 1,
      maxIterations: 1,
      privateKey: "<written-to-config-file>",
    });
    assert.doesNotMatch(JSON.stringify(result), /0x33/u);
    assert.doesNotMatch(JSON.stringify(result), /user:pass|token=secret/u);

    await assert.rejects(
      () => runGenerateConfig({
        argv: ["--out", "not-ignored.json"],
        root: dir,
        dependencies: { checkIgnored: () => false },
      }),
      /Refusing to write non-ignored config path/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
