import type { flushSync } from "react-dom";
import type { Root } from "react-dom/client";
import { vi } from "vitest";

class TestElement {
  public readonly nodeType = 1;
}
class TestIFrameElement extends TestElement {}

// The least React DOM reads to create a root and commit; nothing here renders or dispatches events.
const testDocument = {
  activeElement: null,
  addEventListener: vi.fn(),
  defaultView: {
    event: undefined,
    HTMLElement: TestElement,
    HTMLIFrameElement: TestIFrameElement,
  },
  nodeType: 9,
};

/** Points `document` and `window` at the fake document. */
export function stubDom(): void {
  vi.stubGlobal("document", testDocument);
  vi.stubGlobal("window", testDocument.defaultView);
}

/**
 * Stubs the fake document, then loads React DOM under it.
 *
 * `restoreDom` waits a macrotask first, so React's scheduled work still finds the fake;
 * `restoreNow` is for a caller whose work `act` has already flushed.
 */
export async function fakeDom(): Promise<{
  createRoot: () => Root;
  flushSync: typeof flushSync;
  restoreDom: () => Promise<void>;
  restoreNow: () => void;
}> {
  const originalDocument: unknown = Reflect.get(globalThis, "document");
  const originalWindow: unknown = Reflect.get(globalThis, "window");
  const restoreNow = (): void => {
    vi.stubGlobal("document", originalDocument);
    vi.stubGlobal("window", originalWindow);
  };
  stubDom();
  const reactDom = await import("react-dom");
  const reactDomClient = await import("react-dom/client");
  return {
    createRoot: (): Root =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- React DOM owns this structural test container boundary.
      reactDomClient.createRoot(fakeContainer() as unknown as Element),
    flushSync: reactDom.flushSync,
    restoreDom: async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      restoreNow();
    },
    restoreNow,
  };
}

function fakeContainer(): object {
  return {
    addEventListener: vi.fn(),
    nodeName: "DIV",
    nodeType: 1,
    ownerDocument: testDocument,
    removeEventListener: vi.fn(),
    tagName: "DIV",
  };
}
