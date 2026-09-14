import "./environment.ts";

export type { ActionLayout } from "../../../src/action/ActionLayout.tsx";
export type { PendingTransactionStore } from "../../../src/action/pendingTransaction.ts";
export type { L1StateType, QuoteState } from "../../../src/query/queries.ts";
export type { RootConfig, TxInfo, WalletConfig } from "../../../src/shared/utils.ts";
export type { WalletAppShell } from "../../../src/view/staticWalletApp.tsx";

const actionModule = await import("../../../src/action/Action.tsx");
const pendingTransactionModule =
  await import("../../../src/action/pendingTransaction.ts");
const appModule = await import("../../../src/app/App.tsx");
const interfaceModule = await import("../../../src/app/Interface.tsx");
const interfaceConfigModule = await import("../../../src/app/interfaceConfig.ts");
const quoteStateModule = await import("../../../src/query/quoteState.ts");
const sharedUtilsModule = await import("../../../src/shared/utils.ts");
const formModule = await import("../../../src/view/Form.tsx");
const dashboardModule = await import("../../../src/view/Dashboard.tsx");
const walletAppViewModule = await import("../../../src/view/WalletAppView.tsx");
const interfaceLandingModule = await import("../../../src/wallet/interfaceLanding.tsx");
const walletConfigGateModule = await import("../../../src/wallet/WalletConfigGate.tsx");
const walletConfigPendingViewModule =
  await import("../../../src/wallet/WalletConfigPendingView.tsx");
const walletGateModule = await import("../../../src/wallet/WalletGate.tsx");
const walletGateStateModule = await import("../../../src/wallet/walletGateState.ts");
const walletGateSupportModule = await import("../../../src/wallet/walletGateSupport.tsx");

export const Action = actionModule.default;
export const clearPendingTransaction = pendingTransactionModule.clearPendingTransaction;
export const submitPendingTransaction = pendingTransactionModule.submitPendingTransaction;
export const App = appModule.default;
export const Interface = interfaceModule.default;
export const Form = formModule.default;
export const Dashboard = dashboardModule.Dashboard;
export const WalletAppView = walletAppViewModule.WalletAppView;
export const LandingPage = interfaceLandingModule.LandingPage;
export const TestnetHint = interfaceLandingModule.TestnetHint;
export const WalletConfigGate = walletConfigGateModule.default;
export const WalletConfigPendingView =
  walletConfigPendingViewModule.WalletConfigPendingView;
export const WalletGate = walletGateModule.WalletGate;
export const appName = interfaceConfigModule.appName;
export const ckbSignerOnly = interfaceConfigModule.ckbSignerOnly;
export const connectorStyle = interfaceConfigModule.connectorStyle;
export const createRootConfig = interfaceConfigModule.createRootConfig;
export const mainnetClient = interfaceConfigModule.mainnetClient;
export const queryClient = interfaceConfigModule.queryClient;
export const testnetClient = interfaceConfigModule.testnetClient;
export const liveQuoteStatus = quoteStateModule.liveQuoteStatus;
export const useQuoteState = quoteStateModule.useQuoteState;
export const CKB = sharedUtilsModule.CKB;
export const txInfoPadding = sharedUtilsModule.txInfoPadding;
export const signerClientChain = walletGateStateModule.signerClientChain;
export const walletLabel = walletGateStateModule.walletLabel;
export const CkbSignerRequired = walletGateSupportModule.CkbSignerRequired;
export const SwitchingWalletNetwork = walletGateSupportModule.SwitchingWalletNetwork;
export const UnsupportedNetwork = walletGateSupportModule.UnsupportedNetwork;
