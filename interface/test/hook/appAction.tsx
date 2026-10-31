import { script } from "@ickb/testkit";
import { skipToken } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { activeTxInfo, recordPending } from "../action/fixtures/transaction.ts";
import { elementProps, findElements, firstElement } from "../support/react.ts";
import { inAct, renderHook, settle } from "../support/renderHook.ts";
import {
  actionProps,
  l1State,
  nothingToSign,
  quoteState,
  walletConfig,
} from "./fixtures/data.ts";
import {
  queryFnOf,
  queryMock,
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
  WalletAppView,
  type ActionLayout,
} from "./fixtures/modules.ts";

type ActionProps = Parameters<typeof Action>[0];
type AppProps = Parameters<typeof App>[0];
type LayoutProps = Parameters<typeof ActionLayout>[0];
type ViewProps = Parameters<typeof WalletAppView>[0];

const requestConversion = "request conversion";

describe("hook-based app and action state", () => {
  registerAppStateTests();
  registerActionPreviewTests();
  registerActionAlternativeTests();
  registerActionAttemptTests();
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
    queryMock.result = { data: loadedState, error: null, isFetching: false, refetch };
    const props = appProps({ isCkb2Udt: false, text: "2", quoteState: quoteState() });
    const { result, rerender, unmount } = await renderApp(props);
    const view = elementProps<ViewProps>(result.current);

    view.actionParams.formReset();
    view.actionParams.retryState();
    const refreshedState = await view.actionParams.refreshState();

    expect(view.isCkb2Udt).toBe(false);
    expect(view.amount).toBe(2n * CKB);
    expect(view.exchangeRatio).toBe(loadedState.system.exchangeRatio);
    expect(props.setText).toHaveBeenCalledWith("");
    expect(refreshedState).toBe(loadedState);
    expect(refetch).toHaveBeenCalledTimes(2);

    // Without wallet data or a quote there is no ratio to quote the form at.
    queryMock.result = { data: undefined, error: null, isFetching: true, refetch };
    await rerender(appProps({ text: "" }));
    expect(elementProps<ViewProps>(result.current).exchangeRatio).toBeUndefined();
    await unmount();
  });

  it("rejects failed or missing fresh wallet data", async () => {
    for (const [refetched, message] of [
      [
        { data: undefined, error: new Error("RPC down") },
        "Unable to refresh wallet data",
      ],
      [{ data: undefined, error: null }, "Fresh wallet data is unavailable"],
    ] as const) {
      queryMock.result = {
        data: l1State(),
        error: null,
        isFetching: false,
        refetch: vi.fn(async () => {
          await Promise.resolve();
          return refetched;
        }),
      };
      const { result, unmount } = await renderApp(appProps());

      await expect(
        elementProps<ViewProps>(result.current).actionParams.refreshState(),
      ).rejects.toThrow(message);
      await unmount();
    }
  });
}

function registerActionPreviewTests(): void {
  it("renders Action for missing, errored, and valid preview state", async () => {
    const retryState = vi.fn<() => void>();
    const loading = await renderAction({
      ...actionProps(),
      l1State: undefined,
      isStateFetching: true,
      stateError: null,
      retryState,
    });
    // Without wallet data the preview query is parked.
    expect(txPreviewQueryOptions().queryFn).toBe(skipToken);
    expect(layout(loading.result.current)).toMatchObject({
      disabled: true,
      message: "Loading wallet data...",
    });
    await loading.unmount();

    const errored = await renderAction({
      ...actionProps(),
      l1State: undefined,
      stateError: new Error("RPC down"),
      retryState,
    });
    layout(errored.result.current).onAction?.();
    expect(retryState).toHaveBeenCalledTimes(1);
    expect(retryState).toHaveBeenCalledWith();
    await errored.unmount();

    const freeze = vi.fn<(value: boolean) => void>();
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    const ready = await renderAction({ ...actionProps(), freeze, l1State: l1State() });
    const props = layout(ready.result.current);
    await expect(queryFnOf(txPreviewQueryOptions())()).resolves.toBe(nothingToSign);
    expect(props.disabled).toBe(false);
    expect(props.fee).toBe("0.00000001 CKB");

    await click(props);
    expect(transactMock.transact).toHaveBeenCalledTimes(1);
    const [transactParams] = transactMock.transact.mock.calls[0] ?? [];
    if (transactParams === undefined) {
      throw new Error("transact was not called");
    }
    expect((await transactParams.refreshState()).stateId).toBe("state-id");
    expect(transactParams).toMatchObject({
      isCkb2Udt: true,
      amount: CKB,
      destination: { lock: script("11") },
    });
    expect(freeze).toHaveBeenCalledWith(true);
    await ready.unmount();

    queryMock.result = { data: undefined, isFetching: false };
    const empty = await renderAction({ ...actionProps(), l1State: l1State() });
    expect(layout(empty.result.current).disabled).toBe(true);
    await empty.unmount();
  });
}

