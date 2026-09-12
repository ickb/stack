import { ccc } from "@ckb-ccc/ccc";
import { Ratio } from "@ickb/sdk";

import { script, StubClient } from "@ickb/testkit";
import { vi } from "vitest";
import { txWithInput } from "../../action/fixtures/transaction.ts";
import {
  CKB,
  mainnetClient,
  queryClient,
  testnetClient,
  txInfoPadding,
  type Action,
  type L1StateType,
  type QuoteState,
  type RootConfig,
  type TxInfo,
  type useQuoteState,
  type WalletConfig,
  type WalletConfigGate,
} from "./modules.ts";

export const selectedChainKey = "ickb-selected-chain";
export const connectionInfoKey = "ccc-connection-info";

export function actionProps(): Parameters<typeof Action>[0] {
  return {
    isCkb2Udt: true,
    amount: CKB,
    amountError: "",
    refreshPreview: vi.fn(async () => {
      await Promise.resolve();
      return {
        stateId: "state-id",
        tipTimestamp: 0n,
        hasCollectable: false,
        build: async (): Promise<TxInfo> => {
          await Promise.resolve();
          return activeTxInfo();
        },
      };
    }),
    freeze: vi.fn<(value: boolean) => void>(),
    formReset: vi.fn<() => void>(),
    walletConfig: walletConfig(),
    pendingTransaction: undefined,
    // Built inline: this fixture loads before the React mock, so it must not import the hook module.
    pendingStore: { current: undefined, onChange: (): undefined => undefined },
    l1State: l1State(),
    isStateFetching: false,
    stateError: null,
    retryState: vi.fn<() => void>(),
  };
}

export function activeTxInfo(): TxInfo {
  return {
    tx: txWithInput("11"),
    error: "",
    fee: 1n,
    estimatedMaturity: 0n,
  };
}

export function l1State(): L1StateType {
  return {
    ckbNative: 3n * CKB,
    ickbNative: 2n * CKB,
    ckbBalance: 4n * CKB,
    ickbBalance: 3n * CKB,
    ckbAvailable: 3n * CKB,
    ickbAvailable: 2n * CKB,
    tipTimestamp: 0n,
    system: quoteSystemState(),
    stateId: "state-id",
    txBuilder: vi.fn(async () => {
      await Promise.resolve();
      return txInfoPadding;
    }),
    hasCollectable: false,
  };
}

export function quoteState(): QuoteState {
  return {
    exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
    tipTimestamp: 0n,
  };
}

export function walletConfig(): WalletConfig {
  return {
    ...rootConfig("testnet"),
    signer: signerInfo(ccc.SignerType.CKB, "ckt"),
    address: "ckt1test",
    accountLocks: [script("11")],
    primaryLock: script("11"),
  };
}

export function rootConfig(chain: RootConfig["chain"]): RootConfig {
  return {
    chain,
    cccClient: chain === "mainnet" ? mainnetClient : testnetClient,
    resetClient: vi.fn<() => void>(),
    queryClient,
    sdk: rootSdk(),
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
    rawText: "C1",
    setRawText: vi.fn<(value: string) => void>(),
  };
}

export function walletSigner(isConnected: boolean): ccc.Signer & {
  connect: ReturnType<typeof vi.fn>;
  getRecommendedAddressObj: ReturnType<typeof vi.fn>;
} {
  const recommendedScript = script("11");
  const alternateScript = script("22");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Wallet config tests need a signer double with just the methods used by WalletConfigGate.
  return {
    client: new StubClient({ addressPrefix: "ckt" }),
    type: ccc.SignerType.CKB,
    connect: vi.fn(async () => {
      await Promise.resolve();
    }),
    getAddressObjs: vi.fn(async () => {
      await Promise.resolve();
      return [
        { script: recommendedScript },
        { script: alternateScript },
        { script: alternateScript },
      ];
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

export function signerFilterInfo(signer: ccc.Signer): ccc.SignerInfo {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Signer filter only reads signer.type in this test.
  return { signer } as ccc.SignerInfo;
}

export function signerInfo(type: ccc.SignerType, addressPrefix: string): ccc.Signer {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- WalletGate branch tests need only signer type and client prefix.
  return {
    type,
    client: new StubClient({ addressPrefix }),
  } as unknown as ccc.Signer;
}

function quoteSystemState(): L1StateType["system"] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Test quote state matches the system subset used by App.
  return quoteState() as L1StateType["system"];
}

function rootSdk(): RootConfig["sdk"] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Root config tests never invoke SDK methods.
  return {} as RootConfig["sdk"];
}
