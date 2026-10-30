import type * as ReactModule from "react";
import { beforeEach, vi } from "vitest";

/**
 * React's hooks replaced by call-order slots, for the hook tests not yet rendered in a real
 * root. Effects run on every call and push their cleanup; nothing honours dependencies.
 * Import it before the modules under test.
 */
interface HookState {
  effects: Array<() => void>;
  index: number;
  nextRefCurrent: unknown;
  states: unknown[];
}

export const hookState: HookState = {
  effects: [],
  index: 0,
  nextRefCurrent: undefined,
  states: [],
};

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

beforeEach(() => {
  resetHooks();
});

export function resetHooks(): void {
  hookState.effects = [];
  hookState.index = 0;
  hookState.nextRefCurrent = undefined;
  hookState.states = [];
}
