import assert from "node:assert/strict";
import test from "node:test";
import { isRetryablePreflightError } from "../../../live/preflight/errors.ts";
import type { RuntimeConfigLike } from "../../../live/preflight/report.ts";
import { runPreflight } from "../../../live/preflight/run.ts";
import {
  type ConfigDirContext,
  mockDependencies,
  randomPrivateKey,
  withConfigDir,
} from "./support.ts";

const fetchFailedMessage = "fetch failed";

void test("preflight preserves parse failure cause without leaking config contents", async () => {
  const privateKey = `0x${"11".repeat(32)}`;
  const parseError = new Error("Invalid env LIVE_PREFLIGHT_CONFIG_FILE");
  await withConfigDir(
    {
      chain: "testnet",
      privateKey,
      rpcUrl: "not-a-url",
      sleepIntervalSeconds: 1,
      maxIterations: 1,
    },
    async ({ configPath, dir }: ConfigDirContext) => {
      const dependencies = mockDependencies();
      await assert.rejects(
        async () =>
          runPreflight({
            configPath,
            root: dir,
            dependencies: {
              ...dependencies,
              checkIgnored: () => true,
              nodeUtils: {
                ...dependencies.nodeUtils,
                readRuntimeConfigEnv: async (): Promise<RuntimeConfigLike> => {
                  await Promise.resolve();
                  throw parseError;
                },
              },
            },
          }),
        (error) => {
          assert(error instanceof Error);
          assert.match(error.message, /Invalid live preflight config/u);
          assert.equal(error.message.includes(privateKey), false);
          assert.equal(error.cause, parseError);
          return true;
        },
      );
    },
  );
});

void test("preflight marks retryable transport failures without leaking RPC URLs", async () => {
  const privateKey = randomPrivateKey();
  await withConfigDir(
    {
      chain: "testnet",
      privateKey,
      rpcUrl: "https://testnet.example/path?token=secret",
      sleepIntervalSeconds: 1,
      maxIterations: 1,
    },
    async ({ configPath, dir }: ConfigDirContext) => {
      const dependencies = mockDependencies();
      const fetchFailure = new TypeError(fetchFailedMessage);
      dependencies.nodeUtils.verifyChainPreflight = async (): Promise<never> => {
        await Promise.resolve();
        throw fetchFailure;
      };
      dependencies.nodeUtils.isRetryableRpcTransportError = (error: unknown): boolean =>
        error === fetchFailure;

      await assertRejectsWith(
        async () =>
          runPreflight({
            configPath,
            root: dir,
            dependencies: { ...dependencies, checkIgnored: () => true },
          }),
        (error) => {
          assert(error instanceof Error);
          assert.equal(error.name, "RetryablePreflightError");
          assert.equal(error.message, fetchFailedMessage);
          assert.doesNotMatch(error.message, /token=secret/u);
        },
      );
    },
  );
});

void test("preflight retryability keeps deterministic failures non-retryable", () => {
  assert.equal(
    isRetryablePreflightError(new Error("Live preflight failed"), {
      isRetryableRpcTransportError: () => false,
    }),
    false,
  );
});

void test("preflight preserves public wrong-chain evidence", async () => {
  const privateKey = randomPrivateKey();
  await withConfigDir(
    baseConfig(privateKey),
    async ({ configPath, dir }: ConfigDirContext) => {
      const dependencies = mockDependencies();
      dependencies.nodeUtils.verifyChainPreflight = async (): Promise<never> => {
        await Promise.resolve();
        throw new Error(
          "Invalid testnet RPC chain identity: genesis hash expected 0x1 observed 0x2",
        );
      };

      await assertRejectsWith(
        async () =>
          runPreflight({
            configPath,
            root: dir,
            dependencies: { ...dependencies, checkIgnored: () => true },
          }),
        (error) => {
          assert(error instanceof Error);
          assert.equal(
            error.message,
            "Invalid testnet RPC chain identity: genesis hash expected 0x1 observed 0x2",
          );
          assert.equal(error.message.includes(privateKey), false);
        },
      );
    },
  );
});

function baseConfig(privateKey: string): {
  chain: string;
  maxIterations: number;
  privateKey: string;
  rpcUrl: string;
  sleepIntervalSeconds: number;
} {
  return {
    chain: "testnet",
    privateKey,
    rpcUrl: "https://testnet.example/",
    sleepIntervalSeconds: 1,
    maxIterations: 1,
  };
}

async function assertRejectsWith(
  action: () => Promise<unknown>,
  check: (error: unknown) => void,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    check(error);
    return true;
  });
}
