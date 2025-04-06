import {
  TransactionSkeleton,
  encodeToAddress,
  sealTransaction,
  type TransactionSkeletonType,
} from "@ckb-lumos/helpers";
import { prepareSigningEntries } from "@ckb-lumos/common-scripts/lib/secp256k1_blake160.js";
import { key } from "@ckb-lumos/hd";
import {
  CKB,
  I8Cell,
  I8Header,
  I8Script,
  addCells,
  addCkbChange,
  addWitnessPlaceholder,
  binarySearch,
  calculateTxFee,
  capacitySifter,
  chainConfigFrom,
  ckbDelta,
  hex,
  isChain,
  isDaoDeposit,
  isDaoWithdrawalRequest,
  isPopulated,
  lockExpanderFrom,
  maturityDiscriminator,
  since,
  txSize,
  type ChainConfig,
  type ConfigAdapter,
} from "@ickb/lumos-utils";
import {
  ICKB_SOFT_CAP_PER_DEPOSIT,
  addIckbUdtChange,
  addOwnedWithdrawalRequestsChange,
  addReceiptDepositsChange,
  addWithdrawalRequestGroups,
  ckb2Ickb,
  ckb2UdtRatioCompare,
  ckbSoftCapPerDeposit,
  errorAllowanceTooLow,
  getIckbScriptConfigs,
  ickb2Ckb,
  ickbDelta,
  ickbDeposit,
  ickbExchangeRatio,
  ickbLogicScript,
  ickbPoolSifter,
  ickbRequestWithdrawalFrom,
  ickbSifter,
  limitOrderScript,
  orderMelt,
  orderSatisfy,
  orderSifter,
  ownedOwnerScript,
  udt2CkbRatioCompare,
  type ExtendedDeposit,
  type MyOrder,
  type Order,
} from "@ickb/v1-core";
import type { Cell, Header, Transaction } from "@ckb-lumos/base";

