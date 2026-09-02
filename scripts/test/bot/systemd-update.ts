import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import type { Stats } from "node:fs";
import {
  appendFile as fsAppendFile,
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
    const accepted = requireLauncherUnit(unitPath, directory);
    assert.equal(accepted.status, 0, accepted.stderr);

    await writeText(unitPath, `${unitText(directory)}WorkingDirectory=/tmp/override\n`);
    const duplicate = requireLauncherUnit(unitPath, directory);
    assert.equal(duplicate.status, 1);

    await writeText(
      unitPath,
      unitText(directory).replace(
        `WorkingDirectory=${directory}/current`,
        `WorkingDirectory=${directory}`,
      ),
    );
    const refused = requireLauncherUnit(unitPath, directory);
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

void test("readiness accepts the new launch record and matching preflight", async () => {
  const fixture = await readinessFixture();
  try {
    const beforeReplacement = readinessProbe(
      fixture.launches,
      fixture.release,
      fixture.logRoot,
    );
    assert.equal(beforeReplacement.status, 1);

    const releaseWithSeparator = `${fixture.release}${path.sep}`;
    await writeText(
      fixture.launches,
      `${JSON.stringify({ ...fixture.launch, repoRoot: releaseWithSeparator })}\n`,
    );
    const ready = readinessProbe(fixture.launches, fixture.release, fixture.logRoot);
    assert.equal(ready.status, 0, ready.stderr);

    const wrongRelease = readinessProbe(
      fixture.launches,
      `${fixture.release}-other`,
      fixture.logRoot,
    );
    assert.equal(wrongRelease.status, 1);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

void test("readiness cannot use a stale expected release behind a newer launch", async () => {
  const fixture = await readinessFixture();
  try {
    await writeText(fixture.launches, `${JSON.stringify(fixture.launch)}\n`);
    const otherRelease = `${fixture.release}-other`;
    await appendText(
      fixture.launches,
      `${JSON.stringify(launchRecord(otherRelease, fixture.logRoot, fixture.events, "run-other"))}\n`,
    );
    assert.equal(
      readinessProbe(fixture.launches, fixture.release, fixture.logRoot).status,
      1,
    );
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

void test("same-path readiness rejects the previous run id", async () => {
  const fixture = await readinessFixture();
  try {
    const previous = launchRecord(
      fixture.release,
      fixture.logRoot,
      fixture.events,
      "run-old",
    );
    await writeText(fixture.launches, `${JSON.stringify(previous)}\n`);
    await writeText(fixture.events, `${JSON.stringify(preflightEvent("run-old"))}\n`);
    assert.equal(
      readinessProbe(fixture.launches, fixture.release, fixture.logRoot, {
        previousRunId: "run-old",
      }).status,
      1,
    );

    await writeText(fixture.launches, `${JSON.stringify(fixture.launch)}\n`);
    await writeText(fixture.events, `${JSON.stringify(preflightEvent("run-new"))}\n`);
    assert.equal(
      readinessProbe(fixture.launches, fixture.release, fixture.logRoot, {
        previousRunId: "run-old",
      }).status,
      0,
    );
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

void test("readiness rejects a bot preflight mismatch", async () => {
  const fixture = await readinessFixture({
    matches: { genesisHash: true, addressPrefix: false },
  });
  try {
    await writeText(fixture.launches, `${JSON.stringify(fixture.launch)}\n`);
    const result = readinessProbe(fixture.launches, fixture.release, fixture.logRoot);
    assert.equal(result.status, 1);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

void test("readiness requires the requested network and production preflight matches", async () => {
  const fixture = await readinessFixture();
  try {
    await writeText(fixture.launches, `${JSON.stringify(fixture.launch)}\n`);

    await writeText(
      fixture.events,
      `${JSON.stringify(preflightEvent("run-new", undefined, "mainnet"))}\n`,
    );
    assert.equal(
      readinessProbe(fixture.launches, fixture.release, fixture.logRoot).status,
      1,
    );

    await writeText(
      fixture.events,
      `${JSON.stringify(preflightEvent("run-new", { chain: true, genesis: true }))}\n`,
    );
    assert.equal(
      readinessProbe(fixture.launches, fixture.release, fixture.logRoot).status,
      1,
    );

    const contradictory = preflightEvent("run-new");
    const observed = contradictory["observed"];
    assert.ok(observed !== null && typeof observed === "object");
    contradictory["observed"] = { ...observed, genesisHash: "0xwrong" };
    await writeText(fixture.events, `${JSON.stringify(contradictory)}\n`);
    assert.equal(
      readinessProbe(fixture.launches, fixture.release, fixture.logRoot).status,
      1,
    );
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

void test("readiness rejects noncanonical preflight records", async () => {
  const fixture = await readinessFixture();
  try {
    await writeText(fixture.launches, `${JSON.stringify(fixture.launch)}\n`);
    const event = preflightEvent("run-new");
    delete event["version"];
    await writeText(fixture.events, `${JSON.stringify(event)}\n`);
    assert.equal(
      readinessProbe(fixture.launches, fixture.release, fixture.logRoot).status,
      1,
    );
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
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
      `ready ${join(directory, "releases", "new")} prior -`,
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
      `ready ${join(directory, "releases", "new")} prior -`,
      stopCommand,
      "systemctl restart ickb.service",
      `ready ${join(directory, "releases", "old")} prior run-candidate`,
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
  assert.match(text, /maxTailBytes/u);
  assert.doesNotMatch(text, /pull --ff-only/u);
  assert.doesNotMatch(text, /systemctl --no-pager --full status/u);
  assert.doesNotMatch(text, /launch_log_size|baselineText|subarray\(baseline/u);
});

interface ReadinessFixture {
  events: string;
  launch: Record<string, unknown>;
  launches: string;
  logRoot: string;
  release: string;
  root: string;
}

async function readinessFixture({
  matches = { genesisHash: true, addressPrefix: true },
}: {
  matches?: Record<string, boolean>;
} = {}): Promise<ReadinessFixture> {
  const root = await mkdtemp(join(tmpdir(), "ickb-update-ready-"));
  const release = join(root, "releases", "expected");
  const logRoot = join(root, "log");
  const botRoot = join(logRoot, "bot");
  const launches = join(botRoot, "launches.ndjson");
  const events = join(botRoot, "bot.events.slot-00.ndjson");
  await makeDirectory(release);
  await makeDirectory(botRoot);
  const staleRecord = launchRecord(
    join(root, "releases", "stale"),
    logRoot,
    events,
    "run-stale",
  );
  await writeText(launches, `${JSON.stringify(staleRecord)}\n`);
  await writeText(events, `${JSON.stringify(preflightEvent("run-new", matches))}\n`);
  return {
    events,
    launch: launchRecord(release, logRoot, events, "run-new"),
    launches,
    logRoot,
    release,
    root,
  };
}

function launchRecord(
  release: string,
  logRoot: string,
  events: string,
  runId: string,
): Record<string, unknown> {
  return {
    version: 3,
    type: "launcher.started",
    repoRoot: release,
    logRoot,
    teeChildOutput: false,
    runId,
    logFiles: { events },
  };
}

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
Environment=BOT_CONFIG_FILE=%d/ickb-bot-testnet-config.json
LoadCredentialEncrypted=ickb-bot-testnet-config.json:/etc/ickb/credentials/ickb-bot-testnet-config.cred
ExecStart=/usr/bin/node scripts/bot/launcher.ts --log-root ${deployRoot}/log --no-child-tee
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

async function appendText(filePath: string, text: string): Promise<void> {
  await fsAppendFile(filePath, text);
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

function requireLauncherUnit(
  unitPath: string,
  deployRoot: string,
): SpawnSyncReturns<string> {
  return runShell('source "$1"; require_launcher_unit "$2" testnet "$3"', [
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
  launches: string,
  release: string,
  logRoot: string,
  options: {
    network?: "testnet" | "mainnet";
    previousRunId?: string;
  } = {},
): SpawnSyncReturns<string> {
  return runShell('source "$1"; readiness_probe "$2" "$3" "$4" "$5" "$6"', [
    launches,
    release,
    logRoot,
    options.network ?? "testnet",
    options.previousRunId ?? "",
  ]);
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
  const oldRelease = join(deployRoot, "releases", "old");
  const newRelease = join(deployRoot, "releases", "new");
  return runShell(
    String.raw`source "$1"
log_path=$2
fail_new=$3
fail_candidate_stop=$8
fail_rollback=$9
expected_new=$7
deploy_root=$4
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
latest_launch_run_id() {
  if [[ $(readlink "$deploy_root/current") == releases/new ]]; then
    printf 'run-candidate\n'
  else
    printf 'run-old\n'
  fi
}
wait_for_readiness() {
  prior=$6
  [[ -n "$prior" ]] || prior=-
  printf 'ready %s prior %s\n' "$3" "$prior" >>"$log_path"
  [[ "$fail_new" != true || "$3" != "$expected_new" ]] &&
    [[ "$fail_rollback" != true || "$3" == "$expected_new" ]]
}
set +e
activate_release ickb.service "$4" "$5" releases/old "$6" "$4/log" testnet 5
status=$?
printf 'removable=%s\n' "$candidate_removable"
exit "$status"`,
    [
      logPath,
      String(options.failNew),
      deployRoot,
      newRelease,
      oldRelease,
      newRelease,
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
