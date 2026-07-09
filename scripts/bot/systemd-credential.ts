#!/usr/bin/env node
import fs from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stderr as promptOutput } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import { parseRuntimeConfig } from "../../packages/node-utils/src/index.ts";
import {
  type Network,
  type OutputStream,
  isNetwork,
  isRecord,
  publicErrorMessage,
  requireCommand,
  requireNode22_19,
  requireRoot,
  requireSuccessfulCommand,
} from "./systemd-support.ts";
import { credentialConfigName, credentialPath } from "./systemd-install.ts";

export interface BotSystemdCredentialOptions {
  argv?: string[];
  repoRoot?: string;
  stdout?: OutputStream;
}

export interface ParsedCredentialArgs {
  force: boolean;
  network: Network;
}

const invalidConfigMessage =
  "Invalid bot config: expected exact JSON with matching chain, privateKey, optional rpcUrl, sleepIntervalSeconds, optional maxIterations, and optional maxRetryableAttempts.";
const credentialDirectory = "/etc/ickb/credentials";
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export function usage(scriptName = "ickb-bot-systemd-credential.sh"): string {
  return `Usage: ${scriptName} <testnet|mainnet> [--force]`;
}

export function parseCredentialArgs(argv: readonly string[]): ParsedCredentialArgs | "help" {
  const [network, force, extra] = argv;
  if (network === "-h" || network === "--help") {
    return "help";
  }
  if (extra !== undefined || network === undefined || !isNetwork(network)) {
    throw new Error(usage());
  }
  if (force !== undefined && force !== "--force") {
    throw new Error(usage());
  }
  return { force: force === "--force", network };
}

export async function runSystemdCredential({
  argv = process.argv.slice(2),
  repoRoot: root = repoRoot,
  stdout = process.stdout,
}: BotSystemdCredentialOptions = {}): Promise<void> {
  requireRoot();
  const parsed = parseCredentialArgs(argv);
  if (parsed === "help") {
    stdout.write(`${usage()}\n`);
    return;
  }

  requireCredentialRuntime(root);
  if (!fs.existsSync("/var/lib/systemd/credential.secret")) {
    requireSuccessfulCommand("systemd-creds", ["setup"], { stdio: "inherit" });
  }

  const credential = credentialPath(parsed.network);
  if (fs.existsSync(credential) && !parsed.force) {
    throw new Error(`${credential} already exists; rerun with --force to rotate it.`);
  }

  await mkdir(credentialDirectory, { mode: 0o700, recursive: true });
  fs.chmodSync(credentialDirectory, 0o700);
  const tmp = await makeTemporaryCredentialPath(parsed.network);
  try {
    const config = await promptCredentialConfig(parsed.network);
    const validated = validateCredentialConfig(parsed.network, config);
    encryptCredential(credentialConfigName(parsed.network), validated, tmp);
    await copyFile(tmp, credential);
    fs.chmodSync(credential, 0o600);
    const decrypted = decryptCredential(credentialConfigName(parsed.network), credential);
    validateCredentialConfig(parsed.network, decrypted);
    stdout.write(`Wrote encrypted credential ${credential}\n`);
  } finally {
    await rm(path.dirname(tmp), { force: true, recursive: true });
  }
}

export async function main(
  argv: string[] = process.argv.slice(2),
  io: { stderr?: OutputStream; stdout?: OutputStream } = {},
): Promise<number> {
  const stderr = io.stderr ?? process.stderr;
  try {
    await runSystemdCredential({ argv, stdout: io.stdout });
    return 0;
  } catch (error) {
    stderr.write(`${publicErrorMessage(error)}\n`);
    return 1;
  }
}

export function validateCredentialConfig(
  expectedChain: Network,
  text: string,
): string {
  try {
    parseRuntimeConfig(text, "BOT_CONFIG_FILE");
    const config: unknown = JSON.parse(text);
    if (!isRecord(config) || config["chain"] !== expectedChain) {
      throw new Error("chain mismatch");
    }
    return JSON.stringify(config);
  } catch {
    throw new Error(invalidConfigMessage);
  }
}

function requireCredentialRuntime(root: string): void {
  requireCommand("systemd-creds", "systemd-creds is required.");
  requireCommand("systemd-ask-password", "systemd-ask-password is required.");
  const node = requireCommand(
    "node",
    "node >=22.19.0 is required to validate the config before encrypting.",
  );
  requireNode22_19(node, "to validate TypeScript source configs");
  if (!fs.existsSync(path.join(root, "packages/node-utils/src/index.ts"))) {
    throw new Error(`Missing @ickb/node-utils source in ${root}.`);
  }
}

async function promptCredentialConfig(network: Network): Promise<string> {
  const privateKey = askPassword(`iCKB ${network} bot private key:`);
  const rpcUrl = askPassword(`iCKB ${network} RPC URL [empty for CCC default]:`);
  const readline = createInterface({ input, output: promptOutput });
  try {
    const sleepIntervalSeconds = await questionDefault(
      readline,
      `iCKB ${network} bot sleep interval seconds [60]: `,
      "60",
    );
    const maxIterations = await readline.question(
      `iCKB ${network} bot max iterations [empty for unbounded]: `,
    );
    const maxRetryableAttempts = await readline.question(
      `iCKB ${network} bot max retryable attempts [empty for unbounded]: `,
    );
    return JSON.stringify(
      configFromPrompt({
        maxIterations,
        maxRetryableAttempts,
        network,
        privateKey,
        rpcUrl,
        sleepIntervalSeconds,
      }),
    );
  } finally {
    readline.close();
  }
}

function configFromPrompt(inputConfig: {
  maxIterations: string;
  maxRetryableAttempts: string;
  network: Network;
  privateKey: string;
  rpcUrl: string;
  sleepIntervalSeconds: string;
}): Record<string, string | number> {
  const config: Record<string, string | number> = {
    chain: inputConfig.network,
    privateKey: inputConfig.privateKey,
    sleepIntervalSeconds: Number(inputConfig.sleepIntervalSeconds),
  };
  if (inputConfig.rpcUrl !== "") {
    config["rpcUrl"] = inputConfig.rpcUrl;
  }
  if (inputConfig.maxIterations !== "") {
    config["maxIterations"] = Number(inputConfig.maxIterations);
  }
  if (inputConfig.maxRetryableAttempts !== "") {
    config["maxRetryableAttempts"] = Number(inputConfig.maxRetryableAttempts);
  }
  return config;
}

function askPassword(prompt: string): string {
  const result = requireSuccessfulCommand("systemd-ask-password", ["-n", prompt]);
  return result.stdout.replace(/[\r\n]+$/u, "");
}

async function questionDefault(
  readline: ReturnType<typeof createInterface>,
  prompt: string,
  defaultValue: string,
): Promise<string> {
  const answer = await readline.question(prompt);
  return answer === "" ? defaultValue : answer;
}

function encryptCredential(name: string, text: string, outputPath: string): void {
  requireSuccessfulCommand(
    "systemd-creds",
    ["encrypt", "--with-key=host", `--name=${name}`, "-", outputPath],
    { input: text },
  );
}

function decryptCredential(name: string, credential: string): string {
  return requireSuccessfulCommand("systemd-creds", ["decrypt", `--name=${name}`, credential])
    .stdout;
}

async function makeTemporaryCredentialPath(network: Network): Promise<string> {
  const directory = await fs.promises.mkdtemp(
    path.join(credentialDirectory, `.bot-${network}.`),
  );
  return path.join(directory, "credential.tmp");
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  process.exit(await main());
}