function registerActionAlternativeTests(): void {
  it("renders collect, intermediate, and reverse-direction action alternatives", async () => {
    queryMock.result = {
      data: { ...activeTxInfo(), conversionKind: "collect-only" },
      isFetching: false,
    };
    const collect = await actionLayout({
      ...actionProps(),
      amount: 0n,
      l1State: { ...l1State(), hasCollectable: true },
    });
    expect(collect.action).toBe("collect converted funds");
    expect(collect.disabled).toBe(false);

    // Nothing to sign, something converting: the date still shows; without either, it waits.
    queryMock.result = {
      data: { ...nothingToSign, estimatedMaturity: 180_000n },
      isFetching: false,
    };
    const converting = await actionLayout({
      ...actionProps(),
      amount: 0n,
      l1State: { ...l1State(), hasConverting: true },
    });
    expect(converting.disabled).toBe(true);
    expect(converting.maturity).toBe("in 3 minutes");
    expect(converting.fee).toBe("...");
    const idle = await actionLayout({ ...actionProps(), amount: 0n, l1State: l1State() });
    expect(idle.maturity).toBe("...");
    queryMock.result = { data: undefined, isFetching: true };
    const loading = await actionLayout({
      ...actionProps(),
      amount: 0n,
      l1State: { ...l1State(), hasConverting: true },
    });
    expect(loading.maturity).toBe("...");

    queryMock.result = { data: activeTxInfo(), isFetching: false };
    const intermediate = await renderAction({
      ...actionProps(),
      amount: undefined,
      amountError: "",
      l1State: l1State(),
    });
    const unfinished = layout(intermediate.result.current);
    await click(unfinished);
    expect(unfinished.action).toBe(requestConversion);
    expect(unfinished.disabled).toBe(true);
    expect(unfinished.message).toBe("Finish entering the amount.");
    expect(transactMock.transact).not.toHaveBeenCalled();
    await intermediate.unmount();

    await actionLayout({ ...actionProps(), isCkb2Udt: false, l1State: l1State() });
    expect(txPreviewQueryOptions().enabled).toBe(true);
    expect(txPreviewQueryOptions().queryKey).toContain(false);
  });
}

