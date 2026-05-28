#!/usr/bin/env node
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultCheckIgnored } from "./ickb-live-config-git.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const ROLE_PATTERN = /^[a-z](?:[a-z0-9_-]{0,30}[a-z0-9])?$/u;
const CKB = 100000000n;
const BOT_CKB_RESERVE = 1000n * CKB;
const TESTER_CKB_RESERVE = 2000n * CKB;

export function parseArgs(argv) {
  const args = { role: "preflight" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      args.help = true;
      continue;
    }
    if (arg === "--config") {
      args.configPath = valueAfter(argv, ++index, arg);
      continue;
    }
    if (arg === "--role") {
      args.role = parseRole(valueAfter(argv, ++index, arg));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.help && !args.configPath) {
    throw new Error("Missing required --config <path>");
  }

  return args;
}

export function usage() {
  return "Usage: node scripts/ickb-live-preflight.mjs --config <ignored-json-config> [--role <label>]";
}

export function publicScript(script) {
  return {
    codeHash: script.codeHash,
    hashType: script.hashType,
    args: script.args,
  };
}

export function publicErrorMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

export function isPublicChainIdentityError(error) {
  return error instanceof Error && (
    error.message.includes("Missing") && error.message.includes("genesis header") ||
    error.message.includes("Invalid") && error.message.includes("chain identity")
  );
}

export function ckbReserveForRole(role) {
  if (!ROLE_PATTERN.test(role)) {
    throw new Error(
      "Invalid role: expected 1-32 lowercase letters, numbers, hyphens, or underscores without trailing separators",
    );
  }
  return role === "tester" || role.startsWith("tester-") || role.startsWith("tester_")
    ? TESTER_CKB_RESERVE
    : BOT_CKB_RESERVE;
}

export async function runPreflight({ configPath, role, root = rootDir, dependencies }) {
  const originalRoot = resolve(root);
  const resolvedRoot = await (dependencies?.realpath ?? realpath)(originalRoot);
  const config = resolveConfigPath(originalRoot, resolvedRoot, configPath, dependencies?.checkIgnored);
  await assertReadableConfigPath(resolvedRoot, config.absolutePath, dependencies);
  const configText = await readFile(config.absolutePath, "utf8");
  const { nodeUtils } = dependencies ?? await loadBuiltNodeUtils(root);
  let runtimeConfig;
  try {
    runtimeConfig = nodeUtils.parseRuntimeConfig(configText, "LIVE_PREFLIGHT_CONFIG_FILE");
  } catch (cause) {
    throw new Error(
      "Invalid live preflight config: expected exact JSON with chain, privateKey, optional rpcUrl, sleepIntervalSeconds, optional maxIterations, and optional maxRetryableAttempts",
      { cause },
    );
  }

  const {
    ccc,
    sdk: sdkModule,
    core,
  } = dependencies ?? await loadBuiltStack(root);

  try {
    return await buildPreflightReport({
      runtimeConfig,
      role,
      nodeUtils,
      ccc,
      sdk: sdkModule,
      core,
    });
  } catch (error) {
    const retryable = nodeUtils.isRetryableRpcTransportError?.(error) === true;
    const preflightError = new Error(
      retryable
        ? "fetch failed"
        : isPublicChainIdentityError(error)
          ? error.message
          : "Live preflight failed",
    );
    if (retryable) {
      preflightError.name = "RetryablePreflightError";
    }
    throw preflightError;
  }
}

export async function buildPreflightReport({
  runtimeConfig,
  role,
  nodeUtils,
  ccc,
  sdk: sdkModule,
  core,
}) {
  const client = nodeUtils.createPublicClient(runtimeConfig.chain, runtimeConfig.rpcUrl);
  const chain = await nodeUtils.verifyChainPreflight(client, runtimeConfig.chain);
  const signer = new ccc.SignerCkbPrivateKey(client, runtimeConfig.privateKey);
  const recommended = await signer.getRecommendedAddressObj();
  const primaryLock = recommended.script;
  const accountLocks = await nodeUtils.signerAccountLocks(signer, primaryLock);
  const stackConfig = sdkModule.getConfig(runtimeConfig.chain);
  const ickb = sdkModule.IckbSdk.fromConfig(stackConfig);
  const tip = await client.getTipHeader();
  const [feeRate, account] = await Promise.all([
    client.getFeeRate(),
    ickb.getAccountState(client, accountLocks, tip),
  ]);
  const exchangeRatio = core.ickbExchangeRatio(tip);
  const projection = sdkModule.projectAccountAvailability(account, [], {
    collectedOrdersAvailable: true,
  });
  const totalCkb = projection.ckbAvailable + projection.ckbPending;
  const depositCapacity = core.convert(false, core.ICKB_DEPOSIT_CAP, exchangeRatio);
  const minimumCkbCapital = (21n * depositCapacity) / 20n;
  const ckbReserve = ckbReserveForRole(role);
  const plainCkb = nodeUtils.accountPlainCkbBalance(account.capacityCells, accountLocks);
  const spendableCkb = maxBigInt(0n, plainCkb - ckbReserve);
  const totalEquivalentCkb = totalCkb + core.convert(false, projection.ickbAvailable, exchangeRatio);
  const totalEquivalentIckb = core.convert(true, totalCkb, exchangeRatio) + projection.ickbAvailable;

  return {
    role,
    chain: runtimeConfig.chain,
    bounded: runtimeConfig.maxIterations !== undefined,
    maxIterations: runtimeConfig.maxIterations,
    maxRetryableAttempts: runtimeConfig.maxRetryableAttempts,
    sleepIntervalSeconds: runtimeConfig.sleepIntervalMs / 1000,
    rpcConfigured: runtimeConfig.rpcUrl !== undefined,
    chainIdentity: chain,
    key: {
      recommendedAddress: recommended.toString(),
      primaryLock: publicScript(primaryLock),
      accountLocks: accountLocks.map(publicScript),
    },
    balances: {
      CKB: {
        available: nodeUtils.formatCkb(plainCkb),
        reserve: nodeUtils.formatCkb(ckbReserve),
        spendable: nodeUtils.formatCkb(spendableCkb),
        unavailable: nodeUtils.formatCkb(projection.ckbPending),
        total: nodeUtils.formatCkb(totalCkb),
      },
      ICKB: {
        available: nodeUtils.formatCkb(projection.ickbAvailable),
      },
      totalEquivalent: {
        CKB: nodeUtils.formatCkb(totalEquivalentCkb),
        ICKB: nodeUtils.formatCkb(totalEquivalentIckb),
      },
    },
    capital: {
      depositCapacity: nodeUtils.formatCkb(depositCapacity),
      minimumCkbCapital: nodeUtils.formatCkb(minimumCkbCapital),
      totalEquivalentCkb: nodeUtils.formatCkb(totalEquivalentCkb),
    },
    inventory: {
      userOrderCount: null,
      userOrderScan: "skipped-global-scan",
      receiptCount: account.receipts.length,
      readyWithdrawalCount: projection.readyWithdrawals.length,
      pendingWithdrawalCount: projection.pendingWithdrawals.length,
    },
    system: {
      tip: {
        hash: tip.hash,
        number: tip.number,
        timestamp: tip.timestamp,
      },
      feeRate,
      exchangeRatio: {
        ckbScale: exchangeRatio.ckbScale,
        udtScale: exchangeRatio.udtScale,
      },
    },
  };
}

