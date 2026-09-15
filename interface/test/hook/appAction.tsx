import { script } from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import { elementProps, findElements, firstElement } from "../support/react.ts";
import {
  actionProps,
  activeTxInfo,
  l1State,
  quoteState,
  walletConfig,
} from "./fixtures/data.ts";
import {
  hookState,
  queryMock,
  resetHooks,
  transactMock,
  txPreviewQueryOptions,
} from "./fixtures/environment.ts";
import {
  Action,
  App,
  CKB,
  clearPendingTransaction,
  Dashboard,
  Form,
  submitPendingTransaction,
  txInfoPadding,
  WalletAppView,
  type ActionLayout,
  type PendingTransactionStore,
} from "./fixtures/modules.ts";

const requestConversion = "request conversion";

describe("hook-based app and action state", () => {
  registerAppStateTests();
  registerAppRefreshTests();
  registerActionPreviewTests();
  registerActionAlternativeTests();
  registerActionRejectionTests();
  registerFreshFailureIdentityTests();
  registerActionConfirmationTests();
  registerPendingTransactionRecoveryTests();
  registerWalletViewTests();
});

function registerAppStateTests(): void {
  it("builds App state and action params from wallet state", async () => {
    const loadedState = l1State();
    const refetch = vi.fn(async () => {
      await Promise.resolve();
      return { data: loadedState, error: null };
    });
    queryMock.result = {
      data: loadedState,
      error: null,
      isFetching: false,
      refetch,
    };
    const setRawText = vi.fn<(value: string) => void>();
    const element = App({
      walletConfig: walletConfig(),
      walletName: "JoyID",
      openWallet: vi.fn<() => void>(),
      rawText: "I2",
      setRawText,
      quoteState: quoteState(),
    });
    const props = elementProps<Parameters<typeof WalletAppView>[0]>(element);

    props.actionParams.formReset();
    props.actionParams.retryState();
    const refreshedState = await props.actionParams.refreshPreview(false, 2n * CKB, {
      lock: script("11"),
    });

    expect(props.isCkb2Udt).toBe(false);
    expect(props.amount).toBe(2n * CKB);
    expect(props.formQuoteState).toBe(loadedState.system);
    expect(setRawText).toHaveBeenCalledWith("I");
    expect(refreshedState).toMatchObject({
      stateId: loadedState.stateId,
      tipTimestamp: loadedState.tipTimestamp,
      hasCollectable: loadedState.hasCollectable,
    });
    expect(loadedState.txBuilder).not.toHaveBeenCalled();
    await expect(refreshedState.build()).resolves.toBe(txInfoPadding);
    expect(loadedState.txBuilder).toHaveBeenCalledWith(false, 2n * CKB, {
      lock: script("11"),
    });
    expect(refetch).toHaveBeenCalledTimes(2);

    resetHooks();
    queryMock.result = { data: undefined, error: null, isFetching: true, refetch };
    expect(
      elementProps<Parameters<typeof WalletAppView>[0]>(
        App({
          walletConfig: walletConfig(),
          walletName: "JoyID",
          openWallet: vi.fn<() => void>(),
          rawText: "C",
          setRawText,
        }),
      ).isCkb2Udt,
    ).toBe(true);
  });
}

function registerAppRefreshTests(): void {
  it("rejects failed or missing fresh wallet data", async () => {
    for (const [result, message] of [
      [
        { data: undefined, error: new Error("RPC down") },
        "Unable to refresh wallet data",
      ],
      [{ data: undefined, error: null }, "Fresh wallet data is unavailable"],
    ] as const) {
      resetHooks();
      queryMock.result = {
        data: l1State(),
        error: null,
        isFetching: false,
        refetch: vi.fn(async () => {
          await Promise.resolve();
          return result;
        }),
      };
      const props = elementProps<Parameters<typeof WalletAppView>[0]>(
        App({
          walletConfig: walletConfig(),
          walletName: "JoyID",
          openWallet: vi.fn<() => void>(),
          rawText: "C1",
          setRawText: vi.fn<(value: string) => void>(),
        }),
      );

      await expect(
        props.actionParams.refreshPreview(true, CKB, { lock: script("11") }),
      ).rejects.toThrow(message);
    }

    resetHooks();
    queryMock.result = {
      data: l1State(),
      error: null,
      isFetching: false,
      refetch: vi.fn().mockRejectedValue(new Error("transport failed")),
    };
    const rejected = elementProps<Parameters<typeof WalletAppView>[0]>(
      App({
        walletConfig: walletConfig(),
        walletName: "JoyID",
        openWallet: vi.fn<() => void>(),
        rawText: "C1",
        setRawText: vi.fn<(value: string) => void>(),
      }),
    );
    await expect(
      rejected.actionParams.refreshPreview(true, CKB, { lock: script("11") }),
    ).rejects.toThrow("Unable to refresh wallet data: transport failed");
  });
}

