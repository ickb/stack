import { createElement, Suspense, type ReactElement, type ReactNode } from "react";
import type { createRoot as reactCreateRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import interfaceSource from "../../src/app/Interface.tsx?raw";
import { mainnetClient, testnetClient } from "../../src/app/interfaceConfig.ts";
import { createInterface } from "../../src/app/lazyInterface.ts";
import lazySource from "../../src/app/lazyInterface.ts?raw";
import { InterfaceLoading, InterfaceRoot } from "../../src/app/loadInterface.tsx";
import loaderSource from "../../src/app/loadInterface.tsx?raw";
import { element, renderedElement } from "./fixtures/mount.ts";

const walletAppId = "wallet-app";

const createRoot = vi.hoisted(() =>
  vi.fn<typeof reactCreateRoot>(() => ({
    render: vi.fn<(children: ReactNode) => void>(),
    unmount: vi.fn<() => void>(),
  })),
);

vi.mock(import("react-dom/client"), () => ({ createRoot }));
vi.mock(import("../../src/app/Interface.tsx"), () => ({
  default: (): ReactElement => createElement("div", undefined, "Loaded wallet interface"),
}));

describe("main entrypoint", () => {
  it("uses explicit app-owned HTTPS RPC endpoints", () => {
    expect(mainnetClient.url).toBe("https://mainnet.ckb.dev/");
    expect(testnetClient.url).toBe("https://testnet.ckb.dev/");
  });

  it("loads the wallet implementation through the aliased lazy chunk boundary", () => {
    expect(lazySource).toContain('import("./Interface.tsx")');
    expect(lazySource).toContain("return lazy(loader)");
    expect(interfaceSource).toContain('from "../wallet/WalletGate.tsx"');
    expect(loaderSource).not.toMatch(/balance|conversion|quote|financial/iu);
  });

  it("renders the loader and resolves the lazy wallet component", async () => {
    const Interface = createInterface();
    expect(renderToStaticMarkup(createElement(InterfaceLoading))).toContain(
      "Loading wallet interface...",
    );
    renderToStaticMarkup(
      createElement(
        Suspense,
        { fallback: createElement(InterfaceLoading) },
        createElement(Interface),
      ),
    );

    await vi.waitFor(() => {
      expect(renderToStaticMarkup(createElement(Interface))).toContain(
        "Loaded wallet interface",
      );
    });
  });

  it("renders stable wallet app content immediately", async () => {
    createRoot.mockClear();
    const walletApp = element(walletAppId);
    vi.stubGlobal("document", {
      getElementById: vi.fn((id: string) => (id === walletAppId ? walletApp : null)),
    });

    vi.resetModules();
    await import("../../src/main.tsx");
    const rendered = renderedElement(createRoot);

    expect(createRoot).toHaveBeenCalledWith(walletApp);
    expect(rendered.type).toHaveProperty("name", InterfaceRoot.name);
  });

  it("fails fast when the wallet app mount is missing", async () => {
    createRoot.mockClear();
    vi.stubGlobal("document", { getElementById: vi.fn(() => null) });

    vi.resetModules();
    await expect(import("../../src/main.tsx")).rejects.toThrow("Missing wallet app root");
  });
});