export async function main(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    stderr.write(`${publicErrorMessage(error)}\n${usage()}\n`);
    return 1;
  }
  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  try {
    const report = await runPreflight(args);
    const { jsonLogReplacer } = await import(
      pathToFileURL(join(rootDir, "packages/node-utils/dist/index.js")).href
    );
    stdout.write(`${JSON.stringify(report, jsonLogReplacer, 2)}\n`);
    return 0;
  } catch (error) {
    const label = error instanceof Error && error.name === "RetryablePreflightError"
      ? "Live preflight retryable failure"
      : "Live preflight failed";
    stderr.write(`${label}: ${publicErrorMessage(error)}\n`);
    return 1;
  }
}

async function loadBuiltNodeUtils(root) {
  try {
    const nodeUtils = await import(pathToFileURL(join(root, "packages/node-utils/dist/index.js")).href);
    return { nodeUtils };
  } catch (cause) {
    throw new Error(
      "Build @ickb/node-utils before running preflight, for example: pnpm --filter @ickb/node-utils build",
      { cause },
    );
  }
}

async function loadBuiltStack(root) {
  try {
    const [sdk, core, cccModule] = await Promise.all([
      import(pathToFileURL(join(root, "packages/sdk/dist/index.js")).href),
      import(pathToFileURL(join(root, "packages/core/dist/index.js")).href),
      import(pathToFileURL(join(root, "forks/ccc/repo/packages/core/dist/index.js")).href),
    ]);
    return { sdk, core, ccc: cccModule.ccc };
  } catch (cause) {
    throw new Error(
      "Build required packages before running preflight, for example: pnpm --filter @ickb/node-utils --filter @ickb/sdk --filter @ickb/core build",
      { cause },
    );
  }
}

function valueAfter(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
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

function maxBigInt(left, right) {
  return left > right ? left : right;
}

function resolveConfigPath(originalRoot, resolvedRoot, configPath, checkIgnored = defaultCheckIgnored) {
  const absolutePath = isAbsolute(configPath) ? configPath : resolve(resolvedRoot, configPath);
  const relativePath = relative(resolvedRoot, absolutePath);
  if (isInsideRelativePath(relativePath)) {
    if (!checkIgnored(resolvedRoot, relativePath)) {
      throw new Error(`Refusing to read non-ignored config path: ${relativePath}`);
    }
    return { absolutePath, relativePath };
  }
  if (isAbsolute(configPath)) {
    const originalRelativePath = relative(originalRoot, configPath);
    if (isInsideRelativePath(originalRelativePath)) {
      if (!checkIgnored(resolvedRoot, originalRelativePath)) {
        throw new Error(`Refusing to read non-ignored config path: ${originalRelativePath}`);
      }
      return {
        absolutePath: resolve(resolvedRoot, originalRelativePath),
        relativePath: originalRelativePath,
      };
    }
  }
  throw new Error("Config path must stay inside the repo");
}

function isInsideRelativePath(relativePath) {
  return !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

async function assertReadableConfigPath(root, configPath, dependencies = {}) {
  await assertNoSymlinkedConfigAncestors(root, configPath, dependencies);
  const stat = await (dependencies.lstat ?? lstat)(configPath);
  if (stat.isSymbolicLink()) {
    throw new Error("Refusing to read symlink config path");
  }

  const resolvedPath = await (dependencies.realpath ?? realpath)(configPath);
  const relativePath = relative(root, resolvedPath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Config path must stay inside the repo");
  }
}

async function assertNoSymlinkedConfigAncestors(root, configPath, dependencies) {
  const lstatFn = dependencies.lstat ?? lstat;
  const parts = relative(root, configPath).split("/").filter((part) => part !== "");
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    const stat = await lstatFn(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to read config through symlinked path: ${relative(root, current)}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main(process.argv.slice(2)));
}
