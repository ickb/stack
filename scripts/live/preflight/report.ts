const CKB = 100000000n;
const CKB_RESERVE = 1000n * CKB;

export interface ScriptLike {
  args: string;
  codeHash: string;
  hashType: string;
}

interface ExchangeRatio {
  ckbScale: bigint;
  udtScale: bigint;
}

export interface Projection {
  ckbAvailable: bigint;
  ckbBalance: bigint;
  ckbPending: bigint;
  ickbAvailable: bigint;
  ickbBalance: bigint;
  ickbPending: bigint;
  pendingWithdrawals: readonly unknown[];
  readyWithdrawals: readonly unknown[];
}

export interface AccountState {
  capacityCells: unknown;
  receipts: readonly unknown[];
}

export interface L1AccountState {
  account: AccountState;
  system: {
    exchangeRatio: ExchangeRatio;
    feeRate: bigint;
    tip: { hash: string; number: bigint; timestamp: bigint };
  };
  user: {
    orders: ReadonlyArray<{ order: { isMatchable: () => boolean } }>;
  };
}

export interface RuntimeConfigLike {
  chain: string;
  maxIterations?: number;
  maxRetryableAttempts?: number;
  privateKey: string;
  rpcUrl: string;
  sleepIntervalMs: number;
}

interface RpcEndpointIdentity {
  mode: "exclusive";
  protocol: "http:" | "https:";
  hostname: string;
  port: string;
  pathname: string;
}

export interface ChainIdentity {
  chain: string;
  expected: { addressPrefix: string; genesisHash: string };
  matches: { addressPrefix: boolean; genesisHash: boolean };
  observed: {
    addressPrefix: string;
    genesisHash: string;
    tip: { hash: string; number: bigint; timestamp: bigint };
  };
}

export interface NodeUtilsLike {
  accountPlainCkbBalance: (
    capacityCells: unknown,
    accountLocks: readonly ScriptLike[],
  ) => bigint;
  createPublicClient: (chain: string, rpcUrl: string) => unknown;
  formatCkb: (value: bigint) => string;
  isRetryableRpcTransportError?: (error: unknown) => boolean;
  publicRpcEndpointIdentity: (rpcUrl: string) => RpcEndpointIdentity;
  signerAccountLocks: (signer: unknown, primaryLock: ScriptLike) => Promise<ScriptLike[]>;
  verifyChainPreflight: (client: unknown, chain: string) => Promise<ChainIdentity>;
}

export interface CccLike {
  SignerCkbPrivateKey: new (
    client: unknown,
    privateKey: string,
  ) => {
    getRecommendedAddressObj: () => Promise<{
      script: ScriptLike;
      toString: () => string;
    }>;
  };
}

export interface SdkLike {
  getConfig: (chain: string) => unknown;
  IckbSdk: {
    fromConfig: (config: unknown) => {
      getL1AccountState: (
        client: unknown,
        accountLocks: readonly ScriptLike[],
      ) => Promise<L1AccountState>;
    };
  };
  projectAccountAvailability: (
    account: AccountState,
    userOrders: readonly unknown[],
    options: { collectedOrdersAvailable: boolean },
  ) => Projection;
}

export interface CoreLike {
  convert: (toIckb: boolean, value: bigint, exchangeRatio: ExchangeRatio) => bigint;
  ICKB_DEPOSIT_CAP: bigint;
}

export interface PreflightReport {
  balances: BalanceReport;
  bounded: boolean;
  capital: CapitalReport;
  chain: string;
  chainIdentity: ChainIdentity;
  inventory: InventoryReport;
  key: KeyReport;
  maxIterations?: number;
  maxRetryableAttempts?: number;
  rpcEndpoint: RpcEndpointIdentity;
  sleepIntervalSeconds: number;
  system: SystemReport;
}

interface BalanceReport {
  CKB: {
    available: string;
    plainAvailable: string;
    projectedAvailable: string;
    reserve: string;
    spendable: string;
    total: string;
    unavailable: string;
  };
  ICKB: { available: string; total: string; unavailable: string };
  totalEquivalent: { CKB: string; ICKB: string };
}

interface CapitalReport {
  depositCapacity: string;
  minimumCkbCapital: string;
  totalEquivalentCkb: string;
}

interface InventoryReport {
  matchableUserOrderCount: number;
  pendingWithdrawalCount: number;
  readyWithdrawalCount: number;
  receiptCount: number;
  userOrderCount: number;
  userOrderScan: "complete-global-scan";
}

interface KeyReport {
  accountLocks: ScriptLike[];
  primaryLock: ScriptLike;
  recommendedAddress: string;
}

interface SystemReport {
  exchangeRatio: ExchangeRatio;
  feeRate: bigint;
  tip: { hash: string; number: bigint; timestamp: bigint };
}

interface ReportAmounts {
  depositCapacity: bigint;
  minimumCkbCapital: bigint;
  plainCkb: bigint;
  spendableCkb: bigint;
  totalCkb: bigint;
  totalEquivalentCkb: bigint;
  totalEquivalentIckb: bigint;
  totalIckb: bigint;
}

interface PreflightReportInput {
  ccc: CccLike;
  core: CoreLike;
  nodeUtils: NodeUtilsLike;
  runtimeConfig: RuntimeConfigLike;
  sdk: SdkLike;
}

