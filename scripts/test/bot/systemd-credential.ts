import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import type { Stats } from "node:fs";
import {
  chmod,
  readFile as fsReadFile,
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const { join } = path;
const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
const script = join(rootDir, "scripts", "ickb-bot-systemd-credential.sh");
const bashPath = "/usr/bin/bash";
const privateKey = `0x${"11".repeat(32)}`;
const rpcUrl = "http://127.0.0.1:8114/";

void test("credential helper requires Node 22.19 for source config validation", async () => {
  const text = await readScript();

  assert.match(text, /Node\.js >=22\.19\.0/u);
  assert.match(text, /minor >= 19/u);
});

void test("credential helper validation uses the shared runtime parser", () => {
  const config = JSON.stringify({
    chain: "testnet",
    privateKey,
    rpcUrl,
    sleepIntervalSeconds: 60,
    maxRetryableAttempts: 10,
  });

  const valid = validateConfig("testnet", config);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout, config);

  const missingRpcConfig = JSON.stringify({
    chain: "testnet",
    privateKey,
    sleepIntervalSeconds: 60,
    maxRetryableAttempts: 10,
  });
  const invalidMissingRpc = validateConfig("testnet", missingRpcConfig);
  assert.equal(invalidMissingRpc.status, 1);
  assert.match(invalidMissingRpc.stderr, /Invalid bot config/u);

  const unboundedRetryConfig = JSON.stringify({
    chain: "testnet",
    privateKey,
    rpcUrl,
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
      rpcUrl,
      sleepIntervalSeconds: 60,
    }),
  );
  assert.equal(invalidKey.status, 1);
  assert.doesNotMatch(invalidKey.stderr, /0x11/u);
});

void test("credential helper does not echo RPC URL input", async () => {
  const text = await readScript();

  assert.doesNotMatch(text, /systemd-ask-password --echo=yes/u);
  assert.match(text, /RPC URL:/u);
  assert.doesNotMatch(text, /empty for CCC default/u);
});

void test("credential helper prompts for retryable-attempt budget", async () => {
  const text = await readScript();

  assert.match(text, /max retryable attempts/u);
  assert.match(text, /empty for unbounded/u);
  assert.match(text, /maxRetryableAttempts/u);
});

void test("candidate validation failure preserves the existing credential", async () => {
  await withInstallFixture("invalid", async ({ credential, oldBytes, run }) => {
    const result = run();

    assert.notEqual(result.status, 0);
    assert.deepEqual(await readFixture(credential), oldBytes);
  });
});

void test("pre-replace failure preserves the existing credential", async () => {
  await withInstallFixture(
    "sync-failure",
    async ({ credential, events, oldBytes, run }) => {
      const result = run();

      assert.equal(result.status, 73);
      assert.deepEqual(await readFixture(credential), oldBytes);
      assert.deepEqual(await readEvents(events), ["decrypt", "sync:file"]);
    },
  );
});

void test("validated candidate atomically replaces with mode 0600 and durable ordering", async () => {
  await withInstallFixture(
    "success",
    async ({ candidateBytes, credential, events, run }) => {
      const result = run();

      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(await readFixture(credential), candidateBytes);
      assert.equal((await statFixture(credential)).mode & 0o777, 0o600);
      assert.deepEqual(await readEvents(events), [
        "decrypt",
        "sync:file",
        "rename",
        "sync:directory",
      ]);
    },
  );
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

type FixtureMode = "invalid" | "sync-failure" | "success";

interface InstallFixture {
  candidateBytes: Buffer;
  credential: string;
  events: string;
  oldBytes: Buffer;
  run: () => SpawnSyncReturns<string>;
}

async function withInstallFixture(
  mode: FixtureMode,
  body: (fixture: InstallFixture) => Promise<void>,
): Promise<void> {
  const fixtureRoot = await mkdtemp(join(os.tmpdir(), "ickb-credential-test-"));
  try {
    const bin = join(fixtureRoot, "bin");
    const credentialDir = join(fixtureRoot, "credentials");
    const candidate = join(credentialDir, ".candidate");
    const credential = join(credentialDir, "config.cred");
    const events = join(fixtureRoot, "events");
    const oldBytes = Buffer.from("fixture-old-credential-canary\0", "utf8");
    const candidateBytes = Buffer.from(
      mode === "invalid"
        ? "fixture-invalid-candidate-canary"
        : JSON.stringify({
            chain: "testnet",
            privateKey,
            rpcUrl,
            sleepIntervalSeconds: 60,
          }),
      "utf8",
    );

    await makeFixtureDirectory(bin);
    await makeFixtureDirectory(credentialDir);
    await writeFixture(candidate, candidateBytes, 0o644);
    await writeFixture(credential, oldBytes, 0o600);
    await writeExecutable(
      join(bin, "systemd-creds"),
      '#!/usr/bin/env bash\nprintf \'decrypt\\n\' >> "$EVENTS"\n/usr/bin/cat -- "$3"\n',
    );
    await writeExecutable(
      join(bin, "sync"),
      `#!/usr/bin/env bash\nif [[ -d \${2} ]]; then\n  event=sync:directory\nelse\n  event=sync:file\nfi\nprintf '%s\\n' "\${event}" >> "\${EVENTS}"\n${mode === "sync-failure" ? "exit 73" : '/usr/bin/sync "$@"'}\n`,
    );
    await writeExecutable(
      join(bin, "mv"),
      '#!/usr/bin/env bash\nprintf \'rename\\n\' >> "$EVENTS"\n/usr/bin/mv "$@"\n',
    );

    await body({
      candidateBytes,
      credential,
      events,
      oldBytes,
      run: () =>
        spawnSync(
          bashPath,
          [
            "-c",
            'source "$1"; install_credential_candidate testnet "$2" config.json "$3" "$4"',
            "bash",
            script,
            rootDir,
            candidate,
            credential,
          ],
          {
            cwd: rootDir,
            encoding: "utf8",
            env: {
              ...process.env,
              EVENTS: events,
              PATH: `${bin}:${process.env["PATH"] ?? ""}`,
            },
          },
        ),
    });
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

async function writeExecutable(filePath: string, contents: string): Promise<void> {
  await writeFixture(filePath, contents);
  await chmodFixture(filePath, 0o700);
}

async function readEvents(filePath: string): Promise<string[]> {
  return (await readFixture(filePath)).toString("utf8").trim().split("\n");
}

async function chmodFixture(filePath: string, mode: number): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This test modifies files inside its own temporary fixture directory.
  await chmod(filePath, mode);
}

async function makeFixtureDirectory(directory: string): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This test creates directories inside its own temporary fixture directory.
  await mkdir(directory);
}

async function readFixture(filePath: string): Promise<Buffer> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This test reads files inside its own temporary fixture directory.
  return fsReadFile(filePath);
}

async function statFixture(filePath: string): Promise<Stats> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This test stats files inside its own temporary fixture directory.
  return stat(filePath);
}

async function writeFixture(
  filePath: string,
  contents: string | Uint8Array,
  mode?: number,
): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This test writes files inside its own temporary fixture directory.
  await writeFile(filePath, contents, mode === undefined ? undefined : { mode });
}
