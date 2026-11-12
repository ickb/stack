import { skipToken } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { activeTxInfo } from "../action/fixtures/transaction.ts";
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
  Dashboard,
  Form,
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

    // The account query runs from the first render: nothing is frozen yet.
    expect(queryMock.options).toMatchObject({ enabled: true });
    view.actionParams.retryState();
    const { formReset, refreshState } = await startedAttempt(view);
    formReset();
    const refreshedState = await refreshState();

    expect(view.isCkb2Udt).toBe(false);
    expect(view.amount).toBe(2n * CKB);
    expect(view.exchangeRatio).toBe(loadedState.exchangeRatio);
    expect(props.setText).toHaveBeenCalledWith("");
    expect(refreshedState).toBe(loadedState);
    // The retry, the attempt's own refresh, and the one called here.
    expect(refetch).toHaveBeenCalledTimes(3);

    // Without wallet data or a quote there is no ratio to quote the form at.
    queryMock.result = { data: undefined, error: null, isFetching: true, refetch };
    await rerender(appProps({ text: "" }));
    expect(elementProps<ViewProps>(result.current).exchangeRatio).toBeUndefined();
    await unmount();
  });

  it("rejects failed or missing fresh wallet data", async () => {
    const down = new Error("RPC down");
    // The query's own error stays attached for whoever logs the failure.
    for (const [refetched, message, cause] of [
      [{ data: undefined, error: down }, "Unable to refresh wallet data", down],
      [{ data: undefined, error: null }, "Fresh wallet data is unavailable", undefined],
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
      const { refreshState } = await startedAttempt(
        elementProps<ViewProps>(result.current),
      );

      let failure: unknown;
      try {
        await refreshState();
      } catch (error) {
        failure = error;
      }
      if (!(failure instanceof Error)) {
        throw new TypeError("refreshState did not reject with an Error");
      }
      expect(failure.message).toContain(message);
      expect(failure.cause).toBe(cause);
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
      action: requestConversion,
      disabled: true,
      isDone: false,
      message: "Loading wallet data...",
    });
    await loading.unmount();

    const errored = await renderAction({
      ...actionProps(),
      l1State: undefined,
      stateError: new Error("RPC down"),
      retryState,
    });
    expect(layout(errored.result.current)).toMatchObject({
      action: "Retry wallet data",
      isDone: true,
      message: "⚠️ Unable to load wallet data: RPC down",
    });
    layout(errored.result.current).onAction?.();
    expect(retryState).toHaveBeenCalledTimes(1);
    expect(retryState).toHaveBeenCalledWith();
    await errored.unmount();

    queryMock.result = { data: activeTxInfo(), isFetching: false };
    const onAction = vi.fn<() => void>();
    const ready = await renderAction({ ...actionProps(), onAction, l1State: l1State() });
    const props = layout(ready.result.current);
    await expect(queryFnOf(txPreviewQueryOptions())()).resolves.toBe(nothingToSign);
    // A failed build is shown, not retried: each one completes a real transaction.
    expect(txPreviewQueryOptions()).toMatchObject({ retry: false });
    expect(props.disabled).toBe(false);
    expect(props.isDone).toBe(true);
    expect(props.fee).toBe("0.00000001 CKB");

    await click(props);
    expect(onAction).toHaveBeenCalledTimes(1);
    await ready.unmount();

    const refreshing = await actionLayout({
      ...actionProps(),
      l1State: l1State(),
      isStateFetching: true,
    });
    expect(refreshing.disabled).toBe(true);
    expect(refreshing.isDone).toBe(false);

    queryMock.result = { data: undefined, isFetching: false };
    const empty = await renderAction({ ...actionProps(), l1State: l1State() });
    expect(layout(empty.result.current)).toMatchObject({
      disabled: true,
      message: "No conversion request available for this amount.",
    });
    await empty.unmount();
  });

  it("keys the preview by state and draft, following the amount once typing settles", async () => {
    vi.useFakeTimers();
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    const props = { ...actionProps(), l1State: l1State() };
    const { rerender, unmount } = await renderAction(props);
    const key = (): readonly unknown[] => txPreviewQueryOptions().queryKey;
    const wait = async (ms: number): Promise<void> => {
      await inAct(() => {
        vi.advanceTimersByTime(ms);
      });
    };

    expect(key()).toEqual(expect.arrayContaining(["state-id", String(CKB)]));
    await rerender({ ...props, amount: 2n * CKB });
    await wait(200);
    await rerender({ ...props, amount: 3n * CKB });
    await wait(200);
    // The second edit restarted the wait, so the first edit never builds a preview.
    expect(key()).toContain(String(CKB));
    await wait(100);
    expect(key()).toContain(String(3n * CKB));
    await unmount();
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

    // Nothing to sign, something converting: the state's date still shows; without either,
    // it waits.
    queryMock.result = { data: nothingToSign, isFetching: false };
    const converting = await actionLayout({
      ...actionProps(),
      amount: 0n,
      l1State: { ...l1State(), hasConverting: true, estimatedMaturity: 180_000n },
    });
    expect(converting.disabled).toBe(true);
    expect(converting.maturity).toBe("in 3 minutes");
    expect(converting.fee).toBe("...");
    // A conversion due sooner than what is converting shows the later date: everything.
    queryMock.result = {
      data: activeTxInfo("11", { estimatedMaturity: 60_000n }),
      isFetching: false,
    };
    const sooner = await actionLayout({
      ...actionProps(),
      l1State: { ...l1State(), hasConverting: true, estimatedMaturity: 180_000n },
    });
    expect(sooner.maturity).toBe("in 3 minutes");
    queryMock.result = { data: nothingToSign, isFetching: false };
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
    expect(unfinished.action).toBe(requestConversion);
    expect(unfinished.disabled).toBe(true);
    expect(unfinished.message).toBe("Finish entering the amount.");
    expect(txPreviewQueryOptions().queryFn).toBe(skipToken);
    await intermediate.unmount();

    await actionLayout({ ...actionProps(), isCkb2Udt: false, l1State: l1State() });
    expect(txPreviewQueryOptions().enabled).toBe(true);
    expect(txPreviewQueryOptions().queryKey).toContain(false);
  });
}

