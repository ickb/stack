import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  chmod as fsChmod,
  mkdir as fsMkdir,
  readFile as fsReadFile,
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
const updateTempPrefix = "ickb-bot-systemd-update-";
const testnetUnitFile = "ickb-bot-testnet.service";
const testnet = "testnet";
const productionLauncherFileLogging = /production launcher file logging/u;
const shellExpansionStart = "$".concat("{");

void test("systemd update script requires Node 22.19 for source units", async () => {
  const text = await readUpdateScript();

  assert.match(text, /Node\.js >=22\.19\.0/u);
  assert.match(text, /minor >= 19/u);
  assert.doesNotMatch(text, /Node\.js >=22 is required/u);
});

void test("systemd update accepts launcher-wired units", async () => {
  const dir = await mkdtemp(join(tmpdir(), updateTempPrefix));
  try {
    const unitPath = join(dir, testnetUnitFile);
    await writeText(unitPath, unitText({ network: testnet, launcher: true }));

    const result = requireLauncherUnit(unitPath, testnet);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update refuses launcher-wired units with explicit log roots", async () => {
  const dir = await mkdtemp(join(tmpdir(), updateTempPrefix));
  try {
    const unitPath = join(dir, testnetUnitFile);
    await writeText(
      unitPath,
      unitText({
        network: testnet,
        launcher: true,
        logRoot: "/srv/ickb/log",
      }),
    );

    const result = requireLauncherUnit(unitPath, testnet);
    assert.equal(result.status, 1);
    assert.match(result.stderr, productionLauncherFileLogging);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update reads unit files without trailing newlines", async () => {
  const dir = await mkdtemp(join(tmpdir(), updateTempPrefix));
  try {
    const unitPath = join(dir, testnetUnitFile);
    await writeText(
      unitPath,
      unitText({ network: testnet, launcher: true }).replace(/\n$/u, ""),
    );

    const result = requireLauncherUnit(unitPath, testnet);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update accepts generated units with log storage quotas", async () => {
  const dir = await mkdtemp(join(tmpdir(), updateTempPrefix));
  try {
    const unitPath = join(dir, testnetUnitFile);
    await writeText(
      unitPath,
      unitText({
        network: testnet,
        launcher: true,
        extraEnvironment: "ICKB_BOT_LOG_STORAGE_QUOTA_BYTES=1000",
      }),
    );

    const result = requireLauncherUnit(unitPath, testnet);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update refuses launcher units that tee child output to journald", async () => {
  const dir = await mkdtemp(join(tmpdir(), updateTempPrefix));
  try {
    const unitPath = join(dir, testnetUnitFile);
    await writeText(
      unitPath,
      unitText({ network: testnet, launcher: true, staleLauncherChild: true }),
    );

    const result = requireLauncherUnit(unitPath, testnet);
    assert.equal(result.status, 1);
    assert.match(result.stderr, productionLauncherFileLogging);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update refuses environment log-root overrides", async () => {
  const dir = await mkdtemp(join(tmpdir(), updateTempPrefix));
  try {
    const unitPath = join(dir, testnetUnitFile);
    await writeText(
      unitPath,
      unitText({
        network: testnet,
        launcher: true,
        extraEnvironment: "ICKB_BOT_LOG_ROOT=/tmp/other-log",
      }),
    );

    const result = requireLauncherUnit(unitPath, testnet);
    assert.equal(result.status, 1);
    assert.match(result.stderr, productionLauncherFileLogging);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update refuses stale direct-exec units", async () => {
  const dir = await mkdtemp(join(tmpdir(), updateTempPrefix));
  try {
    const unitPath = join(dir, testnetUnitFile);
    await writeText(unitPath, unitText({ network: testnet, launcher: false }));

    const result = requireLauncherUnit(unitPath, testnet);
    assert.equal(result.status, 1);
    assert.match(result.stderr, productionLauncherFileLogging);
    assert.match(result.stderr, /ickb-bot-systemd-install\.sh testnet/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update refuses launcher units without core-dump hardening", async () => {
  const dir = await mkdtemp(join(tmpdir(), updateTempPrefix));
  try {
    const unitPath = join(dir, testnetUnitFile);
    await writeText(
      unitPath,
      unitText({ network: testnet, launcher: true, limitCore: false }),
    );

    const result = requireLauncherUnit(unitPath, testnet);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /core-dump hardening/u);
    assert.match(result.stderr, /ickb-bot-systemd-install\.sh testnet/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update refuses launcher units with mismatched writable log roots", async () => {
  const dir = await mkdtemp(join(tmpdir(), updateTempPrefix));
  try {
    const unitPath = join(dir, testnetUnitFile);
    await writeText(
      unitPath,
      unitText({
        network: testnet,
        launcher: true,
        logRoot: "/srv/ickb/log",
        readWritePath: "/tmp",
      }),
    );

    const result = requireLauncherUnit(unitPath, testnet);
    assert.equal(result.status, 1);
    assert.match(result.stderr, productionLauncherFileLogging);
    assert.match(result.stderr, /ickb-bot-systemd-install\.sh testnet/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update refuses launcher log-root arguments", async () => {
  const dir = await mkdtemp(join(tmpdir(), updateTempPrefix));
  try {
    const unitPath = join(dir, testnetUnitFile);
    await writeText(
      unitPath,
      unitText({ network: testnet, launcher: true, logRoot: "relative-log" }),
    );

    const result = requireLauncherUnit(unitPath, testnet);
    assert.equal(result.status, 1);
    assert.match(result.stderr, productionLauncherFileLogging);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update ignores commented launcher directives", async () => {
  const dir = await mkdtemp(join(tmpdir(), updateTempPrefix));
  try {
    const unitPath = join(dir, testnetUnitFile);
    await writeText(
      unitPath,
      unitText({ network: testnet, launcher: false, commentedSpoof: true }),
    );

    const result = requireLauncherUnit(unitPath, testnet);
    assert.equal(result.status, 1);
    assert.match(result.stderr, productionLauncherFileLogging);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update ignores launcher directives outside the Service section", async () => {
  const dir = await mkdtemp(join(tmpdir(), updateTempPrefix));
  try {
    const unitPath = join(dir, "ickb-bot-testnet.service");
    await writeText(
      unitPath,
      unitText({
        network: testnet,
        launcher: false,
        inactiveSectionSpoof: true,
      }),
    );

    const result = requireLauncherUnit(unitPath, testnet);
    assert.equal(result.status, 1);
    assert.match(result.stderr, productionLauncherFileLogging);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update checks unit wiring before mutating deploy checkout", async () => {
  const text = await readUpdateScript();
  const guardIndex = text.indexOf(
    `require_launcher_unit "${shellExpansionStart}unit_path}" "${shellExpansionStart}network}" "${shellExpansionStart}deploy_dir}"`,
  );
  const pullIndex = text.indexOf(
    `git -C "${shellExpansionStart}deploy_dir}" pull --ff-only`,
  );

  assert.notEqual(guardIndex, -1);
  assert.notEqual(pullIndex, -1);
  assert.ok(guardIndex < pullIndex);
});

void test("systemd update refuses untracked files before pulling", async () => {
  const dir = await mkdtemp(join(tmpdir(), updateTempPrefix));
  try {
    const fakeBin = join(dir, "bin");
    const logPath = join(dir, "git.log");
    await makeDirectory(fakeBin, { recursive: true });
    await writeText(
      join(fakeBin, "runuser"),
      `#!/usr/bin/env bash
shift 3
env_args=()
while [[ $# -gt 0 && $1 == *=* ]]; do
  env_args+=("$1")
  shift
done
exec env "${shellExpansionStart}env_args[@]}" "$@"
`,
    );
    await chmodPath(join(fakeBin, "runuser"), 0o755);
    await writeText(
      join(fakeBin, "git"),
      String.raw`#!/usr/bin/env bash
printf '%s\n' "$*" >> ${JSON.stringify(logPath)}
if [[ $* == *' status --porcelain' ]]; then
  printf '?? untracked.txt\n'
fi
`,
    );
    await chmodPath(join(fakeBin, "git"), 0o755);

    const result = spawnSync(
      bashPath,
      [
        "-c",
        `source "$1"; PATH="$2:$PATH"; run_as_service_user() { command runuser -u "$1" -- env HOME="$2" USER="$1" LOGNAME="$1" SHELL=/bin/bash "${shellExpansionStart}@:3}"; }; require_clean_worktree ickb-bot-testnet /home/ickb /deploy`,
        "bash",
        updateScript,
        fakeBin,
      ],
      { cwd: rootDir, encoding: "utf8" },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /local changes or untracked files/u);
    assert.doesNotMatch(await readText(logPath), /pull --ff-only/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

interface UnitTextOptions {
  commentedSpoof?: boolean;
  extraEnvironment?: string;
  inactiveSectionSpoof?: boolean;
  launcher: boolean;
  limitCore?: boolean;
  logRoot?: string;
  network: string;
  readWritePath?: string;
  staleLauncherChild?: boolean;
}

async function readUpdateScript(): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This test reads the fixed systemd update helper script under the repository root.
  return fsReadFile(updateScript, "utf8");
}

async function chmodPath(filePath: string, mode: number): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This test modifies files inside its own temporary fixture directory.
  await fsChmod(filePath, mode);
}

async function makeDirectory(
  directory: string,
  options: { recursive: true },
): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This test creates directories inside its own temporary fixture directory.
  await fsMkdir(directory, options);
}

async function readText(filePath: string): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This test reads files inside its own temporary fixture directory.
  return fsReadFile(filePath, "utf8");
}

async function writeText(filePath: string, data: string): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This test writes files inside its own temporary fixture directory.
  await fsWriteFile(filePath, data);
}

function requireLauncherUnit(
  unitPath: string,
  network: string,
): SpawnSyncReturns<string> {
  const deployDir = `/opt/ickb-${network}`;
  return spawnSync(
    bashPath,
    [
      "-c",
      'source "$1"; require_launcher_unit "$2" "$3" "$4"',
      "bash",
      updateScript,
      unitPath,
      network,
      deployDir,
    ],
    { cwd: rootDir, encoding: "utf8" },
  );
}

function unitText({
  network,
  launcher,
  limitCore = true,
  commentedSpoof = false,
  inactiveSectionSpoof = false,
  logRoot,
  readWritePath,
  extraEnvironment,
  staleLauncherChild = false,
}: UnitTextOptions): string {
  const credentialName = `ickb-bot-${network}-config.json`;
  const credential = `/etc/ickb/credentials/ickb-bot-${network}-config.cred`;
  const launcherLogRoot = logRoot === undefined ? "" : `--log-root ${logRoot} `;
  let execStart = `ExecStart=/usr/bin/node apps/bot/src/index.ts`;
  if (launcher && staleLauncherChild) {
    execStart = `ExecStart=/usr/bin/node --experimental-default-type=module scripts/bot/launcher.ts ${launcherLogRoot}-- /usr/bin/node apps/bot/src/index.ts`;
  } else if (launcher) {
    execStart = `ExecStart=/usr/bin/node --experimental-default-type=module scripts/bot/launcher.ts ${launcherLogRoot}--no-child-tee`;
  }
  const workingDirectory = `/opt/ickb-${network}`;
  const writablePath = readWritePath ?? logRoot ?? `${workingDirectory}/log`;
  const environmentValue = [`BOT_CONFIG_FILE=%d/${credentialName}`, extraEnvironment]
    .filter(Boolean)
    .join(" ");

  const comments = commentedSpoof
    ? `# ExecStart=/usr/bin/node --experimental-default-type=module scripts/bot/launcher.ts -- /usr/bin/node apps/bot/src/index.ts
# ReadWritePaths=${workingDirectory}/log
`
    : "";
  const inactive = inactiveSectionSpoof
    ? `[Unit]
ExecStart=/usr/bin/node --experimental-default-type=module scripts/bot/launcher.ts -- /usr/bin/node apps/bot/src/index.ts
ReadWritePaths=${workingDirectory}/log
[Install]
WantedBy=multi-user.target
`
    : "";

  return `${inactive}[Service]
${comments}
WorkingDirectory=${workingDirectory}
Environment=${environmentValue}
LoadCredentialEncrypted=${credentialName}:${credential}
${execStart}
RestartPreventExitStatus=2
RestartSec=60
${limitCore ? `LimitCORE=0\n` : ""}
ReadWritePaths=${writablePath}
`;
}
