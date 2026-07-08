import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { readFile as fsReadFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const { join } = path;
const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
const script = join(rootDir, "scripts", "ickb-bot-systemd-credential.sh");
const bashPath = "/usr/bin/bash";
const privateKey = `0x${"11".repeat(32)}`;

void test("credential helper requires Node 22.19 for source config validation", async () => {
  const text = await readScript();

  assert.match(text, /Node\.js >=22\.19\.0/u);
  assert.match(text, /minor >= 19/u);
});

void test("credential helper validation uses the shared runtime parser", () => {
  const config = JSON.stringify({
    chain: "testnet",
    privateKey,
    rpcUrl: "http://127.0.0.1:8114/",
    sleepIntervalSeconds: 60,
    maxRetryableAttempts: 10,
  });

  const valid = validateConfig("testnet", config);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout, config);

  const defaultRpcConfig = JSON.stringify({
    chain: "testnet",
    privateKey,
    sleepIntervalSeconds: 60,
    maxRetryableAttempts: 10,
  });
  const validDefaultRpc = validateConfig("testnet", defaultRpcConfig);
  assert.equal(validDefaultRpc.status, 0, validDefaultRpc.stderr);
  assert.equal(validDefaultRpc.stdout, defaultRpcConfig);

  const unboundedRetryConfig = JSON.stringify({
    chain: "testnet",
    privateKey,
    sleepIntervalSeconds: 60,
  });
  const validUnboundedRetry = validateConfig("testnet", unboundedRetryConfig);
  assert.equal(validUnboundedRetry.status, 0, validUnboundedRetry.stderr);
  assert.equal(validUnboundedRetry.stdout, unboundedRetryConfig);

  const wrongChain = validateConfig("mainnet", config);
  assert.equal(wrongChain.status, 1);
  assert.match(wrongChain.stderr, /Invalid bot config/u);

  const invalidKey = validateConfig(
    "testnet",
    JSON.stringify({
      chain: "testnet",
      privateKey: `${privateKey}\n`,
      rpcUrl: "http://127.0.0.1:8114/",
      sleepIntervalSeconds: 60,
    }),
  );
  assert.equal(invalidKey.status, 1);
  assert.doesNotMatch(invalidKey.stderr, /0x11/u);
});

void test("credential helper does not echo RPC URL input", async () => {
  const text = await readScript();

  assert.doesNotMatch(text, /systemd-ask-password --echo=yes/u);
});

void test("credential helper prompts for retryable-attempt budget", async () => {
  const text = await readScript();

  assert.match(text, /max retryable attempts/u);
  assert.match(text, /empty for unbounded/u);
  assert.match(text, /maxRetryableAttempts/u);
});

async function readScript(): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This test reads the fixed credential helper script under the repository root.
  return fsReadFile(script, "utf8");
}

function validateConfig(network: string, input: string): SpawnSyncReturns<string> {
  return spawnSync(
    bashPath,
    ["-c", `source "$1"; validate_config "$2" "$3"`, "bash", script, network, rootDir],
    {
      cwd: rootDir,
      input,
      encoding: "utf8",
    },
  );
}