function registerActionPreviewTests(): void {
  it("renders Action for missing, errored, and valid preview state", async () => {
    const retryState = vi.fn<() => void>();
    const loading = Action({
      ...actionProps(),
      l1State: undefined,
      isStateFetching: true,
      stateError: null,
      retryState,
    });
    await expect(txPreviewQueryOptions().queryFn()).resolves.toBe(txInfoPadding);

    expect(elementProps<Parameters<typeof ActionLayout>[0]>(loading)).toMatchObject({
      disabled: true,
      message: "Loading wallet data...",
    });

    resetHooks();
    const errored = Action({
      ...actionProps(),
      l1State: undefined,
      stateError: new Error("RPC down"),
      retryState,
    });
    elementProps<Parameters<typeof ActionLayout>[0]>(errored).onAction?.();
    expect(retryState).toHaveBeenCalledTimes(1);
    expect(retryState).toHaveBeenCalledWith();

    resetHooks();
    const freeze = vi.fn<(value: boolean) => void>();
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    const ready = Action({ ...actionProps(), freeze, l1State: l1State() });
    const props = elementProps<Parameters<typeof ActionLayout>[0]>(ready);
    await expect(txPreviewQueryOptions().queryFn()).resolves.toBe(txInfoPadding);
    props.onAction?.();

    expect(props.disabled).toBe(false);
    expect(props.fee).toBe("0.00000001 CKB");
    expect(transactMock.transact).toHaveBeenCalledTimes(1);
    const transactCall = transactMock.transact.mock.calls[0];
    if (transactCall === undefined) {
      throw new Error("transact was not called");
    }
    const [transactParams] = transactCall;
    const refreshedState = await transactParams.refreshPreview();
    expect(refreshedState.stateId).toBe("state-id");
    await expect(refreshedState.build()).resolves.toEqual(activeTxInfo());
    expect(freeze).toHaveBeenCalledWith(true);

    resetHooks();
    queryMock.result = { data: undefined, isFetching: false };
    expect(
      elementProps<Parameters<typeof ActionLayout>[0]>(
        Action({ ...actionProps(), l1State: l1State() }),
      ).disabled,
    ).toBe(true);
  });
}

function registerActionAlternativeTests(): void {
  it("renders collect, intermediate, and reverse-direction action alternatives", () => {
    const collectableState = { ...l1State(), hasCollectable: true };
    queryMock.result = {
      data: { ...activeTxInfo(), conversionKind: "collect-only" },
      isFetching: false,
    };
    const collect = elementProps<Parameters<typeof ActionLayout>[0]>(
      Action({ ...actionProps(), amount: 0n, l1State: collectableState }),
    );
    expect(collect.action).toBe("collect converted funds");
    expect(collect.disabled).toBe(false);

    resetHooks();
    const callsBeforeIntermediate = transactMock.transact.mock.calls.length;
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    const intermediate = elementProps<Parameters<typeof ActionLayout>[0]>(
      Action({
        ...actionProps(),
        amount: undefined,
        amountError: "",
        l1State: l1State(),
      }),
    );
    intermediate.onAction?.();
    expect(intermediate.action).toBe(requestConversion);
    expect(intermediate.disabled).toBe(true);
    expect(intermediate.message).toBe("Finish entering the amount.");
    expect(transactMock.transact).toHaveBeenCalledTimes(callsBeforeIntermediate);

    resetHooks();
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    Action({ ...actionProps(), isCkb2Udt: false, l1State: l1State() });
    expect(txPreviewQueryOptions().enabled).toBe(true);
    expect(txPreviewQueryOptions().queryKey).toContain(false);
  });
}

function registerActionRejectionTests(): void {
  it("restores the normal action and editable form after chain rejection", async () => {
    const attempted = Promise.withResolvers<undefined>();
    const failure = `Transaction rejected: validation failed. Hash: 0x${"ab".repeat(32)}`;
    const base = actionProps();
    const freeze = vi.fn<(value: boolean) => void>();
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    transactMock.transact.mockImplementationOnce(async (params) => {
      params.lockIntent();
      const { build, ...state } = await params.refreshPreview();
      params.freezePreview({ ...state, txInfo: await build() });
      params.setFailure(failure);
      clearPendingTransaction(params.pendingStore);
      params.freezePreview(undefined);
      attempted.resolve(undefined);
    });
    const initial = Action({ ...base, freeze, l1State: l1State() });

    elementProps<Parameters<typeof ActionLayout>[0]>(initial).onAction?.();
    await attempted.promise;
    hookState.index = 0;
    const recovered = elementProps<Parameters<typeof ActionLayout>[0]>(
      Action({ ...base, freeze, l1State: l1State() }),
    );

    expect(recovered.action).toBe(requestConversion);
    expect(recovered.disabled).toBe(false);
    expect(recovered.message).toBe(`⚠️ ${failure}`);
    expect(freeze).toHaveBeenNthCalledWith(1, true);
    expect(freeze).toHaveBeenLastCalledWith(false);
    expect(base.formReset).not.toHaveBeenCalled();
  });
}

