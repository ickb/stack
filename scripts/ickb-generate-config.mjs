#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultCheckIgnored } from "./ickb-live-config-git.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const SECP256K1_ORDER = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const DEFAULT_RPC_URLS = {
  mainnet: "https://mainnet.ckb.dev/",
  testnet: "https://testnet.ckb.dev/",
};
const ROLE_PATTERN = /^[a-z](?:[a-z0-9_-]{0,30}[a-z0-9])?$/u;

export function parseArgs(argv) {
  const args = {
    chain: "testnet",
    role: "bot",
    sleepIntervalSeconds: 1,
    maxIterations: 1,
    maxRetryableAttempts: 10,
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      args.help = true;
      continue;
    }
    if (arg === "--chain") {
      args.chain = parseChain(valueAfter(argv, ++index, arg));
      continue;
    }
    if (arg === "--role") {
      args.role = parseRole(valueAfter(argv, ++index, arg));
      continue;
    }
    if (arg === "--out") {
      args.out = valueAfter(argv, ++index, arg);
      continue;
    }
    if (arg === "--rpc-url") {
      args.rpcUrl = parseRpcUrl(valueAfter(argv, ++index, arg));
      continue;
    }
    if (arg === "--sleep-interval-seconds") {
      args.sleepIntervalSeconds = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    if (arg === "--max-iterations") {
      args.maxIterations = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    if (arg === "--max-retryable-attempts") {
      args.maxRetryableAttempts = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    if (arg === "--no-max-retryable-attempts") {
      args.maxRetryableAttempts = undefined;
      continue;
    }
    if (arg === "--no-max-iterations") {
      args.maxIterations = undefined;
      continue;
    }
    if (arg === "--force") {
      args.force = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  args.rpcUrl ??= DEFAULT_RPC_URLS[args.chain];
  args.out ??= `config/${args.role}-${args.chain}.json`;
  return args;
}

export function usage() {
  return [
    "Usage: node scripts/ickb-generate-config.mjs [--chain testnet|mainnet] [--role <label>] [--out <ignored-json-config>] [--rpc-url <url>] [--sleep-interval-seconds <n>] [--max-iterations <n>|--no-max-iterations] [--max-retryable-attempts <n>|--no-max-retryable-attempts] [--force]",
    "Defaults: --chain testnet --role bot --out config/<role>-<chain>.json --sleep-interval-seconds 1 --max-iterations 1 --max-retryable-attempts 10",
  ].join("\n");
}

export function generateSecp256k1PrivateKey(readRandomBytes = randomBytes) {
  for (;;) {
    const candidate = readRandomBytes(32);
    if (candidate.length !== 32) {
      throw new Error("Random byte source must return exactly 32 bytes");
    }
    const hex = candidate.toString("hex");
    const value = BigInt(`0x${hex}`);
    if (value > 0n && value < SECP256K1_ORDER) {
      return `0x${hex}`;
    }
  }
}

export function buildRuntimeConfig({
  chain,
  privateKey,
  rpcUrl,
  sleepIntervalSeconds,
  maxIterations,
  maxRetryableAttempts,
}) {
  return {
    chain,
    privateKey,
    rpcUrl,
    sleepIntervalSeconds,
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(maxRetryableAttempts === undefined ? {} : { maxRetryableAttempts }),
  };
}

export async function runGenerateConfig({ argv, root = rootDir, dependencies = {} }) {
  const args = parseArgs(argv);
  if (args.help) {
    return { help: usage() };
  }
  const originalRoot = resolve(root);
  const resolvedRoot = await (dependencies.realpath ?? realpath)(originalRoot);

  const privateKey = generateSecp256k1PrivateKey(dependencies.randomBytes ?? randomBytes);
  const config = buildRuntimeConfig({ ...args, privateKey });
  const output = outputPath(originalRoot, resolvedRoot, args.out);
  assertIgnoredPath(resolvedRoot, output.relativePath, dependencies.checkIgnored);
  await makeSafeParentDir(output.absolutePath, resolvedRoot, dependencies);
  await writeStagedConfigFile(output.absolutePath, `${JSON.stringify(config)}\n`, args.force, dependencies);

  return {
    outputPath: output.relativePath,
    role: args.role,
    chain: args.chain,
    rpcConfigured: args.rpcUrl !== undefined,
    sleepIntervalSeconds: args.sleepIntervalSeconds,
    maxIterations: args.maxIterations,
    maxRetryableAttempts: args.maxRetryableAttempts,
    privateKey: "<written-to-config-file>",
  };
}

export async function main(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const result = await runGenerateConfig({ argv });
    if (result.help !== undefined) {
      stdout.write(`${result.help}\n`);
      return 0;
    }
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    stderr.write(`Config generation failed: ${message}\n${usage()}\n`);
    return 1;
  }
}

function valueAfter(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseChain(value) {
  if (value !== "mainnet" && value !== "testnet") {
    throw new Error("Invalid --chain: expected mainnet or testnet");
  }
  return value;
}

function parseRole(value) {
  if (!ROLE_PATTERN.test(value)) {
    throw new Error(
      "Invalid --role: expected 1-32 lowercase letters, numbers, hyphens, or underscores without trailing separators",
    );
  }
  return value;
}

function parsePositiveInteger(value, flag) {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`Invalid ${flag}: expected a positive integer`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER) {
    throw new Error(`Invalid ${flag}: expected a safe integer`);
  }
  return Number(parsed);
}

function parseRpcUrl(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (/\s/u.test(value[index] ?? "") || code < 0x20 || code === 0x7f) {
      throw new Error("Invalid --rpc-url: expected http(s) URL");
    }
  }
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Invalid --rpc-url: expected http(s) URL");
  }
  return value;
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

async function writeStagedConfigFile(path, text, force, dependencies) {
  const tempPath = tempConfigPath(path);
  let caught;
  try {
    await writeConfigFile(tempPath, text, false, dependencies);
    await installStagedConfig(tempPath, path, force, dependencies);
  } catch (error) {
    caught = error;
  }
  try {
    await cleanupPath(tempPath, dependencies);
  } catch (error) {
    if (caught === undefined) {
      throw error;
    }
  }
  if (caught !== undefined) {
    throw caught;
  }
}

function tempConfigPath(path) {
  return `${path}.tmp-${process.pid}-${Date.now()}`;
}

async function installStagedConfig(tempPath, targetPath, force, dependencies) {
  await assertNoSymlinkTarget(targetPath, dependencies);
  if (force) {
    await (dependencies.rename ?? rename)(tempPath, targetPath);
    return;
  }
  try {
    await (dependencies.link ?? link)(tempPath, targetPath);
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new Error("Config already exists; rerun with --force to overwrite", { cause: error });
    }
    throw error;
  }
}

async function cleanupPath(path, dependencies) {
  try {
    await (dependencies.unlink ?? unlink)(path);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
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

function isNotFoundError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isAlreadyExistsError(error) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main(process.argv.slice(2)));
}
