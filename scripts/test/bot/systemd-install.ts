import assert from "node:assert/strict";
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

import { botServiceUnitText } from "../../bot/systemd-install.ts";
import {
  parsePositiveSafeInteger,
  requireNode22_19,
  safeInstallDirectory,
} from "../../bot/systemd-support.ts";

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
const installWrapper = joinPath(rootDir, "scripts", "ickb-bot-systemd-install.sh");
const installEntrypoint = joinPath(rootDir, "scripts", "bot", "systemd-install.ts");

void test("systemd install wrapper delegates to the Node-owned entrypoint", async () => {
  const text = await readText(installWrapper);

  assert.match(text, /bot\/systemd-install\.ts/u);
  assert.doesNotMatch(text, /require_systemd_safe_positive_integer/u);
});

void test("systemd install units run the source bot through the file-log launcher", () => {
  const text = botServiceUnitText({
    deployDir: "/srv/ickb-stack",
    logStorageQuotaBytes: 1000,
    network: "testnet",
  });

  assert.match(
    text,
    /ExecStart=\/usr\/bin\/node scripts\/bot\/launcher\.ts --no-child-tee/u,
  );
  assert.doesNotMatch(text, /ExecStart=\/usr\/bin\/node apps\/bot\/src\/index\.ts/u);
  assert.match(
    text,
    /Environment=BOT_CONFIG_FILE=%d\/ickb-bot-testnet-config\.json ICKB_BOT_LOG_STORAGE_QUOTA_BYTES=1000/u,
  );
  assert.match(
    text,
    /LoadCredentialEncrypted=ickb-bot-testnet-config\.json:\/etc\/ickb\/credentials\/ickb-bot-testnet-config\.cred/u,
  );
  assert.match(text, /RestartSec=60/u);
  assert.match(text, /RestartPreventExitStatus=2/u);
  assert.match(text, /LimitCORE=0/u);
  assert.match(text, /ProtectSystem=strict/u);
  assert.match(text, /ReadWritePaths=\/srv\/ickb-stack\/log/u);
});

void test("systemd install script requires Node 22.19 for source units", async () => {
  const text = await readText(installEntrypoint);

  assert.match(text, /requireNode22_19/u);
  assert.doesNotMatch(text, /Node\.js >=22 is required/u);
});

void test("systemd install node version helper rejects early Node 22", async () => {
  const dir = await mkdtemp(joinPath(tmpdir(), "ickb-node-version-"));
  try {
    const fakeNode = joinPath(dir, "node");
    await writeText(
      fakeNode,
      `#!/usr/bin/env bash
version=\${FAKE_NODE_VERSION:?}
if [[ \${1:-} == --version ]]; then
  printf 'v%s\n' "\${version}"
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

    assert.throws(() => {
      requireNodeVersion(fakeNode, "22.18.0");
    }, /v22\.18\.0/u);
    assert.doesNotThrow(() => {
      requireNodeVersion(fakeNode, "22.19.0");
    });
    assert.doesNotThrow(() => {
      requireNodeVersion(fakeNode, "23.0.0");
    });
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("systemd install units use the invoking checkout as deployment root", () => {
  const text = botServiceUnitText({ deployDir: "/srv/deploy", network: "mainnet" });

  assert.match(text, /WorkingDirectory=\/srv\/deploy/u);
  assert.match(text, /ReadWritePaths=\/srv\/deploy\/log/u);
  assert.doesNotMatch(text, /\/opt\/ickb-stack-/u);
  assert.doesNotMatch(text, /\/var\/log/u);
  assert.doesNotMatch(text, /logs\/live-supervisor/u);
});

void test("systemd install script keeps generated units on the checkout-local log root", () => {
  const text = botServiceUnitText({ deployDir: "/srv/deploy", network: "testnet" });

  assert.match(text, /ReadWritePaths=\/srv\/deploy\/log/u);
  assert.match(
    text,
    /ExecStart=\/usr\/bin\/node scripts\/bot\/launcher\.ts --no-child-tee/u,
  );
  assert.doesNotMatch(text, /--network \$\{network\}/u);
  assert.doesNotMatch(text, /ICKB_BOT_LOG_ROOT/u);
  assert.doesNotMatch(text, /--log-root \$\{log_root_path\}/u);
});

void test("systemd install script validates optional log storage quota", () => {
  assert.equal(parsePositiveSafeInteger("ICKB_BOT_LOG_STORAGE_QUOTA_BYTES", "1000"), 1000);
  for (const value of ["", "0", "abc", "9007199254740993"]) {
    assert.throws(
      () => parsePositiveSafeInteger("ICKB_BOT_LOG_STORAGE_QUOTA_BYTES", value),
      /positive safe integer/u,
      value,
    );
  }
});

void test("systemd install script creates log dirs without following symlinks", async () => {
  const dir = await mkdtemp(joinPath(tmpdir(), "ickb-bot-systemd-install-"));
  try {
    const uid = process.getuid?.() ?? 0;
    const gid = process.getgid?.() ?? 0;
    const createdPath = joinPath(dir, "log", "bot");
    safeInstallDirectory(createdPath, 0o700, uid, gid);
    assert.equal(await pathMode(createdPath), 0o700);

    const linkPath = joinPath(dir, "link");
    await linkSymbolic(dir, linkPath, "dir");
    assert.throws(
      () => {
        safeInstallDirectory(joinPath(linkPath, "bot"), 0o755, uid, gid);
      },
      /Refusing symlinked directory path/u,
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

function requireNodeVersion(nodePath: string, version: string): void {
  const previousVersion = process.env["FAKE_NODE_VERSION"];
  process.env["FAKE_NODE_VERSION"] = version;
  try {
    requireNode22_19(nodePath, "test");
  } finally {
    if (previousVersion === undefined) {
      delete process.env["FAKE_NODE_VERSION"];
    } else {
      process.env["FAKE_NODE_VERSION"] = previousVersion;
    }
  }
}

async function readText(filePath: string): Promise<string> {
  return fsReadFile(filePath, "utf8");
}

async function chmodPath(filePath: string, mode: number): Promise<void> {
  await fsChmod(filePath, mode);
}

async function linkSymbolic(
  target: string,
  linkPath: string,
  type: "dir" | "file" | "junction",
): Promise<void> {
  await fsSymlink(target, linkPath, type);
}

async function statPath(filePath: string): Promise<Stats> {
  return fsStat(filePath);
}

async function pathMode(filePath: string): Promise<number> {
  return (await statPath(filePath)).mode & 0o777;
}

async function writeText(filePath: string, data: string): Promise<void> {
  await fsWriteFile(filePath, data);
}

function joinPath(...segments: string[]): string {
  return path.join(...segments);
}
