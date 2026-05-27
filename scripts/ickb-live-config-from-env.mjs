#!/usr/bin/env node
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultCheckIgnored } from "./ickb-live-config-git.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const SECP256K1_ORDER = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const OUTPUTS = [
  { role: "bot", envName: "ICKB_TESTNET_BOT_PRIVATE_KEY", out: "config/bot-testnet.json" },
  { role: "tester", envName: "ICKB_TESTNET_TESTER_PRIVATE_KEY", out: "config/tester-testnet.json" },
];

export function parseArgs(argv) {
  const args = { force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      args.help = true;
      continue;
    }
    if (arg === "--force") {
      args.force = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

export function usage() {
  return [
    "Usage: node scripts/ickb-live-config-from-env.mjs [--force]",
    "Required env: ICKB_TESTNET_BOT_PRIVATE_KEY, ICKB_TESTNET_TESTER_PRIVATE_KEY",
    "Optional env: ICKB_TESTNET_RPC_URL, ICKB_TESTNET_SLEEP_INTERVAL_SECONDS, ICKB_TESTNET_MAX_ITERATIONS, ICKB_TESTNET_MAX_RETRYABLE_ATTEMPTS",
    "Writes ignored testnet configs under config/ without printing secrets. Omitted RPC URL lets CCC use its default endpoint.",
  ].join("\n");
}

export async function runLiveConfigFromEnv({ argv, env = process.env, root = rootDir, dependencies = {} }) {
  const args = parseArgs(argv);
  if (args.help) {
    return { help: usage() };
  }
  const originalRoot = resolve(root);
  const resolvedRoot = await (dependencies.realpath ?? realpath)(originalRoot);

  const sleepIntervalSeconds = parseOptionalPositiveInteger(env.ICKB_TESTNET_SLEEP_INTERVAL_SECONDS, "ICKB_TESTNET_SLEEP_INTERVAL_SECONDS") ?? 1;
  const maxIterations = parseOptionalPositiveInteger(env.ICKB_TESTNET_MAX_ITERATIONS, "ICKB_TESTNET_MAX_ITERATIONS") ?? 1;
  const maxRetryableAttempts = parseOptionalPositiveInteger(env.ICKB_TESTNET_MAX_RETRYABLE_ATTEMPTS, "ICKB_TESTNET_MAX_RETRYABLE_ATTEMPTS") ?? 10;
  const rpcUrl = parseOptionalRpcUrl(env.ICKB_TESTNET_RPC_URL, "ICKB_TESTNET_RPC_URL");
  const outputs = OUTPUTS.map((output) => ({
    ...output,
    privateKey: parsePrivateKey(env[output.envName], output.envName),
    target: outputPath(originalRoot, resolvedRoot, output.out),
  }));
  for (const output of outputs) {
    assertIgnoredPath(resolvedRoot, output.target.relativePath, dependencies.checkIgnored);
  }
  if (!args.force) {
    await assertNoExistingTargets(outputs.map((output) => output.target.absolutePath), dependencies);
  }

  for (const output of outputs) {
    await makeSafeParentDir(output.target.absolutePath, resolvedRoot, dependencies);
  }

  const staged = [];
  let caught;
  try {
    for (const [index, output] of outputs.entries()) {
      const config = buildRuntimeConfig({
        privateKey: output.privateKey,
        rpcUrl,
        sleepIntervalSeconds,
        maxIterations,
        maxRetryableAttempts,
      });
      const tempPath = tempConfigPath(output.target.absolutePath, "tmp", index);
      staged.push({ ...output, tempPath });
      await writeConfigFile(tempPath, `${JSON.stringify(config)}\n`, false, dependencies);
    }
    await commitStagedConfigs(staged, args.force, dependencies);
  } catch (error) {
    caught = error;
  }
  try {
    await cleanupPaths(staged.map((output) => output.tempPath), dependencies);
  } catch (error) {
    if (caught === undefined) {
      throw error;
    }
  }
  if (caught !== undefined) {
    throw caught;
  }

  return {
    written: outputs.map((output) => ({
      role: output.role,
      outputPath: output.target.relativePath,
      chain: "testnet",
      rpcConfigured: rpcUrl !== undefined,
      sleepIntervalSeconds,
      maxIterations,
      maxRetryableAttempts,
      privateKey: "<written-to-config-file>",
    })),
  };
}

export function buildRuntimeConfig({ privateKey, rpcUrl, sleepIntervalSeconds, maxIterations, maxRetryableAttempts }) {
  return {
    chain: "testnet",
    privateKey,
    ...(rpcUrl === undefined ? {} : { rpcUrl }),
    sleepIntervalSeconds,
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(maxRetryableAttempts === undefined ? {} : { maxRetryableAttempts }),
  };
}

async function commitStagedConfigs(staged, force, dependencies) {
  for (const output of staged) {
    await assertNoSymlinkTarget(output.target.absolutePath, dependencies);
  }
  if (force) {
    await replaceStagedConfigs(staged, dependencies);
    return;
  }
  await createStagedConfigs(staged, dependencies);
}

async function createStagedConfigs(staged, dependencies) {
  const linked = [];
  try {
    for (const output of staged) {
      await (dependencies.link ?? link)(output.tempPath, output.target.absolutePath);
      linked.push(output.target.absolutePath);
    }
  } catch (error) {
    await cleanupPaths(linked, dependencies);
    throw error;
  }
}

async function replaceStagedConfigs(staged, dependencies) {
  const backups = [];
  const installedWithoutBackup = [];
  try {
    for (const [index, output] of staged.entries()) {
      const backupPath = tempConfigPath(output.target.absolutePath, "backup", index);
      if (await pathExists(output.target.absolutePath, dependencies)) {
        await (dependencies.rename ?? rename)(output.target.absolutePath, backupPath);
        backups.push({ targetPath: output.target.absolutePath, backupPath });
      }
    }
    const backedUpTargets = new Set(backups.map((backup) => backup.targetPath));
    for (const output of staged) {
      await (dependencies.rename ?? rename)(output.tempPath, output.target.absolutePath);
      if (!backedUpTargets.has(output.target.absolutePath)) {
        installedWithoutBackup.push(output.target.absolutePath);
      }
    }
  } catch (error) {
    for (const backup of backups.reverse()) {
      try {
        if (await pathExists(backup.backupPath, dependencies)) {
          await (dependencies.rename ?? rename)(backup.backupPath, backup.targetPath);
        }
      } catch {
        // Try every rollback path; the original install error is the actionable failure.
      }
    }
    try {
      await cleanupPaths(installedWithoutBackup, dependencies);
    } catch {
      // Preserve the original install failure.
    }
    throw error;
  }
  await cleanupPaths(backups.map((backup) => backup.backupPath), dependencies);
}

function tempConfigPath(path, kind, index) {
  return `${path}.${kind}-${process.pid}-${Date.now()}-${index}`;
}

async function pathExists(path, dependencies) {
  try {
    await (dependencies.lstat ?? lstat)(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function cleanupPaths(paths, dependencies) {
  for (const path of paths) {
    try {
      await (dependencies.unlink ?? unlink)(path);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }
}

function parsePrivateKey(value, envName) {
  if (typeof value !== "string") {
    throw new Error(`Missing env ${envName}`);
  }
  if (!/^0x[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`Invalid env ${envName}`);
  }
  const key = BigInt(value);
  if (key <= 0n || key >= SECP256K1_ORDER) {
    throw new Error(`Invalid env ${envName}`);
  }
  return value;
}

function parseOptionalPositiveInteger(value, envName) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid env ${envName}`);
  }
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`Invalid env ${envName}`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER) {
    throw new Error(`Invalid env ${envName}: expected a safe integer`);
  }
  return Number(parsed);
}

function parseOptionalRpcUrl(value, envName) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid env ${envName}`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (/\s/u.test(value[index] ?? "") || code < 0x20 || code === 0x7f) {
      throw new Error(`Invalid env ${envName}`);
    }
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid env ${envName}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid env ${envName}`);
  }
  return value;
}

async function assertNoExistingTargets(paths, dependencies) {
  for (const path of paths) {
    try {
      await (dependencies.lstat ?? lstat)(path);
      throw new Error("Config already exists; rerun with --force to overwrite");
    } catch (error) {
      if (isNotFoundError(error)) {
        continue;
      }
      throw error;
    }
  }
}

function isNotFoundError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function outputPath(originalRoot, resolvedRoot, out) {
  const absolutePath = isAbsolute(out) ? out : resolve(resolvedRoot, out);
  const relativePath = relative(resolvedRoot, absolutePath);
  if (isInsideRelativePath(relativePath)) {
    return { absolutePath, relativePath };
  }
  if (isAbsolute(out)) {
    const originalRelativePath = relative(originalRoot, out);
    if (isInsideRelativePath(originalRelativePath)) {
      return {
        absolutePath: resolve(resolvedRoot, originalRelativePath),
        relativePath: originalRelativePath,
      };
    }
  }
  throw new Error("Output path must stay inside the repo");
}

function isInsideRelativePath(relativePath) {
  return !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

async function writeConfigFile(path, text, force, dependencies) {
  if (dependencies.writeFile !== undefined) {
    await dependencies.writeFile(path, text, { flag: force ? "w" : "wx", mode: 0o600 });
    return;
  }
  await assertNoSymlinkTarget(path, dependencies);
  await assertRealParent(path, dependencies);
  const flags = constants.O_WRONLY |
    constants.O_CREAT |
    constants.O_NOFOLLOW |
    (force ? constants.O_TRUNC : constants.O_EXCL);
  const handle = await (dependencies.open ?? open)(path, flags, 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
}

async function makeSafeParentDir(path, root, dependencies) {
  const parent = dirname(path);
  await assertRealAncestor(root, dependencies);
  const missing = [];
  let current = parent;
  for (;;) {
    try {
      await assertRealAncestor(current, dependencies);
      break;
    } catch (error) {
      if (isNotFoundError(error)) {
        missing.push(current);
        const next = dirname(current);
        if (next === current) {
          throw error;
        }
        current = next;
        continue;
      }
      throw error;
    }
  }
  for (const dir of missing.reverse()) {
    await (dependencies.mkdir ?? mkdir)(dir, { mode: 0o700 });
    await assertRealAncestor(dir, dependencies);
  }
}

async function assertRealAncestor(path, dependencies) {
  const stat = await (dependencies.lstat ?? lstat)(path);
  if (stat.isSymbolicLink()) {
    throw new Error("Refusing to write config through symlinked parent directory");
  }
}

async function assertNoSymlinkTarget(path, dependencies) {
  try {
    const stat = await (dependencies.lstat ?? lstat)(path);
    if (stat.isSymbolicLink()) {
      throw new Error("Refusing to write through symlink config path");
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }
    throw error;
  }
}

async function assertRealParent(path, dependencies) {
  const parent = dirname(path);
  await assertRealAncestor(parent, dependencies);
  const resolvedParent = await (dependencies.realpath ?? realpath)(parent);
  if (resolvedParent !== parent) {
    throw new Error("Refusing to write config through symlinked parent directory");
  }
}

function assertIgnoredPath(root, relativePath, checkIgnored = defaultCheckIgnored) {
  if (!checkIgnored(root, relativePath)) {
    throw new Error(`Refusing to write non-ignored config path: ${relativePath}`);
  }
}

export async function main(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const result = await runLiveConfigFromEnv({ argv });
    if (result.help !== undefined) {
      stdout.write(`${result.help}\n`);
      return 0;
    }
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    stderr.write(`Live config rebuild failed: ${message}\n${usage()}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main(process.argv.slice(2)));
}
