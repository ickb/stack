import type { JSX } from "react";
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
  return (
    <HeaderGrid>
      <WalletButton {...{ walletName, chain, openWallet, disabled }} />
      <AddressLink {...{ address, chain }} />
    </HeaderGrid>
  );
}

/** The wallet's address, shortened, linking to it in the explorer. */
function AddressLink({
  address,
  chain,
}: Readonly<{ address: string; chain: RootConfig["chain"] }>): JSX.Element {
  const href = `https://${chain !== "mainnet" ? "testnet." : ""}explorer.nervos.org/address/${address}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="max-w-full min-w-0 overflow-hidden rounded text-center text-ellipsis whitespace-nowrap text-ickb-action hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ickb-action"
      title={address}
    >
      {shortAddress(address)} ↗
    </a>
  );
}

/** Both ends of an address with the middle elided; a short one stays intact. */
function shortAddress(address: string): string {
  if (address.length <= 21) {
    return address;
  }
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
}

/** Before a wallet connects: the network the quote is on, switched in the wallet modal. */
export function DisconnectedDashboard({
  chain,
}: Readonly<{ chain: RootConfig["chain"] }>): JSX.Element {
  return (
    <HeaderGrid>
      <span className="text-center text-ickb-muted min-[34rem]:col-span-2">
        {networkName(chain)}
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
      <WalletButton {...{ walletName, chain, openWallet }} />
      <span className="text-center text-ickb-muted">Loading address</span>
    </HeaderGrid>
  );
}

function WalletButton({
  walletName,
  chain,
  openWallet,
  disabled,
}: Readonly<{
  walletName: string;
  chain: RootConfig["chain"];
  openWallet: () => unknown;
  disabled?: boolean;
}>): JSX.Element {
  const label = `${walletName} on ${networkName(chain)}`;
  return (
    <span className="flex w-full max-w-full min-w-0 items-center justify-center gap-x-2 text-center">
      <button
        className="block max-w-full min-w-0 cursor-pointer overflow-hidden rounded text-center font-medium text-ellipsis whitespace-nowrap text-ickb-action hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ickb-action"
        onClick={() => {
          openWallet();
        }}
        disabled={disabled}
        title={label}
      >
        {label}
      </button>
    </span>
  );
}

function HeaderGrid({ children }: Readonly<{ children: React.ReactNode }>): JSX.Element {
  return (
    <div className="grid grid-cols-1 items-center justify-items-center gap-5 text-center text-sm min-[34rem]:grid-cols-2 sm:text-base">
      {children}
    </div>
  );
}

function networkName(chain: RootConfig["chain"]): string {
  return chain === "mainnet" ? "Mainnet" : "Testnet";
}
