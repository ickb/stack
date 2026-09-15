import type { ReactNode } from "react";
import type { createPortal as reactCreatePortal } from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  childElements,
  elementProps,
  findElement,
  findElements,
  firstElement,
  invokeElement,
} from "../support/react.ts";
import {
  ActionLayout,
  CKB,
  CkbSignerRequired,
  Dashboard,
  DisconnectedDashboard,
  Form,
  gridLine,
  PendingDashboard,
  RateChart,
  SwitchingWalletNetwork,
  unscaledTimeLabels,
  unscaledValueLabel,
  UnsupportedNetwork,
  WalletAppShell,
  WalletConfigPendingView,
  WalletHeaderPortal,
  WalletSection,
  WalletSections,
} from "./fixtures/modules.ts";

vi.mock(import("react-dom"), () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Component tests replace portals with inline children for static rendering.
  const createPortal = ((children: ReactNode): ReactNode =>
    children) as typeof reactCreatePortal;
  return { createPortal };
});

describe("view components", () => {
  it("renders action layout messages and progress states", () => {
    const onAction = vi.fn<() => void>();
    const markup = renderToStaticMarkup(
      <ActionLayout
        action="request conversion"
        disabled={false}
        isDone={false}
        onAction={onAction}
        message="Preview ready"
        fee="0.001 CKB"
        maturity="Ready"
      />,
    );

    expect(markup).toContain("request conversion");
    expect(markup).toContain("Preview ready");
    expect(markup).toContain("0.001 CKB");
    expect(markup).not.toContain("invisible");
    expect(markup).not.toContain("ickb-line-clamp-2");
    expect(markup).toContain("motion-reduce:animate-none");
    expect(
      renderToStaticMarkup(
        <ActionLayout
          action="request conversion"
          disabled={true}
          isDone={true}
          message=""
          fee="..."
          maturity="..."
        />,
      ),
    ).toContain("Status");
  });

  it("renders connected and pending dashboards with network-specific links", () => {
    const openWallet = vi.fn<() => void>();
    const dashboard = Dashboard({
      walletConfig: dashboardWalletConfig(
        "testnet",
        "ckt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhxqd5v3my",
      ),
      walletName: "Neuron",
      openWallet,
      destination: ownDestination(),
    });
    const walletButton = findElement(
      dashboard,
      (element) =>
        element.type === "button" &&
        elementProps<{ title?: string }>(element).title === "Neuron on Testnet",
    );

    elementProps<{ onClick: () => void }>(walletButton).onClick();
    expect(openWallet).toHaveBeenCalledTimes(1);
    expect(openWallet).toHaveBeenCalledWith();
    expect(renderToStaticMarkup(dashboard)).toContain("faucet.nervos.org");
    expect(renderToStaticMarkup(dashboard)).toContain("ckt1qxy2kg...xqd5v3my");
    expect(
      renderToStaticMarkup(
        <Dashboard
          walletConfig={dashboardWalletConfig("mainnet", "ckb1short")}
          walletName="JoyID"
          openWallet={openWallet}
          destination={ownDestination()}
        />,
      ),
    ).not.toContain("/faucet");
    expect(
      renderToStaticMarkup(
        <Dashboard
          walletConfig={dashboardWalletConfig("mainnet", "ckb1short")}
          walletName="JoyID"
          openWallet={openWallet}
          destination={ownDestination()}
          disabled={true}
        />,
      ),
    ).toContain('disabled=""');

    const pending = PendingDashboard({
      chain: "mainnet",
      walletName: "JoyID",
      openWallet,
    });
    elementProps<{ onClick: () => void }>(
      findElement(pending, (element) => element.type === "button"),
    ).onClick();
    expect(renderToStaticMarkup(pending)).toContain("Loading address");
  });

  it("switches disconnected network tabs", () => {
    const selectChain =
      vi.fn<Parameters<typeof DisconnectedDashboard>[0]["selectChain"]>();
    const markup = renderToStaticMarkup(
      <DisconnectedDashboard chain="mainnet" selectChain={selectChain} />,
    );
    const dashboardChild = firstElement(
      childElements(DisconnectedDashboard({ chain: "mainnet", selectChain })),
    );
    const tabs = invokeElement(firstElement(childElements(dashboardChild)));
    const buttons = findElements(tabs, (element) => element.type === "button");

    elementProps<{ onClick: () => void }>(firstElement(buttons)).onClick();
    elementProps<{ onClick: () => void }>(buttons[1] ?? firstElement(buttons)).onClick();
    expect(selectChain.mock.calls).toEqual([["mainnet"], ["testnet"]]);
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("Mainnet");
    expect(markup).toContain("Testnet");
  });

  it("renders form edits, direction changes, and balance selectors", () => {
    const setRawText = vi.fn<(value: string) => void>();
    const element = Form({
      rawText: "C1.5",
      setRawText,
      isFrozen: false,
      balances: {
        ckbNative: 3n * CKB,
        ickbNative: 2n * CKB,
        ckbAvailable: 4n * CKB,
        ickbAvailable: 2n * CKB,
        ckbBalance: 5n * CKB,
        ickbBalance: 3n * CKB,
      },
    });
    const input = findElement(element, (node) => node.type === "input");
    const buttons = findElements(element, (node) => node.type === "button");

    elementProps<{ onChange: (event: { target: { value: string } }) => void }>(
      input,
    ).onChange({ target: { value: ".25abc" } });
    for (const button of buttons) {
      elementProps<{ onClick?: () => void }>(button).onClick?.();
    }

    expect(setRawText.mock.calls).toEqual([["C.25abc"], ["I1.5"], ["I2"]]);
    expect(renderToStaticMarkup(element)).toContain('aria-invalid="false"');
    const invalidMarkup = renderToStaticMarkup(
      <Form rawText="C1e2" setRawText={setRawText} isFrozen={false} />,
    );
    expect(invalidMarkup).toContain("Enter a decimal amount with up to 8 decimal places");
    expect(invalidMarkup).toContain('aria-invalid="true"');
    expect(invalidMarkup).toMatch(/aria-describedby="([^"]+)"/u);
    const describedBy = /aria-describedby="([^"]+)"/u.exec(invalidMarkup)?.[1];
    if (describedBy === undefined) {
      throw new Error("Invalid amount input is not described by its error");
    }
    expect(invalidMarkup).toContain(`id="${describedBy}"`);
    expect(invalidMarkup).toContain('role="alert"');
    expect(invalidMarkup).toContain("break-words whitespace-normal");
    expect(invalidMarkup).not.toContain("text-ellipsis whitespace-nowrap text-base");
    expect(renderToStaticMarkup(element)).toContain("Available CKB: 3");
    expect(renderToStaticMarkup(element)).toContain("motion-reduce:animate-none");
    expect(renderToStaticMarkup(element)).not.toContain("Use maximum CKB");
    expect(renderToStaticMarkup(element)).toContain("Use maximum iCKB: 2");
    expect(
      renderToStaticMarkup(
        <Form
          rawText="C1"
          setRawText={setRawText}
          isFrozen={false}
          balances={{
            ckbNative: 1n,
            ickbNative: 0n,
            ckbAvailable: 1n,
            ickbAvailable: 0n,
            ckbBalance: 1n,
            ickbBalance: 0n,
          }}
        />,
      ),
    ).toContain("0+");
    expect(
      renderToStaticMarkup(<Form rawText="I" setRawText={setRawText} isFrozen={true} />),
    ).toContain('disabled=""');
  });

  it("renders chart layout elements", () => {
    const chart = renderToStaticMarkup(
      <RateChart
        chain="mainnet"
        isCkb2Udt={true}
        amount={CKB}
        now={new Date("2026-06-07T18:43:08.091Z")}
      />,
    );

    expect(chart).toContain("1 CKB worth over time");
    expect(chart).toContain("polyline");
    expect(
      renderToStaticMarkup(<>{unscaledTimeLabels(0, Date.UTC(2030, 0, 1))}</>),
    ).toContain("2030");
    expect(renderToStaticMarkup(gridLine(1, 0, 2))).toContain("line");
    expect(
      renderToStaticMarkup(
        unscaledValueLabel({ value: 1, minY: 0, maxY: 2, label: "1 CKB", index: 0 }),
      ),
    ).toContain("1 CKB");
  });

  it("renders wallet section shells and pending wallet config states", () => {
    const openWallet = vi.fn<() => void>();
    const setRawText = vi.fn<(value: string) => void>();
    const selectChain = vi.fn<Parameters<typeof WalletAppShell>[0]["selectChain"]>();
    vi.stubGlobal("document", { getElementById: () => ({}) });

    expect(
      renderToStaticMarkup(<WalletHeaderPortal>Header</WalletHeaderPortal>),
    ).toContain("Header");
    vi.stubGlobal("document", { getElementById: () => null });
    expect(WalletHeaderPortal({ children: "Header" })).toBeNull();
    vi.stubGlobal("document", { getElementById: () => ({}) });
    expect(
      renderToStaticMarkup(
        <WalletSections>
          <WalletSection>Body</WalletSection>
        </WalletSections>,
      ),
    ).toContain("Body");
    const restoredShell = (
      <WalletAppShell
        rawText="C1"
        setRawText={setRawText}
        chain="mainnet"
        selectChain={selectChain}
        isRestoring={true}
        open={openWallet}
        liveStatus="Loading live exchange rate."
      />
    );
    expect(renderToStaticMarkup(restoredShell)).toContain("Restoring Mainnet wallet");
    expect(
      renderToStaticMarkup(
        <WalletAppShell
          rawText="C1"
          setRawText={setRawText}
          chain="testnet"
          selectChain={selectChain}
          isRestoring={false}
          open={openWallet}
          liveStatus=""
        />,
      ),
    ).toContain("Connect wallet");
    const pendingError = WalletConfigPendingView({
      rootConfig: pendingRootConfig("testnet"),
      walletName: "JoyID",
      openWallet,
      rawText: "I2",
      setRawText,
      error: new Error("denied"),
      retry: vi.fn<() => void>(),
    });
    const pendingAction = findElement(
      pendingError,
      (element) => element.type === ActionLayout,
    );
    elementProps<Parameters<typeof ActionLayout>[0]>(pendingAction).onAction?.();
    expect(renderToStaticMarkup(pendingError)).toContain(
      "Unable to connect to JoyID: denied",
    );
    expect(openWallet).not.toHaveBeenCalled();
    const pendingConnect = WalletConfigPendingView({
      rootConfig: pendingRootConfig("mainnet"),
      walletName: "JoyID",
      openWallet,
      rawText: "C2",
      setRawText,
    });
    expect(
      elementProps<Parameters<typeof ActionLayout>[0]>(
        findElement(pendingConnect, (element) => element.type === ActionLayout),
      ),
    ).toMatchObject({
      action: "Connect wallet",
      disabled: true,
      isDone: false,
      onAction: undefined,
      message: "JoyID may ask you to authorize this connection.",
    });
  });

  it("keeps invalid disconnected and pending amounts out of chart calculations", () => {
    vi.stubGlobal("document", { getElementById: () => ({}) });
    const invalidShell = WalletAppShell({
      rawText: "C.",
      setRawText: vi.fn<(value: string) => void>(),
      chain: "mainnet",
      selectChain: vi.fn<(chain: "mainnet" | "testnet") => void>(),
      isRestoring: false,
      open: vi.fn<() => void>(),
      liveStatus: "",
    });
    const shellChart = findElement(invalidShell, (element) => element.type === RateChart);
    expect(elementProps<Parameters<typeof RateChart>[0]>(shellChart).amount).toBe(0n);

    const pending = WalletConfigPendingView({
      rootConfig: pendingRootConfig("testnet"),
      walletName: "JoyID",
      openWallet: vi.fn<() => void>(),
      rawText: "I.",
      setRawText: vi.fn<(value: string) => void>(),
      error: new Error("denied"),
    });
    const pendingChart = findElement(pending, (element) => element.type === RateChart);
    const pendingAction = findElement(
      pending,
      (element) => element.type === ActionLayout,
    );
    expect(elementProps<Parameters<typeof RateChart>[0]>(pendingChart)).toMatchObject({
      amount: 0n,
      isCkb2Udt: false,
    });
    expect(elementProps<Parameters<typeof ActionLayout>[0]>(pendingAction)).toMatchObject(
      {
        action: "Retry wallet data",
        disabled: true,
        onAction: undefined,
      },
    );
  });

  it("renders wallet gate support actions", () => {
    const open = vi.fn<() => void>();
    for (const element of [
      CkbSignerRequired({ open }),
      UnsupportedNetwork({ addressPrefix: "ckb-dev", open }),
      SwitchingWalletNetwork({ open }),
    ]) {
      elementProps<{ onClick: () => void }>(
        findElement(element, (node) => node.type === "button"),
      ).onClick();
    }

    expect(open).toHaveBeenCalledTimes(3);
    expect(
      renderToStaticMarkup(<UnsupportedNetwork addressPrefix="ckb-dev" open={open} />),
    ).toContain("Unsupported CKB address prefix: ckb-dev");
  });
});

function dashboardWalletConfig(
  chain: Parameters<typeof Dashboard>[0]["walletConfig"]["chain"],
  address: string,
): Parameters<typeof Dashboard>[0]["walletConfig"] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Dashboard only reads chain and address from the wallet config.
  return { chain, address } as Parameters<typeof Dashboard>[0]["walletConfig"];
}

function pendingRootConfig(
  chain: Parameters<typeof WalletConfigPendingView>[0]["rootConfig"]["chain"],
): Parameters<typeof WalletConfigPendingView>[0]["rootConfig"] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Pending view only reads rootConfig.chain in these branches.
  return { chain } as Parameters<typeof WalletConfigPendingView>[0]["rootConfig"];
}

function ownDestination(): Parameters<typeof Dashboard>[0]["destination"] {
  return {
    text: "",
    setText: vi.fn<(value: string) => void>(),
    isValid: true,
    isForeign: false,
  };
}
