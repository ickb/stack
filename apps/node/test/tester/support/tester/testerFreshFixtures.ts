import { ccc } from "@ckb-ccc/core";
import { getConfig, IckbSdk } from "@ickb/sdk";
import { script } from "@ickb/testkit";
import { vi } from "vitest";
import type { testerExecutionActions } from "../../../../src/tester/evidence/testerEvidence.ts";
import type { freshMatchableOrderSkip } from "../../../../src/tester/runtime/freshMatchableOrderSkip.ts";
import { testerSigner } from "./testerStateFixtures.ts";
import {
  transactionResponse,
  type TransactionResponse,
} from "./testerTransactionFixtures.ts";

export type FreshOrderRuntime = Parameters<typeof freshMatchableOrderSkip>[0];
export type { TransactionResponse } from "./testerTransactionFixtures.ts";
export type EstimatedOrder = Parameters<
  typeof testerExecutionActions
>[0]["estimatedOrders"][number];
export function freshOrderRuntime(
  options: {
    cachedBlockNumber?: bigint;
    rpcBlockNumber?: bigint;
    tracked?: boolean;
  } = {},
): {
  runtime: FreshOrderRuntime;
  getTransactionResponse: () => Promise<TransactionResponse>;
  getTransaction: () => Promise<TransactionResponse>;
} {
  const getTransactionResponse =
    options.tracked === true
      ? vi.fn<() => Promise<TransactionResponse>>(async () => {
          await Promise.resolve();
          return transactionResponse(options.cachedBlockNumber);
        })
      : async (): Promise<TransactionResponse> => {
          await Promise.resolve();
          return transactionResponse(options.cachedBlockNumber);
        };
  const getTransaction =
    options.tracked === true
      ? vi.fn<() => Promise<TransactionResponse>>(async () => {
          await Promise.resolve();
          return transactionResponse(options.rpcBlockNumber);
        })
      : async (): Promise<TransactionResponse> => {
          await Promise.resolve();
          return transactionResponse(options.rpcBlockNumber);
        };
  const runtimeClient = new ccc.ClientPublicTestnet({
    url: "https://example.invalid",
  });
  runtimeClient.cache.getTransactionResponse = getTransactionResponse;
  runtimeClient.getTransaction = getTransaction;
  return {
    runtime: {
      client: runtimeClient,
      signer: testerSigner,
      sdk: IckbSdk.fromConfig(getConfig("testnet")),
      primaryLock: script("11"),
      accountLocks: [script("11")],
    },
    getTransactionResponse,
    getTransaction,
  };
}
