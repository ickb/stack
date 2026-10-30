import { Ratio } from "@ickb/sdk";
import type { ReactElement, ReactNode } from "react";
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
  PendingDashboard,
  QuotePage,
  RateChart,
  SwitchingWalletNetwork,
  UnsupportedNetwork,
  WalletPage,
} from "./fixtures/modules.ts";
import { projection } from "./fixtures/projection.ts";

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
      walletButtonOf(dashboard),
      (element) =>
        element.type === "button" &&
        elementProps<{ title?: string }>(element).title === "Neuron on Testnet",
    );

    elementProps<{ onClick: () => void }>(walletButton).onClick();
    expect(openWallet).toHaveBeenCalledTimes(1);
    expect(openWallet).toHaveBeenCalledWith();
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
    ).not.toContain("faucet");
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
    ).toContain("cannot change during the transaction");

    const pending = PendingDashboard({
      chain: "mainnet",
      walletName: "JoyID",
      openWallet,
    });
    elementProps<{ onClick: () => void }>(
      findElement(walletButtonOf(pending), (element) => element.type === "button"),
    ).onClick();
    expect(openWallet).toHaveBeenCalledTimes(2);
    expect(renderToStaticMarkup(pending)).toContain("JoyID on Mainnet");
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
    const setIsCkb2Udt = vi.fn<(value: boolean) => void>();
    const setText = vi.fn<(value: string) => void>();
    const draft = {
      isCkb2Udt: true,
      setIsCkb2Udt,
      text: "1.5",
      setText,
      isFrozen: false,
    };
    const balances = projection({
      ckbNative: 3n * CKB,
      ickbNative: 2n * CKB,
      ckbAvailable: 4n * CKB,
      ickbAvailable: 2n * CKB,
      ckbBalance: 5n * CKB,
      ickbBalance: 3n * CKB,
    });
    const element = Form({ ...draft, projection: balances, chain: "testnet" });
    const input = findElement(element, (node) => node.type === "input");
    const buttons = findElements(element, (node) => node.type === "button");

    type Change = (event: {
      target: { value: string; selectionStart: number; setSelectionRange: () => void };
    }) => void;
    const typed = (value: string, selectionStart: number): Parameters<Change>[0] => ({
      target: { value, selectionStart, setSelectionRange: vi.fn<() => void>() },
    });
    elementProps<{ onChange: Change }>(input).onChange(typed(".25abc", 6));
    for (const button of buttons) {
      elementProps<{ onClick?: () => void }>(button).onClick?.();
    }

    // Commas in the box never reach the text.
    elementProps<{ onChange: Change }>(input).onChange(typed("1,234,5", 7));
    expect(setText.mock.calls).toEqual([[".25abc"], ["12345"]]);
    expect(setIsCkb2Udt.mock.calls).toEqual([[false]]);
    expect(
      renderToStaticMarkup(
        Form({ ...draft, text: "1234567.5", projection: balances, chain: "testnet" }),
      ),
    ).toContain('value="1,234,567.5"');
    expect(renderToStaticMarkup(element)).toContain('aria-invalid="false"');
    const invalidMarkup = renderToStaticMarkup(
      <Form {...draft} text="1e2" chain="testnet" />,
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
    expect(renderToStaticMarkup(element)).toContain("CKB in wallet: 3");
    expect(renderToStaticMarkup(element)).toContain("motion-reduce:animate-none");
    // Max exists only while converting from iCKB: no CKB Max, none on the target.
    expect(renderToStaticMarkup(element)).not.toContain("Use maximum");
    const fromIckb = Form({
      ...draft,
      isCkb2Udt: false,
      projection: balances,
      chain: "testnet",
    });
    expect(renderToStaticMarkup(fromIckb)).toContain("Use maximum iCKB: 2");
    // The faucet sits under "CKB" on testnet, wherever CKB is, and nowhere on mainnet.
    expect(renderToStaticMarkup(element)).toContain("faucet.nervos.org");
    expect(renderToStaticMarkup(fromIckb)).toContain("faucet.nervos.org");
    expect(
      renderToStaticMarkup(Form({ ...draft, projection: balances, chain: "mainnet" })),
    ).not.toContain("faucet");
    elementProps<{ onClick?: () => void }>(
      findElement(
        fromIckb,
        (node) =>
          node.type === "button" &&
          elementProps<{ "aria-label"?: string }>(node)["aria-label"]?.startsWith(
            "Use maximum",
          ) === true,
      ),
    ).onClick?.();
    expect(setText.mock.lastCall).toEqual(["2"]);
    expect(
      renderToStaticMarkup(
        <Form
          {...draft}
          text="1"
          chain="testnet"
          projection={projection({
            ckbNative: 1n,
            ickbNative: 0n,
            ckbAvailable: 1n,
            ickbAvailable: 0n,
            ckbBalance: 1n,
            ickbBalance: 0n,
          })}
        />,
      ),
    ).toContain("0+");
    // The unit rate beside the switch: both sides at two decimals, "..." without a quote.
    expect(renderToStaticMarkup(element)).toContain("1.00 CKB");
    expect(renderToStaticMarkup(element)).toContain("...");
    expect(
      renderToStaticMarkup(
        <Form
          {...draft}
          text="1"
          chain="testnet"
          exchangeRatio={Ratio.from({ ckbScale: 1n, udtScale: 1n })}
        />,
      ),
    ).toContain("1.00 iCKB");
    expect(
      renderToStaticMarkup(
        <Form {...draft} isCkb2Udt={false} text="" chain="testnet" isFrozen={true} />,
      ),
    ).toContain('disabled=""');
    // Another address: the amount, max and direction cannot change, and the zero says why.
    const move = renderToStaticMarkup(
      <Form
        {...draft}
        isCkb2Udt={false}
        text="0"
        chain="testnet"
        projection={balances}
        isMove={true}
      />,
    );
    expect(move).toContain("all CKB and iCKB go to the address above");
    expect(move.match(/disabled=""/gu)).toHaveLength(3);
  });

  it("renders chart layout elements", () => {
    const chart = renderToStaticMarkup(
      <RateChart chain="mainnet" isCkb2Udt={true} amount={CKB} />,
    );

    expect(chart).toContain("1 CKB worth over time");
    expect(chart).toContain("polyline");
    // The unscaled labels: the years along the time axis and the value ticks with their unit.
    expect(chart).toContain("2019");
    expect(chart).toContain("<line");
    expect(chart).toContain(" iCKB");
  });

  it("renders the wallet page and the quote page around the caller's slots", () => {
    const draft = {
      isCkb2Udt: true,
      setIsCkb2Udt: vi.fn<(value: boolean) => void>(),
      text: "1",
      setText: vi.fn<(value: string) => void>(),
    };
    vi.stubGlobal("document", { getElementById: () => ({}) });

    const page = <WalletPage header="Header" form="Form" action="Act" chart="Chart" />;
    expect(renderToStaticMarkup(page)).toContain("Header");
    expect(renderToStaticMarkup(page)).toContain("Form");
    // Without the header mount the page renders its sections alone.
    vi.stubGlobal("document", { getElementById: () => null });
    expect(renderToStaticMarkup(page)).not.toContain("Header");
    expect(renderToStaticMarkup(page)).toContain("Chart");
    vi.stubGlobal("document", { getElementById: () => ({}) });
    const quote = renderToStaticMarkup(
      <QuotePage {...draft} chain="testnet" header="Pending header" action="Connect" />,
    );
    expect(quote).toContain("Pending header");
    expect(quote).toContain("Connect");
    expect(quote).toContain('value="1"');
  });

  it("keeps an invalid quote amount out of chart calculations", () => {
    vi.stubGlobal("document", { getElementById: () => ({}) });
    const quote = QuotePage({
      isCkb2Udt: false,
      setIsCkb2Udt: vi.fn<(value: boolean) => void>(),
      text: ".",
      setText: vi.fn<(value: string) => void>(),
      chain: "mainnet",
      header: undefined,
      action: undefined,
    });
    const chart = findElement(quote, (element) => element.type === RateChart);
    expect(elementProps<Parameters<typeof RateChart>[0]>(chart)).toMatchObject({
      amount: 0n,
      isCkb2Udt: false,
    });
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

/** Renders the dashboard's wallet button, found by the callback only it receives. */
function walletButtonOf(dashboard: ReactElement): ReactElement {
  return invokeElement(
    findElement(dashboard, (element) => "openWallet" in elementProps<object>(element)),
  );
}

function dashboardWalletConfig(
  chain: Parameters<typeof Dashboard>[0]["walletConfig"]["chain"],
  address: string,
): Parameters<typeof Dashboard>[0]["walletConfig"] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Dashboard only reads chain and address from the wallet config.
  return { chain, address } as Parameters<typeof Dashboard>[0]["walletConfig"];
}

function ownDestination(): Parameters<typeof Dashboard>[0]["destination"] {
  return {
    text: "",
    setText: vi.fn<(value: string) => void>(),
    isValid: true,
    isForeign: false,
  };
}