export async function buildPreflightReport({
  runtimeConfig,
  nodeUtils,
  ccc,
  sdk: sdkModule,
  core,
}: PreflightReportInput): Promise<PreflightReport> {
  const client = nodeUtils.createPublicClient(runtimeConfig.chain, runtimeConfig.rpcUrl);
  const chain = await nodeUtils.verifyChainPreflight(client, runtimeConfig.chain);
  const signer = new ccc.SignerCkbPrivateKey(client, runtimeConfig.privateKey);
  const recommended = await signer.getRecommendedAddressObj();
  const primaryLock = recommended.script;
  const accountLocks = await nodeUtils.signerAccountLocks(signer, primaryLock);
  const stackConfig = sdkModule.getConfig(runtimeConfig.chain);
  const ickb = sdkModule.IckbSdk.fromConfig(stackConfig);
  const { system, user, account } = await ickb.getL1AccountState(client, accountLocks);
  const { exchangeRatio, feeRate, tip } = system;
  const projection = sdkModule.projectAccountAvailability(account, user.orders, {
    collectedOrdersAvailable: true,
  });
  const plainCkb = nodeUtils.accountPlainCkbBalance(account.capacityCells, accountLocks);
  const amounts = calculateAmounts(core, exchangeRatio, projection, plainCkb);

  return {
    chain: runtimeConfig.chain,
    bounded: runtimeConfig.maxIterations !== undefined,
    maxIterations: runtimeConfig.maxIterations,
    maxRetryableAttempts: runtimeConfig.maxRetryableAttempts,
    sleepIntervalSeconds: runtimeConfig.sleepIntervalMs / 1000,
    rpcEndpoint: nodeUtils.publicRpcEndpointIdentity(runtimeConfig.rpcUrl),
    chainIdentity: chain,
    key: {
      recommendedAddress: recommended.toString(),
      primaryLock: publicScript(primaryLock),
      accountLocks: accountLocks.map(publicScript),
    },
    balances: buildBalanceReport(nodeUtils, projection, amounts),
    capital: buildCapitalReport(nodeUtils, amounts),
    inventory: buildInventoryReport(account, user.orders, projection),
    system: buildSystemReport(tip, feeRate, exchangeRatio),
  };
}

export function publicScript(script: ScriptLike): ScriptLike {
  return {
    codeHash: script.codeHash,
    hashType: script.hashType,
    args: script.args,
  };
}

function calculateAmounts(
  core: CoreLike,
  exchangeRatio: ExchangeRatio,
  projection: Projection,
  plainCkb: bigint,
): ReportAmounts {
  const totalCkb = projection.ckbBalance;
  const totalIckb = projection.ickbBalance;
  const depositCapacity = core.convert(false, core.ICKB_DEPOSIT_CAP, exchangeRatio);
  return {
    depositCapacity,
    minimumCkbCapital: (21n * depositCapacity) / 20n,
    plainCkb,
    spendableCkb: maxBigInt(0n, plainCkb - CKB_RESERVE),
    totalCkb,
    totalIckb,
    totalEquivalentCkb: totalCkb + core.convert(false, totalIckb, exchangeRatio),
    totalEquivalentIckb: core.convert(true, totalCkb, exchangeRatio) + totalIckb,
  };
}

function buildBalanceReport(
  nodeUtils: NodeUtilsLike,
  projection: Projection,
  amounts: ReportAmounts,
): BalanceReport {
  return {
    CKB: {
      available: nodeUtils.formatCkb(amounts.plainCkb),
      plainAvailable: nodeUtils.formatCkb(amounts.plainCkb),
      projectedAvailable: nodeUtils.formatCkb(projection.ckbAvailable),
      reserve: nodeUtils.formatCkb(CKB_RESERVE),
      spendable: nodeUtils.formatCkb(amounts.spendableCkb),
      unavailable: nodeUtils.formatCkb(projection.ckbPending),
      total: nodeUtils.formatCkb(amounts.totalCkb),
    },
    ICKB: {
      available: nodeUtils.formatCkb(projection.ickbAvailable),
      unavailable: nodeUtils.formatCkb(projection.ickbPending),
      total: nodeUtils.formatCkb(amounts.totalIckb),
    },
    totalEquivalent: {
      CKB: nodeUtils.formatCkb(amounts.totalEquivalentCkb),
      ICKB: nodeUtils.formatCkb(amounts.totalEquivalentIckb),
    },
  };
}

function buildCapitalReport(
  nodeUtils: NodeUtilsLike,
  amounts: ReportAmounts,
): CapitalReport {
  return {
    depositCapacity: nodeUtils.formatCkb(amounts.depositCapacity),
    minimumCkbCapital: nodeUtils.formatCkb(amounts.minimumCkbCapital),
    totalEquivalentCkb: nodeUtils.formatCkb(amounts.totalEquivalentCkb),
  };
}

function buildInventoryReport(
  account: AccountState,
  userOrders: ReadonlyArray<{ order: { isMatchable: () => boolean } }>,
  projection: Projection,
): InventoryReport {
  return {
    matchableUserOrderCount: userOrders.filter((group) => group.order.isMatchable())
      .length,
    userOrderCount: userOrders.length,
    userOrderScan: "complete-global-scan",
    receiptCount: account.receipts.length,
    readyWithdrawalCount: projection.readyWithdrawals.length,
    pendingWithdrawalCount: projection.pendingWithdrawals.length,
  };
}

function buildSystemReport(
  tip: L1AccountState["system"]["tip"],
  feeRate: bigint,
  exchangeRatio: ExchangeRatio,
): SystemReport {
  return {
    tip: {
      hash: tip.hash,
      number: tip.number,
      timestamp: tip.timestamp,
    },
    feeRate,
    exchangeRatio: {
      ckbScale: exchangeRatio.ckbScale,
      udtScale: exchangeRatio.udtScale,
    },
  };
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
