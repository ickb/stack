import type * as ReactQueryModule from "@tanstack/react-query";
import { createElement, Fragment, type ReactElement } from "react";
import { afterAll, describe, expect, it, vi } from "vitest";
import type * as QueryModule from "../../src/app/queries.ts";
import type { WalletConfig } from "../../src/shared/utils.ts";
import type { WalletAppView } from "../../src/view/WalletAppView.tsx";
import { fakeDom } from "../support/dom.ts";

const mocks = vi.hoisted<{
  amounts: Array<bigint | undefined>;
  queryResult: {
    data: undefined;
    error: null;
    isFetching: false;
    refetch: ReturnType<typeof vi.fn>;
  };
}>(() => ({
  amounts: [],
  queryResult: {
    data: undefined,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  },
}));

vi.mock(import("@tanstack/react-query"), () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- The test supplies the query result subset read by App through React Query's overloaded hook type.
  const useQuery = (() =>
    mocks.queryResult) as unknown as typeof ReactQueryModule.useQuery;
  return { useQuery };
});

vi.mock(import("../../src/app/queries.ts"), () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- The mocked query hook ignores options, so App only needs a spreadable value.
  const l1StateOptions = (() => ({})) as unknown as typeof QueryModule.l1StateOptions;
  return { l1StateOptions };
});

vi.mock(import("../../src/view/WalletAppView.tsx"), () => ({
  WalletAppView: (props: Parameters<typeof WalletAppView>[0]): ReactElement => {
    mocks.amounts.push(props.actionParams.amount);
    return createElement(Fragment);
  },
}));

const App = (await import("../../src/app/App.tsx")).default;
const { createRoot, flushSync, restoreDom } = await fakeDom();

afterAll(restoreDom);

describe("transaction intent", () => {
  it("replaces the actionable amount in the same committed render", () => {
    const root = createRoot();

    flushSync(() => {
      root.render(appElement("1"));
    });
    flushSync(() => {
      root.render(appElement("2"));
    });
    flushSync(() => {
      root.render(appElement("1e2"));
    });

    expect(mocks.amounts).toEqual([100_000_000n, 200_000_000n, undefined]);
    flushSync(() => {
      root.unmount();
    });
  });
});

function appElement(text: string): ReactElement {
  return createElement(App, {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Query and view mocks make wallet internals irrelevant to this App prop transition.
    walletConfig: {} as WalletConfig,
    walletName: "Test wallet",
    openWallet: vi.fn(),
    isCkb2Udt: true,
    setIsCkb2Udt: vi.fn<(value: boolean) => void>(),
    text,
    setText: vi.fn<(value: string) => void>(),
  });
}
