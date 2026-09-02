import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import pathModule from "node:path";
import test from "node:test";
import {
  buildRuntimeConfig,
  generateSecp256k1PrivateKey,
  parseArgs,
  runGenerateConfig,
  usage,
} from "../../../live/config/generate-config.ts";

const { join } = pathModule;
const defaultOut = "config/bot-testnet.json";
const testnetRpcUrl = "https://testnet.example/";

void test("config generator requires an explicit RPC URL and parses options", () => {
  assert.throws(() => parseArgs([]), /Missing required --rpc-url/u);
  assert.deepEqual(
    parseArgs([
      "--chain",
      "mainnet",
      "--role",
      "tester_role",
      "--out",
      "config/custom.json",
      "--rpc-url",
      "https://mainnet.example/path?token=secret",
      "--sleep-interval-seconds",
      "10",
      "--no-max-iterations",
      "--max-retryable-attempts",
      "3",
      "--force",
    ]),
    {
      chain: "mainnet",
      role: "tester_role",
      sleepIntervalSeconds: 10,
      maxIterations: undefined,
      maxRetryableAttempts: 3,
      force: true,
      out: "config/custom.json",
      rpcUrl: "https://mainnet.example/path?token=secret",
    },
  );
  assert.throws(() => parseArgs(["--chain", "devnet"]), /Invalid --chain/u);
  assert.throws(() => parseArgs(["--role", "Bot"]), /Invalid --role/u);
  assert.throws(() => parseArgs(["--role", "bot-"]), /Invalid --role/u);
  assert.throws(() => parseArgs(["--role", "bot_"]), /Invalid --role/u);
  assert.throws(() => parseArgs(["--role", `b${"o".repeat(31)}t`]), /Invalid --role/u);
  assert.throws(
    () =>
      parseArgs([
        "--rpc-url",
        testnetRpcUrl,
        "--sleep-interval-seconds",
        "9007199254740993",
      ]),
    /safe integer/u,
  );
  assert.match(usage(), /scripts\/live\/generate-config\.ts/u);
  assert.match(usage(), /--sleep-interval-seconds/u);
  assert.match(usage(), /--max-iterations/u);
  assert.match(usage(), /--no-max-iterations/u);
  assert.match(usage(), /--max-retryable-attempts/u);
  assert.match(usage(), /--no-max-retryable-attempts/u);
  assert.match(usage(), /--force/u);
  assert.equal(
    parseArgs([
      "--rpc-url",
      testnetRpcUrl,
      "--no-max-retryable-attempts",
    ]).maxRetryableAttempts,
    undefined,
  );
});

void test("config generator rejects RPC URLs the runtime parser rejects", () => {
  assert.throws(
    () => parseArgs(["--rpc-url", "https://testnet.example/path with spaces"]),
    /Invalid --rpc-url/u,
  );
  assert.throws(
    () => parseArgs(["--rpc-url", "https://testnet.example/\t"]),
    /Invalid --rpc-url/u,
  );
  assert.throws(
    () => parseArgs(["--rpc-url", "https://user@testnet.example/"]),
    /Invalid --rpc-url/u,
  );
});

void test("config generator uses secp256k1 range rejection", () => {
  const zero = Buffer.alloc(32);
  const order = Buffer.from(
    "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
    "hex",
  );
  const aboveOrder = Buffer.from(
    "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364142",
    "hex",
  );
  const valid = Buffer.from("01".repeat(32), "hex");
  const samples = [zero, order, aboveOrder, valid];

  const privateKey = generateSecp256k1PrivateKey(() => samples.shift() ?? valid);

  assert.equal(privateKey, `0x${"01".repeat(32)}`);
});

void test("config generator builds strict runtime config shape", () => {
  assert.deepEqual(
    buildRuntimeConfig({
      chain: "testnet",
      privateKey: `0x${"11".repeat(32)}`,
      rpcUrl: "https://testnet.ckb.dev/",
      sleepIntervalSeconds: 1,
      maxIterations: 1,
      maxRetryableAttempts: 10,
    }),
    {
      chain: "testnet",
      privateKey: `0x${"11".repeat(32)}`,
      rpcUrl: "https://testnet.ckb.dev/",
      sleepIntervalSeconds: 1,
      maxIterations: 1,
      maxRetryableAttempts: 10,
    },
  );
  assert.deepEqual(
    buildRuntimeConfig({
      chain: "mainnet",
      privateKey: `0x${"22".repeat(32)}`,
      rpcUrl: "https://mainnet.ckb.dev/",
      sleepIntervalSeconds: 60,
      maxIterations: undefined,
      maxRetryableAttempts: undefined,
    }),
    {
      chain: "mainnet",
      privateKey: `0x${"22".repeat(32)}`,
      rpcUrl: "https://mainnet.ckb.dev/",
      sleepIntervalSeconds: 60,
    },
  );
});

void test("config generator writes only ignored configs and reports public metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-generate-config-"));
  const dependencies = {
    randomBytes: (): Buffer => Buffer.from("33".repeat(32), "hex"),
    checkIgnored: (_root: string, relativePath: string): boolean =>
      relativePath.startsWith("config/"),
  };
  try {
    const result = await runGenerateConfig({
      argv: [
        "--out",
        defaultOut,
        "--rpc-url",
        "https://testnet.example/path?token=secret",
      ],
      root: dir,
      dependencies,
    });

    const outputPath = join(dir, defaultOut);
    assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), {
      chain: "testnet",
      privateKey: `0x${"33".repeat(32)}`,
      rpcUrl: "https://testnet.example/path?token=secret",
      sleepIntervalSeconds: 60,
      maxIterations: 1,
      maxRetryableAttempts: 10,
    });
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    assert.deepEqual(result, {
      outputPath: defaultOut,
      role: "bot",
      chain: "testnet",
      rpcConfigured: true,
      sleepIntervalSeconds: 60,
      maxIterations: 1,
      maxRetryableAttempts: 10,
      privateKey: "<written-to-config-file>",
    });
    assert.doesNotMatch(JSON.stringify(result), /0x33/u);
    assert.doesNotMatch(JSON.stringify(result), /token=secret/u);

    await assert.rejects(
      async () =>
        runGenerateConfig({
          argv: [
            "--rpc-url",
            testnetRpcUrl,
            "--out",
            "not-ignored.json",
          ],
          root: dir,
          dependencies: { checkIgnored: () => false },
        }),
      /Refusing to write non-ignored config path/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