function registerActionAttemptTests(): void {
  it("starts the session's attempt on the drafted amount, and none on an unfinished one", async () => {
    queryMock.result = { data: l1State(), error: null, isFetching: false };
    const app = await renderApp(appProps({ isCkb2Udt: false, text: "2" }));
    const params = await startedAttempt(elementProps<ViewProps>(app.result.current));

    expect(params).toMatchObject({ isCkb2Udt: false, amount: 2n * CKB });
    expect(params.walletConfig).toBe(
      elementProps<ViewProps>(app.result.current).walletConfig,
    );
    await app.unmount();

    const unfinished = await renderApp(appProps({ text: "." }));
    elementProps<ViewProps>(unfinished.result.current).actionParams.onAction();
    expect(transactMock.transact).toHaveBeenCalledTimes(1);
    await unfinished.unmount();
  });

  it("holds the draft and the account read from the click to the last step", async () => {
    queryMock.result = { data: l1State(), error: null, isFetching: false };
    const props = appProps();
    const app = await renderApp(props);
    const params = await startedAttempt(elementProps<ViewProps>(app.result.current));
    const view = (): ViewProps => elementProps<ViewProps>(app.result.current);

    await inAct(() => {
      params.setPhase("preparing");
    });
    expect(view().isFrozen).toBe(true);
    expect(queryMock.options).toMatchObject({ enabled: false });

    const preview = { ...l1State(), txInfo: activeTxInfo() };
    await inAct(() => {
      params.freezePreview(preview);
      params.setPhase("confirming");
      params.setMessage("Transaction 0xab sent. Waiting for network confirmation...");
    });
    expect(view().actionParams.attempt).toEqual({
      phase: "confirming",
      message: "Transaction 0xab sent. Waiting for network confirmation...",
      failure: "",
      frozenPreview: preview,
    });

    // The last step releases the preview and ends the attempt; only then does the form thaw.
    await inAct(() => {
      params.setFailure("Transaction rejected: dead input. Hash: 0xab");
      params.freezePreview(undefined);
    });
    expect(view().isFrozen).toBe(true);
    await inAct(() => {
      params.setPhase("idle");
    });
    expect(view().isFrozen).toBe(false);
    expect(view().actionParams.attempt.failure).toBe(
      "Transaction rejected: dead input. Hash: 0xab",
    );
    // The failure belongs to the draft it was built for: an edit clears it.
    await app.rerender({ ...props, text: "2" });
    expect(view().actionParams.attempt.failure).toBe("");
    await app.unmount();
  });

  it("renders the session's attempt: preparing, confirming, then a failure", async () => {
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    const preview = {
      ...l1State(),
      stateId: "fresh-state",
      txInfo: {
        ...activeTxInfo(),
        plannedFee: 9n,
        estimatedMaturity: 120_001n,
        conversionKind: "direct-plus-order" as const,
      },
    };
    const props = { ...actionProps(), l1State: l1State() };

    const preparing = await actionLayout({
      ...props,
      attempt: { ...props.attempt, phase: "preparing", message: "Refreshing..." },
    });
    expect(preparing).toMatchObject({
      disabled: true,
      isDone: false,
      message: "Refreshing...",
    });

    const retrying =
      "Transaction 0xab sent. Waiting for network confirmation... First send: fetch failed";
    const confirming = await actionLayout({
      ...props,
      attempt: {
        phase: "confirming",
        message: retrying,
        failure: "",
        frozenPreview: preview,
      },
    });
    expect(confirming).toMatchObject({
      action: "confirming...",
      disabled: true,
      isDone: false,
      message: retrying,
      fee: "0.00000009 CKB",
      maturity: "in 3 minutes",
    });
    expect(txPreviewQueryOptions().enabled).toBe(false);

    const failure = "Transaction rejected: dead input. Hash: 0xab";
    const failed = await actionLayout({
      ...props,
      attempt: { ...props.attempt, failure },
    });
    expect(failed).toMatchObject({
      action: requestConversion,
      disabled: false,
      message: `⚠️ ${failure}`,
    });
  });

  it("holds the action on the frozen preview's state while the wallet signs", async () => {
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    const props = { ...actionProps(), amount: 0n, l1State: l1State() };
    const signing = await actionLayout({
      ...props,
      attempt: {
        phase: "confirming",
        message: "Confirm the transaction in your wallet.",
        failure: "",
        frozenPreview: { ...l1State(), hasCollectable: true, txInfo: activeTxInfo() },
      },
    });

    // The live state has nothing to collect; the frozen one the wallet signs does.
    expect(signing.action).toBe("confirming...");
    expect(signing.disabled).toBe(true);
    expect(signing.message).toBe("Confirm the transaction in your wallet.");
    expect(txPreviewQueryOptions().enabled).toBe(false);
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
      elementProps<Parameters<typeof Form>[0]>(firstElement(formElements)).state,
    ).toMatchObject({
      ckbNative: 3n * CKB,
      ickbNative: 2n * CKB,
    });
    // The form and the header run on the page's own draft and wallet.
    expect(elementProps<object>(firstElement(formElements))).toMatchObject({
      isCkb2Udt: true,
      text: "1",
      setText: baseProps.setText,
    });
    expect(
      elementProps<object>(
        firstElement(findElements(withBalances, (element) => element.type === Dashboard)),
      ),
    ).toMatchObject({ walletName: "JoyID", openWallet: baseProps.openWallet });
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

/** Presses the session's action and returns what it handed `transact`. */
async function startedAttempt(
  view: ViewProps,
): Promise<Parameters<typeof transactMock.transact>[0]> {
  await inAct(() => {
    view.actionParams.onAction();
  });
  const params = transactMock.transact.mock.calls.at(-1)?.[0];
  if (params === undefined) {
    throw new Error("transact was not called");
  }
  return params;
}