async function main(): Promise<void> {
  const { CHAIN, RPC_URL, BOT_PRIVATE_KEY, BOT_SLEEP_INTERVAL } = process.env;
  if (!CHAIN) {
    throw Error("Invalid env CHAIN: Empty");
  }
  if (!isChain(CHAIN)) {
    throw Error("Invalid env CHAIN: " + CHAIN);
  }
  if (!BOT_PRIVATE_KEY) {
    throw Error("Empty env BOT_PRIVATE_KEY");
  }
  if (!BOT_SLEEP_INTERVAL || Number(BOT_SLEEP_INTERVAL) < 1) {
    throw Error("Invalid env BOT_SLEEP_INTERVAL");
  }

  const chainConfig = await chainConfigFrom(
    CHAIN,
    RPC_URL,
    true,
    getIckbScriptConfigs,
  );
  const { config, rpc } = chainConfig;
  const account = secp256k1Blake160(BOT_PRIVATE_KEY, config);
  const sleepInterval = Number(BOT_SLEEP_INTERVAL) * 1000;

  for (;;) {
    await new Promise((r) => setTimeout(r, 2 * Math.random() * sleepInterval));
    // console.log();

    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const executionLog: Record<string, any> = {};
    const startTime = new Date();
    executionLog.startTime = startTime.toLocaleString();
    try {
      const {
        capacities,
        udts,
        receipts,
        matureWrGroups,
        notMatureWrGroups,
        ickbPool,
        orders,
        myOrders,
        tipHeader,
        feeRate,
      } = await getL1State(account, chainConfig);

      // console.log(JSON.stringify(orders, replacer, " "));

      // Calculate balances and baseTx
      const baseTx = base({
        capacities,
        myOrders,
        udts,
        receipts,
        wrGroups: matureWrGroups,
      });
      const availableCkbBalance = ckbDelta(baseTx, config);
      const ickbUdtBalance = ickbDelta(baseTx, config);
      const unavailableFunds = base({
        wrGroups: notMatureWrGroups,
      });
      const unavailableCkbBalance = ckbDelta(unavailableFunds, config);
      const ckbBalance = availableCkbBalance + unavailableCkbBalance;

      executionLog.balance = {
        CKB: {
          total: fmtCkb(ckbBalance),
          available: fmtCkb(availableCkbBalance),
          unavailable: fmtCkb(unavailableCkbBalance),
        },
        ICKB: {
          total: fmtCkb(ickbUdtBalance),
          available: fmtCkb(ickbUdtBalance),
          unavailable: fmtCkb(0n),
        },
        totalEquivalent: {
          CKB: fmtCkb(ckbBalance + ickb2Ckb(ickbUdtBalance, tipHeader)),
          ICKB: fmtCkb(ckb2Ickb(ckbBalance, tipHeader) + ickbUdtBalance),
        },
      };
      executionLog.ratio = ickbExchangeRatio(tipHeader);

      const standardDeposit = ckbSoftCapPerDeposit(tipHeader);
      const minCKB = (21n * standardDeposit) / 20n;

      if (ckbBalance + ickb2Ckb(ickbUdtBalance, tipHeader) <= minCKB) {
        executionLog.error =
          "The bot must have more than " +
          String(fmtCkb(minCKB)) +
          " CKB worth of capital to be able to operate, shutting down...";
        console.log(JSON.stringify(executionLog, replacer, " "));
        return;
      }

      function evaluate(combination: Combination): Readonly<{
        tx: TransactionSkeletonType;
        gain: bigint;
        i: number;
        j: number;
        origins: readonly I8Cell[];
        matches: readonly I8Cell[];
      }> {
        const { i, j, origins, matches } = combination;
        const onlyOrders = addCells(
          TransactionSkeleton(),
          "append",
          origins,
          matches,
        );
        const ckbGain = ckbDelta(onlyOrders, config);
        const ickbUdtGain = ickbDelta(onlyOrders, config);

        const tx = finalize(
          addCells(baseTx, "append", origins, matches),
          ckbBalance + ckbGain,
          ickbUdtBalance + ickbUdtGain,
          ickbPool,
          tipHeader,
          feeRate,
          account,
          chainConfig,
        );

        const gain =
          i == 0 && j == 0
            ? 0n
            : !isPopulated(tx)
              ? negInf
              : ickb2Ckb(ickbUdtGain, tipHeader) +
                ckbGain -
                3n * ckbDelta(tx, config); //tx fee
        return Object.freeze({ ...combination, tx, gain });
      }

      const { tx, matches } = bestPartialFilling(
        orders,
        evaluate,
        standardDeposit / 100n,
        ICKB_SOFT_CAP_PER_DEPOSIT / 100n,
      );
      if (isPopulated(tx)) {
        // console.log(JSON.stringify(tx, undefined, 2));

        const matchedOrders = matches.length;
        const deposits = tx.outputs.filter((c) => isDaoDeposit(c, config)).size;
        const withdrawalRequests = tx.outputs.filter((c) =>
          isDaoWithdrawalRequest(c, config),
        ).size;
        const withdrawals = tx.inputs.filter((c) =>
          isDaoWithdrawalRequest(c, config),
        ).size;

        executionLog.actions = {
          matchedOrders,
          deposits,
          withdrawalRequests,
          withdrawals,
        };
        executionLog.txFee = {
          fee: fmtCkb(ckbDelta(tx, config)),
          feeRate,
        };

        if (matchedOrders + deposits + withdrawalRequests > 0) {
          executionLog.txHash = await rpc.sendTransaction(account.signer(tx));
        } else {
          continue;
        }
      } else {
        continue;
      }
    } catch (e) {
      if (e instanceof Object && "stack" in e) {
        /* eslint-disable-next-line @typescript-eslint/no-misused-spread */
        executionLog.error = { ...e, stack: e.stack ?? "" };
      } else {
        executionLog.error = e ?? "Empty Error";
      }
    }
    executionLog.ElapsedSeconds = Math.round(
      (new Date().getTime() - startTime.getTime()) / 1000,
    );
    console.log(JSON.stringify(executionLog, replacer, " "));
  }
}

