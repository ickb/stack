import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as coreSource from "../../../packages/core/src/index.ts";
import * as nodeUtilsSource from "../../../packages/node-utils/src/index.ts";
import * as sdkSource from "../../../packages/sdk/src/index.ts";
import type { CheckIgnored } from "../config/git.ts";
import { isPublicChainIdentityError, isRetryablePreflightError } from "./errors.ts";
import {
  assertReadableConfigPath,
  type ConfigPathDependencies,
  resolveConfigPath,
} from "./paths.ts";
import {
  buildPreflightReport,
  type CccLike,
  type CoreLike,
  type NodeUtilsLike,
  type PreflightReport,
  type RuntimeConfigLike,
  type SdkLike,
} from "./report.ts";

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
const requireFromCore = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Node's require API is untyped; package ownership and resolution are fixed here.
const cccSource: CccLike = requireFromCore("@ckb-ccc/core");

export type NodeUtilsRuntimeLike = NodeUtilsLike & {
  readRuntimeConfigEnv: (
    configPath: string,
    envName: string,
  ) => Promise<RuntimeConfigLike>;
};

// eslint-disable-next-line no-restricted-syntax, @typescript-eslint/no-unsafe-type-assertion -- Source signatures are narrower than the injected test boundary.
const sourceNodeUtils = nodeUtilsSource as unknown as NodeUtilsRuntimeLike;
// eslint-disable-next-line no-restricted-syntax, @typescript-eslint/no-unsafe-type-assertion -- Source signatures are narrower than the injected test boundary.
const sourceSdk = sdkSource as unknown as SdkLike;

type PreflightDependencies = ConfigPathDependencies & {
  ccc?: CccLike;
  checkIgnored?: CheckIgnored;
  core?: CoreLike;
  nodeUtils?: NodeUtilsRuntimeLike;
  sdk?: SdkLike;
};

interface RunPreflightOptions {
  configPath: string;
  dependencies?: PreflightDependencies;
  root?: string;
}

class RetryablePreflightError extends Error {
  public override readonly name = "RetryablePreflightError";
}

export async function runPreflight({
  configPath,
  root = rootDir,
  dependencies,
}: RunPreflightOptions): Promise<PreflightReport> {
  const originalRoot = path.resolve(root);
  const resolvedRoot = await (dependencies?.realpath ?? realpath)(originalRoot);
  const config = resolveConfigPath(
    originalRoot,
    resolvedRoot,
    configPath,
    dependencies?.checkIgnored,
  );
  await assertReadableConfigPath(resolvedRoot, config.absolutePath, dependencies);
  const nodeUtils = dependencies?.nodeUtils ?? sourceNodeUtils;
  const runtimeConfig = await readRuntimeConfig(nodeUtils, config.absolutePath);
  const stack =
    dependencies?.ccc !== undefined &&
    dependencies.core !== undefined &&
    dependencies.sdk !== undefined
      ? { ccc: dependencies.ccc, core: dependencies.core, sdk: dependencies.sdk }
      : { ccc: cccSource, core: coreSource, sdk: sourceSdk };

  try {
    return await buildPreflightReport({
      runtimeConfig,
      nodeUtils,
      ccc: stack.ccc,
      sdk: stack.sdk,
      core: stack.core,
    });
  } catch (error) {
    throw publicPreflightFailure(error, nodeUtils);
  }
}

async function readRuntimeConfig(
  nodeUtils: NodeUtilsRuntimeLike,
  configPath: string,
): Promise<RuntimeConfigLike> {
  try {
    return await nodeUtils.readRuntimeConfigEnv(configPath, "LIVE_PREFLIGHT_CONFIG_FILE");
  } catch (cause) {
    throw new Error(
      "Invalid live preflight config: expected exact JSON with chain, privateKey, and rpcUrl",
      { cause },
    );
  }
}

function publicPreflightFailure(error: unknown, nodeUtils: NodeUtilsRuntimeLike): Error {
  if (isRetryablePreflightError(error, nodeUtils)) {
    return new RetryablePreflightError("fetch failed");
  }
  if (isPublicChainIdentityError(error)) {
    return new Error(error.message);
  }
  return new Error("Live preflight failed");
}
