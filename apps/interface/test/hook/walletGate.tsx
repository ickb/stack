import { ccc } from "@ckb-ccc/ccc";
import { StubClient } from "@ickb/testkit";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { childElements, elementProps, firstElement } from "../support/react.ts";
import {
  connectionInfoKey,
  quoteState,
  quoteStateQuery,
  rootConfig,
  selectedChainKey,
  signerInfo,
} from "./fixtures/data.ts";
import { connectorMock, hookState, resetHooks } from "./fixtures/environment.ts";
import {
  CkbSignerRequired,
  LandingPage,
  mainnetClient,
  SwitchingWalletNetwork,
  testnetClient,
  TestnetHint,
  UnsupportedNetwork,
  WalletConfigGate,
  WalletGate,
  type RootConfig,
  type WalletAppShell,
} from "./fixtures/modules.ts";

interface LandingPageTestContext {
  open: ReturnType<typeof vi.fn<() => void>>;
  setClient: ReturnType<typeof vi.fn<(client: unknown) => void>>;
  setDraftChain: ReturnType<typeof vi.fn<(chain: RootConfig["chain"]) => void>>;
  setRawText: ReturnType<typeof vi.fn<(value: string) => void>>;
}

describe("hook-based wallet gate", () => {
  registerWalletGateBranchTests();
  registerLandingPageStateTests();
});

function registerWalletGateBranchTests(): void {
  it("selects wallet gate branches from connector and signer state", () => {
    connectorMock.signer = undefined;
    connectorMock.ccc.client = new StubClient({ addressPrefix: "ckt" });
    expect(firstElement(childElements(WalletGate())).type).toBe(LandingPage);

    resetHooks();
    globalThis.localStorage.setItem(selectedChainKey, "testnet");
    connectorMock.signer = undefined;
    connectorMock.ccc.client = new StubClient({ addressPrefix: "ckb" });
    expect(firstElement(childElements(WalletGate())).type).toBe(LandingPage);

    resetHooks();
    connectorMock.signer = signerInfo(ccc.SignerType.BTC, "ckb");
    connectorMock.ccc.client = new StubClient({ addressPrefix: "ckb" });
    expect(WalletGate().type).toBe(CkbSignerRequired);

    resetHooks();
    connectorMock.signer = signerInfo(ccc.SignerType.CKB, "ckb-dev");
    connectorMock.ccc.client = new StubClient({ addressPrefix: "ckb-dev" });
    expect(WalletGate().type).toBe(UnsupportedNetwork);

    resetHooks();
    connectorMock.signer = signerInfo(ccc.SignerType.CKB, "ckt");
    connectorMock.ccc.client = new StubClient({ addressPrefix: "ckb" });
    expect(WalletGate().type).toBe(SwitchingWalletNetwork);

    resetHooks();
    hookState.nextRefCurrent = "mainnet";
    connectorMock.signer = signerInfo(ccc.SignerType.CKB, "ckt");
    connectorMock.ccc.client = new StubClient({ addressPrefix: "ckt" });
    connectorMock.ccc.wallet = { name: "JoyID" };
    connectorMock.ccc.signerInfo = { name: "CKB" };
    expect(WalletGate().type).toBe(WalletConfigGate);
    expect(connectorMock.ccc.close).toHaveBeenCalledTimes(1);
    expect(connectorMock.ccc.close).toHaveBeenCalledWith();
    expect(globalThis.localStorage.getItem(selectedChainKey)).toBe("testnet");
  });
}

