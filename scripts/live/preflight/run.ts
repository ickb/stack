import { createRequire } from "node:module";
import * as nodeUtilsSource from "../../../packages/node-utils/src/index.ts";
import * as sdkSource from "../../../packages/sdk/src/index.ts";
import { isPublicChainIdentityError, isRetryablePreflightError } from "./errors.ts";
import {
  buildPreflightReport,
  type CccLike,
  type CoreLike,
  type NodeUtilsLike,
  type PreflightReport,
  type RuntimeConfigLike,
  type SdkLike,
} from "./report.ts";

const requireFromCore = createRequire(
  new URL("../../../packages/sdk/package.json", import.meta.url),
);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Node's require API is untyped; package ownership and resolution are fixed here.
const cccSource: CccLike = requireFromCore("@ckb-ccc/core");

export type NodeUtilsRuntimeLike = NodeUtilsLike & {
  readRuntimeConfigEnv: (
    env: NodeJS.ProcessEnv,
    prefix: string,
  ) => Promise<RuntimeConfigLike>;
};

// eslint-disable-next-line no-restricted-syntax, @typescript-eslint/no-unsafe-type-assertion -- Source signatures are narrower than the injected test boundary.
const sourceNodeUtils = nodeUtilsSource as unknown as NodeUtilsRuntimeLike;
// eslint-disable-next-line no-restricted-syntax, @typescript-eslint/no-unsafe-type-assertion -- Source signatures are narrower than the injected test boundary.
const sourceSdk = sdkSource as unknown as SdkLike;

interface PreflightDependencies {
  ccc?: CccLike;
  core?: CoreLike;
  nodeUtils?: NodeUtilsRuntimeLike;
  sdk?: SdkLike;
}

interface RunPreflightOptions {
  dependencies?: PreflightDependencies;
  env: NodeJS.ProcessEnv;
  prefix: string;
}

class RetryablePreflightError extends Error {
  public override readonly name = "RetryablePreflightError";
}

export async function runPreflight({
  env,
  prefix,
  dependencies,
}: RunPreflightOptions): Promise<PreflightReport> {
  const nodeUtils = dependencies?.nodeUtils ?? sourceNodeUtils;
  const runtimeConfig = await readRuntimeConfig(nodeUtils, env, prefix);
  const stack =
    dependencies?.ccc !== undefined &&
    dependencies.core !== undefined &&
    dependencies.sdk !== undefined
      ? { ccc: dependencies.ccc, core: dependencies.core, sdk: dependencies.sdk }
      : { ccc: cccSource, core: sdkSource, sdk: sourceSdk };

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
  env: NodeJS.ProcessEnv,
  prefix: string,
): Promise<RuntimeConfigLike> {
  try {
    return await nodeUtils.readRuntimeConfigEnv(env, prefix);
  } catch (cause) {
    throw new Error(
      `Invalid live preflight config: expected ${prefix}_CHAIN, ${prefix}_RPC_URL, and ${prefix}_PRIVATE_KEY_FILE`,
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