function fmtCkb(b: bigint): number {
  return Number(b) / Number(CKB);
}

function replacer(_: unknown, value: unknown): unknown {
  return typeof value === "bigint" ? Number(value) : value;
}

const negInf = -1n * (1n << 64n);

interface Combination {
  i: number;
  j: number;
  origins: readonly I8Cell[];
  matches: readonly I8Cell[];
  tx: TransactionSkeletonType;
  gain: bigint;
}

function bestPartialFilling(
  orders: Order[],
  evaluate: (tx: Combination) => Combination,
  ckbAllowanceStep: bigint,
  udtAllowanceStep: bigint,
): Combination {
  const ckb2UdtPartials = partialsFrom(orders, true, udtAllowanceStep);
  const udt2CkbPartials = partialsFrom(orders, false, ckbAllowanceStep);

  const alreadyVisited = new Map<string, Combination>();
  const from = (i: number, j: number): Combination => {
    const key = `${String(i)}-${String(j)}`;
    const cached = alreadyVisited.get(key);
    if (cached) {
      return cached;
    }
    let result: Combination = {
      i,
      j,
      origins: Object.freeze([]),
      matches: Object.freeze([]),
      tx: TransactionSkeleton(),
      gain: negInf,
    };
    const iom = ckb2UdtPartials[i];
    const jom = udt2CkbPartials[j];
    if (iom && jom) {
      result.origins = Object.freeze(iom.origins.concat(jom.origins));
      result.matches = Object.freeze(iom.matches.concat(jom.matches));
      result = evaluate(result);
      // console.log(i, j, result.gain, isPopulated(result.tx));
    }
    alreadyVisited.set(key, Object.freeze(result));
    return result;
  };

  let fresh = from(0, 0);
  let old: typeof fresh | undefined = undefined;
  while (old !== fresh) {
    old = fresh;
    fresh = [
      from(fresh.i, fresh.j),
      from(fresh.i, fresh.j + 1),
      from(fresh.i + 1, fresh.j),
      from(fresh.i + 1, fresh.j + 1),
    ].reduce((a, b) => (a.gain > b.gain ? a : b));
  }

  // console.log(fresh.i, fresh.j, String(fresh.gain / CKB));

  return fresh;
}

function partialsFrom(
  orders: Order[],
  isCkb2Udt: boolean,
  allowanceStep: bigint,
): {
  origins: readonly I8Cell[];
  matches: readonly I8Cell[];
}[] {
  let ckbAllowanceStep, udtAllowanceStep;
  if (isCkb2Udt) {
    ckbAllowanceStep = 0n;
    udtAllowanceStep = allowanceStep;
    orders = orders.filter((o) => o.info.isCkb2UdtMatchable);
    orders.sort((o0, o1) =>
      ckb2UdtRatioCompare(o0.info.ckbToUdt, o1.info.ckbToUdt),
    );
  } else {
    ckbAllowanceStep = allowanceStep;
    udtAllowanceStep = 0n;
    orders = orders.filter((o) => o.info.isUdt2CkbMatchable);
    orders.sort((o0, o1) =>
      udt2CkbRatioCompare(o0.info.udtToCkb, o1.info.udtToCkb),
    );
  }

  let origins: readonly I8Cell[] = Object.freeze([]);
  let fulfilled: readonly I8Cell[] = Object.freeze([]);
  let matches: readonly I8Cell[] = Object.freeze([]);

  const res = [{ origins, matches }];

  for (const o of orders) {
    try {
      let ckbAllowance = 0n;
      let udtAllowance = 0n;

      let match: I8Cell;
      let isFulfilled = false;

      const new_origins = Object.freeze(origins.concat([o.cell]));
      while (!isFulfilled) {
        ckbAllowance += ckbAllowanceStep;
        udtAllowance += udtAllowanceStep;

        ({ match, isFulfilled } = orderSatisfy(
          o,
          isCkb2Udt,
          ckbAllowance,
          udtAllowance,
        ));
        matches = Object.freeze(fulfilled.concat([match]));

        res.push({ origins: new_origins, matches });
      }

      origins = new_origins;
      fulfilled = matches;
    } catch (e) {
      // Skip orders whose ckbMinMatch is too high to be matched by base allowance Step
      if (!(e instanceof Error) || e.message !== errorAllowanceTooLow) {
        throw e;
      }
    }
  }

  return res;
}

