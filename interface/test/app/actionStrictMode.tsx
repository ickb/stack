import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, Fragment, StrictMode, useState, type ReactElement } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionLayout } from "../../src/action/ActionLayout.tsx";
import type * as TransactionModule from "../../src/action/actionTransaction.ts";
import type { RefreshedTransactionState } from "../../src/action/actionTransaction.ts";
import {
  createPendingTransactionStore,
  submitPendingTransaction,
  type PendingTransactionState,
  type PendingTransactionStore,
} from "../../src/action/pendingTransaction.ts";
import type { L1StateType } from "../../src/query/queries.ts";
import type { TxInfo, WalletConfig } from "../../src/shared/utils.ts";
import { txWithInput } from "../action/fixtures/transaction.ts";

class TestElement {
  public readonly nodeType = 1;
}
class TestIFrameElement extends TestElement {}
interface TestDocument {
  readonly activeElement: null;
  readonly addEventListener: ReturnType<typeof vi.fn>;
  readonly defaultView: {
    event: undefined;
    HTMLElement: typeof TestElement;
    HTMLIFrameElement: typeof TestIFrameElement;
  };
  readonly nodeType: 9;
}

const txHash = `0x${"ab".repeat(32)}` as const;
const mocks = vi.hoisted<{
  layout: Parameters<typeof ActionLayout>[0] | undefined;
  retryConfirmation: ReturnType<typeof vi.fn<typeof TransactionModule.retryConfirmation>>;
  transact: ReturnType<typeof vi.fn<typeof TransactionModule.transact>>;
}>(() => ({
  layout: undefined,
  retryConfirmation: vi.fn(async () => {
    await Promise.resolve();
  }),
  transact: vi.fn(async () => {
    await Promise.resolve();
  }),
}));

vi.mock(import("../../src/action/ActionLayout.tsx"), () => ({
  ActionLayout: (props: Parameters<typeof ActionLayout>[0]): ReactElement => {
    mocks.layout = props;
    return createElement(Fragment);
  },
}));

vi.mock(import("../../src/action/actionTransaction.ts"), async (importActual) => ({
  ...(await importActual()),
  retryConfirmation: mocks.retryConfirmation,
  transact: mocks.transact,
}));

const actionComponent = (await import("../../src/action/Action.tsx")).default;
const originalDocument: unknown = Reflect.get(globalThis, "document");
const originalWindow: unknown = Reflect.get(globalThis, "window");
const nativeAbortController = AbortController;
const testDocument = fakeDocument();
vi.stubGlobal("document", testDocument);
vi.stubGlobal("window", testDocument.defaultView);
const { flushSync } = await import("react-dom");
const { createRoot } = await import("react-dom/client");

beforeEach(() => {
  vi.stubGlobal("document", testDocument);
  vi.stubGlobal("window", testDocument.defaultView);
  mocks.layout = undefined;
  mocks.retryConfirmation.mockClear();
  mocks.transact.mockClear();
});

afterEach(async () => {
  await Promise.resolve();
  vi.stubGlobal("AbortController", nativeAbortController);
});

afterAll(async () => {
  await new Promise<undefined>((resolve) => {
    setTimeout(() => {
      resolve(undefined);
    }, 0);
  });
  vi.stubGlobal("document", originalDocument);
  vi.stubGlobal("window", originalWindow);
});

describe("Action StrictMode ownership", () => {
  it("uses the fresh controller generation for a send click", () => {
    const freeze = vi.fn<(value: boolean) => void>();
    const fixture = walletFixture();
    const { controllers, root } = strictAction(fixture.config, freeze);

    const controllerCount = controllers.length;
    const onAction = currentLayout().onAction;
    onAction?.();

    expect(mocks.transact).toHaveBeenCalledTimes(1);
    expect(controllers).toHaveLength(controllerCount + 1);
    expect(mocks.transact.mock.calls[0]?.[0].signal).toBe(controllers.at(-1)?.signal);
    flushSync(() => {
      root.unmount();
    });
    onAction?.();
    expect(mocks.transact).toHaveBeenCalledTimes(1);
    expect(controllers.at(-1)?.signal.aborted).toBe(true);
    expect(freeze).toHaveBeenCalledWith(false);
  });

  it("uses the fresh controller generation for recovered confirmation retry", () => {
    const fixture = walletFixture();
    const { controllers, root } = strictAction(
      fixture.config,
      vi.fn<(value: boolean) => void>(),
      { status: "pending", txHash },
    );

    expect(currentLayout().action).toBe("retry confirmation");
    const controllerCount = controllers.length;
    currentLayout().onAction?.();

    expect(mocks.retryConfirmation).toHaveBeenCalledTimes(1);
    expect(controllers).toHaveLength(controllerCount + 1);
    expect(mocks.retryConfirmation.mock.calls[0]?.[0].signal).toBe(
      controllers.at(-1)?.signal,
    );
    expect(fixture.sendTransaction).not.toHaveBeenCalled();
    flushSync(() => {
      root.unmount();
    });
  });

  it("stops an active wait and retries it with a fresh controller", stopAndRetry);
});

