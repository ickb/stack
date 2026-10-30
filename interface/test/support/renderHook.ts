import { act, createElement } from "react";
import { fakeDom } from "./dom.ts";

/**
 * Renders `hook(props)` in a real React root on the fake document.
 *
 * Each render and the unmount run inside `act`, so when they resolve the effects, their
 * cleanups and the state writes those cause have committed, and `result.current` holds
 * what the hook returned in the last commit.
 */
export async function renderHook<P, R>(
  hook: (props: P) => R,
  props: P,
): Promise<{
  result: { current: R | undefined };
  rerender: (props: P) => Promise<void>;
  unmount: () => Promise<void>;
}> {
  // React warns about every act call unless the environment declares itself a test.
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const { createRoot, restoreDom } = await fakeDom();
  const root = createRoot();
  const result: { current: R | undefined } = { current: undefined };
  function Probe({ props: current }: Readonly<{ props: P }>): null {
    result.current = hook(current);
    return null;
  }
  const rerender = async (next: P): Promise<void> => {
    await inAct(() => {
      root.render(createElement(Probe, { props: next }));
    });
  };
  await rerender(props);
  return {
    result,
    rerender,
    unmount: async (): Promise<void> => {
      await inAct(() => {
        root.unmount();
      });
      await restoreDom();
    },
  };
}

async function inAct(update: () => void): Promise<void> {
  // act's typed overload for a void callback returns nothing to await; the async form
  // settles once React has flushed the work the update caused.
  await act(async () => {
    update();
    await Promise.resolve();
  });
}