function registerFreshFailureIdentityTests(): void {
  it("keeps a state-B build failure visible after refetching state A", async () => {
    const attempted = Promise.withResolvers<undefined>();
    const stateA = { ...l1State(), stateId: "state-a" };
    const stateB = {
      ...l1State(),
      stateId: "state-b",
      txBuilder: vi.fn().mockRejectedValue(new Error("fresh build failed")),
    };
    queryMock.result = {
      data: stateA,
      error: null,
      isFetching: false,
      refetch: vi.fn(async () => {
        await Promise.resolve();
        return { data: stateB, error: null };
      }),
    };
    const app = elementProps<Parameters<typeof WalletAppView>[0]>(
      App({
        walletConfig: walletConfig(),
        walletName: "JoyID",
        openWallet: vi.fn<() => void>(),
        rawText: "C1",
        setRawText: vi.fn<(value: string) => void>(),
      }),
    );
    resetHooks();
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    const freeze = vi.fn<(value: boolean) => void>();
    const actionParams = { ...app.actionParams, freeze, l1State: stateA };
    transactMock.transact.mockImplementationOnce(async (params) => {
      params.lockIntent();
      const freshState = await params.refreshPreview();
      try {
        await freshState.build();
      } catch (error) {
        params.setFailure(
          error instanceof Error ? error.message : "Fresh preview failed",
        );
        params.freezePreview(undefined);
      }
      attempted.resolve(undefined);
    });

    elementProps<Parameters<typeof ActionLayout>[0]>(Action(actionParams)).onAction?.();
    await attempted.promise;
    hookState.index = 0;
    const recovered = elementProps<Parameters<typeof ActionLayout>[0]>(
      Action({ ...actionParams, l1State: stateB }),
    );

    expect(stateB.txBuilder).toHaveBeenCalledWith(true, CKB, { lock: script("11") });
    expect(recovered.message).toBe("⚠️ fresh build failed");
    expect(recovered.disabled).toBe(false);
    expect(freeze).toHaveBeenLastCalledWith(false);
  });
}

function registerActionConfirmationTests(): void {
  it("shows waiting before offering recoverable confirmation retry", async () => {
    const confirmation = Promise.withResolvers<undefined>();
    const waitingReady = Promise.withResolvers<undefined>();
    const base = {
      ...actionProps(),
      refreshPreview: vi.fn(async () => {
        await Promise.resolve();
        return {
          stateId: "fresh-state",
          tipTimestamp: 0n,
          hasCollectable: false,
          build: async (): Promise<ReturnType<typeof activeTxInfo>> => {
            await Promise.resolve();
            return {
              ...activeTxInfo(),
              fee: 9n,
              estimatedMaturity: 120_001n,
              conversionKind: "direct-plus-order" as const,
            };
          },
        };
      }),
    };
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    transactMock.transact.mockImplementationOnce(async (params) => {
      params.lockIntent();
      const { build, ...state } = await params.refreshPreview();
      params.freezePreview({ ...state, txInfo: await build() });
      await recordPending(params.pendingStore, `0x${"ab".repeat(32)}`);
      params.setIsConfirming(true);
      waitingReady.resolve(undefined);
      await confirmation.promise;
      params.setFailure("RPC unavailable");
      params.setIsConfirming(false);
    });
    const initial = Action({ ...base, l1State: l1State() });

    elementProps<Parameters<typeof ActionLayout>[0]>(initial).onAction?.();
    await waitingReady.promise;
    hookState.index = 0;
    const waiting = elementProps<Parameters<typeof ActionLayout>[0]>(
      Action({
        ...base,
        pendingTransaction: base.pendingStore.current,
        l1State: l1State(),
      }),
    );

    expect(waiting.action).toBe("stop waiting");
    expect(waiting.disabled).toBe(false);
    expect(waiting.fee).toBe("0.00000009 CKB");
    expect(waiting.maturity).toBe("⏳ 3 minutes");
    expect(waiting.message).toContain(
      "Intent: Part converts at a fixed time, the rest at a variable time.",
    );

    confirmation.resolve(undefined);
    await confirmation.promise;
    await Promise.resolve();
    hookState.index = 0;
    const retry = elementProps<Parameters<typeof ActionLayout>[0]>(
      Action({
        ...base,
        pendingTransaction: base.pendingStore.current,
        l1State: l1State(),
      }),
    );

    expect(retry.action).toBe("retry confirmation");
    expect(retry.disabled).toBe(false);
    retry.onAction?.();
    expect(transactMock.retryConfirmation).toHaveBeenCalledTimes(1);
  });
}

