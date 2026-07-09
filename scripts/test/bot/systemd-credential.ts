import assert from "node:assert/strict";
import { readFile as fsReadFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateCredentialConfig } from "../../bot/systemd-credential.ts";

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
const wrapper = joinPath(rootDir, "scripts", "ickb-bot-systemd-credential.sh");
const entrypoint = joinPath(rootDir, "scripts", "bot", "systemd-credential.ts");
const privateKey = `0x${"11".repeat(32)}`;

void test("credential helper wrapper delegates to the Node-owned entrypoint", async () => {
  const text = await readText(wrapper);

  assert.match(text, /bot\/systemd-credential\.ts/u);
  assert.doesNotMatch(text, /validate_config/u);
});

void test("credential helper requires Node 22.19 for source config validation", async () => {
  const text = await readText(entrypoint);

  assert.match(text, /requireNode22_19/u);
});

void test("credential helper validation uses the shared runtime parser", () => {
  const config = JSON.stringify({
    chain: "testnet",
    privateKey,
    rpcUrl: "http://127.0.0.1:8114/",
    sleepIntervalSeconds: 60,
    maxRetryableAttempts: 10,
  });

  assert.equal(validateCredentialConfig("testnet", config), config);

  const defaultRpcConfig = JSON.stringify({
    chain: "testnet",
    privateKey,
    sleepIntervalSeconds: 60,
    maxRetryableAttempts: 10,
  });
  assert.equal(validateCredentialConfig("testnet", defaultRpcConfig), defaultRpcConfig);

  const unboundedRetryConfig = JSON.stringify({
    chain: "testnet",
    privateKey,
    sleepIntervalSeconds: 60,
  });
  assert.equal(validateCredentialConfig("testnet", unboundedRetryConfig), unboundedRetryConfig);

  assert.throws(() => validateCredentialConfig("mainnet", config), /Invalid bot config/u);

  assert.throws(
    () =>
      validateCredentialConfig(
        "testnet",
        JSON.stringify({
          chain: "testnet",
          privateKey: `${privateKey}\n`,
          rpcUrl: "http://127.0.0.1:8114/",
          sleepIntervalSeconds: 60,
        }),
      ),
    (error: unknown) =>
      error instanceof Error &&
      /Invalid bot config/u.test(error.message) &&
      !/0x11/u.test(error.message),
  );
});

void test("credential helper does not echo RPC URL input", async () => {
  const text = await readText(entrypoint);

  assert.doesNotMatch(text, /systemd-ask-password --echo=yes/u);
});

void test("credential helper prompts for retryable-attempt budget", async () => {
  const text = await readText(entrypoint);

  assert.match(text, /max retryable attempts/u);
  assert.match(text, /empty for unbounded/u);
  assert.match(text, /maxRetryableAttempts/u);
});

async function readText(filePath: string): Promise<string> {
  return fsReadFile(filePath, "utf8");
}

function joinPath(...segments: string[]): string {
  return path.join(...segments);
}
