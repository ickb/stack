import assert from "node:assert/strict";
import test from "node:test";
import { isRetryablePreflightError } from "../../../live/preflight/errors.ts";
import type { RuntimeConfigLike } from "../../../live/preflight/report.ts";
import { runPreflight } from "../../../live/preflight/run.ts";
import { configEnv, mockDependencies, randomPrivateKey } from "./support.ts";

const fetchFailedMessage = "fetch failed";

void test("preflight preserves parse failure cause without leaking config contents", async () => {
  const privateKey = `0x${"11".repeat(32)}`;
  const parseError = new Error("Invalid env TESTER_RPC_URL");
  const dependencies = mockDependencies();
  await assert.rejects(
    async () =>
      runPreflight({
        env: configEnv({ chain: "testnet", privateKey, rpcUrl: "not-a-url" }),
        prefix: "TESTER",
        dependencies: {
          ...dependencies,
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
      assert.match(
        error.message,
        /Invalid live preflight config: expected TESTER_CHAIN, TESTER_RPC_URL, and TESTER_PRIVATE_KEY_FILE/u,
      );
      assert.equal(error.message.includes(privateKey), false);
      assert.equal(error.cause, parseError);
      return true;
    },
  );
});

void test("preflight marks retryable transport failures without leaking RPC URLs", async () => {
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
        env: configEnv({
          chain: "testnet",
          privateKey: randomPrivateKey(),
          rpcUrl: "https://testnet.example/path?token=secret",
        }),
        prefix: "BOT",
        dependencies,
      }),
    (error) => {
      assert(error instanceof Error);
      assert.equal(error.name, "RetryablePreflightError");
      assert.equal(error.message, fetchFailedMessage);
      assert.doesNotMatch(error.message, /token=secret/u);
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
        env: configEnv({
          chain: "testnet",
          privateKey,
          rpcUrl: "https://testnet.example/",
        }),
        prefix: "BOT",
        dependencies,
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
});

async function assertRejectsWith(
  action: () => Promise<unknown>,
  check: (error: unknown) => void,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    check(error);
    return true;
  });
}