function finalize(
  tx: TransactionSkeletonType,
  _ckbBalance: bigint,
  ickbUdtBalance: bigint,
  ickbPool: readonly ExtendedDeposit[],
  tipHeader: I8Header,
  feeRate: bigint,
  account: ReturnType<typeof secp256k1Blake160>,
  chainConfig: ChainConfig,
): TransactionSkeletonType {
  // For simplicity a transaction containing Nervos DAO script is currently limited to 64 output cells
  // so that processing is simplified, this limitation may be relaxed later on in a future Nervos DAO script update.
  //58 = 64 - 6, 6 are the estimated change cells added later
  const daoLimit = 58 - tx.outputs.size;

  // Keep most balance in CKB
  // Ideally keep an iCKB balance between 2k iCKB and 120k iCKB
  let isCkb2Udt = false;
  let maxAmount = 0n;
  const standardDeposit = ckbSoftCapPerDeposit(tipHeader);
  if (daoLimit <= 0) {
    // Do nothing...
  } else if (ickbUdtBalance < 2000n * CKB) {
    isCkb2Udt = true;
    maxAmount = standardDeposit;
  } else if (ickbUdtBalance > ICKB_SOFT_CAP_PER_DEPOSIT + 20000n * CKB) {
    isCkb2Udt = false;
    maxAmount = ickbUdtBalance - 20000n * CKB;
  }

  return convert(
    tx,
    isCkb2Udt,
    maxAmount,
    standardDeposit,
    ickbPool,
    tipHeader,
    feeRate,
    account,
    chainConfig,
  );
}

type MyExtendedDeposit = ExtendedDeposit & { ickbCumulative: bigint };

function convert(
  baseTx: TransactionSkeletonType,
  isCkb2Udt: boolean,
  maxAmount: bigint,
  depositAmount: bigint,
  deposits: readonly ExtendedDeposit[],
  tipHeader: Readonly<I8Header>,
  feeRate: bigint,
  account: ReturnType<typeof secp256k1Blake160>,
  chainConfig: ChainConfig,
): TransactionSkeletonType {
  const ickbPool: MyExtendedDeposit[] = [];
  if (!isCkb2Udt) {
    // Filter deposits
    let ickbCumulative = 0n;
    for (const d of deposits) {
      const c = ickbCumulative + d.ickbValue;
      if (c > maxAmount) {
        continue;
      }
      ickbCumulative = c;
      ickbPool.push(Object.freeze({ ...d, ickbCumulative }));
      if (ickbPool.length >= 30) {
        break;
      }
    }
  }
  Object.freeze(ickbPool);

  const N = isCkb2Udt ? Number(maxAmount / depositAmount) : ickbPool.length;
  const txCache = Array<TransactionSkeletonType | undefined>(N);
  const attempt = (n: number): TransactionSkeletonType => {
    n = N - n;
    return (txCache[n] =
      txCache[n] ??
      convertAttempt(
        n,
        isCkb2Udt,
        maxAmount,
        baseTx,
        depositAmount,
        ickbPool,
        tipHeader,
        feeRate,
        account,
        chainConfig,
      ));
  };
  return attempt(binarySearch(N, (n) => isPopulated(attempt(n))));
}

