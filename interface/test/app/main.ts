import { createElement, type ReactElement, type ReactNode } from "react";
import type { createRoot as reactCreateRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { mainnetClient, testnetClient } from "../../src/app/interfaceConfig.ts";
import { element, renderedElement } from "./fixtures/mount.ts";

const walletAppId = "wallet-app";

// Hoisted so the mocked module and the assertion share one component identity.
const MockInterface = vi.hoisted(
  () =>
    function Interface(): ReactElement {
      return createElement("div");
    },
);

const createRoot = vi.hoisted(() =>
  vi.fn<typeof reactCreateRoot>(() => ({
    render: vi.fn<(children: ReactNode) => void>(),
    unmount: vi.fn<() => void>(),
  })),
);

vi.mock(import("react-dom/client"), () => ({ createRoot }));
// The wallet connector needs a DOM; the entrypoint test only checks what is mounted where.
vi.mock(import("../../src/app/Interface.tsx"), () => ({ default: MockInterface }));

describe("main entrypoint", () => {
  it("opens the mainnet and testnet clients on their own chains", () => {
    expect(mainnetClient.addressPrefix).toBe("ckb");
    expect(testnetClient.addressPrefix).toBe("ckt");
  });

  it("renders the interface directly into the wallet app mount", async () => {
    createRoot.mockClear();
    const walletApp = element(walletAppId);
    vi.stubGlobal("document", {
      getElementById: vi.fn((id: string) => (id === walletAppId ? walletApp : null)),
    });

    vi.resetModules();
    await import("../../src/main.tsx");
    const rendered = renderedElement(createRoot);

    expect(createRoot).toHaveBeenCalledWith(walletApp);
    expect(rendered.props.children.type).toBe(MockInterface);
  });

  it("fails fast when the wallet app mount is missing", async () => {
    createRoot.mockClear();
    vi.stubGlobal("document", { getElementById: vi.fn(() => null) });

    vi.resetModules();
    await expect(import("../../src/main.tsx")).rejects.toThrow("Missing wallet app root");
  });
});
