import type * as ConnectorModule from "@ckb-ccc/connector-react";
import { StubClient } from "@ickb/testkit";
import type * as ReactQueryModule from "@tanstack/react-query";
import { skipToken, type SkipToken } from "@tanstack/react-query";
import { afterEach, beforeEach, vi } from "vitest";
import type {
  retryConfirmation as retryConfirmationType,
  transact as transactType,
} from "../../../src/action/actionTransaction.ts";
import type { QuoteState } from "../../../src/app/queries.ts";
import type { TxInfo } from "../../../src/shared/utils.ts";

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
        const state = await params.refreshState();
        const txInfo = await state.txBuilder(
          params.isCkb2Udt,
          params.amount,
          params.destination,
        );
        if (txInfo.ok) {
          params.freezePreview({ ...state, txInfo });
        }
      }),
    },
  }),
);

export const connectorMock = mocks.connectorMock;
export const queryMock = mocks.queryMock;
export const transactMock = mocks.transactMock;

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

vi.mock(import("../../../src/action/actionTransaction.ts"), () => transactMock);

beforeEach(() => {
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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

export function quoteStateOptions(): {
  queryKey: readonly unknown[];
  queryFn: (() => Promise<QuoteState>) | SkipToken;
} {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Query mock options are captured from the production hook call.
  return queryMock.options as {
    queryKey: readonly unknown[];
    queryFn: (() => Promise<QuoteState>) | SkipToken;
  };
}

export function txPreviewQueryOptions(): {
  enabled: boolean;
  queryKey: readonly unknown[];
  queryFn: (() => Promise<TxInfo>) | SkipToken;
} {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Query mock options are captured from the production hook call.
  return queryMock.options as {
    enabled: boolean;
    queryKey: readonly unknown[];
    queryFn: (() => Promise<TxInfo>) | SkipToken;
  };
}

/** The captured query function, which the test expects not to be parked. */
export function queryFnOf<T>(options: {
  queryFn: (() => Promise<T>) | SkipToken;
}): () => Promise<T> {
  if (options.queryFn === skipToken) {
    throw new Error("The query is parked");
  }
  return options.queryFn;
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
