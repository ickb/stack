import { ccc } from "@ckb-ccc/ccc";
import { script } from "@ickb/testkit";
import { skipToken } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { shortAddress } from "../../src/action/destination.ts";
import { activeTxInfo, recordPending } from "../action/fixtures/transaction.ts";
import {
  elementProps,
  findElement,
  findElements,
  firstElement,
  invokeElement,
} from "../support/react.ts";
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
  testnetClient,
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

    // The account query runs from the first render: nothing is frozen yet.
    expect(queryMock.options).toMatchObject({ enabled: true });
    expect(view.destinationField).toMatchObject({
      text: "",
      isValid: true,
      isForeign: false,
    });
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

  it("zeroes the amount for a foreign destination once it resolves, keeping the typed text", async () => {
    queryMock.result = {
      data: l1State(),
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    };
    const props = appProps({ text: "2" });
    const { result, unmount } = await renderApp(props);
    const foreign = ccc.Address.fromScript(script("22"), testnetClient);
    const parse = Promise.withResolvers<ccc.Address>();
    vi.spyOn(ccc.Address, "fromString").mockReturnValueOnce(parse.promise);
    const view = (): ViewProps => elementProps<ViewProps>(result.current);

    await inAct(() => {
      view().destinationField.setText(foreign.toString());
    });
    expect(view().destinationField).toMatchObject({ isValid: false, isForeign: false });
    expect(view().text).toBe("2");
    parse.resolve(foreign);
    await settle();

    expect(view().destinationField).toMatchObject({ isValid: true, isForeign: true });
    expect(view().text).toBe("0");
    expect(view().actionParams.amount).toBe(0n);
    expect(props.setText).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    await unmount();
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
    expect(layout(errored.result.current).message).toBe(
      "⚠️ Unable to load wallet data: RPC down",
    );
    layout(errored.result.current).onAction?.();
    expect(retryState).toHaveBeenCalledTimes(1);
    expect(retryState).toHaveBeenCalledWith();
    await errored.unmount();

    const freeze = vi.fn<(value: boolean) => void>();
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    const ready = await renderAction({ ...actionProps(), freeze, l1State: l1State() });
    const props = layout(ready.result.current);
    await expect(queryFnOf(txPreviewQueryOptions())()).resolves.toBe(nothingToSign);
    // A failed build is shown, not retried: each one completes a real transaction.
    expect(txPreviewQueryOptions()).toMatchObject({ retry: false });
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

    const refreshing = await actionLayout({
      ...actionProps(),
      l1State: l1State(),
      isStateFetching: true,
    });
    expect(refreshing.disabled).toBe(true);

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

    expect(key()).toEqual(
      expect.arrayContaining(["state-id", String(CKB), script("11").hash()]),
    );
    await rerender({ ...props, amount: 2n * CKB });
    await wait(200);
    await rerender({ ...props, amount: 3n * CKB });
    await wait(200);
    // The second edit restarted the wait, so the first edit never builds a preview.
    expect(key()).toContain(String(CKB));
    await wait(100);
    expect(key()).toContain(String(3n * CKB));
    await rerender({ ...props, amount: 3n * CKB, destination: {} });
    expect(key()).toContain("own");
    await unmount();
  });

  it("parks the preview and refuses the action while the destination is unresolved", async () => {
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    const { result, unmount } = await renderAction({
      ...actionProps(),
      destination: undefined,
      l1State: l1State(),
    });
    const unresolved = layout(result.current);
    await click(unresolved);

    expect(unresolved).toMatchObject({
      disabled: true,
      message: "Checking the destination address...",
    });
    expect(txPreviewQueryOptions().queryFn).toBe(skipToken);
    expect(txPreviewQueryOptions().queryKey).toContain("invalid");
    expect(transactMock.transact).not.toHaveBeenCalled();
    await unmount();
  });

  it("labels a move and dates it now, since converting funds stay behind", async () => {
    const moveTo = "ckt1qzda...abcdef";
    queryMock.result = {
      data: activeTxInfo("11", {
        move: { to: moveTo, isComplete: true },
        estimatedMaturity: 600_000n,
      }),
      isFetching: false,
    };
    const move = await actionLayout({
      ...actionProps(),
      amount: 0n,
      destination: { lock: script("22"), moveTo },
      l1State: l1State(),
    });

    expect(move).toMatchObject({ action: "send all CKB and iCKB", maturity: "now" });
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
    expect(txPreviewQueryOptions().queryFn).toBe(skipToken);
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
    const { result, rerender, unmount } = await renderAction(props);

    await click(layout(result.current));
    const recovered = layout(result.current);

    expect(recovered.action).toBe(requestConversion);
    expect(recovered.disabled).toBe(false);
    expect(recovered.message).toBe(`⚠️ ${failure}`);
    expect(props.freeze).toHaveBeenNthCalledWith(1, true);
    expect(props.freeze).toHaveBeenLastCalledWith(false);
    expect(props.formReset).not.toHaveBeenCalled();
    // The failure belongs to the draft it was built for: an edit clears it.
    await rerender({ ...props, amount: 2n * CKB });
    expect(layout(result.current).message).toBe("Converts at a fixed time, shown below.");
    await unmount();
  });

  it("holds the action on the fresh preview and its state while the wallet signs", async () => {
    queryMock.result = { data: activeTxInfo(), isFetching: false };
    const props = {
      ...actionProps(),
      amount: 0n,
      l1State: l1State(),
      refreshState: vi.fn(async () => {
        await Promise.resolve();
        return {
          ...l1State(),
          hasCollectable: true,
          txBuilder: async (): Promise<ReturnType<typeof activeTxInfo>> => {
            await Promise.resolve();
            return activeTxInfo();
          },
        };
      }),
    };
    const { result, unmount } = await renderAction(props);

    await click(layout(result.current));
    const signing = layout(result.current);

    // The live state has nothing to collect; the frozen one the wallet signs does.
    expect(signing.action).toBe("collect converted funds");
    expect(signing.disabled).toBe(true);
    expect(signing.message).toContain("Confirm the transaction in your wallet.");
    expect(txPreviewQueryOptions().enabled).toBe(false);
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

    expect(stateB.txBuilder).toHaveBeenCalledWith(true, CKB, {});
    // The click froze the form before any preview existed to freeze it.
    expect(props.freeze).toHaveBeenCalledWith(true);
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

    expect(layout(result.current).disabled).toBe(true);
    expect(transactMock.transact).not.toHaveBeenCalled();
    expect(transactMock.retryConfirmation).not.toHaveBeenCalled();
    sent.resolve(`0x${"ef".repeat(32)}`);
    await submission;
    await unmount();
  });
}

