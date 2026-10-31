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
 * Callers render inside `act`: out of it, React runs each commit's passive-effect flush,
 * which reads `window.event`, as a Scheduler task that can outlive the test and find the
 * DOM restored. `act` queues that flush on its own queue and drains it before returning,
 * so `restoreNow` may restore the DOM as soon as the last `act` has returned.
 */
export async function fakeDom(): Promise<{
  createRoot: () => Root;
  restoreNow: () => void;
}> {
  // React warns about every act call unless the environment declares itself a test.
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const originalDocument: unknown = Reflect.get(globalThis, "document");
  const originalWindow: unknown = Reflect.get(globalThis, "window");
  const restoreNow = (): void => {
    vi.stubGlobal("document", originalDocument);
    vi.stubGlobal("window", originalWindow);
  };
  stubDom();
  const reactDomClient = await import("react-dom/client");
  return {
    createRoot: (): Root =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- React DOM owns this structural test container boundary.
      reactDomClient.createRoot(fakeContainer() as unknown as Element),
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
