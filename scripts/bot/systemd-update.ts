#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SpawnSyncReturns } from "node:child_process";

import {
  type Network,
  type OutputStream,
  parseNetworkArg,
  publicErrorMessage,
  requireCommand,
  requireNode22_19,
  requireRoot,
  requireSuccessfulCommand,
  runCommand,
} from "./systemd-support.ts";
import { credentialConfigName, credentialPath, serviceName, serviceUser } from "./systemd-install.ts";

export interface BotSystemdUpdateOptions {
  argv?: string[];
}

export interface RequireCleanWorktreeOptions {
  deployDir: string;
  runAsServiceUser?: RunAsServiceUser;
  user: string;
  userHome: string;
}

export type RunAsServiceUser = (
  user: string,
  userHome: string,
  command: string,
  args: readonly string[],
  options?: { stdio?: "ignore" | "inherit" | "pipe" },
) => SpawnSyncReturns<string>;

export function usage(scriptName = "ickb-bot-systemd-update.sh"): string {
  return `Usage: ${scriptName} <testnet|mainnet>`;
}

export function runSystemdUpdate({
  argv = process.argv.slice(2),
}: BotSystemdUpdateOptions = {}): void {
  requireRoot();
  requireUpdateRuntime();
  const network = parseNetworkArg(argv, usage());
  if (network === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  updateNetwork(network);
}

export function main(
  argv: string[] = process.argv.slice(2),
  io: { stderr?: OutputStream } = {},
): number {
  const stderr = io.stderr ?? process.stderr;
  try {
    runSystemdUpdate({ argv });
    return 0;
  } catch (error) {
    stderr.write(`${publicErrorMessage(error)}\n`);
    return 1;
  }
}

export function updateNetwork(network: Network): void {
  const user = serviceUser(network);
  const service = serviceName(network);
  const unitPath = `/etc/systemd/system/${service}`;
  const pnpmBin = requireCommand("pnpm", "pnpm is required before updating.");
  const userHome = serviceUserHome(user);
  const deployDir = requireUnitWorkingDirectory(unitPath, network);

  requireLauncherUnit(unitPath, network, deployDir);
  requireServiceCommand(user, userHome, "git", [
    "-C",
    deployDir,
    "rev-parse",
    "--is-inside-work-tree",
  ], { stdio: "ignore" });
  requireCleanWorktree({ deployDir, user, userHome });

  requireServiceCommand(user, userHome, "git", ["-C", deployDir, "pull", "--ff-only"], {
    stdio: "inherit",
  });
  requireServiceCommand(user, userHome, pnpmBin, ["-C", deployDir, "bot:install"], {
    stdio: "inherit",
  });
  requireServiceCommand(user, userHome, pnpmBin, ["-C", deployDir, "bot:check"], {
    stdio: "inherit",
  });
  requireSuccessfulCommand("systemctl", ["restart", service], { stdio: "inherit" });
  requireSuccessfulCommand("systemctl", ["--no-pager", "--full", "status", service], {
    stdio: "inherit",
  });
}

export function serviceUserHome(user: string): string {
  const result = runCommand("getent", ["passwd", user]);
  if (result.status !== 0) {
    throw new Error(`User ${user} does not exist. Run bot:install first.`);
  }
  const userHome = result.stdout.split(":")[5] ?? "";
  if (userHome === "") {
    throw new Error(`User ${user} has no home directory.`);
  }
  return userHome;
}

export function runAsServiceUser(
  user: string,
  userHome: string,
  command: string,
  args: readonly string[],
  options: { stdio?: "ignore" | "inherit" | "pipe" } = {},
): SpawnSyncReturns<string> {
  return runCommand(
    "runuser",
    [
      "-u",
      user,
      "--",
      "env",
      `HOME=${userHome}`,
      `USER=${user}`,
      `LOGNAME=${user}`,
      "SHELL=/bin/bash",
      command,
      ...args,
    ],
    { stdio: options.stdio },
  );
}

export function requireServiceCommand(
  user: string,
  userHome: string,
  command: string,
  args: readonly string[],
  options: { stdio?: "ignore" | "inherit" | "pipe" } = {},
): SpawnSyncReturns<string> {
  const result = runAsServiceUser(user, userHome, command, args, options);
  if (result.status !== 0) {
    throw new Error(
      stderrText(result) || `${command} exited with status ${String(result.status)}`,
    );
  }
  return result;
}

export function requireCleanWorktree({
  deployDir,
  runAsServiceUser: run = runAsServiceUser,
  user,
  userHome,
}: RequireCleanWorktreeOptions): void {
  const status = run(user, userHome, "git", ["-C", deployDir, "status", "--porcelain"]);
  if (status.status !== 0) {
    throw new Error(stderrText(status) || "Unable to inspect deploy checkout status.");
  }
  if (status.stdout !== "") {
    throw new Error(
      `Deploy checkout ${deployDir} has local changes or untracked files; refusing to update.`,
    );
  }
}

export function requireLauncherUnit(
  unitPath: string,
  network: Network,
  deployDir: string,
): void {
  if (!isReadableFile(unitPath)) {
    throw new Error(
      `Service unit ${unitPath} is missing or unreadable. Run scripts/ickb-bot-systemd-install.sh ${network} first.`,
    );
  }

  const unitText = fs.readFileSync(unitPath, "utf8");
  const credentialName = credentialConfigName(network);
  const credential = credentialPath(network);
  const logRoot = path.join(deployDir, "log");
  if (
    !serviceHasBotEnvironment(unitText, credentialName) ||
    !serviceHasLine(unitText, `LoadCredentialEncrypted=${credentialName}:${credential}`) ||
    !serviceHasLine(unitText, "ExecStart=/usr/bin/node scripts/bot/launcher.ts --no-child-tee") ||
    !serviceHasLine(unitText, "RestartPreventExitStatus=2") ||
    !serviceHasLine(unitText, "LimitCORE=0") ||
    !serviceHasLine(unitText, "RestartSec=60") ||
    !serviceHasLine(unitText, `ReadWritePaths=${logRoot}`)
  ) {
    throw new Error(
      `Service unit ${unitPath} is not wired for production launcher file logging and core-dump hardening. Run scripts/ickb-bot-systemd-install.sh ${network} before updating.`,
    );
  }
}

export function requireUnitWorkingDirectory(unitPath: string, network: Network): string {
  const deployDir = unitWorkingDirectory(fs.readFileSync(unitPath, "utf8"));
  if (deployDir === null || !path.isAbsolute(deployDir)) {
    throw new Error(
      `Service unit ${unitPath} has no absolute WorkingDirectory. Run scripts/ickb-bot-systemd-install.sh ${network} from the deploy checkout before updating.`,
    );
  }
  return deployDir;
}

export function unitWorkingDirectory(unitText: string): string | null {
  for (const line of serviceSectionLines(unitText)) {
    if (line.startsWith("WorkingDirectory=")) {
      return line.slice("WorkingDirectory=".length);
    }
  }
  return null;
}

export function serviceHasLine(unitText: string, expected: string): boolean {
  return serviceSectionLines(unitText).includes(expected);
}

export function serviceHasBotEnvironment(
  unitText: string,
  credentialName: string,
): boolean {
  const base = `Environment=BOT_CONFIG_FILE=%d/${credentialName}`;
  for (const line of serviceSectionLines(unitText)) {
    if (line === base) {
      return true;
    }
    if (!line.startsWith(`${base} ICKB_BOT_LOG_STORAGE_QUOTA_BYTES=`)) {
      continue;
    }
    const quota = line.slice(`${base} ICKB_BOT_LOG_STORAGE_QUOTA_BYTES=`.length);
    if (/^[1-9]\d*$/u.test(quota)) {
      return true;
    }
  }
  return false;
}

export function serviceSectionLines(unitText: string): string[] {
  const lines: string[] = [];
  let inService = false;
  for (const rawLine of unitText.split("\n")) {
    const line = rawLine.replace(/\r$/u, "").trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }
    const section = /^\[(.*)\]$/u.exec(line);
    if (section !== null) {
      inService = section[1] === "Service";
      continue;
    }
    if (inService) {
      lines.push(line);
    }
  }
  return lines;
}

function requireUpdateRuntime(): void {
  if (!isExecutableFile("/usr/bin/node")) {
    throw new Error(
      "/usr/bin/node is required because generated units use that path. Install Node.js >=22.19.0 there or adjust the unit before updating.",
    );
  }
  requireNode22_19("/usr/bin/node", "at /usr/bin/node");
  requireCommand("pnpm", "pnpm is required before updating.");
  requireCommand("git", "git is required before updating.");
}

function isReadableFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function isExecutableFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function stderrText(result: SpawnSyncReturns<string>): string {
  return typeof result.stderr === "string" ? result.stderr.trim() : "";
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  process.exit(main());
}
