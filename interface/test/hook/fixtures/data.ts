import { ccc } from "@ckb-ccc/ccc";

import { script, StubClient } from "@ickb/testkit";
import { vi } from "vitest";
import { state } from "../../action/fixtures/transaction.ts";
import {
  CKB,
  mainnetClient,
  queryClient,
  testnetClient,
  type Action,
  type L1StateType,
  type QuoteState,
  type RootConfig,
  type TxInfo,
  type useQuoteState,
  type WalletConfig,
  type WalletConfigGate,
} from "./modules.ts";

export const connectionInfoKey = "ccc-connection-info";

export function actionProps(): Parameters<typeof Action>[0] {
  return {
    isCkb2Udt: true,
    amount: CKB,
    amountError: "",
    walletConfig: walletConfig(),
    attempt: { phase: "idle", message: "", failure: "", frozenPreview: undefined },
    onAction: vi.fn<() => void>(),
    l1State: l1State(),
    isStateFetching: false,
    stateError: null,
    retryState: vi.fn<() => void>(),
  };
}

/** What the state fixture's builder returns: nothing to sign. */
export const nothingToSign: TxInfo = Object.freeze({
  ok: false,
  error: "Nothing to do",
});

export function l1State(): L1StateType {
  return {
    ...state({
      ckbNative: 3n * CKB,
      ickbNative: 2n * CKB,
      ckbBalance: 4n * CKB,
      ickbBalance: 3n * CKB,
      ckbAvailable: 3n * CKB,
      ckbConvertible: 2n * CKB,
      ickbAvailable: 2n * CKB,
      exchangeRatio: quoteState().exchangeRatio,
    }),
    stateId: "state-id",
    txBuilder: vi.fn(async () => {
      await Promise.resolve();
      return nothingToSign;
    }),
    hasConverting: false,
  };
}

export function quoteState(): QuoteState {
  return {
    exchangeRatio: { ckbScale: 1n, udtScale: 1n },
    tipTimestamp: 0n,
  };
}

export function walletConfig(): WalletConfig {
  return {
    ...rootConfig("testnet"),
    signer: signerInfo(ccc.SignerType.CKB, "ckt"),
    address: "ckt1test",
  };
}

export function rootConfig(chain: RootConfig["chain"]): RootConfig {
  return {
    chain,
    cccClient: chain === "mainnet" ? mainnetClient : testnetClient,
    queryClient,
  };
}

export function walletConfigGateProps(
  signer: ccc.Signer,
): Parameters<typeof WalletConfigGate>[0] {
  return {
    rootConfig: rootConfig("testnet"),
    signer,
    walletName: "JoyID",
    openWallet: vi.fn<() => void>(),
    isCkb2Udt: true,
    setIsCkb2Udt: vi.fn<(value: boolean) => void>(),
    text: "1",
    setText: vi.fn<(value: string) => void>(),
  };
}

export function walletSigner(isConnected: boolean): ccc.Signer & {
  connect: ReturnType<typeof vi.fn>;
  getRecommendedAddressObj: ReturnType<typeof vi.fn>;
} {
  const recommendedScript = script("11");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Wallet config tests need a signer double with just the methods used by WalletConfigGate.
  return {
    client: new StubClient({ addressPrefix: "ckt" }),
    type: ccc.SignerType.CKB,
    connect: vi.fn(async () => {
      await Promise.resolve();
    }),
    getRecommendedAddressObj: vi.fn(async () => {
      await Promise.resolve();
      return {
        script: recommendedScript,
        toString: (): string => "ckt1recommended",
      };
    }),
    isConnected: vi.fn(async () => {
      await Promise.resolve();
      return isConnected;
    }),
  } as unknown as ccc.Signer & {
    connect: ReturnType<typeof vi.fn>;
    getRecommendedAddressObj: ReturnType<typeof vi.fn>;
  };
}

export function quoteStateQuery(value: unknown): ReturnType<typeof useQuoteState> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Tests provide only the query fields read by the component branch under test.
  return value as ReturnType<typeof useQuoteState>;
}

export function signerInfo(type: ccc.SignerType, addressPrefix: string): ccc.Signer {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- WalletGate branch tests need only signer type and client prefix.
  return {
    type,
    client: new StubClient({ addressPrefix }),
  } as unknown as ccc.Signer;
}