function registerLandingPageStateTests(): void {
  it("drives landing page connect, restore, cleanup, and chain selection state", () => {
    const context = landingPageTestContext();
    expect(context.open).not.toHaveBeenCalled();
    assertInitialLandingBranch(context);
    const restoringProps = assertRestoringBranch(context);
    assertCleanupBranch(context);
    assertChainSelectionBranch(context, restoringProps);
  });

  it("connects and selects a chain when localStorage acquisition throws", () => {
    const context = landingPageTestContext();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("blocked");
      },
    });

    expect(() => {
      WalletGate();
    }).not.toThrow();
    resetHooks();
    const props = renderLandingPage(context, "mainnet", { data: quoteState() });

    expect(() => {
      props.open();
    }).not.toThrow();
    expect(context.open).toHaveBeenCalledTimes(1);
    expect(context.setClient).toHaveBeenCalledWith(mainnetClient);
    expect(() => {
      props.selectChain("testnet");
    }).not.toThrow();
    expect(context.setDraftChain).toHaveBeenCalledWith("testnet");
  });
}

function landingPageTestContext(): LandingPageTestContext {
  vi.useFakeTimers();
  return {
    open: vi.fn<() => void>(),
    setClient: vi.fn<(client: unknown) => void>(),
    setRawText: vi.fn<(value: string) => void>(),
    setDraftChain: vi.fn<(chain: RootConfig["chain"]) => void>(),
  };
}

function assertInitialLandingBranch(context: LandingPageTestContext): void {
  const props = renderLandingPage(context, "mainnet", { data: quoteState() });
  props.open();
  expect(context.open).toHaveBeenCalledTimes(1);
  expect(context.open).toHaveBeenCalledWith();
  expect(context.setClient).toHaveBeenCalledWith(mainnetClient);
  expect(props.liveStatus).toBe("");
  runEffectCleanups();
}

function assertRestoringBranch(
  context: LandingPageTestContext,
): Parameters<typeof WalletAppShell>[0] {
  resetLandingHooksWithStoredConnection();
  const restoringProps = renderLandingPage(context, "testnet", {
    data: undefined,
    isError: false,
  });
  restoringProps.open();
  vi.runAllTimers();
  expect(context.open).toHaveBeenCalledTimes(2);
  return restoringProps;
}

function assertCleanupBranch(context: LandingPageTestContext): void {
  resetLandingHooksWithStoredConnection();
  renderLandingPage(context, "testnet", { data: undefined, isError: false }).open();
  runEffectCleanups();
}

function assertChainSelectionBranch(
  context: LandingPageTestContext,
  restoringProps: Parameters<typeof WalletAppShell>[0],
): void {
  resetLandingHooksWithStoredConnection();
  renderLandingPage(context, "testnet", { data: undefined, isError: false }).open();
  restoringProps.selectChain("mainnet");
  vi.runAllTimers();
  expect(context.setClient).toHaveBeenCalledWith(testnetClient);
  expect(context.setDraftChain).toHaveBeenCalledWith("mainnet");
  expect(restoringProps.liveStatus).toBe("Loading live exchange rate...");
  expect(renderToStaticMarkup(<TestnetHint />)).toContain("Need testnet CKB?");
}

function renderLandingPage(
  context: LandingPageTestContext,
  chain: RootConfig["chain"],
  liveQuote: Parameters<typeof quoteStateQuery>[0],
): Parameters<typeof WalletAppShell>[0] {
  return landingShellProps(
    LandingPage({
      open: context.open,
      setClient: context.setClient,
      rootConfig: rootConfig(chain),
      rawText: "C1",
      setRawText: context.setRawText,
      quoteStateQuery: quoteStateQuery(liveQuote),
      setDraftChain: context.setDraftChain,
    }),
  );
}

function resetLandingHooksWithStoredConnection(): void {
  resetHooks();
  globalThis.localStorage.setItem(
    connectionInfoKey,
    JSON.stringify({ walletName: "JoyID", signerName: "CKB" }),
  );
}

function runEffectCleanups(): void {
  for (const cleanup of hookState.effects) {
    cleanup();
  }
}

function landingShellProps(element: ReactElement): Parameters<typeof WalletAppShell>[0] {
  return elementProps<Parameters<typeof WalletAppShell>[0]>(element);
}
