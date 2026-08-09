import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildRuntimeConfig,
  parseArgs,
  usage,
} from "../../../live/config/config-from-env.ts";
import { defaultCheckIgnored } from "../../../live/config/git.ts";
import {
  absoluteConfigPath,
  assertWrittenResult,
  botConfigFile,
  botConfigPath,
  botLiveConfigFile,
  botLiveConfigPath,
  botPrivateKey,
  botPrivateKeyEnv,
  boundedMaxIterations,
  checkConfigIgnored,
  configFileMode,
  configSecretPattern,
  configuredRpcOptions,
  defaultMaxRetryableAttempts,
  expectedConfig,
  expectedWritten,
  hasMessage,
  jsonText,
  liveEnv,
  modeOf,
  readJson,
  retryableAttemptsEnv,
  rpcSecretPattern,
  rpcUrlEnv,
  runLiveConfig,
  sleepIntervalEnv,
  tempPrefix,
  testerConfigFile,
  testerConfigPath,
  testerPrivateKey,
  testerPrivateKeyEnv,
  testnetChain,
  testnetRpcUrl,
  type LiveConfigEnv,
} from "./config-from-env-support.ts";

const { join } = path;

void test("live env config helper parses CLI arguments", () => {
  assert.deepEqual(parseArgs([]), { force: false });
  assert.deepEqual(parseArgs(["--force"]), { force: true });
  assert.deepEqual(parseArgs(["--", "--help"]), { force: false, help: true });
  assert.throws((): void => {
    parseArgs(["--chain", testnetChain]);
  }, hasMessage("Unknown argument: --chain"));
  const usageText = usage();
  assert.equal(usageText.includes(botPrivateKeyEnv), true);
  assert.equal(usageText.includes(rpcUrlEnv), true);
  assert.equal(usageText.includes(retryableAttemptsEnv), true);
});

void test("live config git ignore guard runs with an allowlisted environment", () => {
  const originalPrivateKey = process.env["PRIVATE_KEY"];
  process.env["PRIVATE_KEY"] = "operator-secret";
  try {
    let seen: Record<string, string> | undefined;
    const ignored = defaultCheckIgnored(
      "/repo",
      botConfigPath,
      (_command, _args, options) => {
        seen = options.env;
        return { status: 0, stderr: "" };
      },
    );

    assert.equal(ignored, true);
    assert(seen !== undefined);
    assert.equal(seen["PRIVATE_KEY"], undefined);
    assert.equal(seen["NODE_OPTIONS"], undefined);
  } finally {
    if (originalPrivateKey === undefined) {
      delete process.env["PRIVATE_KEY"];
    } else {
      process.env["PRIVATE_KEY"] = originalPrivateKey;
    }
  }
});

void test("live env config helper builds configs with a required RPC URL", () => {
  assert.deepEqual(
    buildRuntimeConfig({
      privateKey: botPrivateKey,
      rpcUrl: testnetRpcUrl,
      sleepIntervalSeconds: 1,
      maxIterations: undefined,
      maxRetryableAttempts: undefined,
    }),
    {
      chain: testnetChain,
      privateKey: botPrivateKey,
      rpcUrl: testnetRpcUrl,
      sleepIntervalSeconds: 1,
    },
  );
  assert.deepEqual(
    buildRuntimeConfig({
      privateKey: botPrivateKey,
      rpcUrl: testnetRpcUrl,
      sleepIntervalSeconds: 1,
      maxIterations: boundedMaxIterations,
      maxRetryableAttempts: defaultMaxRetryableAttempts,
    }),
    {
      chain: testnetChain,
      privateKey: botPrivateKey,
      rpcUrl: testnetRpcUrl,
      sleepIntervalSeconds: 1,
      maxIterations: boundedMaxIterations,
      maxRetryableAttempts: defaultMaxRetryableAttempts,
    },
  );
  assert.deepEqual(
    buildRuntimeConfig({
      privateKey: botPrivateKey,
      rpcUrl: "https://testnet.example/",
      sleepIntervalSeconds: 2,
      maxIterations: 3,
      maxRetryableAttempts: 4,
    }),
    {
      chain: testnetChain,
      privateKey: botPrivateKey,
      rpcUrl: "https://testnet.example/",
      sleepIntervalSeconds: 2,
      maxIterations: 3,
      maxRetryableAttempts: 4,
    },
  );
});

