import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import type { Stats } from "node:fs";
import {
  lstat as fsLstat,
  mkdir as fsMkdir,
  readdir as fsReaddir,
  readFile as fsReadFile,
  readlink as fsReadlink,
  symlink as fsSymlink,
  writeFile as fsWriteFile,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const { join } = path;
const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
const updateScript = join(rootDir, "scripts", "ickb-bot-systemd-update.sh");
const bashPath = "/usr/bin/bash";
const currentName = "current";
const oldTarget = "releases/old";
const newTarget = "releases/new";
const stopCommand = "systemctl stop ickb.service";
const commandsFile = "commands.log";
const candidateRetained = "removable=0";

void test("systemd update accepts only the safe current and shared-log unit shape", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ickb-update-unit-"));
  try {
    const unitPath = join(directory, "ickb-bot-testnet.service");
    await writeText(unitPath, unitText(directory));
    const accepted = requireBotUnit(unitPath, directory);
    assert.equal(accepted.status, 0, accepted.stderr);

    await writeText(unitPath, `${unitText(directory)}WorkingDirectory=/tmp/override\n`);
    const duplicate = requireBotUnit(unitPath, directory);
    assert.equal(duplicate.status, 1);

    await writeText(
      unitPath,
      unitText(directory).replace(
        `WorkingDirectory=${directory}/current`,
        `WorkingDirectory=${directory}`,
      ),
    );
    const refused = requireBotUnit(unitPath, directory);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /safe release layout/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

void test("readiness timeout remains bounded", () => {
  assert.equal(requireReadinessTimeout("1").status, 0);
  assert.equal(requireReadinessTimeout("600").status, 0);
  const excessive = requireReadinessTimeout("601");
  assert.equal(excessive.status, 1);
  assert.match(excessive.stderr, /must not exceed 600/u);
});

void test("systemd update layout permits current but not shared-log symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ickb-update-layout-"));
  try {
    const release = join(directory, "releases", "release-1");
    await makeDirectory(join(release, ".git"));
    await makeDirectory(join(directory, "log", "bot"));
    await linkSymbolic("releases/release-1", join(directory, "current"));
    const accepted = requireDeploymentLayout(directory);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(accepted.stdout.trim(), release);

    await rm(join(directory, "log"), { recursive: true });
    await makeDirectory(join(directory, "outside-log", "bot"));
    await linkSymbolic(join(directory, "outside-log"), join(directory, "log"));
    const refused = requireDeploymentLayout(directory);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Refusing symlinked directory path/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

void test("readiness accepts only a canonical bot preflight for the requested network", () => {
  const ready = readinessProbe("testnet", [preflightEvent("run-1")]);
  assert.equal(ready.status, 0, ready.stderr);
  assert.equal(readinessProbe("mainnet", [preflightEvent("run-1")]).status, 1);
  assert.equal(
    readinessProbe("testnet", [
      preflightEvent("run-1", { genesisHash: false, addressPrefix: true }),
    ]).status,
    1,
  );
  assert.equal(
    readinessProbe("testnet", [{ ...preflightEvent("run-1"), timestamp: "yesterday" }])
      .status,
    1,
  );
  assert.equal(
    readinessProbe("testnet", ["not json", { app: "bot", type: "bot.run.started" }])
      .status,
    1,
  );
});

void test("atomic switch replaces current with a relative same-root release pointer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ickb-update-switch-"));
  try {
    await makeDirectory(join(directory, "releases", "old"));
    await makeDirectory(join(directory, "releases", "new"));
    await linkSymbolic(oldTarget, join(directory, currentName));
    const result = atomicSwitch(directory, newTarget);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readLink(join(directory, currentName)), newTarget);
    assert.equal((await lstatPath(join(directory, currentName))).isSymbolicLink(), true);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

void test("activation stops only after preparation and accepts evidence readiness", async () => {
  const directory = await activationFixture();
  try {
    const logPath = join(directory, commandsFile);
    const result = runActivation(directory, logPath, { failNew: false });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual((await readText(logPath)).trim().split("\n"), [
      stopCommand,
      "systemctl start ickb.service",
      "ready releases/new",
    ]);
    assert.equal(await readLink(join(directory, currentName)), newTarget);
    assert.equal(result.stdout.trim(), candidateRetained);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

void test("failed new readiness atomically restores and verifies the previous release", async () => {
  const directory = await activationFixture();
  try {
    const logPath = join(directory, commandsFile);
    const result = runActivation(directory, logPath, { failNew: true });
    assert.equal(result.status, 1);
    assert.deepEqual((await readText(logPath)).trim().split("\n"), [
      stopCommand,
      "systemctl start ickb.service",
      "ready releases/new",
      stopCommand,
      "systemctl restart ickb.service",
      "ready releases/old",
    ]);
    assert.equal(await readLink(join(directory, currentName)), oldTarget);
    assert.match(result.stderr, /Rollback release is ready/u);
    assert.equal(result.stdout.trim(), "removable=1");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

void test("failed candidate stop retains the active candidate release", async () => {
  const directory = await activationFixture();
  try {
    const logPath = join(directory, commandsFile);
    const result = runActivation(directory, logPath, {
      failCandidateStop: true,
      failNew: true,
    });
    assert.equal(result.status, 1);
    assert.equal(await readLink(join(directory, currentName)), newTarget);
    assert.equal(result.stdout.trim(), candidateRetained);
    assert.match(result.stderr, /Candidate stop failed/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

void test("failed rollback readiness retains the stopped candidate release", async () => {
  const directory = await activationFixture();
  try {
    const logPath = join(directory, commandsFile);
    const result = runActivation(directory, logPath, {
      failNew: true,
      failRollback: true,
    });
    assert.equal(result.status, 1);
    assert.equal(await readLink(join(directory, currentName)), oldTarget);
    assert.equal(result.stdout.trim(), candidateRetained);
    assert.match(result.stderr, /immediate operator intervention/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

void test("release pruning keeps active, rollback, and one additional validated release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ickb-update-prune-"));
  try {
    for (const name of [
      "20260101-a",
      "20260201-b",
      "20260301-c",
      "20260401-d",
      "20260501-e",
    ]) {
      await makeDirectory(join(directory, name));
    }
    const result = pruneReleases(directory, "releases/20260501-e", "releases/20260201-b");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      new Set(await readDirectory(directory)),
      new Set(["20260201-b", "20260401-d", "20260501-e"]),
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

void test("updater stages and validates before the final switch and never pulls in place", async () => {
  const text = await readText(updateScript);
  const prepare = text.lastIndexOf("prepare_release");
  const activate = text.indexOf("if ! activate_release");
  assert.ok(prepare !== -1 && activate > prepare);
  assert.match(text, /flock -n/u);
  assert.match(text, /bot:install/u);
  assert.match(text, /bot:check/u);
  assert.match(text, /chmod -R a-w/u);
  assert.doesNotMatch(text, /pull --ff-only/u);
  assert.doesNotMatch(text, /systemctl --no-pager --full status/u);
  assert.doesNotMatch(text, /launch_log_size|baselineText|subarray\(baseline/u);
});

function preflightEvent(
  runId: string,
  matches?: Record<string, boolean>,
  chain: "testnet" | "mainnet" = "testnet",
): Record<string, unknown> {
  return {
    version: 1,
    app: "bot",
    type: "bot.chain.preflight",
    chain,
    runId,
    iterationId: 0,
    timestamp: "2026-07-22T00:00:00.000Z",
    expected: { chain, genesisHash: "0xgenesis", addressPrefix: "ckt" },
    observed: { genesisHash: "0xgenesis", addressPrefix: "ckt" },
    matches: matches ?? { genesisHash: true, addressPrefix: true },
  };
}

async function activationFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ickb-update-activate-"));
  await makeDirectory(join(directory, "releases", "old"));
  await makeDirectory(join(directory, "releases", "new"));
  await makeDirectory(join(directory, "log", "bot"));
  await linkSymbolic(oldTarget, join(directory, currentName));
  return directory;
}

function unitText(deployRoot = "/opt/ickb-stack-testnet"): string {
  return `[Service]
WorkingDirectory=${deployRoot}/current
Environment=BOT_CONFIG_FILE=%d/ickb-bot-testnet-config.json BOT_ARTIFACT_ROOT=${deployRoot}/log/bot/artifacts BOT_ARTIFACT_REF_PREFIX=artifacts
LoadCredentialEncrypted=ickb-bot-testnet-config.json:/etc/ickb/credentials/ickb-bot-testnet-config.cred
ExecStart=/usr/bin/node apps/bot/src/index.ts
RestartSec=60
RestartPreventExitStatus=2
LimitCORE=0
NoNewPrivileges=true
PrivateTmp=true
ProtectProc=invisible
ProtectSystem=strict
ReadWritePaths=${deployRoot}/log
ProtectHome=true
`;
}

async function lstatPath(filePath: string): Promise<Stats> {
  return fsLstat(filePath);
}

async function makeDirectory(directory: string): Promise<void> {
  await fsMkdir(directory, { recursive: true });
}

async function readDirectory(directory: string): Promise<string[]> {
  return fsReaddir(directory);
}

async function readLink(filePath: string): Promise<string> {
  return fsReadlink(filePath);
}

async function readText(filePath: string): Promise<string> {
  return fsReadFile(filePath, "utf8");
}

async function linkSymbolic(target: string, linkPath: string): Promise<void> {
  await fsSymlink(target, linkPath, "dir");
}

async function writeText(filePath: string, text: string): Promise<void> {
  await fsWriteFile(filePath, text);
}

function requireBotUnit(unitPath: string, deployRoot: string): SpawnSyncReturns<string> {
  return runShell('source "$1"; require_bot_unit "$2" testnet "$3"', [
    unitPath,
    deployRoot,
  ]);
}

function requireDeploymentLayout(deployRoot: string): SpawnSyncReturns<string> {
  return runShell('source "$1"; require_deployment_layout "$2"', [deployRoot]);
}

function requireReadinessTimeout(value: string): SpawnSyncReturns<string> {
  return runShell('source "$1"; require_readiness_timeout "$2"', [value]);
}

function readinessProbe(
  network: "testnet" | "mainnet",
  lines: Array<Record<string, unknown> | string>,
): SpawnSyncReturns<string> {
  const input = `${lines
    .map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
    .join("\n")}\n`;
  return spawnSync(
    bashPath,
    ["-c", 'source "$1"; readiness_probe "$2"', "bash", updateScript, network],
    {
      cwd: rootDir,
      encoding: "utf8",
      input,
    },
  );
}

function atomicSwitch(deployRoot: string, target: string): SpawnSyncReturns<string> {
  return runShell('source "$1"; atomic_switch "$2" "$3"', [deployRoot, target]);
}

function runActivation(
  deployRoot: string,
  logPath: string,
  options: {
    failCandidateStop?: boolean;
    failNew: boolean;
    failRollback?: boolean;
  },
): SpawnSyncReturns<string> {
  return runShell(
    String.raw`source "$1"
log_path=$2
fail_new=$3
deploy_root=$4
fail_candidate_stop=$6
fail_rollback=$7
stop_count=0
systemctl() {
  printf 'systemctl %s\n' "$*" >>"$log_path"
  if [[ "$*" == "stop ickb.service" ]]; then
    stop_count=$((stop_count + 1))
    if [[ "$fail_candidate_stop" == true && $stop_count -eq 2 ]]; then
      return 1
    fi
  fi
}
wait_for_readiness() {
  release=$(readlink "$deploy_root/current")
  printf 'ready %s\n' "$release" >>"$log_path"
  [[ "$fail_new" != true || "$release" != releases/new ]] &&
    [[ "$fail_rollback" != true || "$release" == releases/new ]]
}
set +e
activate_release ickb.service "$4" "$5" releases/old testnet 5
status=$?
printf 'removable=%s\n' "$candidate_removable"
exit "$status"`,
    [
      logPath,
      String(options.failNew),
      deployRoot,
      join(deployRoot, "releases", "new"),
      String(options.failCandidateStop ?? false),
      String(options.failRollback ?? false),
    ],
  );
}

function pruneReleases(
  releases: string,
  active: string,
  rollback: string,
): SpawnSyncReturns<string> {
  return runShell('source "$1"; prune_releases "$2" "$3" "$4"', [
    releases,
    active,
    rollback,
  ]);
}

function runShell(command: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(bashPath, ["-c", command, "bash", updateScript, ...args], {
    cwd: rootDir,
    encoding: "utf8",
  });
}
