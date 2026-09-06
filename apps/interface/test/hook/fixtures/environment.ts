import type * as ConnectorModule from "@ckb-ccc/connector-react";
import { StubClient } from "@ickb/testkit";
import type * as ReactQueryModule from "@tanstack/react-query";
import type * as ReactModule from "react";
import { afterEach, beforeEach, vi } from "vitest";
import type {
  retryConfirmation as retryConfirmationType,
  transact as transactType,
} from "../../../src/action/actionTransaction.ts";
import type { QuoteState } from "../../../src/query/queries.ts";
import type { TxInfo, WalletConfig } from "../../../src/shared/utils.ts";

interface HookState {
  effects: Array<() => void>;
  index: number;
  nextRefCurrent: unknown;
  states: unknown[];
}

interface QueryMock {
  options: unknown;
  result: unknown;
}

interface ConnectorMock {
  ccc: {
    client: unknown;
    close: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    setClient: ReturnType<typeof vi.fn>;
    wallet?: { name?: string };
    signerInfo?: { name?: string };
  };
  signer: unknown;
}

const mocks = vi.hoisted(
  (): {
    connectorMock: ConnectorMock;
    hookState: HookState;
    queryMock: QueryMock;
    transactMock: {
      retryConfirmation: ReturnType<typeof vi.fn<typeof retryConfirmationType>>;
      transact: ReturnType<typeof vi.fn<typeof transactType>>;
    };
  } => ({
    connectorMock: {
      ccc: {
        client: undefined,
        close: vi.fn<() => void>(),
        open: vi.fn<() => void>(),
        setClient: vi.fn<(client: unknown) => void>(),
        wallet: undefined,
        signerInfo: undefined,
      },
      signer: undefined,
    },
    hookState: {
      effects: [],
      index: 0,
      nextRefCurrent: undefined,
      states: [],
    },
    queryMock: {
      options: undefined,
      result: {},
    },
    transactMock: {
      retryConfirmation: vi.fn(async () => {
        await Promise.resolve();
      }),
      transact: vi.fn(async (params) => {
        params.lockIntent();
        const { build, ...state } = await params.refreshPreview();
        params.freezePreview({ ...state, txInfo: await build() });
      }),
    },
  }),
);

export const connectorMock = mocks.connectorMock;
export const hookState = mocks.hookState;
export const queryMock = mocks.queryMock;
export const transactMock = mocks.transactMock;

// eslint-disable-next-line unicorn/no-top-level-side-effects -- Hook fixture registers React hook mocks before dynamic component imports.
vi.mock(import("react"), async (importActual: () => Promise<typeof ReactModule>) => {
  const actual = await importActual();
  function mockUseState<S>(
    initialState: S | (() => S),
  ): [S, ReactModule.Dispatch<ReactModule.SetStateAction<S>>];
  function mockUseState<S = undefined>(): [
    S | undefined,
    ReactModule.Dispatch<ReactModule.SetStateAction<S | undefined>>,
  ];
  function mockUseState<S>(
    initial?: S | (() => S),
  ): [S | undefined, ReactModule.Dispatch<ReactModule.SetStateAction<S | undefined>>] {
    const stateIndex = hookState.index;
    hookState.index += 1;
    if (!(stateIndex in hookState.states)) {
      hookState.states[stateIndex] =
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Mock useState invokes lazy initializers with the caller-provided generic type.
        typeof initial === "function" ? (initial as () => S)() : initial;
    }
    return [
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Mock useState returns the stored value as the caller-provided generic type.
      hookState.states[stateIndex] as S | undefined,
      (value: ReactModule.SetStateAction<S | undefined>): void => {
        hookState.states[stateIndex] =
          typeof value === "function"
            ? // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Mock useState invokes functional updates with the stored generic value.
              (value as (previous: S | undefined) => S | undefined)(
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Mock state slots store generic hook state.
                hookState.states[stateIndex] as S | undefined,
              )
            : value;
      },
    ];
  }

  return {
    ...actual,
    useDeferredValue: <T>(value: T): T => value,
    useEffect: (effect: ReactModule.EffectCallback): void => {
      const cleanup = effect();
      if (typeof cleanup === "function") {
        hookState.effects.push((): void => {
          cleanup();
        });
      }
    },
    useMemo: <T>(factory: () => T): T => factory(),
    useRef: <T>(initial: T): { current: T } => {
      const current =
        hookState.nextRefCurrent === undefined
          ? initial
          : // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Mock useRef supplies the caller-owned generic fixture value.
            (hookState.nextRefCurrent as T);
      hookState.nextRefCurrent = undefined;
      return { current };
    },
    useState: mockUseState,
  };
});

