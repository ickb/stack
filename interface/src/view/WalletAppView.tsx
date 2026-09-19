import type { Ratio } from "@ickb/sdk";
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
  isCkb2Udt,
  setIsCkb2Udt,
  text,
  setText,
  quoteState,
  exchangeRatio,
  isFrozen,
  destinationField,
  actionParams,
  amount,
  l1State,
}: Readonly<{
  walletConfig: WalletConfig;
  walletName: string;
  openWallet: () => unknown;
  isCkb2Udt: boolean;
  setIsCkb2Udt: (value: boolean) => void;
  text: string;
  setText: (value: string) => void;
  quoteState?: QuoteState;
  exchangeRatio?: Ratio;
  isFrozen: boolean;
  destinationField: DestinationField;
  actionParams: ActionParams;
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
            {...{ isCkb2Udt, setIsCkb2Udt, text, setText, exchangeRatio, isFrozen }}
            projection={l1State?.projection}
            chain={walletConfig.chain}
          />
        </WalletSection>
        {/* The button follows the form; the chart is context and comes last (52(ag)). */}
        <WalletSection>
          <Action
            key={`${walletConfig.chain}:${walletConfig.address}:${String(objectIdentityKey(walletConfig))}`}
            {...actionParams}
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
      </WalletSections>
    </>
  );
}

type ActionParams = Parameters<typeof Action>[0];
