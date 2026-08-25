import type { ccc } from "@ckb-ccc/ccc";
import type {
  signAndSendTransaction as sdkSignAndSendTransaction,
  waitTransaction as sdkWaitTransaction,
} from "@ickb/sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, Fragment, type ReactElement } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionLayout } from "../../src/action/ActionLayout.tsx";
import type { RefreshedTransactionState } from "../../src/action/actionTransaction.ts";
import type { L1StateType } from "../../src/query/queries.ts";
import type { TxInfo, WalletConfig } from "../../src/shared/utils.ts";
import { txWithInput } from "../action/fixtures/transaction.ts";
import { waitCallOptions } from "../support/wait.ts";

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
  it("retries the recorded hash after a remount on the same QueryClient", async () => {
    const queryClient = new QueryClient();
    const { sent, root: firstRoot, send: firstSend } = await submittedAction(queryClient);
    flushSync(() => {
      firstRoot.unmount();
    });

    const replacementSend = vi.fn(async () => {
      await Promise.resolve();
      return txHash;
    });
    const replacementConfig = walletConfig(queryClient, replacementSend);
    const replacementRoot = renderAction(replacementConfig);
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
      replacementRoot.unmount();
    });
  });

  it("offers no recorded hash to a replacement QueryClient", async () => {
    const {
      freshAction,
      sent,
      root: firstRoot,
    } = await submittedAction(new QueryClient());
    flushSync(() => {
      firstRoot.unmount();
    });

    const replacementRoot = renderAction(walletConfig(new QueryClient(), vi.fn()));

    expect(currentLayout().action).toBe(freshAction);
    expect(mocks.waitTransaction).not.toHaveBeenCalled();
    sent.resolve(txHash);
    flushSync(() => {
      replacementRoot.unmount();
    });
  });
});

/** Renders an action, submits it, and leaves the broadcast unresolved with its hash recorded. */
async function submittedAction(queryClient: QueryClient): Promise<{
  freshAction: string;
  root: ReturnType<typeof createRoot>;
  send: ReturnType<typeof vi.fn>;
  sent: PromiseWithResolvers<ccc.Hex>;
}> {
  const sent = Promise.withResolvers<ccc.Hex>();
  const send = vi.fn(async () => sent.promise);
  const root = renderAction(walletConfig(queryClient, send));
  const freshAction = currentLayout().action;
  expect(freshAction).not.toBe("retry confirmation");

  currentLayout().onAction?.();
  await vi.waitFor(() => {
    expect(send).toHaveBeenCalledTimes(1);
  });
  return { freshAction, root, send, sent };
}

function renderAction(walletConfig: WalletConfig): ReturnType<typeof createRoot> {
  walletConfig.queryClient.setQueryData(
    [walletConfig.chain, walletConfig.address, "txInfo", "state", true, "1"],
    activeTxInfo(),
  );
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- React DOM owns this structural test container boundary.
  const root = createRoot(fakeContainer(testDocument) as unknown as Element);
  flushSync(() => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: walletConfig.queryClient },
        createElement(Action, actionProps(walletConfig)),
      ),
    );
  });
  return root;
}

function actionProps(walletConfig: WalletConfig): Parameters<typeof Action>[0] {
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

function activeTxInfo(): TxInfo {
  return {
    tx: txWithInput("11"),
    error: "",
    fee: 1n,
    estimatedMaturity: 0n,
    conversionKind: "order",
  };
}

function l1State(): L1StateType {
  const candidate: unknown = {
    ckbNative: 0n,
    ickbNative: 0n,
    ckbBalance: 0n,
    ickbBalance: 0n,
    ckbAvailable: 0n,
    ickbAvailable: 0n,
    tipTimestamp: 0n,
    system: {},
    stateId: "state",
    txBuilder: async () => {
      await Promise.resolve();
      return activeTxInfo();
    },
    hasCollectable: false,
  };
  if (!isL1State(candidate)) {
    throw new Error("L1 state fixture is invalid");
  }
  return candidate;
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

function isL1State(value: unknown): value is L1StateType {
  return typeof value === "object" && value !== null && "txBuilder" in value;
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
