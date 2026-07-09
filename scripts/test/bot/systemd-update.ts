import assert from "node:assert/strict";
import type { SpawnSyncReturns } from "node:child_process";
import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  requireCleanWorktree,
  requireLauncherUnit,
  type RunAsServiceUser,
} from "../../bot/systemd-update.ts";

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
const updateWrapper = joinPath(rootDir, "scripts", "ickb-bot-systemd-update.sh");
const updateEntrypoint = joinPath(rootDir, "scripts", "bot", "systemd-update.ts");
const updateTempPrefix = "ickb-bot-systemd-update-";
const testnetUnitFile = "ickb-bot-testnet.service";
const testnet = "testnet";
const productionLauncherFileLogging = /production launcher file logging/u;

void test("systemd update wrapper delegates to the Node-owned entrypoint", async () => {
  const text = await readText(updateWrapper);

  assert.match(text, /bot\/systemd-update\.ts/u);
  assert.doesNotMatch(text, /require_launcher_unit/u);
});

void test("systemd update script requires Node 22.19 for source units", async () => {
  const text = await readText(updateEntrypoint);

  assert.match(text, /requireNode22_19/u);
  assert.doesNotMatch(text, /Node\.js >=22 is required/u);
});

void test("systemd update accepts launcher-wired units", async () => {
  const dir = await mkdtemp(joinPath(tmpdir(), updateTempPrefix));
  try {
    const unitPath = joinPath(dir, testnetUnitFile);
    await writeText(unitPath, unitText({ network: testnet, launcher: true }));

    assert.doesNotThrow(() => {
      checkLauncherUnit(unitPath, testnet);
    });
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update refuses launcher-wired units with explicit log roots", async () => {
  const dir = await mkdtemp(joinPath(tmpdir(), updateTempPrefix));
  try {
    const unitPath = joinPath(dir, testnetUnitFile);
    await writeText(
      unitPath,
      unitText({
        network: testnet,
        launcher: true,
        logRoot: "/srv/ickb/log",
      }),
    );

    assert.throws(() => {
      checkLauncherUnit(unitPath, testnet);
    }, productionLauncherFileLogging);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update reads unit files without trailing newlines", async () => {
  const dir = await mkdtemp(joinPath(tmpdir(), updateTempPrefix));
  try {
    const unitPath = joinPath(dir, testnetUnitFile);
    await writeText(
      unitPath,
      unitText({ network: testnet, launcher: true }).replace(/\n$/u, ""),
    );

    assert.doesNotThrow(() => {
      checkLauncherUnit(unitPath, testnet);
    });
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update accepts generated units with log storage quotas", async () => {
  const dir = await mkdtemp(joinPath(tmpdir(), updateTempPrefix));
  try {
    const unitPath = joinPath(dir, testnetUnitFile);
    await writeText(
      unitPath,
      unitText({
        network: testnet,
        launcher: true,
        extraEnvironment: "ICKB_BOT_LOG_STORAGE_QUOTA_BYTES=1000",
      }),
    );

    assert.doesNotThrow(() => {
      checkLauncherUnit(unitPath, testnet);
    });
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update refuses launcher units that tee child output to journald", async () => {
  const dir = await mkdtemp(joinPath(tmpdir(), updateTempPrefix));
  try {
    const unitPath = joinPath(dir, testnetUnitFile);
    await writeText(
      unitPath,
      unitText({ network: testnet, launcher: true, staleLauncherChild: true }),
    );

    assert.throws(() => {
      checkLauncherUnit(unitPath, testnet);
    }, productionLauncherFileLogging);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update refuses environment log-root overrides", async () => {
  const dir = await mkdtemp(joinPath(tmpdir(), updateTempPrefix));
  try {
    const unitPath = joinPath(dir, testnetUnitFile);
    await writeText(
      unitPath,
      unitText({
        network: testnet,
        launcher: true,
        extraEnvironment: "ICKB_BOT_LOG_ROOT=/tmp/other-log",
      }),
    );

    assert.throws(() => {
      checkLauncherUnit(unitPath, testnet);
    }, productionLauncherFileLogging);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update refuses stale direct-exec units", async () => {
  const dir = await mkdtemp(joinPath(tmpdir(), updateTempPrefix));
  try {
    const unitPath = joinPath(dir, testnetUnitFile);
    await writeText(unitPath, unitText({ network: testnet, launcher: false }));

    assert.throws(() => {
      checkLauncherUnit(unitPath, testnet);
    }, /ickb-bot-systemd-install\.sh testnet/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update refuses launcher units without core-dump hardening", async () => {
  const dir = await mkdtemp(joinPath(tmpdir(), updateTempPrefix));
  try {
    const unitPath = joinPath(dir, testnetUnitFile);
    await writeText(
      unitPath,
      unitText({ network: testnet, launcher: true, limitCore: false }),
    );

    assert.throws(() => {
      checkLauncherUnit(unitPath, testnet);
    }, /core-dump hardening/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update refuses launcher units with mismatched writable log roots", async () => {
  const dir = await mkdtemp(joinPath(tmpdir(), updateTempPrefix));
  try {
    const unitPath = joinPath(dir, testnetUnitFile);
    await writeText(
      unitPath,
      unitText({
        network: testnet,
        launcher: true,
        logRoot: "/srv/ickb/log",
        readWritePath: "/tmp",
      }),
    );

    assert.throws(() => {
      checkLauncherUnit(unitPath, testnet);
    }, productionLauncherFileLogging);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update refuses launcher log-root arguments", async () => {
  const dir = await mkdtemp(joinPath(tmpdir(), updateTempPrefix));
  try {
    const unitPath = joinPath(dir, testnetUnitFile);
    await writeText(
      unitPath,
      unitText({ network: testnet, launcher: true, logRoot: "relative-log" }),
    );

    assert.throws(() => {
      checkLauncherUnit(unitPath, testnet);
    }, productionLauncherFileLogging);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update ignores commented launcher directives", async () => {
  const dir = await mkdtemp(joinPath(tmpdir(), updateTempPrefix));
  try {
    const unitPath = joinPath(dir, testnetUnitFile);
    await writeText(
      unitPath,
      unitText({ network: testnet, launcher: false, commentedSpoof: true }),
    );

    assert.throws(() => {
      checkLauncherUnit(unitPath, testnet);
    }, productionLauncherFileLogging);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update ignores launcher directives outside the Service section", async () => {
  const dir = await mkdtemp(joinPath(tmpdir(), updateTempPrefix));
  try {
    const unitPath = joinPath(dir, "ickb-bot-testnet.service");
    await writeText(
      unitPath,
      unitText({
        network: testnet,
        launcher: false,
        inactiveSectionSpoof: true,
      }),
    );

    assert.throws(() => {
      checkLauncherUnit(unitPath, testnet);
    }, productionLauncherFileLogging);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd update checks unit wiring before mutating deploy checkout", async () => {
  const text = await readText(updateEntrypoint);
  const guardIndex = text.indexOf("requireLauncherUnit(unitPath, network, deployDir);");
  const pullIndex = text.indexOf('"pull", "--ff-only"');

  assert.notEqual(guardIndex, -1);
  assert.notEqual(pullIndex, -1);
  assert.ok(guardIndex < pullIndex);
});

void test("systemd update refuses untracked files before pulling", () => {
  const commands: string[] = [];
  const runAsServiceUser: RunAsServiceUser = (_user, _userHome, command, args) => {
    commands.push([command, ...args].join(" "));
    return spawnResult("?? untracked.txt\n");
  };

  assert.throws(
    () => {
      requireCleanWorktree({
        deployDir: "/deploy",
        runAsServiceUser,
        user: "ickb-bot-testnet",
        userHome: "/home/ickb",
      });
    },
    /local changes or untracked files/u,
  );
  assert.doesNotMatch(commands.join("\n"), /pull --ff-only/u);
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

async function readText(filePath: string): Promise<string> {
  return fsReadFile(filePath, "utf8");
}

async function writeText(filePath: string, data: string): Promise<void> {
  await fsWriteFile(filePath, data);
}

function checkLauncherUnit(unitPath: string, network: typeof testnet): void {
  requireLauncherUnit(unitPath, network, `/opt/ickb-${network}`);
}

function spawnResult(stdout: string, status = 0): SpawnSyncReturns<string> {
  return {
    output: [null, stdout, ""],
    pid: 0,
    signal: null,
    status,
    stderr: "",
    stdout,
  };
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
    execStart = `ExecStart=/usr/bin/node scripts/bot/launcher.ts ${launcherLogRoot}-- /usr/bin/node apps/bot/src/index.ts`;
  } else if (launcher) {
    execStart = `ExecStart=/usr/bin/node scripts/bot/launcher.ts ${launcherLogRoot}--no-child-tee`;
  }
  const workingDirectory = `/opt/ickb-${network}`;
  const writablePath = readWritePath ?? logRoot ?? `${workingDirectory}/log`;
  const environmentValue = [`BOT_CONFIG_FILE=%d/${credentialName}`, extraEnvironment]
    .filter(Boolean)
    .join(" ");

  const comments = commentedSpoof
    ? `# ExecStart=/usr/bin/node scripts/bot/launcher.ts -- /usr/bin/node apps/bot/src/index.ts
# ReadWritePaths=${workingDirectory}/log
`
    : "";
  const inactive = inactiveSectionSpoof
    ? `[Unit]
ExecStart=/usr/bin/node scripts/bot/launcher.ts -- /usr/bin/node apps/bot/src/index.ts
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
${limitCore ? `LimitCORE=0\n` : ""}ReadWritePaths=${writablePath}
`;
}

function joinPath(...segments: string[]): string {
  return path.join(...segments);
}