/** Establishes pending state exactly as a completed submission does. */
async function recordPending(
  store: PendingTransactionStore,
  txHash: `0x${string}`,
): Promise<void> {
  await submitPendingTransaction(store, async (recordTxHash) => {
    recordTxHash(txHash);
    await Promise.resolve();
    return txHash;
  });
}

function registerPendingTransactionRecoveryTests(): void {
  it("restores the session's hash and aborts ownership on unmount", async () => {
    const txHash = `0x${"cd".repeat(32)}` as const;
    const props = actionProps();
    await recordPending(props.pendingStore, txHash);
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    const freeze = vi.fn<(value: boolean) => void>();
    const restored = elementProps<Parameters<typeof ActionLayout>[0]>(
      Action({
        ...props,
        pendingTransaction: props.pendingStore.current,
        freeze,
        l1State: l1State(),
      }),
    );

    restored.onAction?.();

    expect(restored.action).toBe("retry confirmation");
    expect(restored.disabled).toBe(false);
    expect(transactMock.retryConfirmation).toHaveBeenCalledTimes(1);
    expect(transactMock.transact).not.toHaveBeenCalled();
    expect(freeze).toHaveBeenCalledWith(true);
    const retryCall = transactMock.retryConfirmation.mock.calls[0]?.[0];
    expect(retryCall?.txHash).toBe(txHash);
    expect(retryCall?.signal.aborted).toBe(false);
    for (const cleanup of hookState.effects) {
      cleanup();
    }
    expect(retryCall?.signal.aborted).toBe(true);
    restored.onAction?.();
    expect(transactMock.retryConfirmation).toHaveBeenCalledTimes(1);

    resetHooks();
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    // Another session has its own store and therefore no recorded hash.
    const otherSession = elementProps<Parameters<typeof ActionLayout>[0]>(
      Action({ ...actionProps(), l1State: l1State() }),
    );
    expect(otherSession.action).toBe(requestConversion);
  });

  it("does not start another action while wallet submission is owned", async () => {
    const props = actionProps();
    const sent = Promise.withResolvers<`0x${string}`>();
    const submission = submitPendingTransaction(
      props.pendingStore,
      async () => sent.promise,
    );
    await Promise.resolve();
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    const action = elementProps<Parameters<typeof ActionLayout>[0]>(
      Action({
        ...props,
        pendingTransaction: props.pendingStore.current,
        l1State: l1State(),
      }),
    );

    action.onAction?.();

    expect(transactMock.transact).not.toHaveBeenCalled();
    expect(transactMock.retryConfirmation).not.toHaveBeenCalled();
    sent.resolve(`0x${"ef".repeat(32)}`);
    await submission;
  });
}

function registerWalletViewTests(): void {
  it("renders WalletAppView with and without loaded balances", () => {
    const baseProps = {
      walletConfig: walletConfig(),
      walletName: "JoyID",
      openWallet: vi.fn<() => void>(),
      rawText: "C1",
      setRawText: vi.fn<(value: string) => void>(),
      quoteState: quoteState(),
      formQuoteState: quoteState(),
      isFrozen: false,
      destinationField: {
        text: "",
        setText: vi.fn<(value: string) => void>(),
        isValid: true,
        isForeign: false,
      },
      actionParams: actionProps(),
      isCkb2Udt: true,
      amount: CKB,
    } satisfies Omit<Parameters<typeof WalletAppView>[0], "l1State">;

    const withoutBalances = WalletAppView({ ...baseProps, l1State: undefined });
    const withBalances = WalletAppView({ ...baseProps, l1State: l1State() });
    const frozen = WalletAppView({ ...baseProps, isFrozen: true, l1State: l1State() });
    const replacement = WalletAppView({
      ...baseProps,
      walletConfig: { ...baseProps.walletConfig },
      l1State: l1State(),
    });
    const formElements = findElements(withBalances, (element) => element.type === Form);

    expect(
      findElements(withoutBalances, (element) => element.type === Form),
    ).toHaveLength(1);
    expect(
      elementProps<Parameters<typeof Form>[0]>(firstElement(formElements)).balances,
    ).toMatchObject({
      ckbNative: 3n * CKB,
      ickbNative: 2n * CKB,
    });
    const frozenDashboard = firstElement(
      findElements(frozen, (element) => element.type === Dashboard),
    );
    expect(elementProps<Parameters<typeof Dashboard>[0]>(frozenDashboard).disabled).toBe(
      true,
    );
    expect(
      firstElement(findElements(withBalances, (element) => element.type === Action)).key,
    ).not.toBe(
      firstElement(findElements(replacement, (element) => element.type === Action)).key,
    );
  });
}
