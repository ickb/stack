import { ccc } from "@ckb-ccc/ccc";
import { readState, type WithdrawalGroup } from "@ickb/sdk";

import { headerLike, offlineTestnetClient, script, StubClient } from "@ickb/testkit";
import { skipToken } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  getL1State,
  l1StateOptions,
  l1StateQueryKey,
  quoteStateOptions,
  rootConfigQueryKey,
} from "../../src/app/queries.ts";
import type { RootConfig } from "../../src/shared/utils.ts";
import { state as sampledState } from "../action/fixtures/transaction.ts";
import { rootConfig as testRootConfig } from "../hook/fixtures/data.ts";
import { cell, testSigner, walletConfigReading } from "./fixtures/query.ts";

// The SDK's read and build are its own tests'; here each test serves the signer's state
// and a refused build.
vi.mock(import("@ickb/sdk"), async (importOriginal) => ({
  ...(await importOriginal()),
  readState: vi.fn(),
  buildConversionTransaction: vi.fn(),
}));

function itKeysL1StateByAccountLocks(): void {
  it("keys L1 state by the wallet config object, not its shape", () => {
    const walletConfig = { chain: "testnet", address: "ckt1same" } as const;
    const key = l1StateQueryKey(walletConfig);

    expect(key).toEqual(["testnet", "ckt1same", key[2], "l1State"]);
    expect(l1StateQueryKey(walletConfig)).toEqual(key);
    expect(l1StateQueryKey({ ...walletConfig })).not.toEqual(key);
  });
}

function itPollsLiveStateUnlessFrozen(): void {
  it("polls live state every minute unless a transaction is frozen", () => {
    const walletConfig = {
      ...walletConfigReading(sampledState()),
      cccClient: offlineTestnetClient(),
      signer: testSigner(),
      address: "ckt1same",
    } satisfies Parameters<typeof l1StateOptions>[0];

    expect(l1StateOptions(walletConfig, false).enabled).toBe(true);
    expect(l1StateOptions(walletConfig, true).enabled).toBe(false);
    expect(l1StateOptions(walletConfig, false).refetchInterval).toBe(60_000);
  });
}

function itRunsL1StateOptionsQuery(): void {
  it("runs L1 state through the query option function", async () => {
    const options = l1StateOptions(
      walletConfigReading(sampledState({ tip: headerLike({ timestamp: 42n }) })),
      false,
    );

    await expect(options.queryFn()).resolves.toMatchObject({
      tip: { timestamp: 42n },
    });
  });
}

function itLoadsQuoteStateFromTip(): void {
  it("loads quote state from the tip without scanning protocol or account state", async () => {
    let tipReads = 0;
    const rootConfig: RootConfig = {
      ...testRootConfig("testnet"),
      cccClient: new StubClient({
        getTipHeader: async (): Promise<ccc.ClientBlockHeader> => {
          await Promise.resolve();
          tipReads += 1;
          return headerLike({
            timestamp: 25n,
            dao: { ar: 10000000000000000n, c: 0n, s: 0n, u: 0n },
          });
        },
      }),
    };

    const options = quoteStateOptions(rootConfig);
    if (options.queryFn === skipToken) {
      throw new Error("A configured chain has a quote query");
    }
    const state = await options.queryFn();

    expect(state.exchangeRatio.ckbScale).toBe(10000000000000000n);
    expect(state.tipTimestamp).toBe(25n);
    expect(state.exchangeRatio.udtScale).toBe(10008200000000000n);
    // Each chain and client quotes under its own key.
    expect(options.queryKey).toEqual([...rootConfigQueryKey(rootConfig), "quoteState"]);
    expect(options.refetchInterval).toBe(60_000);
    expect(tipReads).toBe(1);
    // An unsupported chain parks the query under a key that tolerates the missing config.
    const parked = quoteStateOptions(undefined);
    expect(parked.queryFn).toBe(skipToken);
    expect(parked.queryKey).toEqual(["unsupported", "quoteState"]);
  });
}

describe("getL1State", () => {
  itKeysL1StateByAccountLocks();
  itPollsLiveStateUnlessFrozen();
  itRunsL1StateOptionsQuery();
  itLoadsQuoteStateFromTip();
});

it("serves the signer's read with the app's preview and converting flag", async () => {
  const read = sampledState({ ckbAvailable: ccc.fixedPointFrom(50) });
  const walletConfig = walletConfigReading(read);

  const state = await getL1State(walletConfig);

  expect(readState).toHaveBeenCalledWith(walletConfig.signer);
  expect(state).toMatchObject({ ...read, hasConverting: false });
  expect(state.stateId).toMatch(/^\d+$/u);
  // The fixture SDK refuses every build as short of CKB.
  await expect(state.txBuilder(true, 1n)).resolves.toMatchObject({
    error: "More CKB than you have",
  });
});

it("flags a withdrawal that stays after the next collection", async () => {
  // A request before its claim epoch is pending: the collect-only intent says the rest keeps
  // converting, while nothing is collectable yet.
  const lock = script("11");
  const tip = headerLike({ timestamp: 10n });
  const request = cell(ccc.fixedPointFrom(100_082), script("44"));
  const owner = cell(ccc.fixedPointFrom(61), lock);
  // The SDK exports the group as a type; the projection reads only these members.
  const pendingWithdrawal: WithdrawalGroup = {
    owned: {
      cell: request,
      headers: [tip, tip],
      maturity: ccc.Epoch.from([182n, 0n, 1n]),
      isReady: false,
      ckbValue: request.cellOutput.capacity,
    },
    owner: {
      cell: owner,
      getOwned: () => request.outPoint,
    },
    ckbValue: request.cellOutput.capacity + owner.cellOutput.capacity,
    udtValue: 0n,
  };
  const walletConfig = walletConfigReading(
    sampledState({ tip, pendingWithdrawals: [pendingWithdrawal] }),
  );

  const state = await getL1State(walletConfig);

  expect(state.hasConverting).toBe(true);
  expect(state.pendingWithdrawals).toEqual([pendingWithdrawal]);
});

it("gives every fetch its own stateId, so each poll rebuilds the preview", async () => {
  const first = await getL1State(walletConfigReading(sampledState()));
  const second = await getL1State(walletConfigReading(sampledState()));

  expect(first.stateId).not.toBe(second.stateId);
});

describe("rootConfigQueryKey", () => {
  it("keys root-scoped client reads by chain and client identity", () => {
    const config = testRootConfig("testnet");
    const key = rootConfigQueryKey(config);

    expect(key[0]).toBe("testnet");
    expect(key.at(-1)).toBe("rootConfig");
    expect(rootConfigQueryKey({ ...config })).toEqual(key);
    expect(rootConfigQueryKey({ ...config, chain: "mainnet" })).not.toEqual(key);
    expect(
      rootConfigQueryKey({ ...config, cccClient: testRootConfig("mainnet").cccClient }),
    ).not.toEqual(key);
  });
});
