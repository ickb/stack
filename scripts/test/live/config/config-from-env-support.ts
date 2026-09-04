import assert from "node:assert/strict";
import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  stat as fsStat,
  symlink as fsSymlink,
} from "node:fs/promises";
import path from "node:path";
import { runLiveConfigFromEnv } from "../../../live/config/config-from-env.ts";

const { join } = path;

export const botPrivateKeyEnv = "ICKB_TESTNET_BOT_PRIVATE_KEY";
export const testerPrivateKeyEnv = "ICKB_TESTNET_TESTER_PRIVATE_KEY";
export const rpcUrlEnv = "ICKB_TESTNET_RPC_URL";
export const botPrivateKey = `0x${"11".repeat(32)}`;
export const testerPrivateKey = `0x${"22".repeat(32)}`;
export const configDir = "config";
export const botConfigFile = "bot-testnet.json";
export const testerConfigFile = "tester-testnet.json";
export const botConfigPath = `config/${botConfigFile}`;
export const testerConfigPath = `config/${testerConfigFile}`;
export const tempPrefix = "ickb-live-config-env-";
export const rootTempPrefix = "ickb-live-config-env-root-";
export const testnetChain = "testnet";
export const configFileMode = 0o600;
export const testnetRpcUrl = "https://testnet.example/path?token=secret";
export const configSecretPattern = /0x11|0x22/u;
export const rpcSecretPattern = /0x11|0x22|token=secret/u;

const configPathPrefix = `${configDir}/`;
const privateKeyPlaceholder = "<written-to-config-file>";

type RunOptions = Parameters<typeof runLiveConfigFromEnv>[0];
export type LiveConfigDependencies = NonNullable<RunOptions["dependencies"]>;
export type LiveConfigEnv = NonNullable<RunOptions["env"]>;
export type LiveConfigResult = Awaited<ReturnType<typeof runLiveConfigFromEnv>>;

interface ExpectedConfig {
  chain: "testnet";
  privateKey: string;
  rpcUrl: string;
}

type ConfigJson = Record<string, boolean | number | string>;

interface ExpectedWrittenConfig {
  chain: "testnet";
  outputPath: string;
  privateKey: string;
  role: string;
  rpcConfigured: boolean;
}

export async function runLiveConfig(
  root: string,
  options: {
    argv?: readonly string[];
    dependencies?: LiveConfigDependencies;
    env?: LiveConfigEnv;
  } = {},
): Promise<LiveConfigResult> {
  return runLiveConfigFromEnv({
    argv: options.argv ?? [],
    root,
    env: options.env ?? liveEnv(),
    dependencies: options.dependencies ?? { checkIgnored: alwaysIgnored },
  });
}

export function liveEnv(overrides: LiveConfigEnv = {}): LiveConfigEnv {
  return {
    [botPrivateKeyEnv]: botPrivateKey,
    [testerPrivateKeyEnv]: testerPrivateKey,
    [rpcUrlEnv]: testnetRpcUrl,
    ...overrides,
  };
}

export function expectedConfig(
  privateKey: string,
  rpcUrl = testnetRpcUrl,
): ExpectedConfig {
  return { chain: testnetChain, privateKey, rpcUrl };
}

export function expectedWritten(role: string, outputPath: string): ExpectedWrittenConfig {
  return {
    role,
    outputPath,
    chain: testnetChain,
    rpcConfigured: true,
    privateKey: privateKeyPlaceholder,
  };
}

export function hasMessage(expected: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert(error instanceof Error);
    assert.equal(error.message, expected);
    return true;
  };
}

export function checkConfigIgnored(_root: string, relativePath: string): boolean {
  return relativePath.startsWith(configPathPrefix);
}

function alwaysIgnored(): boolean {
  return true;
}

export function neverIgnored(): boolean {
  return false;
}

export function absoluteConfigPath(root: string, fileName: string): string {
  return join(root, configDir, fileName);
}

export async function readJson(filePath: string): Promise<ConfigJson> {
  const parsed: unknown = JSON.parse(await readText(filePath));
  return parseConfigJson(parsed);
}

export function jsonText(value: unknown): string {
  const text = JSON.stringify(value);
  assert.equal(typeof text, "string");
  return text;
}

export async function modeOf(filePath: string): Promise<number> {
  const fileStat = await fsStat(filePath);
  return fileStat.mode & 0o777;
}

export async function makeDirectory(directory: string): Promise<void> {
  await fsMkdir(directory);
}

export async function linkSymbolic(target: string, linkPath: string): Promise<void> {
  await fsSymlink(target, linkPath, "dir");
}

async function readText(filePath: string): Promise<string> {
  return fsReadFile(filePath, "utf8");
}

function parseConfigJson(value: unknown): ConfigJson {
  if (isConfigJson(value)) {
    return value;
  }
  throw new Error("Expected config JSON object");
}

function isConfigJson(value: unknown): value is ConfigJson {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every(
      (entry) =>
        typeof entry === "boolean" ||
        typeof entry === "number" ||
        typeof entry === "string",
    )
  );
}
