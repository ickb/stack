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
  selectedChainKey,
  signerInfo,
} from "./fixtures/data.ts";
import { connectorMock } from "./fixtures/environment.ts";
import {
  chainFromClient,
  CkbSignerRequired,
  LandingPage,
  mainnetClient,
  SwitchingWalletNetwork,
  testnetClient,
  TestnetHint,
  UnsupportedNetwork,
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
    expect(firstElement(childElements(result.current)).type).toBe(LandingPage);
    // The chain follows the connector's client and is saved, and a client change closes
    // the connector's modal.
    expect(globalThis.localStorage.getItem(selectedChainKey)).toBe("testnet");
    expect(connectorMock.ccc.close).toHaveBeenCalledTimes(1);

    // The saved chain does not override the client's.
    connectorMock.ccc.client = new StubClient({ addressPrefix: "ckb" });
    await rerender(undefined);
    expect(firstElement(childElements(result.current)).type).toBe(LandingPage);
    expect(globalThis.localStorage.getItem(selectedChainKey)).toBe("mainnet");
    expect(connectorMock.ccc.close).toHaveBeenCalledTimes(2);

    // A signer change on the same client neither saves nor closes again.
    connectorMock.signer = signerInfo(ccc.SignerType.BTC, "ckb");
    await rerender(undefined);
    expect(result.current.type).toBe(CkbSignerRequired);
    expect(connectorMock.ccc.close).toHaveBeenCalledTimes(2);

    connectorMock.signer = signerInfo(ccc.SignerType.CKB, "ckb-dev");
    connectorMock.ccc.client = new StubClient({ addressPrefix: "ckb-dev" });
    await rerender(undefined);
    expect(result.current.type).toBe(UnsupportedNetwork);

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
    ).toMatchObject({ walletName: "JoyID CKB", signer: connectorMock.signer });
    expect(globalThis.localStorage.getItem(selectedChainKey)).toBe("testnet");
    await unmount();
  });

  it("connects at once without a saved connection", async () => {
    const props = landingProps("mainnet", { data: quoteState() });
    const { result, unmount } = await renderHook(LandingPage, props);

    expect(landingView(result.current)).toMatchObject({ action: "Connect wallet" });
    expect(landingView(result.current).message).toMatch(/^This is an estimate\./u);
    await inAct(() => {
      landingView(result.current).open();
    });
    expect(props.open).toHaveBeenCalledTimes(1);
    expect(props.open).toHaveBeenCalledWith();
    expect(props.setClient).not.toHaveBeenCalled();
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
    expect(landingView(result.current).action).toBe("Restoring Testnet wallet");
    expect(props.open).not.toHaveBeenCalled();

    await inAct(() => {
      vi.runAllTimers();
    });
    expect(props.open).toHaveBeenCalledTimes(1);
    expect(landingView(result.current).action).toBe("Connect wallet");
    await unmount();
  });

  it("drops the pending open when the page unmounts or the chain changes", async () => {
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

    const { result, unmount } = await renderHook(LandingPage, props);
    await inAct(() => {
      landingView(result.current).open();
    });
    await inAct(() => {
      landingView(result.current).selectChain("mainnet");
    });
    expect(lendsClient(props, mainnetClient)).toBe(true);
    expect(landingView(result.current).action).toBe("Connect wallet");
    await inAct(() => {
      vi.runAllTimers();
    });
    expect(props.open).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<TestnetHint />)).toContain("Need testnet CKB?");
    await unmount();
  });

  it("connects and selects a chain when localStorage acquisition throws", async () => {
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
    await inAct(() => {
      landingView(result.current).selectChain("testnet");
    });
    expect(lendsClient(props, testnetClient)).toBe(true);
    await unmount();
  });
});

/** The landing page's props, one object so every re-render sees the same config. */
function landingProps(
  chain: RootConfig["chain"],
  liveQuote: Parameters<typeof quoteStateQuery>[0],
): LandingProps & {
  open: ReturnType<typeof vi.fn<() => void>>;
  setClient: ReturnType<typeof vi.fn<(client: unknown) => void>>;
} {
  return {
    open: vi.fn<() => void>(),
    setClient: vi.fn<(client: unknown) => void>(),
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

/** Whether the landing tabs last lent the connector an Owner of this client. */
function lendsClient(
  props: { setClient: ReturnType<typeof vi.fn<(client: unknown) => void>> },
  client: unknown,
): boolean {
  const owner: unknown = props.setClient.mock.lastCall?.[0];
  return ccc.Owner.is(owner) && owner.value === client;
}

/** What the landing page hands its header and action. */
function landingView(element: ReactElement): {
  action: string;
  message: string;
  open: () => void;
  selectChain: (chain: RootConfig["chain"]) => void;
} {
  const { header, action } = elementProps<{ header: ReactElement; action: ReactElement }>(
    element,
  );
  const layout = elementProps<Parameters<typeof ActionLayout>[0]>(action);
  return {
    action: layout.action,
    message: layout.message,
    open: (): void => {
      layout.onAction?.();
    },
    selectChain: elementProps<{ selectChain: (chain: RootConfig["chain"]) => void }>(
      header,
    ).selectChain,
  };
}

describe("chainFromClient", () => {
  it("maps supported CCC client prefixes to stack chains", () => {
    expect(chainFromClient(new StubClient({ addressPrefix: "ckb" }))).toBe("mainnet");
    expect(chainFromClient(new StubClient({ addressPrefix: "ckt" }))).toBe("testnet");
  });

  it("rejects unsupported prefixes so client and signer chains must agree", () => {
    expect(chainFromClient(new StubClient({ addressPrefix: "ckb-dev" }))).toBeUndefined();
  });
});
