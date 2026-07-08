import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import type { Stats } from "node:fs";
import {
  chmod as fsChmod,
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

void test("systemd install units run the source bot through the file-log launcher", async () => {
  const text = await readInstallScript();

  assert.match(
    text,
    /ExecStart=\/usr\/bin\/node scripts\/bot\/launcher\.ts --no-child-tee/u,
  );
  assert.doesNotMatch(text, /ExecStart=\/usr\/bin\/node apps\/bot\/src\/index\.ts/u);
  assert.match(text, /Environment=BOT_CONFIG_FILE=%d\/\$\{credential_name\}/u);
  assert.match(text, /LoadCredentialEncrypted=\$\{credential_name\}:\$\{credential\}/u);
  assert.match(text, /RestartSec=60/u);
  assert.match(text, /RestartPreventExitStatus=2/u);
  assert.match(text, /LimitCORE=0/u);
  assert.match(text, /ProtectSystem=strict/u);
  assert.match(text, /ReadWritePaths=\$\{log_root_path\}/u);
});

void test("systemd install script requires Node 22.19 for source units", async () => {
  const text = await readInstallScript();

  assert.match(text, /Node\.js >=22\.19\.0/u);
  assert.match(text, /minor >= 19/u);
  assert.doesNotMatch(text, /Node\.js >=22 is required/u);
});

void test("systemd install node version helper rejects early Node 22", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-node-version-"));
  try {
    const fakeNode = join(dir, "node");
    await writeText(
      fakeNode,
      `#!/usr/bin/env bash
version=\${FAKE_NODE_VERSION:?}
if [[ \${1:-} == --version ]]; then
  printf 'v%s\\n' "\${version}"
  exit 0
fi
IFS=. read -r major minor _ <<<"\${version}"
if (( major > 22 || (major == 22 && minor >= 19) )); then
  exit 0
fi
exit 1
`,
    );
    await chmodPath(fakeNode, 0o755);

    assert.equal(requireNodeVersion(fakeNode, "22.18.0").status, 1);
    assert.equal(requireNodeVersion(fakeNode, "22.19.0").status, 0);
    assert.equal(requireNodeVersion(fakeNode, "23.0.0").status, 0);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd install script uses the invoking checkout as deployment root", async () => {
  const text = await readInstallScript();

  assert.match(text, /deploy_dir=\$\(pwd -P\)/u);
  assert.match(text, /log_root_path="\$\{deploy_dir\}\/log"/u);
  assert.doesNotMatch(text, /\/opt\/ickb-stack-/u);
  assert.doesNotMatch(text, /\/var\/log/u);
  assert.doesNotMatch(text, /logs\/live-supervisor/u);
});

void test("systemd install script keeps generated units on the checkout-local log root", async () => {
  const text = await readInstallScript();

  assert.match(text, /log_root_path="\$\{deploy_dir\}\/log"/u);
  assert.match(
    text,
    /ExecStart=\/usr\/bin\/node scripts\/bot\/launcher\.ts --no-child-tee/u,
  );
  assert.doesNotMatch(text, /--network \$\{network\}/u);
  assert.doesNotMatch(text, /ICKB_BOT_LOG_ROOT/u);
  assert.doesNotMatch(text, /--log-root \$\{log_root_path\}/u);
});

void test("systemd install script validates optional log storage quota", () => {
  assert.equal(
    validatePositiveInteger("ICKB_BOT_LOG_STORAGE_QUOTA_BYTES", "1000").status,
    0,
  );
  for (const value of ["", "0", "abc", "9007199254740993"]) {
    const invalid = validatePositiveInteger("ICKB_BOT_LOG_STORAGE_QUOTA_BYTES", value);
    assert.equal(invalid.status, 1, value);
    assert.match(invalid.stderr, /positive safe integer/u);
  }
});

void test("systemd install script creates log dirs without following symlinks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-bot-systemd-install-"));
  try {
    const uid = String(process.getuid?.() ?? 0);
    const gid = String(process.getgid?.() ?? 0);
    const createdPath = join(dir, "log", "bot");
    const created = safeInstallDirectory(createdPath, "700", uid, gid);
    assert.equal(created.status, 0, created.stderr);
    assert.equal(await pathMode(createdPath), 0o700);

    const linkPath = join(dir, "link");
    await linkSymbolic(dir, linkPath, "dir");
    const refused = safeInstallDirectory(join(linkPath, "bot"), "755", uid, gid);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Refusing symlinked directory path/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

async function readInstallScript(): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This test reads the fixed systemd install helper script under the repository root.
  return fsReadFile(installScript, "utf8");
}

async function chmodPath(filePath: string, mode: number): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This test modifies files inside its own temporary fixture directory.
  await fsChmod(filePath, mode);
}

async function linkSymbolic(
  target: string,
  linkPath: string,
  type: "dir" | "file" | "junction",
): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Symlink tests intentionally create links inside their temp directory.
  await fsSymlink(target, linkPath, type);
}

async function statPath(filePath: string): Promise<Stats> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This test stats paths inside its own temporary fixture directory.
  return fsStat(filePath);
}

async function pathMode(filePath: string): Promise<number> {
  return (await statPath(filePath)).mode & 0o777;
}

async function writeText(filePath: string, data: string): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This test writes files inside its own temporary fixture directory.
  await fsWriteFile(filePath, data);
}

function validatePositiveInteger(name: string, value: string): SpawnSyncReturns<string> {
  return spawnSync(
    bashPath,
    [
      "-c",
      'source "$1"; require_systemd_safe_positive_integer "$2" "$3"',
      "bash",
      installScript,
      name,
      value,
    ],
    {
      cwd: rootDir,
      encoding: "utf8",
    },
  );
}

function requireNodeVersion(nodePath: string, version: string): SpawnSyncReturns<string> {
  return spawnSync(
    bashPath,
    ["-c", 'source "$1"; require_node_22_19 "$2" test', "bash", installScript, nodePath],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: { ...process.env, FAKE_NODE_VERSION: version },
    },
  );
}

function safeInstallDirectory(
  directory: string,
  mode: string,
  uid: string,
  gid: string,
): SpawnSyncReturns<string> {
  return spawnSync(
    bashPath,
    [
      "-c",
      'source "$1"; safe_install_directory "$2" "$3" "$4" "$5"',
      "bash",
      installScript,
      directory,
      mode,
      uid,
      gid,
    ],
    { cwd: rootDir, encoding: "utf8" },
  );
}
