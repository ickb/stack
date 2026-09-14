import type { ccc } from "@ckb-ccc/ccc";
import type {
  signAndSendTransaction as sdkSignAndSendTransaction,
  waitTransaction as sdkWaitTransaction,
} from "@ickb/sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, Fragment, useState, type ReactElement } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionLayout } from "../../src/action/ActionLayout.tsx";
import type { RefreshedTransactionState } from "../../src/action/actionTransaction.ts";
import {
  createPendingTransactionStore,
  type PendingTransactionState,
} from "../../src/action/pendingTransaction.ts";
import type { TxInfo, WalletConfig } from "../../src/shared/utils.ts";
import { waitCallOptions } from "../support/wait.ts";
import { activeTxInfo, l1State } from "./fixtures/l1State.ts";

class TestElement {
  public readonly nodeType = 1;
}
class TestIFrameElement extends TestElement {}
interface TestDocument {
  readonly activeElement: null;
  readonly addEventListener: ReturnType<typeof vi.fn>;
  readonly defaultView: {
    readonly event: undefined;
    readonly HTMLElement: typeof TestElement;
    readonly HTMLIFrameElement: typeof TestIFrameElement;
  };
  readonly nodeType: 9;
}

const txHash = `0x${"ab".repeat(32)}` as const;
const mocks = vi.hoisted<{
  layout: Parameters<typeof ActionLayout>[0] | undefined;
  signAndSendTransaction: ReturnType<typeof vi.fn<typeof sdkSignAndSendTransaction>>;
  waitTransaction: ReturnType<typeof vi.fn<typeof sdkWaitTransaction>>;
}>(() => ({
  layout: undefined,
  signAndSendTransaction: vi.fn(),
  waitTransaction: vi.fn(),
}));

vi.mock(import("../../src/action/ActionLayout.tsx"), () => ({
  ActionLayout: (props: Parameters<typeof ActionLayout>[0]): ReactElement => {
    mocks.layout = props;
    return createElement(Fragment);
  },
}));

vi.mock(import("@ickb/sdk"), async (importActual) => ({
  ...(await importActual()),
  signAndSendTransaction: mocks.signAndSendTransaction,
  waitTransaction: mocks.waitTransaction,
}));

const Action = (await import("../../src/action/Action.tsx")).default;
const originalDocument: unknown = Reflect.get(globalThis, "document");
const originalWindow: unknown = Reflect.get(globalThis, "window");
const testDocument = fakeDocument();
vi.stubGlobal("document", testDocument);
vi.stubGlobal("window", testDocument.defaultView);
const { flushSync } = await import("react-dom");
const { createRoot } = await import("react-dom/client");

beforeEach(() => {
  mocks.layout = undefined;
  mocks.signAndSendTransaction.mockReset();
  mocks.signAndSendTransaction.mockImplementation(async (signer, tx, recordTxHash) => {
    recordTxHash?.(txHash);
    return fakeSend(signer)(tx);
  });
  mocks.waitTransaction.mockReset();
  mocks.waitTransaction.mockImplementation(waitUntilStopped);
});

afterAll(async () => {
  await new Promise<undefined>((resolve) => {
    setTimeout(() => {
      resolve(undefined);
    }, 0);
  });
  vi.stubGlobal("document", originalDocument);
  vi.stubGlobal("window", originalWindow);
  vi.unstubAllGlobals();
});

describe("pending transaction remount ownership", () => {
  it("retries the recorded hash after the action remounts within the same wallet session", async () => {
    const { sent, root, send: firstSend } = await submittedAction();

    const replacementSend = vi.fn(async () => {
      await Promise.resolve();
      return txHash;
    });
    const replacementConfig = walletConfig(new QueryClient(), replacementSend);
    renderHost(root, replacementConfig, 1);
    expect(currentLayout().action).toBe("retry confirmation");
    expect(currentLayout().disabled).toBe(false);

    currentLayout().onAction?.();

    expect(firstSend).toHaveBeenCalledTimes(1);
    expect(replacementSend).not.toHaveBeenCalled();
    const waitCall = mocks.waitTransaction.mock.calls[0];
    expect(waitCall?.[0]).toBe(replacementConfig.signer.client);
    expect(waitCall?.[1]).toBe(txHash);
    const waitOptions = waitCallOptions(waitCall);
    expect(waitOptions.timeout).toBeGreaterThan(0);
    expect(waitOptions.signal).toBeInstanceOf(AbortSignal);
    sent.resolve(txHash);
    flushSync(() => {
      root.unmount();
    });
  });

  it("offers no recorded hash to a replacement wallet session", async () => {
    const { freshAction, sent, root: firstRoot } = await submittedAction();
    flushSync(() => {
      firstRoot.unmount();
    });

    const replacementRoot = renderHost(
      createRootForTest(),
      walletConfig(new QueryClient(), vi.fn()),
      0,
    );

    expect(currentLayout().action).toBe(freshAction);
    expect(mocks.waitTransaction).not.toHaveBeenCalled();
    sent.resolve(txHash);
    flushSync(() => {
      replacementRoot.unmount();
    });
  });
});

