import { ccc } from "@ckb-ccc/ccc";
import { StubClient } from "@ickb/testkit";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { childElements, elementProps, firstElement } from "../support/react.ts";
import { inAct, renderHook } from "../support/renderHook.ts";
import {
  connectionInfoKey,
  quoteState,
  quoteStateQuery,
  rootConfig,
  signerInfo,
} from "./fixtures/data.ts";
import { connectorMock } from "./fixtures/environment.ts";
import {
  chainFromClient,
  LandingPage,
  SwitchingWalletNetwork,
  TestnetHint,
  WalletConfigGate,
  WalletGate,
  type ActionLayout,
  type RootConfig,
} from "./fixtures/modules.ts";

type LandingProps = Parameters<typeof LandingPage>[0];

describe("hook-based wallet gate", () => {
  it("selects wallet gate branches from connector and signer state", async () => {
    connectorMock.ccc.client = new StubClient({ addressPrefix: "ckt" });
    const { result, rerender, unmount } = await renderHook(() => WalletGate(), undefined);
    const landing = firstElement(childElements(result.current));
    expect(landing.type).toBe(LandingPage);
    // The draft starts empty, converting CKB to iCKB.
    expect(elementProps<LandingProps>(landing)).toMatchObject({
      isCkb2Udt: true,
      text: "",
    });
    // The chain follows the connector's client, and a client change closes its modal.
    expect(elementProps<LandingProps>(landing).rootConfig.chain).toBe("testnet");
    expect(connectorMock.ccc.close).toHaveBeenCalledTimes(1);

    connectorMock.ccc.client = new StubClient({ addressPrefix: "ckb" });
    await rerender(undefined);
    const mainnetLanding = firstElement(childElements(result.current));
    expect(elementProps<LandingProps>(mainnetLanding).rootConfig.chain).toBe("mainnet");
    expect(connectorMock.ccc.close).toHaveBeenCalledTimes(2);

    // A signer change on the same client doesn't close again. A BTC signer, like
    // any CCC signer, opens the wallet: it signs through its CKB lock.
    connectorMock.signer = signerInfo(ccc.SignerType.BTC, "ckb");
    await rerender(undefined);
    expect(result.current.type).toBe(WalletConfigGate);
    expect(connectorMock.ccc.close).toHaveBeenCalledTimes(2);

    connectorMock.signer = signerInfo(ccc.SignerType.CKB, "ckt");
    connectorMock.ccc.client = new StubClient({ addressPrefix: "ckb" });
    await rerender(undefined);
    expect(result.current.type).toBe(SwitchingWalletNetwork);

    connectorMock.ccc.client = new StubClient({ addressPrefix: "ckt" });
    connectorMock.ccc.wallet = { name: "JoyID" };
    connectorMock.ccc.signerInfo = { name: "CKB" };
    await rerender(undefined);
    expect(result.current.type).toBe(WalletConfigGate);
    expect(
      elementProps<Parameters<typeof WalletConfigGate>[0]>(result.current),
    ).toMatchObject({
      walletName: "JoyID CKB",
      signer: connectorMock.signer,
      isCkb2Udt: true,
      text: "",
    });
    await unmount();
  });

  it("connects at once without a saved connection", async () => {
    const props = landingProps("mainnet", { data: quoteState() });
    const { result, unmount } = await renderHook(LandingPage, props);

    expect(landingView(result.current)).toMatchObject({ action: "Connect wallet" });
    expect(landingView(result.current).message).toMatch(/^This is an estimate\./u);
    expect(elementProps<LandingProps>(result.current)).toMatchObject({
      chain: "mainnet",
      isCkb2Udt: true,
      text: "1",
    });
    await inAct(() => {
      landingView(result.current).open();
    });
    expect(props.open).toHaveBeenCalledTimes(1);
    expect(props.open).toHaveBeenCalledWith();
    await unmount();
  });

  it("restores a saved connection before opening the connector", async () => {
    vi.useFakeTimers();
    saveConnection();
    const props = landingProps("testnet", { data: undefined, isError: false });
    const { result, unmount } = await renderHook(LandingPage, props);
    expect(landingView(result.current).message).toMatch(
      /^Loading live exchange rate\.\.\. This is an estimate\./u,
    );

    await inAct(() => {
      landingView(result.current).open();
    });
    expect(landingView(result.current).action).toBe("Restoring wallet");
    expect(props.open).not.toHaveBeenCalled();

    await inAct(() => {
      vi.runAllTimers();
    });
    expect(props.open).toHaveBeenCalledTimes(1);
    expect(landingView(result.current).action).toBe("Connect wallet");
    await unmount();
  });

  it("drops the pending open when the page unmounts", async () => {
    vi.useFakeTimers();
    saveConnection();
    const props = landingProps("testnet", { data: undefined, isError: false });
    const unmounted = await renderHook(LandingPage, props);
    await inAct(() => {
      landingView(unmounted.result.current).open();
    });
    await unmounted.unmount();
    vi.runAllTimers();
    expect(props.open).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<TestnetHint />)).toContain("Need testnet CKB?");
  });

  it("ends a restore left on another chain when connecting without a saved connection", async () => {
    vi.useFakeTimers();
    saveConnection();
    const mainnet = landingProps("mainnet", { data: quoteState() });
    const { result, rerender, unmount } = await renderHook(LandingPage, mainnet);
    await inAct(() => {
      landingView(result.current).open();
    });
    // The wallet modal, not the tabs, switches the chain; the connection is then forgotten.
    await rerender({ ...mainnet, rootConfig: rootConfig("testnet") });
    globalThis.localStorage.setItem(connectionInfoKey, "");
    await inAct(() => {
      landingView(result.current).open();
    });
    expect(mainnet.open).toHaveBeenCalledTimes(1);

    await rerender(mainnet);
    expect(landingView(result.current).action).toBe("Connect wallet");
    await inAct(() => {
      vi.runAllTimers();
    });
    expect(mainnet.open).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it("connects when localStorage acquisition throws", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("blocked");
      },
    });
    const gate = await renderHook(() => WalletGate(), undefined);
    expect(firstElement(childElements(gate.result.current)).type).toBe(LandingPage);
    await gate.unmount();

    const props = landingProps("mainnet", { data: quoteState() });
    const { result, unmount } = await renderHook(LandingPage, props);
    await inAct(() => {
      landingView(result.current).open();
    });
    expect(props.open).toHaveBeenCalledTimes(1);
    await unmount();
  });
});