function registerActionAttemptTests(): void {
  it("restores the normal action and editable form after chain rejection", async () => {
    const failure = `Transaction rejected: validation failed. Hash: 0x${"ab".repeat(32)}`;
    const props = { ...actionProps(), l1State: l1State() };
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    transactMock.transact.mockImplementationOnce(async (params) => {
      await freezeBuiltPreview(params);
      params.setFailure(failure);
      clearPendingTransaction(params.pendingStore);
      params.freezePreview(undefined);
    });
    const { result, unmount } = await renderAction(props);

    await click(layout(result.current));
    const recovered = layout(result.current);

    expect(recovered.action).toBe(requestConversion);
    expect(recovered.disabled).toBe(false);
    expect(recovered.message).toBe(`⚠️ ${failure}`);
    expect(props.freeze).toHaveBeenNthCalledWith(1, true);
    expect(props.freeze).toHaveBeenLastCalledWith(false);
    expect(props.formReset).not.toHaveBeenCalled();
    await unmount();
  });

  it("keeps a state-B build failure visible after refetching state A", async () => {
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
    const app = await renderApp(appProps());
    const { actionParams } = elementProps<ViewProps>(app.result.current);
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    transactMock.transact.mockImplementationOnce(async (params) => {
      params.lockIntent();
      const freshState = await params.refreshState();
      try {
        await freshState.txBuilder(params.isCkb2Udt, params.amount, params.destination);
      } catch (error) {
        params.setFailure(
          error instanceof Error ? error.message : "Fresh preview failed",
        );
        params.freezePreview(undefined);
      }
    });
    const props = { ...actionParams, freeze: vi.fn<(value: boolean) => void>() };
    const { result, rerender, unmount } = await renderAction({
      ...props,
      l1State: stateA,
    });

    await click(layout(result.current));
    // The refetched state arrives as the next render's prop; the failure belongs to the
    // draft, not to the state it was built from.
    await rerender({ ...props, l1State: stateB });
    const recovered = layout(result.current);

    expect(stateB.txBuilder).toHaveBeenCalledWith(true, CKB, { lock: script("11") });
    expect(recovered.message).toBe("⚠️ fresh build failed");
    expect(recovered.disabled).toBe(false);
    expect(props.freeze).toHaveBeenLastCalledWith(false);
    await unmount();
    await app.unmount();
  });

  it("shows waiting before offering recoverable confirmation retry", async () => {
    const confirmation = Promise.withResolvers<undefined>();
    const waitingReady = Promise.withResolvers<undefined>();
    const props = {
      ...actionProps(),
      l1State: l1State(),
      refreshState: vi.fn(async () => {
        await Promise.resolve();
        return {
          ...l1State(),
          stateId: "fresh-state",
          txBuilder: async (): Promise<ReturnType<typeof activeTxInfo>> => {
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
      await freezeBuiltPreview(params);
      await recordPending(params.pendingStore, `0x${"ab".repeat(32)}`);
      params.setIsConfirming(true);
      waitingReady.resolve(undefined);
      await confirmation.promise;
      params.setFailure("RPC unavailable");
      params.setIsConfirming(false);
    });
    const { result, rerender, unmount } = await renderAction(props);

    await inAct(async () => {
      layout(result.current).onAction?.();
      await waitingReady.promise;
    });
    // App passes the store's record down; this test owns the store, so it does.
    const pending = { ...props, pendingTransaction: props.pendingStore.current };
    await rerender(pending);
    const waiting = layout(result.current);

    expect(waiting.action).toBe("confirming...");
    expect(waiting.disabled).toBe(true);
    expect(waiting.fee).toBe("0.00000009 CKB");
    expect(waiting.maturity).toBe("in 3 minutes");
    expect(waiting.message).toContain(
      "Part converts at a fixed time, the rest when a bot fills it, estimated below.",
    );
    // The re-renders during the wait leave the attempt its live controller and the form frozen.
    expect(transactMock.transact.mock.calls[0]?.[0].signal.aborted).toBe(false);
    expect(props.freeze).not.toHaveBeenCalledWith(false);

    confirmation.resolve(undefined);
    await settle();
    const retry = layout(result.current);

    expect(retry.action).toBe("retry confirmation");
    expect(retry.disabled).toBe(false);
    await click(retry);
    expect(transactMock.retryConfirmation).toHaveBeenCalledTimes(1);
    await unmount();
  });
}

function registerPendingTransactionRecoveryTests(): void {
  it("restores the session's hash and aborts ownership on unmount", async () => {
    const txHash = `0x${"cd".repeat(32)}` as const;
    const props = actionProps();
    await recordPending(props.pendingStore, txHash);
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    // StrictMode's extra mount and cleanup must leave the surviving mount's controller live.
    const { result, unmount } = await renderAction(
      { ...props, pendingTransaction: props.pendingStore.current, l1State: l1State() },
      { strict: true },
    );
    const restored = layout(result.current);

    await click(restored);

    expect(restored.action).toBe("retry confirmation");
    expect(restored.disabled).toBe(false);
    expect(transactMock.retryConfirmation).toHaveBeenCalledTimes(1);
    expect(transactMock.transact).not.toHaveBeenCalled();
    expect(props.freeze).toHaveBeenCalledWith(true);
    const retryCall = transactMock.retryConfirmation.mock.calls[0]?.[0];
    expect(retryCall?.txHash).toBe(txHash);
    expect(retryCall?.signal.aborted).toBe(false);

    await unmount();
    expect(retryCall?.signal.aborted).toBe(true);
    expect(props.freeze).toHaveBeenLastCalledWith(false);
    restored.onAction?.();
    expect(transactMock.retryConfirmation).toHaveBeenCalledTimes(1);

    // Another session has its own store and therefore no recorded hash.
    const otherSession = await actionLayout({ ...actionProps(), l1State: l1State() });
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
    const { result, unmount } = await renderAction({
      ...props,
      pendingTransaction: props.pendingStore.current,
      l1State: l1State(),
    });

    await click(layout(result.current));

    expect(transactMock.transact).not.toHaveBeenCalled();
    expect(transactMock.retryConfirmation).not.toHaveBeenCalled();
    sent.resolve(`0x${"ef".repeat(32)}`);
    await submission;
    await unmount();
  });
}

function registerWalletViewTests(): void {
  it("renders WalletAppView with and without loaded balances", () => {
    const baseProps = {
      walletConfig: walletConfig(),
      walletName: "JoyID",
      openWallet: vi.fn<() => void>(),
      isCkb2Udt: true,
      setIsCkb2Udt: vi.fn<(value: boolean) => void>(),
      text: "1",
      setText: vi.fn<(value: string) => void>(),
      quoteState: quoteState(),
      exchangeRatio: quoteState().exchangeRatio,
      isFrozen: false,
      destinationField: {
        text: "",
        setText: vi.fn<(value: string) => void>(),
        isValid: true,
        isForeign: false,
      },
      actionParams: actionProps(),
      amount: CKB,
    } satisfies Omit<ViewProps, "l1State">;

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
      elementProps<Parameters<typeof Form>[0]>(firstElement(formElements)).projection,
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

function appProps(overrides: Partial<AppProps> = {}): AppProps & {
  setText: ReturnType<typeof vi.fn<(value: string) => void>>;
} {
  return {
    walletConfig: walletConfig(),
    walletName: "JoyID",
    openWallet: vi.fn<() => void>(),
    isCkb2Udt: true,
    setIsCkb2Udt: vi.fn<(value: boolean) => void>(),
    text: "1",
    ...overrides,
    setText: vi.fn<(value: string) => void>(),
  };
}

async function renderApp(
  props: AppProps,
): ReturnType<typeof renderHook<AppProps, ReactElement>> {
  return renderHook((current: AppProps) => App(current), props);
}

async function renderAction(
  props: ActionProps,
  options?: Parameters<typeof renderHook>[2],
): ReturnType<typeof renderHook<ActionProps, ReactElement>> {
  return renderHook((current: ActionProps) => Action(current), props, options);
}

/** The layout an Action renders on mount, unmounted again once read. */
async function actionLayout(props: ActionProps): Promise<LayoutProps> {
  const { result, unmount } = await renderAction(props);
  const rendered = layout(result.current);
  await unmount();
  return rendered;
}

function layout(element: ReactElement): LayoutProps {
  return elementProps<LayoutProps>(element);
}

/** Presses the action and lets the attempt it starts run to its next wait. */
async function click(rendered: LayoutProps): Promise<void> {
  await inAct(() => {
    rendered.onAction?.();
  });
  await settle();
}

/** What the default transaction double does: freeze the preview built from fresh state. */
async function freezeBuiltPreview(
  params: Parameters<typeof transactMock.transact>[0],
): Promise<void> {
  params.lockIntent();
  const state = await params.refreshState();
  const txInfo = await state.txBuilder(
    params.isCkb2Udt,
    params.amount,
    params.destination,
  );
  if (txInfo.ok) {
    params.freezePreview({ ...state, txInfo });
  }
}
