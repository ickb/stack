import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const updateScript = join(rootDir, "scripts", "ickb-bot-systemd-update.sh");

test("systemd update accepts launcher-wired units", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-bot-systemd-update-"));
  try {
    const unitPath = join(dir, "ickb-bot-testnet.service");
    await writeFile(unitPath, unitText({ network: "testnet", launcher: true }));

    const result = requireLauncherUnit(unitPath, "testnet");
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("systemd update accepts launcher-wired units with explicit log roots", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-bot-systemd-update-"));
  try {
    const unitPath = join(dir, "ickb-bot-testnet.service");
    await writeFile(unitPath, unitText({ network: "testnet", launcher: true, logRoot: "/srv/ickb/log" }));

    const result = requireLauncherUnit(unitPath, "testnet");
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("systemd update accepts spaces around service directive separators", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-bot-systemd-update-"));
  try {
    const unitPath = join(dir, "ickb-bot-testnet.service");
    await writeFile(unitPath, unitText({ network: "testnet", launcher: true, separator: " = " }));

    const result = requireLauncherUnit(unitPath, "testnet");
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("systemd update refuses stale direct-exec units", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-bot-systemd-update-"));
  try {
    const unitPath = join(dir, "ickb-bot-testnet.service");
    await writeFile(unitPath, unitText({ network: "testnet", launcher: false }));

    const result = requireLauncherUnit(unitPath, "testnet");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /production launcher file logging/u);
    assert.match(result.stderr, /ickb-bot-systemd-install\.sh testnet/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("systemd update refuses launcher units without core-dump hardening", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-bot-systemd-update-"));
  try {
    const unitPath = join(dir, "ickb-bot-testnet.service");
    await writeFile(unitPath, unitText({ network: "testnet", launcher: true, limitCore: false }));

    const result = requireLauncherUnit(unitPath, "testnet");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /core-dump hardening/u);
    assert.match(result.stderr, /ickb-bot-systemd-install\.sh testnet/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("systemd update refuses launcher units with mismatched writable log roots", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-bot-systemd-update-"));
  try {
    const unitPath = join(dir, "ickb-bot-testnet.service");
    await writeFile(unitPath, unitText({ network: "testnet", launcher: true, logRoot: "/srv/ickb/log", readWritePath: "/tmp" }));

    const result = requireLauncherUnit(unitPath, "testnet");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /production launcher file logging/u);
    assert.match(result.stderr, /ickb-bot-systemd-install\.sh testnet/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("systemd update refuses malformed launcher log-root arguments", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-bot-systemd-update-"));
  try {
    const unitPath = join(dir, "ickb-bot-testnet.service");
    await writeFile(unitPath, unitText({ network: "testnet", launcher: true, logRoot: "relative-log" }));

    const result = requireLauncherUnit(unitPath, "testnet");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /production launcher file logging/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("systemd update ignores commented launcher directives", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-bot-systemd-update-"));
  try {
    const unitPath = join(dir, "ickb-bot-testnet.service");
    await writeFile(unitPath, unitText({ network: "testnet", launcher: false, commentedSpoof: true }));

    const result = requireLauncherUnit(unitPath, "testnet");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /production launcher file logging/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("systemd update ignores launcher directives outside the Service section", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-bot-systemd-update-"));
  try {
    const unitPath = join(dir, "ickb-bot-testnet.service");
    await writeFile(unitPath, unitText({ network: "testnet", launcher: false, inactiveSectionSpoof: true }));

    const result = requireLauncherUnit(unitPath, "testnet");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /production launcher file logging/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("systemd update checks unit wiring before mutating deploy checkout", async () => {
  const text = await readFile(updateScript, "utf8");
  const guardIndex = text.indexOf('require_launcher_unit "${unit_path}" "${network}"');
  const pullIndex = text.indexOf('git -C "${deploy_dir}" pull --ff-only');

  assert.notEqual(guardIndex, -1);
  assert.notEqual(pullIndex, -1);
  assert.ok(guardIndex < pullIndex);
});

test("systemd update refuses untracked files before pulling", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-bot-systemd-update-"));
  try {
    const fakeBin = join(dir, "bin");
    const logPath = join(dir, "git.log");
    await mkdir(fakeBin, { recursive: true });
    await writeFile(join(fakeBin, "runuser"), `#!/usr/bin/env bash
shift 3
env_args=()
while [[ $# -gt 0 && $1 == *=* ]]; do
  env_args+=("$1")
  shift
done
exec env "\${env_args[@]}" "$@"
`);
    await chmod(join(fakeBin, "runuser"), 0o755);
    await writeFile(join(fakeBin, "git"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(logPath)}
if [[ $* == *' status --porcelain' ]]; then
  printf '?? untracked.txt\\n'
fi
`);
    await chmod(join(fakeBin, "git"), 0o755);

    const result = spawnSync(
      "bash",
      ["-c", "source \"$1\"; PATH=\"$2:$PATH\"; run_as_service_user() { command runuser -u \"$1\" -- env HOME=\"$2\" USER=\"$1\" LOGNAME=\"$1\" SHELL=/bin/bash \"${@:3}\"; }; require_clean_worktree ickb-bot-testnet /home/ickb /deploy", "bash", updateScript, fakeBin],
      { cwd: rootDir, encoding: "utf8" },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /local changes or untracked files/u);
    assert.doesNotMatch(await readFile(logPath, "utf8"), /pull --ff-only/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

function requireLauncherUnit(unitPath, network) {
  return spawnSync(
    "bash",
    ["-c", "source \"$1\"; require_launcher_unit \"$2\" \"$3\"", "bash", updateScript, unitPath, network],
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
  separator = "=",
}) {
  const credentialName = `ickb-bot-${network}-config.json`;
  const credential = `/etc/ickb/credentials/ickb-bot-${network}-config.cred`;
  const launcherLogRoot = logRoot === undefined ? "" : `--log-root ${logRoot} `;
  const execStart = launcher
    ? `ExecStart${separator}/usr/bin/node scripts/ickb-bot-launcher.mjs ${launcherLogRoot}--network ${network} -- /usr/bin/node apps/bot/dist/index.js`
    : `ExecStart${separator}/usr/bin/node apps/bot/dist/index.js`;
  const writablePath = readWritePath ?? logRoot ?? `/opt/ickb-stack-${network}/log`;

  const comments = commentedSpoof
    ? `# ExecStart=/usr/bin/node scripts/ickb-bot-launcher.mjs --network ${network} -- /usr/bin/node apps/bot/dist/index.js
# ReadWritePaths=/opt/ickb-stack-${network}/log
`
    : "";
  const inactive = inactiveSectionSpoof
    ? `[Unit]
ExecStart=/usr/bin/node scripts/ickb-bot-launcher.mjs --network ${network} -- /usr/bin/node apps/bot/dist/index.js
ReadWritePaths=/opt/ickb-stack-${network}/log
[Install]
WantedBy=multi-user.target
`
    : "";

  return `${inactive}[Service]
${comments}
Environment${separator}BOT_CONFIG_FILE=%d/${credentialName}
LoadCredentialEncrypted${separator}${credentialName}:${credential}
${execStart}
RestartPreventExitStatus${separator}2
${limitCore ? `LimitCORE${separator}0\n` : ""}
ReadWritePaths${separator}${writablePath}
`;
}
