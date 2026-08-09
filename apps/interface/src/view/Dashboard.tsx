import type { JSX } from "react";
import { buttonClass } from "../shared/buttonStyles.ts";
import type { RootConfig, WalletConfig } from "../shared/utils.ts";

export function Dashboard({
  walletConfig,
  walletName,
  openWallet,
  disabled = false,
}: Readonly<{
  walletConfig: WalletConfig;
  walletName: string;
  openWallet: () => unknown;
  disabled?: boolean;
}>): JSX.Element {
  const { chain, address } = walletConfig;
  const href = `https://${chain !== "mainnet" ? "testnet." : ""}explorer.nervos.org/address/${address}`;
  const shownAddress = shortenAddress(address);
  const isTestnet = chain === "testnet";
  const networkName = isTestnet ? "Testnet" : "Mainnet";
  return (
    <HeaderGrid>
      <span className="flex w-full max-w-full min-w-0 items-center justify-center gap-x-2 text-center">
        {isTestnet ? (
          <a
            href="https://testnet.explorer.nervos.org/faucet"
            className="rounded text-xl text-ickb-action hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ickb-action"
            aria-label="Open testnet faucet"
            title="Open testnet faucet"
          >
            🚰
          </a>
        ) : null}
        <button
          className="block max-w-full min-w-0 cursor-pointer overflow-hidden rounded text-center font-medium text-ellipsis whitespace-nowrap text-ickb-action hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ickb-action"
          onClick={() => {
            openWallet();
          }}
          disabled={disabled}
          title={`${walletName} on ${networkName}`}
        >
          {walletName} on {networkName}
        </button>
      </span>
      <span className="w-full max-w-full min-w-0 text-center">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-ickb-action hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ickb-action"
          title={address}
        >
          {shownAddress}
        </a>
      </span>
    </HeaderGrid>
  );
}

export function DisconnectedDashboard({
  chain,
  selectChain,
}: Readonly<{
  chain: RootConfig["chain"];
  selectChain: (chain: RootConfig["chain"]) => void;
}>): JSX.Element {
  return (
    <HeaderGrid>
      <span className="w-full min-[34rem]:col-span-2">
        <NetworkTabs {...{ chain, selectChain }} />
      </span>
    </HeaderGrid>
  );
}

export function PendingDashboard({
  chain,
  walletName,
  openWallet,
}: Readonly<{
  chain: RootConfig["chain"];
  walletName: string;
  openWallet: () => unknown;
}>): JSX.Element {
  return (
    <HeaderGrid>
      <span className="flex w-full max-w-full min-w-0 items-center justify-center gap-x-2 text-center">
        <button
          className="block max-w-full min-w-0 cursor-pointer overflow-hidden rounded text-center font-medium text-ellipsis whitespace-nowrap text-ickb-action hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ickb-action"
          onClick={() => {
            openWallet();
          }}
          title={`${walletName} on ${chain === "mainnet" ? "Mainnet" : "Testnet"}`}
        >
          {walletName} on {chain === "mainnet" ? "Mainnet" : "Testnet"}
        </button>
      </span>
      <span className="text-center text-ickb-muted">Loading address</span>
    </HeaderGrid>
  );
}

function shortenAddress(address: string): string {
  if (address.length <= 21) {
    return address;
  }

  return `${address.slice(0, 10)}...${address.slice(-8)}`;
}

function HeaderGrid({ children }: Readonly<{ children: React.ReactNode }>): JSX.Element {
  return (
    <div className="grid grid-cols-1 items-center justify-items-center gap-3 text-center text-sm min-[34rem]:grid-cols-2 sm:text-base">
      {children}
    </div>
  );
}

function NetworkTabs({
  chain,
  selectChain,
}: Readonly<{
  chain: RootConfig["chain"];
  selectChain: (chain: RootConfig["chain"]) => void;
}>): JSX.Element {
  return (
    <div className="grid w-full grid-cols-2 gap-2">
      <button
        className={networkButtonClass(chain === "mainnet")}
        aria-pressed={chain === "mainnet"}
        onClick={() => {
          selectChain("mainnet");
        }}
      >
        Mainnet
      </button>
      <button
        className={networkButtonClass(chain === "testnet")}
        aria-pressed={chain === "testnet"}
        onClick={() => {
          selectChain("testnet");
        }}
      >
        Testnet
      </button>
    </div>
  );
}

function networkButtonClass(isSelected: boolean): string {
  const baseClass = `${buttonClass} px-2`;
  return isSelected
    ? `${baseClass} bg-ickb-action/15 hover:bg-ickb-action/20 active:bg-ickb-action/25`
    : `${baseClass} border-ickb-border text-ickb-muted opacity-80 hover:border-ickb-action hover:bg-transparent hover:text-ickb-action`;
}
