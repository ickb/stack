import type * as ReactQueryModule from "@tanstack/react-query";
import { createElement, Fragment, type ReactElement } from "react";
import { afterAll, describe, expect, it, vi } from "vitest";
import type * as QueryModule from "../../src/query/queries.ts";
import type { WalletConfig } from "../../src/shared/utils.ts";
import type { WalletAppView } from "../../src/view/WalletAppView.tsx";

class TestElement {
  public readonly nodeType = 1;
}

class TestIFrameElement extends TestElement {}

interface TestWindow {
  readonly event: undefined;
  readonly HTMLElement: typeof TestElement;
  readonly HTMLIFrameElement: typeof TestIFrameElement;
}

interface TestDocument {
  readonly activeElement: null;
  readonly addEventListener: ReturnType<typeof vi.fn>;
  readonly defaultView: TestWindow;
  readonly nodeType: 9;
}

interface TestContainer {
  readonly addEventListener: ReturnType<typeof vi.fn>;
  readonly nodeName: "DIV";
  readonly nodeType: 1;
  readonly ownerDocument: TestDocument;
  readonly removeEventListener: ReturnType<typeof vi.fn>;
  readonly tagName: "DIV";
}

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

vi.mock(import("../../src/query/queries.ts"), () => {
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
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const testDocument = fakeDocument();
vi.stubGlobal("document", testDocument);
vi.stubGlobal("window", testDocument.defaultView);
const { flushSync } = await import("react-dom");
const { createRoot } = await import("react-dom/client");

afterAll(async () => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  vi.stubGlobal("document", originalDocument);
  vi.stubGlobal("window", originalWindow);
});

describe("transaction intent", () => {
  it("replaces the actionable amount in the same committed render", () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- React DOM owns this structural test container boundary.
    const root = createRoot(fakeContainer(testDocument) as unknown as Element);

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

function fakeContainer(ownerDocument: TestDocument): TestContainer {
  return {
    addEventListener: vi.fn(),
    nodeName: "DIV",
    nodeType: 1,
    ownerDocument,
    removeEventListener: vi.fn(),
    tagName: "DIV",
  };
}
