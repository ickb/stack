import type { JSX } from "react";
import Action from "../action/Action.tsx";
import type { DestinationField } from "../action/destination.ts";
import RateChart from "../chart/rateChart.tsx";
import type { L1StateType, QuoteState } from "../query/queries.ts";
import { objectIdentityKey } from "../query/rootConfigQueryKey.ts";
import type { WalletConfig } from "../shared/utils.ts";
import { Dashboard } from "./Dashboard.tsx";
import Form from "./Form.tsx";
import { WalletHeaderPortal } from "./WalletHeaderPortal.tsx";
import { WalletSection, WalletSections } from "./WalletSections.tsx";

export function WalletAppView({
  walletConfig,
  walletName,
  openWallet,
  rawText,
  setRawText,
  quoteState,
  formQuoteState,
  isFrozen,
  destinationField,
  actionParams,
  isCkb2Udt,
  amount,
  l1State,
}: Readonly<{
  walletConfig: WalletConfig;
  walletName: string;
  openWallet: () => unknown;
  rawText: string;
  setRawText: (value: string) => void;
  quoteState?: QuoteState;
  formQuoteState: Parameters<typeof Form>[0]["quoteState"];
  isFrozen: boolean;
  destinationField: DestinationField;
  actionParams: ActionParams;
  isCkb2Udt: boolean;
  amount: bigint;
  l1State: L1StateType | undefined;
}>): JSX.Element {
  return (
    <>
      <WalletHeaderPortal>
        <Dashboard
          {...{ walletConfig, walletName, openWallet }}
          destination={destinationField}
          disabled={isFrozen}
        />
      </WalletHeaderPortal>
      <WalletSections>
        <WalletSection>
          <Form
            {...{
              rawText,
              setRawText,
              quoteState: formQuoteState,
              isFrozen,
              ...(l1State !== undefined
                ? {
                    balances: {
                      ckbNative: l1State.ckbNative,
                      ickbNative: l1State.ickbNative,
                      ckbAvailable: l1State.ckbAvailable,
                      ickbAvailable: l1State.ickbAvailable,
                      ckbBalance: l1State.ckbBalance,
                      ickbBalance: l1State.ickbBalance,
                    },
                  }
                : {}),
            }}
          />
        </WalletSection>
        <WalletSection>
          <RateChart
            chain={walletConfig.chain}
            isCkb2Udt={isCkb2Udt}
            amount={amount}
            quoteState={quoteState}
          />
        </WalletSection>
        <WalletSection>
          <Action
            key={`${walletConfig.chain}:${walletConfig.address}:${String(objectIdentityKey(walletConfig))}`}
            {...actionParams}
          />
        </WalletSection>
      </WalletSections>
    </>
  );
}

type ActionParams = Parameters<typeof Action>[0];
