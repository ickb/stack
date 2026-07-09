#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  type Network,
  type OutputStream,
  parseNetworkArg,
  parsePositiveSafeInteger,
  publicErrorMessage,
  requireCommand,
  requireNode22_19,
  requireRoot,
  requireSuccessfulCommand,
  runCommand,
  safeInstallDirectory,
} from "./systemd-support.ts";

export interface BotSystemdInstallOptions {
  argv?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: OutputStream;
}

export interface BotServiceUnitOptions {
  deployDir: string;
  logStorageQuotaBytes?: number;
  network: Network;
}

export function usage(scriptName = "ickb-bot-systemd-install.sh"): string {
  return [
    `Usage: ${scriptName} <testnet|mainnet>`,
    "Run from the checkout to use as that service deployment. Generated units keep production bot logs under <checkout>/log.",
    "Set ICKB_BOT_LOG_STORAGE_QUOTA_BYTES to enable best-effort pruning of inactive per-run bot logs and artifacts.",
  ].join("\n");
}

export function botServiceUnitText({
  deployDir,
  logStorageQuotaBytes,
  network,
}: BotServiceUnitOptions): string {
  const user = serviceUser(network);
  const credentialName = credentialConfigName(network);
  const credential = credentialPath(network);
  const logRootPath = path.join(deployDir, "log");
  const quotaEnvironment =
    logStorageQuotaBytes === undefined
      ? ""
      : ` ICKB_BOT_LOG_STORAGE_QUOTA_BYTES=${logStorageQuotaBytes.toString()}`;
  return `[Unit]
Description=iCKB bot ${network}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
Group=${user}
WorkingDirectory=${deployDir}
Environment=BOT_CONFIG_FILE=%d/${credentialName}${quotaEnvironment}
LoadCredentialEncrypted=${credentialName}:${credential}
ExecStart=/usr/bin/node scripts/bot/launcher.ts --no-child-tee
Restart=on-failure
RestartSec=60
RestartPreventExitStatus=2
LimitCORE=0
NoNewPrivileges=true
PrivateTmp=true
ProtectProc=invisible
ProtectSystem=strict
ReadWritePaths=${logRootPath}
ProtectHome=true

[Install]
WantedBy=multi-user.target
`;
}

export function runSystemdInstall({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  stdout = process.stdout,
}: BotSystemdInstallOptions = {}): void {
  requireRoot();
  requireInstallRuntime();
  const network = parseNetworkArg(argv, usage());
  if (network === "help") {
    stdout.write(`${usage()}\n`);
    return;
  }

  const deployDir = fs.realpathSync(cwd);
  installNetwork(network, deployDir, env, stdout);
  requireSuccessfulCommand("systemctl", ["daemon-reload"], { stdio: "inherit" });
  stdout.write(
    "Next: create credentials, install dependencies, type-check source, then enable the services.\n",
  );
}

export function main(
  argv: string[] = process.argv.slice(2),
  io: { stderr?: OutputStream; stdout?: OutputStream } = {},
): number {
  const stderr = io.stderr ?? process.stderr;
  try {
    runSystemdInstall({ argv, stdout: io.stdout });
    return 0;
  } catch (error) {
    stderr.write(`${publicErrorMessage(error)}\n`);
    return 1;
  }
}

export function installNetwork(
  network: Network,
  deployDir: string,
  env: NodeJS.ProcessEnv = process.env,
  stdout: OutputStream = process.stdout,
): void {
  const user = serviceUser(network);
  const logStorageQuotaBytes = parseLogStorageQuota(env["ICKB_BOT_LOG_STORAGE_QUOTA_BYTES"]);
  ensureServiceUser(user);
  const userId = readUserId(user, "-u");
  const groupId = readUserId(user, "-g");
  const logRootPath = path.join(deployDir, "log");

  safeInstallDirectory(deployDir, 0o755, userId, groupId);
  safeInstallDirectory(logRootPath, 0o755, 0, 0);
  safeInstallDirectory(path.join(logRootPath, "bot"), 0o700, userId, groupId);
  safeInstallDirectory(credentialDirectory, 0o700, 0, 0);

  const unitPath = `/etc/systemd/system/${serviceName(network)}`;
  fs.writeFileSync(
    unitPath,
    botServiceUnitText({ deployDir, logStorageQuotaBytes, network }),
    "utf8",
  );
  fs.chmodSync(unitPath, 0o644);
  stdout.write(
    `Installed ${serviceName(network)} for user ${user} in ${deployDir} with logs under ${logRootPath}/bot\n`,
  );
}

export function serviceName(network: Network): string {
  return `ickb-bot-${network}.service`;
}

export function serviceUser(network: Network): string {
  return `ickb-bot-${network}`;
}

export function credentialConfigName(network: Network): string {
  return `ickb-bot-${network}-config.json`;
}

export function credentialPath(network: Network): string {
  return `${credentialDirectory}/ickb-bot-${network}-config.cred`;
}

const credentialDirectory = "/etc/ickb/credentials";

function requireInstallRuntime(): void {
  if (!isExecutableFile("/usr/bin/node")) {
    throw new Error(
      "/usr/bin/node is required because generated units use that path. Install Node.js >=22.19.0 there or adjust the unit after install.",
    );
  }
  requireNode22_19("/usr/bin/node", "at /usr/bin/node");
  const pathNode = requireCommand(
    "node",
    "node is required. Install Node.js >=22.19.0 before installing units.",
  );
  requireNode22_19(pathNode, "on PATH");
  requireCommand("pnpm", "pnpm is required for deploy updates.");
}

function parseLogStorageQuota(value: string | undefined): number | undefined {
  return value === undefined || value === ""
    ? undefined
    : parsePositiveSafeInteger("ICKB_BOT_LOG_STORAGE_QUOTA_BYTES", value);
}

function ensureServiceUser(user: string): void {
  const existing = runCommand("id", ["-u", user], { stdio: "ignore" });
  if (existing.status === 0) {
    return;
  }
  requireSuccessfulCommand(
    "useradd",
    ["--system", "--create-home", "--user-group", "--shell", "/usr/sbin/nologin", user],
    { stdio: "inherit" },
  );
}

function readUserId(user: string, flag: "-g" | "-u"): number {
  const result = requireSuccessfulCommand("id", [flag, user]);
  const parsed = Number(result.stdout.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid id output for ${user}`);
  }
  return parsed;
}

function isExecutableFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  process.exit(main());
}
