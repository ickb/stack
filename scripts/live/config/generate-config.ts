import { randomBytes } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRuntimeConfig,
  generateSecp256k1PrivateKey,
  type IckbChain,
  parseArgs,
  type RandomBytes,
  usage,
} from "./generate-config-args.ts";
import {
  assertIgnoredPath,
  type ConfigFileDependencies,
  makeSafeParentDir,
  outputPath,
  writeStagedConfigFile,
} from "./generate-config-files.ts";

export { buildRuntimeConfig, generateSecp256k1PrivateKey, parseArgs, usage };

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
const { resolve } = path;

interface WritableLike {
  write: (chunk: string) => unknown;
}

interface GenerateConfigIo {
  stderr?: WritableLike;
  stdout?: WritableLike;
}

type GenerateConfigDependencies = ConfigFileDependencies & {
  checkIgnored?: (root: string, relativePath: string) => boolean;
  randomBytes?: RandomBytes;
};

interface GenerateConfigRunOptions {
  argv: readonly string[];
  dependencies?: GenerateConfigDependencies;
  root?: string;
}

interface GenerateConfigSuccess {
  chain: IckbChain;
  maxIterations?: number;
  maxRetryableAttempts?: number;
  outputPath: string;
  privateKey: string;
  role: string;
  rpcConfigured: boolean;
  sleepIntervalSeconds: number;
}

type GenerateConfigResult = { help: string } | GenerateConfigSuccess;

export async function main(
  argv: readonly string[],
  io: GenerateConfigIo = {},
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const result = await runGenerateConfig({ argv });
    if ("help" in result) {
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

export async function runGenerateConfig({
  argv,
  root = rootDir,
  dependencies = {},
}: GenerateConfigRunOptions): Promise<GenerateConfigResult> {
  const args = parseArgs(argv);
  if (args.help) {
    return { help: usage() };
  }
  const originalRoot = resolve(root);
  const resolvedRoot = await (dependencies.realpath ?? realpath)(originalRoot);
  const rpcUrl = args.rpcUrl;
  if (rpcUrl === undefined) {
    throw new Error("Missing required --rpc-url");
  }

  const privateKey = generateSecp256k1PrivateKey(dependencies.randomBytes ?? randomBytes);
  const config = buildRuntimeConfig({ ...args, privateKey, rpcUrl });
  const output = outputPath(originalRoot, resolvedRoot, args.out);
  assertIgnoredPath(resolvedRoot, output.relativePath, dependencies.checkIgnored);
  await makeSafeParentDir(output.absolutePath, resolvedRoot, dependencies);
  await writeStagedConfigFile(
    output.absolutePath,
    `${JSON.stringify(config)}\n`,
    args.force,
    dependencies,
  );

  return {
    outputPath: output.relativePath,
    role: args.role,
    chain: args.chain,
    rpcConfigured: true,
    sleepIntervalSeconds: args.sleepIntervalSeconds,
    maxIterations: args.maxIterations,
    maxRetryableAttempts: args.maxRetryableAttempts,
    privateKey: "<written-to-config-file>",
  };
}