async function stopAndRetry(): Promise<void> {
  const fixture = walletFixture();
  const { root } = strictAction(fixture.config, vi.fn<(value: boolean) => void>());
  let submitted: Promise<unknown> | undefined;
  mocks.transact.mockImplementationOnce(async (params) => {
    params.lockIntent();
    params.setIsConfirming(true);
    submitted = recordPending(params.pendingStore);
    await submitted;
    await new Promise<void>((resolve) => {
      params.signal.addEventListener(
        "abort",
        () => {
          resolve();
        },
        { once: true },
      );
    });
  });

  flushSync(() => {
    currentLayout().onAction?.();
  });
  const firstSignal = mocks.transact.mock.calls[0]?.[0].signal;
  // The shared submission publishes the hash asynchronously, so the layout only
  // shows the recovered wait once the render it schedules is flushed.
  await submitted;
  await vi.waitFor(() => {
    flushSync(flushScheduledRender);
    expect(currentLayout().action).toBe("stop waiting");
  });
  expect(currentLayout().disabled).toBe(false);

  flushSync(() => {
    currentLayout().onAction?.();
  });
  expect(firstSignal?.aborted).toBe(true);
  expect(currentLayout().action).toBe("retry confirmation");
  expect(currentLayout().disabled).toBe(false);

  flushSync(() => {
    currentLayout().onAction?.();
  });
  const retrySignal = mocks.retryConfirmation.mock.calls[0]?.[0].signal;
  if (retrySignal === undefined) {
    throw new Error("Retry confirmation was not started");
  }
  expect(retrySignal).not.toBe(firstSignal);
  expect(retrySignal.aborted).toBe(false);
  expect(mocks.transact).toHaveBeenCalledTimes(1);
  expect(mocks.retryConfirmation).toHaveBeenCalledTimes(1);
  expect(fixture.sendTransaction).not.toHaveBeenCalled();

  flushSync(() => {
    root.unmount();
  });
  expect(retrySignal.aborted).toBe(true);
}

function flushScheduledRender(): void {
  // Deliberately empty: flushSync itself renders the already-scheduled update.
}

/** Establishes pending state exactly as a completed submission does. */
async function recordPending(store: PendingTransactionStore): Promise<void> {
  await submitPendingTransaction(store, async (recordTxHash) => {
    recordTxHash(txHash);
    await Promise.resolve();
    return txHash;
  });
}

function strictAction(
  config: WalletConfig,
  freeze: (value: boolean) => void,
  initialPending?: PendingTransactionState,
): {
  controllers: AbortController[];
  root: ReturnType<typeof createRoot>;
} {
  const controllers: AbortController[] = [];
  class TrackingAbortController extends nativeAbortController {
    constructor() {
      super();
      controllers.push(this);
    }
  }
  vi.stubGlobal("AbortController", TrackingAbortController);
  const candidate: unknown = Reflect.apply(createRoot, null, [
    fakeContainer(testDocument),
  ]);
  if (!isReactRoot(candidate)) {
    throw new Error("React root was not created");
  }
  config.queryClient.setQueryData(
    [config.chain, config.address, "txInfo", "state", true, "1"],
    activeTxInfo(),
  );
  flushSync(() => {
    candidate.render(
      createElement(
        StrictMode,
        undefined,
        createElement(
          QueryClientProvider,
          { client: config.queryClient },
          createElement(PendingHost, { initialPending, walletConfig: config, freeze }),
        ),
      ),
    );
  });
  return { controllers, root: candidate };
}

/** Owns the pending record the way App does, so the action under test reads live state. */
// eslint-disable-next-line react-refresh/only-export-components -- Test-local host component.
function PendingHost({
  initialPending,
  walletConfig,
  freeze,
}: Readonly<{
  initialPending: PendingTransactionState | undefined;
  walletConfig: WalletConfig;
  freeze: (value: boolean) => void;
}>): ReactElement {
  const [pendingTransaction, setPendingTransaction] = useState(initialPending);
  const [store] = useState(() =>
    createPendingTransactionStore(setPendingTransaction, initialPending),
  );
  return createElement(actionComponent, {
    pendingTransaction,
    pendingStore: store,
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
    freeze,
    formReset: vi.fn<() => void>(),
    walletConfig,
    l1State: l1State(),
    isStateFetching: false,
    stateError: null,
    retryState: vi.fn<() => void>(),
  });
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

function walletFixture(): {
  config: WalletConfig;
  sendTransaction: ReturnType<typeof vi.fn>;
} {
  const sendTransaction = vi.fn(async () => {
    await Promise.resolve();
    return txHash;
  });
  const candidate: unknown = {
    chain: "testnet",
    address: "ckt1strict",
    queryClient: new QueryClient(),
    cccClient: {},
    resetClient: vi.fn<() => void>(),
    signer: { sendTransaction },
    accountLocks: [],
    primaryLock: {},
    sdk: {},
  };
  if (!isWalletConfig(candidate)) {
    throw new Error("Wallet fixture is invalid");
  }
  return { config: candidate, sendTransaction };
}

function isL1State(value: unknown): value is L1StateType {
  return typeof value === "object" && value !== null && "txBuilder" in value;
}

function isWalletConfig(value: unknown): value is WalletConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "queryClient" in value &&
    "signer" in value
  );
}

function isReactRoot(value: unknown): value is ReturnType<typeof createRoot> {
  return (
    typeof value === "object" &&
    value !== null &&
    "render" in value &&
    typeof value.render === "function" &&
    "unmount" in value &&
    typeof value.unmount === "function"
  );
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
