import { useState, type JSX } from "react";
import { shortAddress, type DestinationField } from "../action/destination.ts";
import { buttonClass } from "../shared/buttonStyles.ts";
import type { RootConfig, WalletConfig } from "../shared/utils.ts";

export function Dashboard({
  walletConfig,
  walletName,
  openWallet,
  destination,
  disabled = false,
}: Readonly<{
  walletConfig: WalletConfig;
  walletName: string;
  openWallet: () => unknown;
  destination: DestinationField;
  disabled?: boolean;
}>): JSX.Element {
  const { chain, address } = walletConfig;
  const isTestnet = chain === "testnet";
  const networkName = isTestnet ? "Testnet" : "Mainnet";
  return (
    <HeaderGrid>
      <span className="flex w-full max-w-full min-w-0 items-center justify-center gap-x-2 text-center">
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
      <AddressField {...{ destination, chain, disabled }} ownAddress={address} />
    </HeaderGrid>
  );
}

/**
 * The wallet's address, doubling as the destination of the next transaction: the own
 * address as the placeholder of the empty field, a pasted one shortened at rest and in
 * full while editing, marked with an arrow once it points elsewhere (decisions amendment
 * 52(af)). The link opens the shown address in the explorer.
 */
function AddressField({
  destination,
  ownAddress,
  chain,
  disabled,
}: Readonly<{
  destination: DestinationField;
  ownAddress: string;
  chain: RootConfig["chain"];
  disabled: boolean;
}>): JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const { text, setText, isValid, isForeign } = destination;
  const marker = isForeign ? "→ " : "";
  const atRest = text === "" ? "" : `${marker}${shortAddress(text)}`;
  const shown = isEditing || !isValid ? text : atRest;
  const explorerAddress = isValid && text !== "" ? text.trim() : ownAddress;
  const href = `https://${chain !== "mainnet" ? "testnet." : ""}explorer.nervos.org/address/${explorerAddress}`;
  // The input sizes to its text, so the explorer link sits right after the address at
  // every width instead of at the far edge of a full-width box.
  return (
    <span className="flex w-full max-w-full min-w-0 items-center justify-center gap-x-1 text-center">
      {/* "to" and the underline say this is the destination and that it is editable; the
          tooltip alone never shows on a phone. */}
      <span className="text-ickb-muted">to</span>
      <input
        value={shown}
        placeholder={shortAddress(ownAddress)}
        disabled={disabled}
        onFocus={() => {
          setIsEditing(true);
        }}
        onBlur={() => {
          setIsEditing(false);
        }}
        onChange={(event) => {
          setText(event.target.value);
        }}
        // A paste is the whole edit: leaving the field shows the address shortened at once.
        onPaste={(event) => {
          const element = event.currentTarget;
          setTimeout(() => {
            element.blur();
          }, 0);
        }}
        autoComplete="off"
        spellCheck={false}
        type="text"
        aria-invalid={!isValid}
        aria-label="Destination address"
        title="Every cell the next transaction creates for you belongs to this address"
        className="field-sizing-content max-w-full min-w-0 overflow-hidden rounded-none border-0 border-b border-ickb-border/70 bg-transparent text-center text-ellipsis whitespace-nowrap text-ickb-action outline-none placeholder:text-ickb-action/70 hover:border-ickb-action/60 focus:border-ickb-action focus-visible:outline-none disabled:cursor-default"
      />
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded text-ickb-action hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ickb-action"
        aria-label="Open the address in the explorer"
        title={explorerAddress}
      >
        ↗
      </a>
    </span>
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

function HeaderGrid({ children }: Readonly<{ children: React.ReactNode }>): JSX.Element {
  return (
    <div className="grid grid-cols-1 items-center justify-items-center gap-5 text-center text-sm min-[34rem]:grid-cols-2 sm:text-base">
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
