import { link, lstat, realpath, rename } from "node:fs/promises";
import pathModule from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertIgnoredPath,
  assertNoSymlinkTarget,
  cleanupPath,
  type ConfigFileDependencies,
  type ConfigPath,
  isNotFoundError,
  makeSafeParentDir,
  outputPath,
  tempConfigPath,
  writeConfigFile,
} from "./generate-config-files.ts";
import type { CheckIgnored } from "./git.ts";

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
const { resolve } = pathModule;
const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const OUTPUTS: readonly LiveConfigOutput[] = [
  { role: "bot", envName: "ICKB_TESTNET_BOT_PRIVATE_KEY", out: "config/bot-testnet.json" },
  {
    role: "tester",
    envName: "ICKB_TESTNET_TESTER_PRIVATE_KEY",
    out: "config/tester-testnet.json",
  },
];

interface LiveConfigArgs {
  force: boolean;
  help?: true;
}

type LiveConfigEnv = Record<string, string | undefined>;

interface LiveConfigOutput {
  envName: "ICKB_TESTNET_BOT_PRIVATE_KEY" | "ICKB_TESTNET_TESTER_PRIVATE_KEY";
  out: string;
  role: string;
}

interface RuntimeConfigInput {
  privateKey: string;
  rpcUrl: string;
}

type RuntimeConfig = RuntimeConfigInput & { chain: "testnet" };

interface StagedConfig {
  target: ConfigPath;
  tempPath: string;
}

type LiveConfigDependencies = ConfigFileDependencies & {
  checkIgnored?: CheckIgnored;
};

interface LiveConfigRunOptions {
  argv: readonly string[];
  dependencies?: LiveConfigDependencies;
  env?: LiveConfigEnv;
  root?: string;
}

interface WrittenConfig {
  chain: "testnet";
  outputPath: string;
  privateKey: string;
  role: string;
  rpcConfigured: boolean;
}

type LiveConfigResult = { help: string } | { written: WrittenConfig[] };

