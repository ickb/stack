import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const script = join(rootDir, "scripts", "ickb-bot-systemd-credential.sh");
const privateKey = `0x${"11".repeat(32)}`;

test("credential helper validation uses the shared runtime parser", () => {
  const config = JSON.stringify({
    chain: "testnet",
    privateKey,
    rpcUrl: "http://127.0.0.1:8114/",
    sleepIntervalSeconds: 60,
  });

  const valid = validateConfig("testnet", config);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout, config);

  const wrongChain = validateConfig("mainnet", config);
  assert.equal(wrongChain.status, 1);
  assert.match(wrongChain.stderr, /Invalid bot config/u);

  const invalidKey = validateConfig("testnet", JSON.stringify({
    chain: "testnet",
    privateKey: `${privateKey}\n`,
    rpcUrl: "http://127.0.0.1:8114/",
    sleepIntervalSeconds: 60,
  }));
  assert.equal(invalidKey.status, 1);
  assert.doesNotMatch(invalidKey.stderr, /0x11/u);
});

function validateConfig(network, input) {
  return spawnSync(
    "bash",
    ["-c", `source "$1"; validate_config "$2" "$3"`, "bash", script, network, rootDir],
    { cwd: rootDir, input, encoding: "utf8" },
  );
}