function convertAttempt(
  quantity: number,
  isCkb2Udt: boolean,
  maxAmount: bigint,
  tx: TransactionSkeletonType,
  depositAmount: bigint,
  ickbPool: readonly MyExtendedDeposit[],
  _tipHeader: Readonly<I8Header>,
  feeRate: bigint,
  account: ReturnType<typeof secp256k1Blake160>,
  chainConfig: ChainConfig,
): TransactionSkeletonType {
  const { config } = chainConfig;
  if (quantity > 0) {
    if (isCkb2Udt) {
      maxAmount -= depositAmount * BigInt(quantity);
      if (maxAmount < 0n) {
        return TransactionSkeleton();
      }
      tx = ickbDeposit(tx, quantity, depositAmount, config);
    } else {
      const d = ickbPool[quantity - 1];
      if (ickbPool.length < quantity || !d) {
        return TransactionSkeleton();
      }
      maxAmount -= d.ickbCumulative;
      if (maxAmount < 0n) {
        return TransactionSkeleton();
      }
      const deposits = ickbPool.slice(0, quantity).map((d) => d.deposit);
      tx = ickbRequestWithdrawalFrom(tx, deposits, config);
    }
  }

  let freeCkb: bigint, freeIckbUdt: bigint;
  ({ tx, freeCkb, freeIckbUdt } = addChange(tx, feeRate, account, chainConfig));

  if (freeIckbUdt < 0n) {
    return TransactionSkeleton();
  }

  if (quantity > 0 && !isCkb2Udt) {
    if (freeCkb < 0n) {
      return TransactionSkeleton();
    }
  } else {
    if (freeCkb < 1000n * CKB) {
      return TransactionSkeleton();
    }
  }

  if (quantity > 0 && tx.outputs.size > 64) {
    return TransactionSkeleton();
  }

  return tx;
}

function addChange(
  tx: TransactionSkeletonType,
  feeRate: bigint,
  account: ReturnType<typeof secp256k1Blake160>,
  chainConfig: ChainConfig,
): {
  tx: TransactionSkeletonType;
  freeCkb: bigint;
  freeIckbUdt: bigint;
} {
  const { lockScript: accountLock, preSigner: addPlaceholders } = account;
  const { config } = chainConfig;
  let freeCkb, freeIckbUdt;
  tx = addReceiptDepositsChange(tx, accountLock, config);
  tx = addOwnedWithdrawalRequestsChange(tx, accountLock, config);
  ({ tx, freeIckbUdt } = addIckbUdtChange(tx, accountLock, config));
  ({ tx, freeCkb } = addCkbChange(
    tx,
    accountLock,
    (txWithDummyChange: TransactionSkeletonType) => {
      const baseFee = calculateTxFee(
        txSize(addPlaceholders(txWithDummyChange)),
        feeRate,
      );
      // Use a fee that is multiple of N=1249
      const N = 1249n;
      return ((baseFee + (N - 1n)) / N) * N;
    },
    config,
  ));

  return { tx, freeCkb, freeIckbUdt };
}

function base({
  capacities = [],
  udts = [],
  receipts = [],
  wrGroups = [],
  myOrders = [],
}: {
  capacities?: I8Cell[];
  udts?: I8Cell[];
  receipts?: I8Cell[];
  wrGroups?: Readonly<{
    ownedWithdrawalRequest: I8Cell;
    owner: I8Cell;
  }>[];
  myOrders?: MyOrder[];
}): TransactionSkeletonType {
  let tx = TransactionSkeleton();
  tx = addCells(tx, "append", [capacities, udts, receipts].flat(), []);
  tx = addWithdrawalRequestGroups(tx, wrGroups);
  tx = orderMelt(tx, myOrders);
  return tx;
}