/** Renders an action, submits it, and leaves the broadcast unresolved with its hash recorded. */
async function submittedAction(): Promise<{
  freshAction: string;
  root: ReturnType<typeof createRoot>;
  send: ReturnType<typeof vi.fn>;
  sent: PromiseWithResolvers<ccc.Hex>;
}> {
  const sent = Promise.withResolvers<ccc.Hex>();
  const send = vi.fn(async () => sent.promise);
  const root = renderHost(createRootForTest(), walletConfig(new QueryClient(), send), 0);
  const freshAction = currentLayout().action;
  expect(freshAction).not.toBe("retry confirmation");

  currentLayout().onAction?.();
  await vi.waitFor(() => {
    expect(send).toHaveBeenCalledTimes(1);
  });
  return { freshAction, root, send, sent };
}

function createRootForTest(): ReturnType<typeof createRoot> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- React DOM owns this structural test container boundary.
  return createRoot(fakeContainer(testDocument) as unknown as Element);
}

/** Renders the session host; a new generation remounts the action under the same host. */
function renderHost(
  root: ReturnType<typeof createRoot>,
  walletConfig: WalletConfig,
  generation: number,
): ReturnType<typeof createRoot> {
  walletConfig.queryClient.setQueryData(
    [walletConfig.chain, walletConfig.address, "txInfo", "state", true, "1"],
    activeTxInfo(),
  );
  flushSync(() => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: walletConfig.queryClient },
        createElement(PendingHost, { walletConfig, generation }),
      ),
    );
  });
  return root;
}

/** Owns the pending record the way App does, so a remounted action sees the same store. */
// eslint-disable-next-line react-refresh/only-export-components -- Test-local host component.
function PendingHost({
  walletConfig,
  generation,
}: Readonly<{ walletConfig: WalletConfig; generation: number }>): ReactElement {
  const [pendingTransaction, setPendingTransaction] = useState<PendingTransactionState>();
  const [store] = useState(() => createPendingTransactionStore(setPendingTransaction));
  return createElement(Action, {
    key: generation,
    ...actionProps(walletConfig),
    pendingTransaction,
    pendingStore: store,
  });
}

function actionProps(
  walletConfig: WalletConfig,
): Omit<Parameters<typeof Action>[0], "pendingTransaction" | "pendingStore"> {
  return {
    isCkb2Udt: true,
    amount: 1n,
    amountError: "",
    refreshPreview: async (): Promise<RefreshedTransactionState> => {
      await Promise.resolve();
      return {
        stateId: "state",
        tipTimestamp: 0n,
        hasCollectable: false,
        build: async (): Promise<TxInfo> => {
          await Promise.resolve();
          return activeTxInfo();
        },
      };
    },
    freeze: vi.fn<(value: boolean) => void>(),
    formReset: vi.fn<() => void>(),
    walletConfig,
    l1State: l1State(),
    isStateFetching: false,
    stateError: null,
    retryState: vi.fn<() => void>(),
  };
}

function currentLayout(): Parameters<typeof ActionLayout>[0] {
  if (mocks.layout === undefined) {
    throw new Error("Action layout was not rendered");
  }
  return mocks.layout;
}

function walletConfig(
  queryClient: QueryClient,
  sendTransaction: ReturnType<typeof vi.fn>,
): WalletConfig {
  const client = {};
  const candidate: unknown = {
    chain: "testnet",
    address: "ckt1remount",
    queryClient,
    cccClient: client,
    resetClient: vi.fn<() => void>(),
    signer: { client, sendTransaction },
    accountLocks: [],
    primaryLock: {},
    sdk: {},
  };
  if (!isWalletConfig(candidate)) {
    throw new Error("Wallet fixture is invalid");
  }
  return candidate;
}

function fakeSend(signer: ccc.Signer): (tx: ccc.TransactionLike) => Promise<ccc.Hex> {
  if (!("sendTransaction" in signer) || typeof signer.sendTransaction !== "function") {
    throw new Error("Missing test send operation");
  }
  return signer.sendTransaction.bind(signer);
}

function isWalletConfig(value: unknown): value is WalletConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "queryClient" in value &&
    "signer" in value
  );
}

// eslint-disable-next-line @typescript-eslint/promise-function-async -- The wait double never settles except on abort.
function waitUntilStopped(
  ...args: Parameters<typeof sdkWaitTransaction>
): ReturnType<typeof sdkWaitTransaction> {
  const { signal } = waitCallOptions(args);
  return new Promise<never>((_resolve, reject) => {
    if (signal === undefined) {
      reject(new Error("Missing confirmation signal"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        reject(new Error("stopped"));
      },
      { once: true },
    );
  });
}

function fakeDocument(): TestDocument {
  return {
    activeElement: null,
    addEventListener: vi.fn(),
    defaultView: {
      event: undefined,
      HTMLElement: TestElement,
      HTMLIFrameElement: TestIFrameElement,
    },
    nodeType: 9,
  };
}

function fakeContainer(ownerDocument: TestDocument): object {
  return {
    addEventListener: vi.fn(),
    nodeName: "DIV",
    nodeType: 1,
    ownerDocument,
    removeEventListener: vi.fn(),
    tagName: "DIV",
  };
}