/** The landing page's props, one object so every re-render sees the same config. */
function landingProps(
  chain: RootConfig["chain"],
  liveQuote: Parameters<typeof quoteStateQuery>[0],
): LandingProps & { open: ReturnType<typeof vi.fn<() => void>> } {
  return {
    open: vi.fn<() => void>(),
    rootConfig: rootConfig(chain),
    isCkb2Udt: true,
    setIsCkb2Udt: vi.fn<(value: boolean) => void>(),
    text: "1",
    setText: vi.fn<(value: string) => void>(),
    quoteStateQuery: quoteStateQuery(liveQuote),
  };
}

function saveConnection(): void {
  globalThis.localStorage.setItem(
    connectionInfoKey,
    JSON.stringify({ walletName: "JoyID", signerName: "CKB" }),
  );
}

/** What the landing page hands its header and action. */
function landingView(element: ReactElement): {
  action: string;
  message: string;
  open: () => void;
} {
  const { action } = elementProps<{ action: ReactElement }>(element);
  const layout = elementProps<Parameters<typeof ActionLayout>[0]>(action);
  return {
    action: layout.action,
    message: layout.message,
    open: (): void => {
      layout.onAction?.();
    },
  };
}

describe("chainFromClient", () => {
  it("maps supported CCC client prefixes to stack chains", () => {
    expect(chainFromClient(new StubClient({ addressPrefix: "ckb" }))).toBe("mainnet");
    expect(chainFromClient(new StubClient({ addressPrefix: "ckt" }))).toBe("testnet");
  });

  it("reads any prefix but mainnet's as testnet", () => {
    expect(chainFromClient(new StubClient({ addressPrefix: "ckb-dev" }))).toBe("testnet");
  });
});