// eslint-disable-next-line unicorn/no-top-level-side-effects -- Hook fixture registers React Query mocks before dynamic component imports.
vi.mock(
  import("@tanstack/react-query"),
  async (importActual: () => Promise<typeof ReactQueryModule>) => {
    const actual = await importActual();
    const React = await import("react");
    const QueryClientProvider: typeof ReactQueryModule.QueryClientProvider = ({
      children,
    }) => React.createElement(React.Fragment, undefined, children);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/promise-function-async, no-restricted-syntax -- Query mock returns captured test state through React Query's overloaded hook type.
    const useQuery = ((options: unknown): unknown => {
      queryMock.options = options;
      return queryMock.result;
    }) as typeof ReactQueryModule.useQuery;
    return {
      ...actual,
      QueryClientProvider,
      useQuery,
    };
  },
);

// eslint-disable-next-line unicorn/no-top-level-side-effects -- Hook fixture registers CCC connector mocks before dynamic component imports.
vi.mock(import("@ckb-ccc/connector-react"), async () => {
  const React = await import("react");
  const Provider: typeof ConnectorModule.Provider = ({ children }) =>
    React.createElement(React.Fragment, undefined, children);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Connector hook mock returns the fixture subset read by production through the connector hook type.
  const useCcc = (() => connectorMock.ccc) as unknown as typeof ConnectorModule.useCcc;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/promise-function-async, no-restricted-syntax -- Signer hook mock returns fixture state through the connector hook type.
  const useSigner = (() =>
    connectorMock.signer) as unknown as typeof ConnectorModule.useSigner;
  return { Provider, useCcc, useSigner };
});

// eslint-disable-next-line unicorn/no-top-level-side-effects -- Hook fixture replaces transaction side effects with an observable mock.
vi.mock(import("../../../src/action/actionTransaction.ts"), () => transactMock);

// eslint-disable-next-line unicorn/no-top-level-side-effects -- Hook fixture owns shared hook state reset for these tests.
beforeEach(() => {
  resetHooks();
  queryMock.options = undefined;
  queryMock.result = {};
  connectorMock.ccc.client = new StubClient({ addressPrefix: "ckb" });
  connectorMock.ccc.close.mockClear();
  connectorMock.ccc.open.mockClear();
  connectorMock.ccc.setClient.mockClear();
  connectorMock.ccc.wallet = undefined;
  connectorMock.ccc.signerInfo = undefined;
  connectorMock.signer = undefined;
  transactMock.transact.mockClear();
  transactMock.retryConfirmation.mockClear();
  vi.stubGlobal("localStorage", storage());
});

// eslint-disable-next-line unicorn/no-top-level-side-effects -- Hook fixture restores global timer and storage state for these tests.
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

export function resetHooks(): void {
  hookState.effects = [];
  hookState.index = 0;
  hookState.nextRefCurrent = undefined;
  hookState.states = [];
}

export function walletConfigQueryOptions(): {
  queryKey: readonly unknown[];
  retry: false;
  queryFn: () => Promise<WalletConfig>;
} {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Query mock options are captured from the production hook call.
  return queryMock.options as {
    queryKey: readonly unknown[];
    retry: false;
    queryFn: () => Promise<WalletConfig>;
  };
}

export function quoteStateOptions(): {
  enabled: boolean;
  queryFn: () => Promise<QuoteState>;
} {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Query mock options are captured from the production hook call.
  return queryMock.options as { enabled: boolean; queryFn: () => Promise<QuoteState> };
}

export function txPreviewQueryOptions(): {
  enabled: boolean;
  queryKey: readonly unknown[];
  queryFn: () => Promise<TxInfo>;
} {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Query mock options are captured from the production hook call.
  return queryMock.options as {
    enabled: boolean;
    queryKey: readonly unknown[];
    queryFn: () => Promise<TxInfo>;
  };
}

function storage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}
