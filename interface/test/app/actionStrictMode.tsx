import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  createElement,
  Fragment,
  StrictMode,
  useState,
  type ReactElement,
} from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionLayout } from "../../src/action/ActionLayout.tsx";
import type * as TransactionModule from "../../src/action/actionTransaction.ts";
import {
  createPendingTransactionStore,
  type PendingTransactionState,
} from "../../src/action/pendingTransaction.ts";
import type { L1StateType } from "../../src/app/queries.ts";
import type { WalletConfig } from "../../src/shared/utils.ts";
import { activeTxInfo, recordPending } from "../action/fixtures/transaction.ts";
import { fakeDom, stubDom } from "../support/dom.ts";
import { inAct } from "../support/renderHook.ts";
import { l1State } from "./fixtures/l1State.ts";

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
const nativeAbortController = AbortController;
const { createRoot, restoreNow } = await fakeDom();

beforeEach(() => {
  stubDom();
  mocks.layout = undefined;
  mocks.retryConfirmation.mockClear();
  mocks.transact.mockClear();
});

afterEach(async () => {
  await Promise.resolve();
  vi.stubGlobal("AbortController", nativeAbortController);
});

afterAll(restoreNow);

describe("Action StrictMode ownership", () => {
  it("runs a send click under the surviving mount's controller", () => {
    const freeze = vi.fn<(value: boolean) => void>();
    const fixture = walletFixture();
    const { controllers, root } = strictAction(fixture.config, freeze);

    const onAction = currentLayout().onAction;
    act(() => {
      onAction?.();
    });

    // StrictMode mounts twice; the attempt runs under the surviving mount's controller.
    expect(mocks.transact).toHaveBeenCalledTimes(1);
    expect(mocks.transact.mock.calls[0]?.[0].signal).toBe(controllers.at(-1)?.signal);
    expect(controllers.at(-1)?.signal.aborted).toBe(false);
    act(() => {
      root.unmount();
    });
    onAction?.();
    expect(mocks.transact).toHaveBeenCalledTimes(1);
    expect(controllers.at(-1)?.signal.aborted).toBe(true);
    expect(freeze).toHaveBeenCalledWith(false);
  });

  it("runs a recovered confirmation retry under the surviving mount's controller", () => {
    const fixture = walletFixture();
    const { controllers, root } = strictAction(
      fixture.config,
      vi.fn<(value: boolean) => void>(),
      { status: "pending", txHash },
    );

    expect(currentLayout().action).toBe("retry confirmation");
    act(() => {
      currentLayout().onAction?.();
    });

    expect(mocks.retryConfirmation).toHaveBeenCalledTimes(1);
    expect(mocks.retryConfirmation.mock.calls[0]?.[0].signal).toBe(
      controllers.at(-1)?.signal,
    );
    expect(controllers.at(-1)?.signal.aborted).toBe(false);
    expect(fixture.sendTransaction).not.toHaveBeenCalled();
    act(() => {
      root.unmount();
    });
  });

  it("holds the action through an active wait, then offers the retry", waitThenRetry);
});

async function waitThenRetry(): Promise<void> {
  const fixture = walletFixture();
  const { root } = strictAction(fixture.config, vi.fn<(value: boolean) => void>());
  let submitted: Promise<unknown> | undefined;
  const windowClosed = Promise.withResolvers<undefined>();
  mocks.transact.mockImplementationOnce(async (params) => {
    params.lockIntent();
    params.setIsConfirming(true);
    submitted = recordPending(params.pendingStore, txHash);
    await submitted;
    await windowClosed.promise;
    params.setIsConfirming(false);
  });

  // The shared submission publishes the hash asynchronously; awaiting it inside act
  // commits the render it schedules.
  await inAct(async () => {
    currentLayout().onAction?.();
    await submitted;
  });
  const firstSignal = mocks.transact.mock.calls[0]?.[0].signal;
  expect(currentLayout().action).toBe("confirming...");
  expect(currentLayout().disabled).toBe(true);

  await inAct(async () => {
    windowClosed.resolve(undefined);
    await mocks.transact.mock.results[0]?.value;
  });
  expect(currentLayout().action).toBe("retry confirmation");
  expect(firstSignal?.aborted).toBe(false);
  expect(currentLayout().disabled).toBe(false);

  act(() => {
    currentLayout().onAction?.();
  });
  const retrySignal = mocks.retryConfirmation.mock.calls[0]?.[0].signal;
  if (retrySignal === undefined) {
    throw new Error("Retry confirmation was not started");
  }
  expect(retrySignal.aborted).toBe(false);
  expect(mocks.transact).toHaveBeenCalledTimes(1);
  expect(mocks.retryConfirmation).toHaveBeenCalledTimes(1);
  expect(fixture.sendTransaction).not.toHaveBeenCalled();

  act(() => {
    root.unmount();
  });
  expect(retrySignal.aborted).toBe(true);
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
  const root = createRoot();
  config.queryClient.setQueryData(
    [config.chain, config.address, "txInfo", "state", true, "1"],
    activeTxInfo(),
  );
  act(() => {
    root.render(
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
  return { controllers, root };
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
  const [store] = useState(() => {
    const created = createPendingTransactionStore(setPendingTransaction);
    created.current = initialPending;
    return created;
  });
  return createElement(actionComponent, {
    pendingTransaction,
    pendingStore: store,
    isCkb2Udt: true,
    amount: 1n,
    amountError: "",
    refreshState: async (): Promise<L1StateType> => {
      await Promise.resolve();
      return l1State();
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
  };
  if (!isWalletConfig(candidate)) {
    throw new Error("Wallet fixture is invalid");
  }
  return { config: candidate, sendTransaction };
}

function isWalletConfig(value: unknown): value is WalletConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "queryClient" in value &&
    "signer" in value
  );
}
