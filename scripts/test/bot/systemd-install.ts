import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import type { Stats } from "node:fs";
import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  stat as fsStat,
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
const installScript = join(rootDir, "scripts", "ickb-bot-systemd-install.sh");
const bashPath = "/usr/bin/bash";

void test("systemd units use the atomic current pointer and shared absolute log root", () => {
  for (const network of ["testnet", "mainnet"] as const) {
    const rendered = renderUnit(network);
    const deployRoot = `/opt/ickb-stack-${network}`;
    assert.equal(rendered.status, 0, rendered.stderr);
    const lines = new Set(rendered.stdout.split("\n"));
    assert.equal(lines.has(`WorkingDirectory=${deployRoot}/current`), true);
    assert.equal(
      lines.has(
        `ExecStart=/usr/bin/node scripts/bot/launcher.ts --log-root ${deployRoot}/log --no-child-tee`,
      ),
      true,
    );
    assert.equal(lines.has(`ReadWritePaths=${deployRoot}/log`), true);
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

void test("legacy migration has one restoration path and no legacy release switch", async () => {
  const text = await readText(installScript);
  assert.match(text, /--migrate <testnet\|mainnet>/u);
  assert.match(
    text,
    /prepare_checkout_copy "\$\{user\}" "\$\{user_home\}" "\$\{source\}"/u,
  );
  assert.match(text, /mv "\$\{holding\}\/log" "\$\{deploy_dir\}\/log"/u);
  assert.match(text, /mv "\$\{holding\}" "\$\{deploy_dir\}\/releases\/\$\{old_id\}"/u);
  assert.match(text, /wait_with_update_helper/u);
  assert.match(text, /restore_legacy_migration/u);
  assert.doesNotMatch(text, /switching to the preserved legacy release/u);
});

void test("legacy migration ignores commented unit-shape spoofs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ickb-systemd-legacy-unit-"));
  try {
    const unitPath = join(directory, "ickb.service");
    const deployRoot = "/opt/ickb-stack-testnet";
    await writeText(unitPath, legacyUnit(deployRoot));
    assert.equal(legacyUnitIsCompatible(unitPath, deployRoot).status, 0);

    await writeText(
      unitPath,
      legacyUnit(deployRoot).replace(
        `WorkingDirectory=${deployRoot}`,
        `# WorkingDirectory=${deployRoot}\nWorkingDirectory=/tmp/spoofed`,
      ),
    );
    assert.equal(legacyUnitIsCompatible(unitPath, deployRoot).status, 1);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

void test("migration restoration reconstructs the shipped layout and unit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ickb-systemd-restore-"));
  try {
    const deployRoot = join(directory, "deploy");
    const replacement = join(directory, "replacement");
    const holding = join(directory, "holding");
    const oldId = "legacy-release";
    const legacyRelease = join(deployRoot, "releases", oldId);
    const unitPath = join(directory, "ickb.service");
    const unitBackup = `${unitPath}.backup`;
    const commandLog = join(directory, "commands.log");
    await makeDirectory(join(legacyRelease, ".git"));
    await makeDirectory(join(deployRoot, "log", "bot"));
    await writeText(join(legacyRelease, ".git", "marker"), "legacy");
    await writeText(unitPath, "new unit\n");
    await writeText(unitBackup, "legacy unit\n");

    const restored = restoreLegacyMigration({
      commandLog,
      deployRoot,
      holding,
      oldId,
      replacement,
      unitBackup,
      unitPath,
    });

    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(await readText(join(deployRoot, ".git", "marker")), "legacy");
    assert.equal(await readText(unitPath), "legacy unit\n");
    await assert.rejects(async () => statPath(replacement), /ENOENT/u);
    assert.deepEqual((await readText(commandLog)).trim().split("\n"), [
      "stop ickb.service",
      "daemon-reload",
      "start ickb.service",
    ]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

async function readText(filePath: string): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed script or temporary fixture path.
  return fsReadFile(filePath, "utf8");
}

async function makeDirectory(directory: string): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path.
  await fsMkdir(directory, { recursive: true });
}

async function linkSymbolic(target: string, linkPath: string): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture symlink.
  await fsSymlink(target, linkPath, "dir");
}

async function statPath(filePath: string): Promise<Stats> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path.
  return fsStat(filePath);
}

async function writeText(filePath: string, text: string): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path.
  await fsWriteFile(filePath, text);
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

function legacyUnitIsCompatible(
  unitPath: string,
  deployRoot: string,
): SpawnSyncReturns<string> {
  return runShell('source "$1"; legacy_unit_is_compatible "$2" testnet "$3"', [
    unitPath,
    deployRoot,
  ]);
}

function legacyUnit(deployRoot: string): string {
  return `[Service]
WorkingDirectory=${deployRoot}
Environment=BOT_CONFIG_FILE=%d/ickb-bot-testnet-config.json
LoadCredentialEncrypted=ickb-bot-testnet-config.json:/etc/ickb/credentials/ickb-bot-testnet-config.cred
ExecStart=/usr/bin/node scripts/ickb-bot-launcher.mjs --network testnet -- /usr/bin/node apps/bot/dist/index.js
RestartSec=10
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

function restoreLegacyMigration(options: {
  commandLog: string;
  deployRoot: string;
  holding: string;
  oldId: string;
  replacement: string;
  unitBackup: string;
  unitPath: string;
}): SpawnSyncReturns<string> {
  return runShell(
    String.raw`source "$1"
command_log=$2
systemctl() { printf '%s\n' "$*" >>"$command_log"; }
restore_legacy_migration ickb.service "$3" "$4" "$5" "$6" "$7" "$8"`,
    [
      options.commandLog,
      options.unitPath,
      options.unitBackup,
      options.deployRoot,
      options.replacement,
      options.holding,
      options.oldId,
    ],
  );
}

function runShell(command: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(bashPath, ["-c", command, "bash", installScript, ...args], {
    cwd: rootDir,
    encoding: "utf8",
  });
}