async function getL1State(
  account: ReturnType<typeof secp256k1Blake160>,
  chainConfig: ChainConfig,
): Promise<{
  capacities: I8Cell[];
  udts: I8Cell[];
  receipts: I8Cell[];
  matureWrGroups: Readonly<{
    ownedWithdrawalRequest: I8Cell;
    owner: I8Cell;
  }>[];
  notMatureWrGroups: Readonly<{
    ownedWithdrawalRequest: I8Cell;
    owner: I8Cell;
  }>[];
  myOrders: MyOrder[];
  orders: Order[];
  ickbPool: Readonly<ExtendedDeposit>[];
  tipHeader: Readonly<I8Header>;
  feeRate: bigint;
}> {
  const { chain, config, rpc } = chainConfig;
  const { expander } = account;

  const mixedCells = await getMixedCells(account, chainConfig);

  // Prefetch feeRate and tipHeader
  const feeRatePromise = rpc.getFeeRate(61n);
  const tipHeaderPromise = rpc.getTipHeader();

  // Prefetch headers
  const wantedHeaders = new Set<string>();
  const deferredGetHeader = (blockNumber: string): Readonly<I8Header> => {
    wantedHeaders.add(blockNumber);
    return headerPlaceholder;
  };
  ickbSifter(mixedCells, expander, deferredGetHeader, config);
  const headersPromise = getHeadersByNumber(wantedHeaders, chainConfig);

  // Prefetch txs outputs
  const wantedTxsOutputs = new Set<string>();
  const deferredGetTxsOutputs = (txHash: string): never[] => {
    wantedTxsOutputs.add(txHash);
    return [];
  };
  orderSifter(mixedCells, expander, deferredGetTxsOutputs, config);
  const txsOutputsPromise = getTxsOutputs(wantedTxsOutputs, chainConfig);

  // Sift capacities
  const { capacities, notCapacities } = capacitySifter(mixedCells, expander);

  // Await for headers
  const headers = await headersPromise;

  // Sift through iCKB related cells
  const {
    udts,
    receipts,
    withdrawalRequestGroups,
    ickbPool: pool,
    notIckbs,
  } = ickbSifter(
    notCapacities,
    expander,
    (blockNumber) => headers.get(blockNumber) ?? headerPlaceholder,
    config,
  );

  const tipHeader = I8Header.from(await tipHeaderPromise);
  // Partition between ripe and non ripe withdrawal requests
  const { mature: matureWrGroups, notMature: notMatureWrGroups } =
    maturityDiscriminator(
      withdrawalRequestGroups,
      (g) => {
        const type = g.ownedWithdrawalRequest.cellOutput.type;
        if (!type) {
          return "0x0";
        }
        return type[since];
      },
      tipHeader,
    );

  // min lock: 1/16 epoch (~ 15 minutes)
  const minLock =
    chain === "devnet" ? undefined : { length: 16, index: 1, number: 0 };
  // max additional lock: 3/16 epoch (~ 45 minutes), for a total of one hours max lock
  const maxLock =
    chain === "devnet" ? undefined : { length: 16, index: 3, number: 0 };
  // Sort the ickbPool based on the tip header
  const ickbPool = ickbPoolSifter(pool, tipHeader, minLock, maxLock);

  // Await for txsOutputs
  const txsOutputs = await txsOutputsPromise;

  // Sift through Orders
  const { myOrders, orders } = orderSifter(
    notIckbs,
    expander,
    (txHash) => txsOutputs.get(txHash) ?? [],
    config,
  );

  return {
    capacities,
    udts,
    receipts,
    matureWrGroups,
    notMatureWrGroups,
    myOrders,
    orders,
    ickbPool,
    tipHeader,
    feeRate: await feeRatePromise,
  };
}

async function getMixedCells(
  account: ReturnType<typeof secp256k1Blake160>,
  chainConfig: ChainConfig,
): Promise<Cell[]> {
  const { rpc, config } = chainConfig;
  return (
    await Promise.all(
      [
        account.lockScript,
        ickbLogicScript(config),
        ownedOwnerScript(config),
        limitOrderScript(config),
      ].map((lock) => rpc.getCellsByLock(lock, "desc", "max")),
    )
  ).flat();
}