export function parseArgs(argv: readonly string[]): LiveConfigArgs {
  const args: LiveConfigArgs = { force: false };
  for (const arg of argv) {
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

export function usage(): string {
  return [
    "Usage: node scripts/live/config-from-env.ts [--force]",
    "Required env: ICKB_TESTNET_BOT_PRIVATE_KEY, ICKB_TESTNET_TESTER_PRIVATE_KEY, ICKB_TESTNET_RPC_URL",
    "Writes ignored config/bot-testnet.json and config/tester-testnet.json without printing secrets. The RPC URL is used exclusively without fallbacks.",
  ].join("\n");
}

export async function runLiveConfigFromEnv({
  argv,
  env = process.env,
  root = rootDir,
  dependencies = {},
}: LiveConfigRunOptions): Promise<LiveConfigResult> {
  const args = parseArgs(argv);
  if (args.help) {
    return { help: usage() };
  }
  const originalRoot = resolve(root);
  const resolvedRoot = await (dependencies.realpath ?? realpath)(originalRoot);
  const rpcUrl = parseRequiredRpcUrl(env["ICKB_TESTNET_RPC_URL"], "ICKB_TESTNET_RPC_URL");
  const outputs = resolveLiveConfigOutputs(originalRoot, resolvedRoot, env, dependencies);
  if (!args.force) {
    await assertNoExistingTargets(
      outputs.map((output) => output.target.absolutePath),
      dependencies,
    );
  }

  for (const output of outputs) {
    await makeSafeParentDir(output.target.absolutePath, resolvedRoot, dependencies);
  }

  const staged: StagedConfig[] = [];
  let caught: unknown;
  try {
    for (const [index, output] of outputs.entries()) {
      const config = buildRuntimeConfig({ privateKey: output.privateKey, rpcUrl });
      const tempPath = tempConfigPath(output.target.absolutePath, "tmp", index);
      staged.push({ target: output.target, tempPath });
      await writeConfigFile(tempPath, `${JSON.stringify(config)}\n`, false, dependencies);
    }
    await commitStagedConfigs(staged, args.force, dependencies);
  } catch (error) {
    caught = error;
  }
  try {
    await cleanupPaths(
      staged.map((output) => output.tempPath),
      dependencies,
    );
  } catch (error) {
    if (caught === undefined) {
      throw error;
    }
  }
  if (caught !== undefined) {
    throwAsError(caught, "Live config rebuild failed");
  }

  return {
    written: outputs.map((output) => ({
      role: output.role,
      outputPath: output.target.relativePath,
      chain: "testnet",
      rpcConfigured: true,
      privateKey: "<written-to-config-file>",
    })),
  };
}

function resolveLiveConfigOutputs(
  originalRoot: string,
  resolvedRoot: string,
  env: LiveConfigEnv,
  dependencies: LiveConfigDependencies,
): Array<LiveConfigOutput & { privateKey: string; target: ConfigPath }> {
  // BEFORE EDITING, STOP AND PROVE, LOCAL SAFETY IS NOT ENOUGH:
  // - OWNER: secret purpose boundary.
  // - INVARIANT: private keys pass through only to signer config files.
  // - FAILURE MODE: production checks that compare, log, redact, or otherwise consume private keys break signing-only purpose.
  const outputs = OUTPUTS.map((output) => ({
    ...output,
    privateKey: parsePrivateKey(env[output.envName], output.envName),
    target: outputPath(originalRoot, resolvedRoot, output.out),
  }));
  for (const output of outputs) {
    assertIgnoredPath(
      resolvedRoot,
      output.target.relativePath,
      dependencies.checkIgnored,
    );
  }
  return outputs;
}

export function buildRuntimeConfig({ privateKey, rpcUrl }: RuntimeConfigInput): RuntimeConfig {
  return { chain: "testnet", privateKey, rpcUrl };
}

async function commitStagedConfigs(
  staged: readonly StagedConfig[],
  force: boolean,
  dependencies: LiveConfigDependencies,
): Promise<void> {
  for (const output of staged) {
    await assertNoSymlinkTarget(output.target.absolutePath, dependencies);
  }
  if (force) {
    await replaceStagedConfigs(staged, dependencies);
    return;
  }
  await createStagedConfigs(staged, dependencies);
}

async function createStagedConfigs(
  staged: readonly StagedConfig[],
  dependencies: LiveConfigDependencies,
): Promise<void> {
  const linked: string[] = [];
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

async function replaceStagedConfigs(
  staged: readonly StagedConfig[],
  dependencies: LiveConfigDependencies,
): Promise<void> {
  const backups: Array<{ backupPath: string; targetPath: string }> = [];
  const installedWithoutBackup: string[] = [];
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
    await restoreBackups(backups, dependencies);
    await cleanupIgnoringErrors(installedWithoutBackup, dependencies);
    throw error;
  }
  await cleanupPaths(
    backups.map((backup) => backup.backupPath),
    dependencies,
  );
}

async function restoreBackups(
  backups: ReadonlyArray<{ backupPath: string; targetPath: string }>,
  dependencies: LiveConfigDependencies,
): Promise<void> {
  for (const backup of backups.toReversed()) {
    await restoreBackupIfPresent(backup, dependencies);
  }
}

async function restoreBackupIfPresent(
  backup: { backupPath: string; targetPath: string },
  dependencies: LiveConfigDependencies,
): Promise<void> {
  try {
    if (await pathExists(backup.backupPath, dependencies)) {
      await (dependencies.rename ?? rename)(backup.backupPath, backup.targetPath);
    }
  } catch {
    // Try every rollback path; the original install error is the actionable failure.
  }
}

async function cleanupIgnoringErrors(
  filePaths: readonly string[],
  dependencies: LiveConfigDependencies,
): Promise<void> {
  try {
    await cleanupPaths(filePaths, dependencies);
  } catch {
    // Preserve the original install failure.
  }
}

async function pathExists(
  filePath: string,
  dependencies: LiveConfigDependencies,
): Promise<boolean> {
  try {
    await (dependencies.lstat ?? lstat)(filePath);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function cleanupPaths(
  filePaths: readonly string[],
  dependencies: LiveConfigDependencies,
): Promise<void> {
  for (const filePath of filePaths) {
    await cleanupPath(filePath, dependencies);
  }
}

function parsePrivateKey(value: string | undefined, envName: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Missing env ${envName}`);
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

function parseRequiredRpcUrl(value: string | undefined, envName: string): string {
  if (value === undefined) {
    throw new TypeError(`Missing env ${envName}`);
  }
  if (typeof value !== "string") {
    throw new TypeError(`Invalid env ${envName}`);
  }
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined || char.trim() === "" || code < 0x20 || code === 0x7f) {
      throw new Error(`Invalid env ${envName}`);
    }
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid env ${envName}`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error(`Invalid env ${envName}`);
  }
  return value;
}

async function assertNoExistingTargets(
  filePaths: readonly string[],
  dependencies: LiveConfigDependencies,
): Promise<void> {
  for (const filePath of filePaths) {
    try {
      await (dependencies.lstat ?? lstat)(filePath);
      throw new Error("Config already exists; rerun with --force to overwrite");
    } catch (error) {
      if (isNotFoundError(error)) {
        continue;
      }
      throw error;
    }
  }
}

interface WritableLike {
  write: (chunk: string) => unknown;
}

interface LiveConfigIo {
  stderr?: WritableLike;
  stdout?: WritableLike;
}

function throwAsError(caught: unknown, message: string): never {
  if (caught instanceof Error) {
    throw caught;
  }
  throw new Error(message, { cause: caught });
}

export async function main(
  argv: readonly string[],
  io: LiveConfigIo = {},
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const result = await runLiveConfigFromEnv({ argv });
    if ("help" in result) {
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