void test("live env config helper writes ignored bounded and live testnet configs from env", async () => {
  const dir = await mkdtemp(join(tmpdir(), tempPrefix));
  try {
    const result = await runLiveConfig(dir, {
      dependencies: { checkIgnored: checkConfigIgnored },
    });

    assert.deepEqual(result, {
      written: [
        expectedWritten("bot", botConfigPath, boundedMaxIterations),
        expectedWritten("tester", testerConfigPath, boundedMaxIterations),
        expectedWritten("bot-live", botLiveConfigPath, undefined),
      ],
    });
    assert.doesNotMatch(jsonText(result), configSecretPattern);

    const botPath = absoluteConfigPath(dir, botConfigFile);
    const testerPath = absoluteConfigPath(dir, testerConfigFile);
    const botLivePath = absoluteConfigPath(dir, botLiveConfigFile);
    assert.deepEqual(
      await readJson(botPath),
      expectedConfig({
        privateKey: botPrivateKey,
        maxIterations: boundedMaxIterations,
        maxRetryableAttempts: defaultMaxRetryableAttempts,
      }),
    );
    assert.deepEqual(
      await readJson(testerPath),
      expectedConfig({
        privateKey: testerPrivateKey,
        maxIterations: boundedMaxIterations,
        maxRetryableAttempts: defaultMaxRetryableAttempts,
      }),
    );
    assert.deepEqual(
      await readJson(botLivePath),
      expectedConfig({ privateKey: botPrivateKey }),
    );
    assert.equal(await modeOf(botPath), configFileMode);
    assert.equal(await modeOf(testerPath), configFileMode);
    assert.equal(await modeOf(botLivePath), configFileMode);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("live env config helper reports configured RPC URLs without exposing them and preserves fixed iteration bounds", async () => {
  const dir = await mkdtemp(join(tmpdir(), tempPrefix));
  try {
    const result = await runLiveConfig(dir, {
      env: liveEnv({
        [rpcUrlEnv]: testnetRpcUrl,
        [sleepIntervalEnv]: "10",
        [retryableAttemptsEnv]: "3",
      }),
      dependencies: { checkIgnored: checkConfigIgnored },
    });

    assert.deepEqual(
      await Promise.all([
        readJson(absoluteConfigPath(dir, botConfigFile)),
        readJson(absoluteConfigPath(dir, testerConfigFile)),
        readJson(absoluteConfigPath(dir, botLiveConfigFile)),
      ]),
      [
        expectedConfig(configuredRpcOptions(botPrivateKey, boundedMaxIterations)),
        expectedConfig(configuredRpcOptions(testerPrivateKey, boundedMaxIterations)),
        expectedConfig(configuredRpcOptions(botPrivateKey, undefined)),
      ],
    );
    assertWrittenResult(result);
    assert.deepEqual(
      result.written.map((entry) => entry.rpcConfigured),
      [true, true, true],
    );
    assert.deepEqual(
      result.written.map((entry) => entry.maxRetryableAttempts),
      [3, 3, 3],
    );
    assert.doesNotMatch(jsonText(result), rpcSecretPattern);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("live env config helper validates env before writing", async () => {
  const dir = await mkdtemp(join(tmpdir(), tempPrefix));
  const invalidCases: Array<{ env: LiveConfigEnv; message: string }> = [
    {
      env: { [botPrivateKeyEnv]: botPrivateKey, [rpcUrlEnv]: testnetRpcUrl },
      message: `Missing env ${testerPrivateKeyEnv}`,
    },
    {
      env: liveEnv({ [rpcUrlEnv]: undefined }),
      message: `Missing env ${rpcUrlEnv}`,
    },
    {
      env: liveEnv({ [rpcUrlEnv]: "" }),
      message: `Invalid env ${rpcUrlEnv}`,
    },
    {
      env: liveEnv({ [rpcUrlEnv]: "https://user@testnet.example/" }),
      message: `Invalid env ${rpcUrlEnv}`,
    },
    {
      env: liveEnv({ [retryableAttemptsEnv]: "0" }),
      message: `Invalid env ${retryableAttemptsEnv}`,
    },
    {
      env: liveEnv({ [sleepIntervalEnv]: "1073742" }),
      message: `Invalid env ${sleepIntervalEnv}`,
    },
  ];
  try {
    for (const invalidCase of invalidCases) {
      await assert.rejects(async () => {
        await runLiveConfig(dir, {
          env: invalidCase.env,
          dependencies: { checkIgnored: checkConfigIgnored },
        });
      }, hasMessage(invalidCase.message));
    }
    await assert.rejects(access(join(dir, "config")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
