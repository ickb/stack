import { createElement, Suspense, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { InterfaceLoader } from "../../src/app/lazyInterface.ts";
import { elementProps } from "../support/react.ts";

vi.mock(import("react"), async (importActual) => {
  const actual = await importActual();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- The production root's single state initializer is invoked directly without a browser DOM.
  const useState = ((initial?: unknown) => [
    isFunction(initial) ? initial() : initial,
    (): undefined => undefined,
  ]) as unknown as typeof actual.useState;
  return { ...actual, useState };
});

const { InterfaceRoot } = await import("../../src/app/loadInterface.tsx");

describe("Interface lazy retry composition", () => {
  it("reloads the document after a module rejection", async () => {
    const reload = vi.fn<() => void>();
    vi.stubGlobal("location", { reload });
    const loader = rejectedLoader();
    const rejectedRoot = InterfaceRoot({ loader });
    renderLazy(rootLazyElement(rejectedRoot));
    await vi.waitFor(() => {
      expect(loader).toHaveBeenCalledTimes(1);
    });

    rootRetry(rejectedRoot)();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith();
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

function rejectedLoader(): ReturnType<typeof vi.fn<InterfaceLoader>> {
  return vi.fn(async () => {
    await Promise.resolve();
    throw new Error("cached chunk failure");
  });
}

function rootLazyElement(root: ReactElement): ReactElement {
  const suspense = elementProps<{ children: ReactElement }>(root).children;
  const wrapper = elementProps<{ children: ReactElement }>(suspense).children;
  return elementProps<{ children: ReactElement }>(wrapper).children;
}

function rootRetry(root: ReactElement): () => void {
  const retry = elementProps<{ onRetry?: () => void }>(root).onRetry;
  if (retry === undefined) {
    throw new Error("Interface root has no retry callback");
  }
  return retry;
}

function renderLazy(element: ReactElement): void {
  renderToStaticMarkup(
    createElement(Suspense, { fallback: createElement("div") }, element),
  );
}

function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}
