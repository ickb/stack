import { act, createElement, StrictMode } from "react";
import { fakeDom } from "./dom.ts";

/**
 * Renders `hook(props)` in a real React root on the fake document.
 *
 * Each render and the unmount run inside `act`, so when they resolve the effects, their
 * cleanups and the state writes those cause have committed, and `result.current` holds
 * what the hook returned in the last commit. A component called as the hook returns its
 * element unrendered, for the test to inspect. `strict` renders under StrictMode, which
 * runs every effect, its cleanup, then the effect again on mount.
 */
export async function renderHook<P, R>(
  hook: (props: P) => R,
  props: NoInfer<P>,
  { strict = false }: { strict?: boolean } = {},
): Promise<{
  result: { readonly current: R };
  rerender: (props: P) => Promise<void>;
  unmount: () => Promise<void>;
}> {
  // React warns about every act call unless the environment declares itself a test.
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const { createRoot, restoreNow } = await fakeDom();
  const root = createRoot();
  let rendered: { value: R } | undefined;
  function Probe({ props: current }: Readonly<{ props: P }>): null {
    rendered = { value: hook(current) };
    return null;
  }
  const rerender = async (next: P): Promise<void> => {
    await inAct(() => {
      const probe = createElement(Probe, { props: next });
      root.render(strict ? createElement(StrictMode, undefined, probe) : probe);
    });
  };
  await rerender(props);
  return {
    result: {
      get current(): R {
        if (rendered === undefined) {
          throw new Error("The hook has not rendered");
        }
        return rendered.value;
      },
    },
    rerender,
    unmount: async (): Promise<void> => {
      await inAct(() => {
        root.unmount();
      });
      restoreNow();
    },
  };
}

/** Runs `update` inside `act`, so the renders and effects it causes commit before it resolves. */
export async function inAct(update: () => void): Promise<void> {
  // act's typed overload for a void callback returns nothing to await; the async form
  // settles once React has flushed the work the update caused.
  await act(async () => {
    update();
    await Promise.resolve();
  });
}

/** Lets pending promises and timers settle inside `act`, then flushes what they rendered. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}