function registerWalletViewTests(): void {
  it("edits the destination in full and shows it shortened at rest, linked in the explorer", async () => {
    const foreign = "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq";
    const own = "ckb1qyqrdsefa43s6m882pcj53m4gdnj4k440axqdt9rtd";
    const setText = vi.fn<(value: string) => void>();
    const props = (
      chain: "mainnet" | "testnet",
      destination: Omit<Parameters<typeof Dashboard>[0]["destination"], "setText">,
    ): Parameters<typeof Dashboard>[0] => ({
      walletConfig: { ...walletConfig(), chain, address: own },
      walletName: "JoyID",
      openWallet: vi.fn<() => void>(),
      destination: { ...destination, setText },
      disabled: false,
    });
    const { result, rerender, unmount } = await renderHook(
      (current: Parameters<typeof Dashboard>[0]) =>
        invokeElement(
          findElement(Dashboard(current), (element) =>
            Object.hasOwn(elementProps<object>(element), "ownAddress"),
          ),
        ),
      props("testnet", { text: foreign, isValid: true, isForeign: true }),
    );
    interface Field {
      value: string;
      placeholder: string;
      onFocus: () => void;
      onBlur: () => void;
      onChange: (event: { target: { value: string } }) => void;
      onPaste: (event: { currentTarget: { blur: () => void } }) => void;
    }
    const field = (): Field =>
      elementProps<Field>(findElement(result.current, (node) => node.type === "input"));
    const href = (): string =>
      elementProps<{ href: string }>(
        findElement(result.current, (node) => node.type === "a"),
      ).href;

    expect(field().value).toBe(`→ ${shortAddress(foreign)}`);
    expect(href()).toBe(`https://testnet.explorer.nervos.org/address/${foreign}`);
    await inAct(() => {
      field().onFocus();
    });
    expect(field().value).toBe(foreign);
    field().onChange({ target: { value: "ckt1" } });
    expect(setText).toHaveBeenCalledWith("ckt1");
    // A paste is the whole edit: the field lets go so the address shows shortened.
    const blur = vi.fn<() => void>();
    field().onPaste({ currentTarget: { blur } });
    await settle();
    expect(blur).toHaveBeenCalledTimes(1);
    await inAct(() => {
      field().onBlur();
    });
    expect(field().value).toBe(`→ ${shortAddress(foreign)}`);

    await rerender(
      props("mainnet", { text: ` ${own} `, isValid: true, isForeign: false }),
    );
    expect(href()).toBe(`https://explorer.nervos.org/address/${own}`);
    await rerender(props("mainnet", { text: own, isValid: true, isForeign: false }));
    expect(field().value).toBe(shortAddress(own));
    // Empty or invalid text links the wallet's own address; invalid text stays as typed.
    await rerender(props("mainnet", { text: "", isValid: true, isForeign: false }));
    expect(field()).toMatchObject({ value: "", placeholder: shortAddress(own) });
    expect(href()).toBe(`https://explorer.nervos.org/address/${own}`);
    await rerender(props("mainnet", { text: "nope", isValid: false, isForeign: false }));
    expect(field().value).toBe("nope");
    expect(href()).toBe(`https://explorer.nervos.org/address/${own}`);
    await unmount();
  });

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