async function getTxsOutputs(
  txHashes: Set<string>,
  chainConfig: ChainConfig,
): Promise<Readonly<Map<string, readonly Cell[]>>> {
  const { rpc } = chainConfig;

  const result = new Map<string, readonly Cell[]>();
  const batch = rpc.createBatchRequest();
  for (const txHash of txHashes) {
    const outputs = _knownTxsOutputs.get(txHash);
    if (outputs !== undefined) {
      result.set(txHash, outputs);
      continue;
    }
    batch.add("getTransaction", txHash);
  }

  if (batch.length === 0) {
    return _knownTxsOutputs;
  }

  for (const tx of (await batch.exec()).map(
    ({ transaction: tx }: { transaction: Transaction }) => tx,
  )) {
    const txHash = tx.hash;
    if (!txHash) {
      throw Error("Empty tx hash");
    }
    result.set(
      txHash,
      Object.freeze(
        tx.outputs.map(({ lock, type, capacity }, index) =>
          Object.freeze({
            cellOutput: Object.freeze({
              lock: Object.freeze(lock),
              type: Object.freeze(type),
              capacity: Object.freeze(capacity),
            }),
            data: Object.freeze(tx.outputsData[index] ?? "0x"),
            outPoint: Object.freeze({
              txHash: txHash,
              index: hex(index),
            }),
          } as Cell),
        ),
      ),
    );
  }

  const frozenResult = Object.freeze(result);
  _knownTxsOutputs = frozenResult;
  return frozenResult;
}

let _knownTxsOutputs = Object.freeze(new Map<string, readonly Cell[]>());

async function getHeadersByNumber(
  wanted: Set<string>,
  chainConfig: ChainConfig,
): Promise<Readonly<Map<string, Readonly<I8Header>>>> {
  const { rpc } = chainConfig;

  const result = new Map<string, Readonly<I8Header>>();
  const batch = rpc.createBatchRequest();
  for (const blockNum of wanted) {
    const h = _knownHeaders.get(blockNum);
    if (h !== undefined) {
      result.set(blockNum, h);
      continue;
    }
    batch.add("getHeaderByNumber", blockNum);
  }

  if (batch.length === 0) {
    return _knownHeaders;
  }

  const headers = (await batch.exec()) as Header[];

  for (const h of headers) {
    result.set(h.number, I8Header.from(h));
  }

  const frozenResult = Object.freeze(result);
  _knownHeaders = frozenResult;
  return frozenResult;
}

let _knownHeaders = Object.freeze(new Map<string, Readonly<I8Header>>());

const headerPlaceholder = I8Header.from({
  compactTarget: "0x1a08a97e",
  parentHash:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  transactionsRoot:
    "0x31bf3fdf4bc16d6ea195dbae808e2b9a8eca6941d589f6959b1d070d51ac28f7",
  proposalsHash:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  extraHash:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  dao: "0x8874337e541ea12e0000c16ff286230029bfa3320800000000710b00c0fefe06",
  epoch: "0x0",
  hash: "0x92b197aa1fba0f63633922c61c92375c9c074a93e85963554f5499fe1450d0e5",
  nonce: "0x0",
  number: "0x0",
  timestamp: "0x16e70e6985c",
  version: "0x0",
});

function secp256k1Blake160(
  privateKey: string,
  config: ConfigAdapter,
): {
  publicKey: string;
  lockScript: Readonly<I8Script>;
  address: string;
  expander: (c: Cell) => I8Script | undefined;
  preSigner: (tx: TransactionSkeletonType) => TransactionSkeletonType;
  signer: (tx: TransactionSkeletonType) => Transaction;
} {
  const publicKey = key.privateToPublic(privateKey);

  const lockScript = I8Script.from({
    /* eslint-disable-next-line @typescript-eslint/no-misused-spread */
    ...config.defaultScript("SECP256K1_BLAKE160"),
    args: key.publicKeyToBlake160(publicKey),
  });

  const address = encodeToAddress(lockScript, { config });

  const expander = lockExpanderFrom(lockScript);

  function preSigner(tx: TransactionSkeletonType): TransactionSkeletonType {
    return addWitnessPlaceholder(tx, lockScript);
  }

  function signer(tx: TransactionSkeletonType): Transaction {
    tx = preSigner(tx);
    tx = prepareSigningEntries(tx, { config });
    const message = tx.get("signingEntries").get(0)?.message;
    if (!message) {
      throw Error("Empty message to sign");
    }
    const sig = key.signRecoverable(message, privateKey);

    return sealTransaction(tx, [sig]);
  }

  return {
    publicKey,
    lockScript,
    address,
    expander,
    preSigner,
    signer,
  };
}

await main();
