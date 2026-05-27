import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const installScript = join(rootDir, "scripts", "ickb-bot-systemd-install.sh");

test("systemd install units run the built bot through the file-log launcher", async () => {
  const text = await readFile(installScript, "utf8");

  assert.match(text, /ExecStart=\/usr\/bin\/node scripts\/ickb-bot-launcher\.mjs .*--network \$\{network\} -- \/usr\/bin\/node apps\/bot\/dist\/index\.js/u);
  assert.doesNotMatch(text, /ExecStart=\/usr\/bin\/node apps\/bot\/dist\/index\.js/u);
  assert.match(text, /Environment=BOT_CONFIG_FILE=%d\/\$\{credential_name\}/u);
  assert.match(text, /LoadCredentialEncrypted=\$\{credential_name\}:\$\{credential\}/u);
  assert.match(text, /RestartPreventExitStatus=2/u);
  assert.match(text, /LimitCORE=0/u);
  assert.match(text, /ProtectSystem=strict/u);
  assert.match(text, /ReadWritePaths=\$\{log_root_path\}/u);
});

test("systemd install script avoids environment-specific hardcoded log roots", async () => {
  const text = await readFile(installScript, "utf8");

  assert.match(text, /log_root_path="\$\{deploy_dir\}\/log"/u);
  assert.doesNotMatch(text, /\/var\/log/u);
  assert.doesNotMatch(text, /logs\/live-supervisor/u);
});

test("systemd install script resolves configured log roots like the launcher", () => {
  const absolute = resolveLogRoot("/opt/ickb-stack-testnet", "/srv/ickb/logs");
  assert.equal(absolute.status, 0, absolute.stderr);
  assert.equal(absolute.stdout, "/srv/ickb/logs");

  const relative = resolveLogRoot("/opt/ickb-stack-testnet", "runtime-log");
  assert.equal(relative.status, 0, relative.stderr);
  assert.equal(relative.stdout, "/opt/ickb-stack-testnet/runtime-log");
});

test("systemd install script refuses unsafe log-root unit arguments", () => {
  const valid = validatePathArg("/srv/ickb-logs");
  assert.equal(valid.status, 0, valid.stderr);

  for (const value of ["", "/srv/ickb logs", "/srv/ickb;logs", "/srv/ickb%logs", "/srv/ickb$logs", "/srv/ickb\\logs"]) {
    const invalid = validatePathArg(value);
    assert.equal(invalid.status, 1, value);
    assert.match(invalid.stderr, /ICKB_BOT_LOG_ROOT/u);
  }
});

test("systemd install script creates log dirs without following symlinks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-bot-systemd-install-"));
  try {
    const uid = String(process.getuid?.() ?? 0);
    const gid = String(process.getgid?.() ?? 0);
    const createdPath = join(dir, "log", "bot", "testnet");
    const created = safeInstallDirectory(createdPath, "700", uid, gid);
    assert.equal(created.status, 0, created.stderr);
    assert.equal((await stat(createdPath)).mode & 0o777, 0o700);

    const linkPath = join(dir, "link");
    await symlink(dir, linkPath, "dir");
    const refused = safeInstallDirectory(join(linkPath, "bot"), "755", uid, gid);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Refusing symlinked directory path/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

function resolveLogRoot(deployDir, logRoot) {
  return spawnSync(
    "bash",
    ["-c", "source \"$1\"; resolve_log_root_path \"$2\" \"$3\"", "bash", installScript, deployDir, logRoot],
    { cwd: rootDir, encoding: "utf8" },
  );
}

function validatePathArg(value) {
  return spawnSync(
    "bash",
    ["-c", "source \"$1\"; require_systemd_safe_path_arg \"$2\"", "bash", installScript, value],
    { cwd: rootDir, encoding: "utf8" },
  );
}

function safeInstallDirectory(path, mode, uid, gid) {
  return spawnSync(
    "bash",
    ["-c", "source \"$1\"; safe_install_directory \"$2\" \"$3\" \"$4\" \"$5\"", "bash", installScript, path, mode, uid, gid],
    { cwd: rootDir, encoding: "utf8" },
  );
}
