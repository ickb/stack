import fs from "node:fs";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

export type Network = "mainnet" | "testnet";

export interface OutputStream {
  write: (chunk: string) => boolean | undefined;
}

export interface RunCommandOptions {
  input?: string;
  stdio?: "ignore" | "inherit" | "pipe";
}

const nodeVersionCheck =
  'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 19) ? 0 : 1)';

export function isNetwork(value: string): value is Network {
  return value === "testnet" || value === "mainnet";
}

export function parseNetworkArg(argv: readonly string[], usage: string): Network | "help" {
  const [network, extra] = argv;
  if (network === "-h" || network === "--help") {
    return "help";
  }
  if (extra !== undefined || network === undefined || !isNetwork(network)) {
    throw new Error(usage);
  }
  return network;
}

export function requireRoot(euid = process.geteuid?.()): void {
  if (euid !== 0) {
    throw new Error("Run this script as root, for example with sudo.");
  }
}

export function requireNode22_19(nodePath: string, context: string): void {
  const check = runCommand(nodePath, ["-e", nodeVersionCheck], { stdio: "ignore" });
  if (check.status === 0) {
    return;
  }

  const version = runCommand(nodePath, ["--version"]);
  const found = version.status === 0 ? version.stdout.trim() : "unknown";
  throw new Error(`Node.js >=22.19.0 is required ${context}. Found: ${found}`);
}

export function requireCommand(command: string, message: string): string {
  const resolved = findCommand(command);
  if (resolved === null) {
    throw new Error(message);
  }
  return resolved;
}

export function findCommand(command: string, pathText = process.env.PATH): string | null {
  if (path.isAbsolute(command)) {
    return isExecutable(command) ? command : null;
  }
  for (const directory of (pathText ?? "").split(path.delimiter)) {
    const candidate = path.join(directory === "" ? "." : directory, command);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function parsePositiveSafeInteger(name: string, value: string): number {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return Number(parsed);
}

export function safeInstallDirectory(
  target: string,
  mode: number,
  uid: number,
  gid: number,
): void {
  if (!path.isAbsolute(target) || !Number.isInteger(mode) || !isUid(uid) || !isUid(gid)) {
    throw new Error(`Invalid directory install arguments: ${target}`);
  }

  const parsed = path.parse(target);
  let current = parsed.root;
  assertDirectory(current);
  for (const part of path.relative(parsed.root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      assertDirectory(current);
    } catch (error) {
      if (!isErrorCode(error, "ENOENT")) {
        throw error;
      }
      fs.mkdirSync(current, { mode });
      assertDirectory(current);
    }
  }
  fs.chmodSync(target, mode);
  fs.chownSync(target, uid, gid);
}

export function runCommand(
  command: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): SpawnSyncReturns<string> {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    input: options.input,
    stdio: options.stdio,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return result;
}

export function requireSuccessfulCommand(
  command: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): SpawnSyncReturns<string> {
  const result = runCommand(command, args, options);
  if (result.status !== 0) {
    const detail = stderrText(result) || `${command} exited with status ${String(result.status)}`;
    throw new Error(detail);
  }
  return result;
}

export function publicErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown systemd helper error";
}

export function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertDirectory(candidate: string): void {
  const stat = fs.lstatSync(candidate);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing symlinked directory path: ${candidate}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Directory path is not a directory: ${candidate}`);
  }
}

function isExecutable(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isUid(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function stderrText(result: SpawnSyncReturns<string>): string {
  return typeof result.stderr === "string" ? result.stderr.trim() : "";
}
