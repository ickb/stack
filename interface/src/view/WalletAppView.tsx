import type { Ratio } from "@ickb/sdk";
import type { JSX } from "react";
import Action from "../action/Action.tsx";
import type { DestinationField } from "../action/destination.ts";
import { objectIdentityKey, type L1StateType, type QuoteState } from "../app/queries.ts";
import RateChart from "../chart/RateChart.tsx";
import type { WalletConfig } from "../shared/utils.ts";
import { Dashboard } from "./Dashboard.tsx";
import Form from "./Form.tsx";
import { WalletPage } from "./WalletPage.tsx";

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
    <WalletPage
      header={
        <Dashboard
          {...{ walletConfig, walletName, openWallet }}
          destination={destinationField}
          disabled={isFrozen}
        />
      }
      form={
        <Form
          {...{ isCkb2Udt, setIsCkb2Udt, text, setText, exchangeRatio, isFrozen }}
          projection={l1State?.projection}
          chain={walletConfig.chain}
        />
      }
      action={
        <Action
          key={`${walletConfig.chain}:${walletConfig.address}:${String(objectIdentityKey(walletConfig))}`}
          {...actionParams}
        />
      }
      chart={
        <RateChart
          chain={walletConfig.chain}
          isCkb2Udt={isCkb2Udt}
          amount={amount}
          quoteState={quoteState}
        />
      }
    />
  );
}

type ActionParams = Parameters<typeof Action>[0];
