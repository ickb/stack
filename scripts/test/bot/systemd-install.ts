import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import type { Stats } from "node:fs";
import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  stat as fsStat,
  symlink as fsSymlink,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const { join } = path;
const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
const installScript = join(rootDir, "scripts", "ickb-bot-systemd-install.sh");
const bashPath = "/usr/bin/bash";

void test("systemd units use the atomic current pointer and shared absolute log root", () => {
  for (const network of ["testnet", "mainnet"] as const) {
    const rendered = renderUnit(network);
    const deployRoot = `/opt/ickb-stack-${network}`;
    assert.equal(rendered.status, 0, rendered.stderr);
    const lines = new Set(rendered.stdout.split("\n"));
    assert.equal(lines.has(`WorkingDirectory=${deployRoot}/current`), true);
    assert.equal(lines.has("ExecStart=/usr/bin/node apps/bot/src/index.ts"), true);
    assert.equal(
      lines.has(
        `Environment=BOT_CONFIG_FILE=%d/ickb-bot-${network}-config.json BOT_ARTIFACT_ROOT=${deployRoot}/log/bot/artifacts`,
      ),
      true,
    );
    assert.equal(lines.has(`ReadWritePaths=${deployRoot}/log`), true);
    assert.match(rendered.stdout, /^Restart=always$/mu);
    assert.match(rendered.stdout, /^RestartPreventExitStatus=2$/mu);
    assert.match(rendered.stdout, /^ProtectSystem=strict$/mu);
    assert.match(rendered.stdout, /^ProtectHome=true$/mu);
    assert.match(rendered.stdout, /^NoNewPrivileges=true$/mu);
    assert.match(rendered.stdout, /^LimitCORE=0$/mu);
  }
});

void test("systemd install script requires the source runtime floor", async () => {
  const text = await readText(installScript);
  assert.match(text, /Node\.js >=22\.19\.0/u);
  assert.match(text, /minor >= 19/u);
});

void test("systemd install directory creation refuses symlink path components", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ickb-systemd-install-dir-"));
  try {
    const uid = String(process.getuid?.() ?? 0);
    const gid = String(process.getgid?.() ?? 0);
    const createdPath = join(directory, "log", "bot");
    const created = safeInstallDirectory(createdPath, "700", uid, gid);
    assert.equal(created.status, 0, created.stderr);
    assert.equal(await pathMode(createdPath), 0o700);

    const linkPath = join(directory, "linked-log");
    await linkSymbolic(join(directory, "log"), linkPath);
    const refused = safeInstallDirectory(join(linkPath, "bot"), "755", uid, gid);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Refusing symlinked directory path/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

void test("installed layout accepts only current as a directory symlink", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ickb-systemd-layout-"));
  try {
    const release = join(directory, "releases", "release-1");
    await makeDirectory(join(release, ".git"));
    await makeDirectory(join(directory, "log", "bot"));
    await linkSymbolic("releases/release-1", join(directory, "current"));

    const accepted = requireReleaseLayout(directory);
    assert.equal(accepted.status, 0, accepted.stderr);

    await rm(join(directory, "log"), { recursive: true });
    const externalLog = join(directory, "external-log");
    await makeDirectory(join(externalLog, "bot"));
    await linkSymbolic(externalLog, join(directory, "log"));
    const refused = requireReleaseLayout(directory);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Refusing symlinked directory path/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

async function readText(filePath: string): Promise<string> {
  return fsReadFile(filePath, "utf8");
}

async function makeDirectory(directory: string): Promise<void> {
  await fsMkdir(directory, { recursive: true });
}

async function linkSymbolic(target: string, linkPath: string): Promise<void> {
  await fsSymlink(target, linkPath, "dir");
}

async function statPath(filePath: string): Promise<Stats> {
  return fsStat(filePath);
}

async function pathMode(filePath: string): Promise<number> {
  return (await statPath(filePath)).mode & 0o777;
}

function renderUnit(network: "testnet" | "mainnet"): SpawnSyncReturns<string> {
  return runShell('source "$1"; render_unit "$2" "/opt/ickb-stack-$2"', [network]);
}

function safeInstallDirectory(
  directory: string,
  mode: string,
  uid: string,
  gid: string,
): SpawnSyncReturns<string> {
  return runShell('source "$1"; safe_install_directory "$2" "$3" "$4" "$5"', [
    directory,
    mode,
    uid,
    gid,
  ]);
}

function requireReleaseLayout(directory: string): SpawnSyncReturns<string> {
  return runShell('source "$1"; require_release_layout "$2"', [directory]);
}

function runShell(command: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(bashPath, ["-c", command, "bash", installScript, ...args], {
    cwd: rootDir,
    encoding: "utf8",
  });
}
