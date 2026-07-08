import { ccc } from "@ckb-ccc/core";
import { udt } from "@ckb-ccc/udt";
import type { DaoManager } from "@ickb/dao";
import type { ExchangeRatio } from "@ickb/utils";
import { ReceiptData } from "./entities.ts";

const ickbXudtTypeOccupiedSize = 69;
const udtDataSize = 16;
const AR_0: ccc.Num = 10000000000000000n; // Base scale for CKB
const depositUsedCapacity = ccc.fixedPointFrom(82); // 82n CKB
const depositCapacityDelta = (depositUsedCapacity * AR_0) / ccc.fixedPointFrom(100000);

/**
 * Soft per-deposit iCKB value cap used before applying the excess discount.
 *
 * @public
 */
export const ICKB_DEPOSIT_CAP = ccc.fixedPointFrom(100000); // 100,000 iCKB

const zeroInputContribution: IckbInputContribution = {
  balance: ccc.Zero,
  isXudt: false,
};

type TransactionWithHeader = Awaited<ReturnType<ccc.Client["getTransactionWithHeader"]>>;

/**
 * IckbUdt extends CCC's Udt class with iCKB-aware completion.
 * CCC UDT APIs account actual xUDT cells; iCKB inputs can also carry value
 * through receipt and DAO deposit cells.
 *
 * @public
 */
export class IckbUdt extends udt.Udt {
  /** Out point of the xUDT code cell used by this iCKB token. */
  public readonly udtCode: ccc.OutPoint;

  /** Out point of the iCKB Logic code cell required by this token. */
  public readonly logicCode: ccc.OutPoint;

  /** Logic script whose hash is embedded in this iCKB xUDT type script. */
  public readonly logicScript: ccc.Script;

  /** DAO helper used to recognize iCKB DAO deposit inputs during completion. */
  public readonly daoManager: DaoManager;

  /**
   * Creates an instance of IckbUdt.
   *
   * @param code - The xUDT code cell OutPoint (passed to base Udt/Trait).
   * @param script - The iCKB UDT type script (token identity via args).
   * @param logicCode - The iCKB Logic code cell OutPoint.
   * @param logicScript - The iCKB Logic script.
   * @param daoManager - The DAO manager instance for deposit cell identification.
   */
  constructor(
    ...[code, script, logicCode, logicScript, daoManager]: [
      code: ccc.OutPointLike,
      script: ccc.ScriptLike,
      logicCode: ccc.OutPointLike,
      logicScript: ccc.ScriptLike,
      daoManager: DaoManager,
    ]
  ) {
    super(code, script);
    this.udtCode = ccc.OutPoint.from(code);
    this.logicCode = ccc.OutPoint.from(logicCode);
    this.logicScript = ccc.Script.from(logicScript);
    this.daoManager = daoManager;
  }

  /**
   * Computes the iCKB UDT type script from raw UDT and Logic scripts.
   *
   * Concatenates the iCKB logic script hash with the fixed 4-byte little-endian
   * xUDT owner-mode flags postfix ("00000080") to form the UDT type script args.
   *
   * @param udtScript - The raw xUDT script (codeHash and hashType reused).
   * @param ickbLogic - The iCKB logic script (hash used for args).
   * @returns A new Script with the computed args.
   */
  public static typeScriptFrom(udtScript: ccc.Script, ickbLogic: ccc.Script): ccc.Script {
    const { codeHash, hashType } = udtScript;
    return new ccc.Script(
      codeHash,
      hashType,
      ccc.hexFrom([ickbLogic.hash(), "00000080"].join("")),
    );
  }

  /**
   * Minimum capacity for an iCKB xUDT cell locked by the supplied lock script.
   */
  public static minimumXudtCellCapacity(lock: ccc.Script): ccc.FixedPoint {
    return (
      BigInt(8 + lock.occupiedSize + ickbXudtTypeOccupiedSize + udtDataSize) * ccc.One
    );
  }

  /**
   * Returns true when a cell carries this iCKB xUDT type and enough UDT data.
   */
  public isUdt(cellLike: ccc.CellAnyLike): boolean {
    const cell = ccc.CellAny.from(cellLike);
    return (
      cell.cellOutput.type?.eq(this.script) === true &&
      ccc.bytesFrom(cell.outputData).length >= udtDataSize
    );
  }

  /**
   * Completes iCKB xUDT inputs and change.
   * Existing receipt/deposit inputs are valued here, but the code that added
   * them still owns protocol-specific cell deps and header deps.
   */
  public override async completeChangeToLock(
    txLike: ccc.TransactionLike,
    signer: ccc.Signer,
    changeLike: ccc.ScriptLike,
  ): Promise<ccc.Transaction> {
    const tx = this.addCellDeps(txLike);
    let inputTally = await this.inputTallyFromTransaction(tx, signer.client);
    const requiredBalance = this.requiredBalanceFromOutputs(tx);

    if (shouldCollectMoreInputs(inputTally, requiredBalance)) {
      inputTally = await this.collectXudtInputs(tx, signer, inputTally, requiredBalance);
    }

    addUdtChangeOutput(tx, changeLike, this.script, inputTally.balance - requiredBalance);

    return tx;
  }

  /**
   * Completes iCKB xUDT inputs and sends change to the signer's recommended lock.
   */
  public override async completeBy(
    txLike: ccc.TransactionLike,
    signer: ccc.Signer,
  ): Promise<ccc.Transaction> {
    const { script } = await signer.getRecommendedAddressObj();
    return this.completeChangeToLock(txLike, signer, script);
  }

  /**
   * Adds iCKB-specific cell dependencies to a transaction.
   *
   * Adds individual code deps (not dep group) for:
   * - xUDT code cell (this.udtCode)
   * - iCKB Logic code cell (this.logicCode)
   *
   * @param txLike - The transaction to add cell deps to.
   * @returns The transaction with cell deps added.
   */
  public addCellDeps(txLike: ccc.TransactionLike): ccc.Transaction {
    const tx = ccc.Transaction.from(txLike);
    addCodeDep(tx, this.udtCode);
    addCodeDep(tx, this.logicCode);
    return tx;
  }

  /** Builds the initial tally from inputs already present in the transaction. */
  private async inputTallyFromTransaction(
    tx: ccc.Transaction,
    client: ccc.Client,
  ): Promise<IckbInputTally> {
    const transactionCache = new Map<ccc.Hex, Promise<TransactionWithHeader>>();
    const cells = await Promise.all(
      tx.inputs.map(async (input) => {
        try {
          return await input.getCell(client);
        } catch (error) {
          throw new Error(`Failed to load input cell ${input.previousOutput.toHex()}`, {
            cause: error,
          });
        }
      }),
    );
    const contributions = await Promise.all(
      cells.map(async (cell) => this.inputContribution(cell, client, transactionCache)),
    );
    const tally = IckbInputTally.default();
    for (const contribution of contributions) {
      tally.addAssign(contribution);
    }
    return tally;
  }

  /** Adds xUDT inputs until the required balance and xUDT-count policy are met. */
  private async collectXudtInputs(
    tx: ccc.Transaction,
    signer: ccc.Signer,
    inputTally: IckbInputTally,
    requiredBalance: ccc.Num,
  ): Promise<IckbInputTally> {
    const transactionCache = new Map<ccc.Hex, Promise<TransactionWithHeader>>();
    const collectedTally = new IckbInputTally(inputTally.balance, inputTally.xudtCount);
    let completedBalance = collectedTally.balance;
    const { accumulated } = await tx.completeInputs(
      signer,
      {
        script: this.script,
        outputDataLenRange: [udtDataSize, ccc.numFrom("0xffffffff")],
      },
      async (balance, cell) => {
        collectedTally.balance = balance;
        collectedTally.addAssign(
          await this.inputContribution(cell, signer.client, transactionCache),
        );
        completedBalance = collectedTally.balance;
        return shouldCollectMoreInputs(collectedTally, requiredBalance)
          ? collectedTally.balance
          : undefined;
      },
      collectedTally.balance,
    );
    if (accumulated !== undefined && accumulated < requiredBalance) {
      throw new Error(
        `Insufficient iCKB, need ${String(requiredBalance - accumulated)} more`,
      );
    }
    collectedTally.balance = accumulated ?? completedBalance;
    return collectedTally;
  }

  /** Classifies an input cell once for iCKB completion accounting. */
  private async inputContribution(
    cell: ccc.CellAny,
    client: ccc.Client,
    transactionCache: Map<ccc.Hex, Promise<TransactionWithHeader>>,
  ): Promise<IckbInputContribution> {
    if (this.isUdt(cell)) {
      return {
        balance: ccc.udtBalanceFrom(cell.outputData),
        isXudt: true,
      };
    }
    if (cell.outPoint === undefined) {
      return zeroInputContribution;
    }

    const { type, lock } = cell.cellOutput;
    let amount: ccc.FixedPoint;
    let quantity = 1n;
    let sign = 1n;
    if (type !== undefined && this.logicScript.eq(type)) {
      let receipt: ReturnType<typeof ReceiptData.decodePrefix>;
      try {
        receipt = ReceiptData.decodePrefix(cell.outputData);
      } catch (error) {
        throw new Error(
          `Invalid iCKB receipt payload at ${cell.outPoint.toHex()}: ${cell.outputData}`,
          { cause: error },
        );
      }
      amount = receipt.depositAmount;
      quantity = receipt.depositQuantity;
    } else if (this.logicScript.eq(lock) && this.daoManager.isDeposit(cell)) {
      amount = cell.capacityFree;
      sign = -1n;
    } else {
      return zeroInputContribution;
    }

    const header = (
      await getCachedTransactionWithHeader(client, cell.outPoint, transactionCache)
    )?.header;
    if (header === undefined) {
      throw new Error(
        `Header not found for txHash ${cell.outPoint.txHash} at ${cell.outPoint.toHex()}`,
      );
    }

    return {
      balance: sign * ickbValue(amount, header) * quantity,
      isXudt: false,
    };
  }

  private requiredBalanceFromOutputs(tx: ccc.Transaction): ccc.Num {
    return Array.from(tx.outputCells).reduce((required, cell) => {
      return this.isUdt(cell) ? required + ccc.udtBalanceFrom(cell.outputData) : required;
    }, ccc.Zero);
  }
}

async function getCachedTransactionWithHeader(
  client: ccc.Client,
  outPoint: ccc.OutPoint,
  transactionCache: Map<ccc.Hex, Promise<TransactionWithHeader>>,
): Promise<TransactionWithHeader> {
  const txHash = outPoint.txHash;
  let promise = transactionCache.get(txHash);
  if (promise === undefined) {
    promise = getTransactionWithHeader(client, outPoint);
    transactionCache.set(txHash, promise);
  }
  return promise;
}

async function getTransactionWithHeader(
  client: ccc.Client,
  outPoint: ccc.OutPoint,
): Promise<TransactionWithHeader> {
  try {
    return await client.getTransactionWithHeader(outPoint.txHash);
  } catch (error) {
    throw new Error(
      `Failed to load transaction header for txHash ${outPoint.txHash} at ${outPoint.toHex()}`,
      { cause: error },
    );
  }
}

interface IckbInputContribution {
  balance: ccc.Num;
  isXudt: boolean;
}

/** Tracks iCKB input value and actual xUDT input count separately. */
class IckbInputTally {
  public balance: ccc.Num;
  public xudtCount: number;

  constructor(balance: ccc.Num, xudtCount: number) {
    this.balance = balance;
    this.xudtCount = xudtCount;
  }

  public static default(): IckbInputTally {
    return new IckbInputTally(ccc.Zero, 0);
  }

  public addAssign(contribution: IckbInputContribution): void {
    this.balance += contribution.balance;
    if (contribution.isXudt) {
      this.xudtCount += 1;
    }
  }
}

/** Decides whether xUDT collection should continue for the current tally. */
function shouldCollectMoreInputs(
  inputTally: IckbInputTally,
  requiredBalance: ccc.Num,
): boolean {
  if (inputTally.balance < requiredBalance) {
    return true;
  }
  if (inputTally.balance === requiredBalance) {
    return false;
  }

  // Match CCC's xUDT compression rule: one overfunding xUDT input should
  // collect a second xUDT input. Receipt and deposit inputs do not count.
  return inputTally.xudtCount === 1;
}

function addUdtChangeOutput(
  tx: ccc.Transaction,
  lock: ccc.ScriptLike,
  type: ccc.ScriptLike,
  balance: ccc.Num,
): void {
  if (balance <= ccc.Zero) {
    return;
  }
  const balanceData = ccc.numLeToBytes(balance, 16);
  tx.addOutput({ lock, type }, balanceData);
}

function addCodeDep(tx: ccc.Transaction, outPoint: ccc.OutPoint): void {
  if (tx.cellDeps.some((dep) => dep.depType === "code" && dep.outPoint.eq(outPoint))) {
    return;
  }
  tx.addCellDeps({ outPoint, depType: "code" });
}

/**
 * Calculates iCKB value for unoccupied CKB capacity at a deposit header.
 *
 * @remarks
 * Values above {@link ICKB_DEPOSIT_CAP} receive a 10% discount only on the
 * excess amount.
 */
export function ickbValue(
  ckbUnoccupiedCapacity: ccc.FixedPoint,
  header: ccc.ClientBlockHeader,
): ccc.FixedPoint {
  let ickbAmount = convert(true, ckbUnoccupiedCapacity, header, false);
  if (ICKB_DEPOSIT_CAP < ickbAmount) {
    // Apply a 10% discount for the amount exceeding the soft iCKB cap per deposit.
    ickbAmount -= (ickbAmount - ICKB_DEPOSIT_CAP) / 10n;
  }

  return ickbAmount;
}

/**
 * Converts between CKB and iCKB based on the provided ratio.
 *
 * @param isCkb2Udt - A boolean indicating the direction of conversion (CKB to iCKB or vice versa).
 * @param amount - The amount to convert.
 * @param rate - The ratio information for conversion, which can be either:
 *   - An object containing `ckbScale` and `udtScale`.
 *   - A `ccc.ClientBlockHeader` for header information.
 * @param accountDepositCapacity - A boolean indicating whether to account for deposit capacity
 *  when using ccc.ClientBlockHeader (default: true).
 * @returns The converted amount in the target unit as a `ccc.FixedPoint`.
 *
 * @public
 */
export function convert(
  isCkb2Udt: boolean,
  amount: ccc.FixedPoint,
  rate: ExchangeRatio | ccc.ClientBlockHeader,
  accountDepositCapacity = true,
): ccc.FixedPoint {
  const ratio = "dao" in rate ? ickbExchangeRatio(rate, accountDepositCapacity) : rate;
  if (ratio.ckbScale <= 0n || ratio.udtScale <= 0n) {
    throw new Error("Exchange ratio scales must be positive");
  }
  return isCkb2Udt
    ? (amount * ratio.ckbScale) / ratio.udtScale
    : (amount * ratio.udtScale) / ratio.ckbScale;
}

/**
 * Calculates the iCKB exchange ratio based on the block header and deposit capacity.
 *
 * @param header - The block header used for calculating the exchange ratio.
 * @param accountDepositCapacity - A boolean indicating whether to account for the deposit capacity in the calculation.
 * @returns An object containing the CKB and UDT scales.
 *
 * @public
 */
export function ickbExchangeRatio(
  header: ccc.ClientBlockHeader,
  accountDepositCapacity = true,
): ExchangeRatio {
  const AR_m = header.dao.ar;
  return {
    ckbScale: AR_0,
    udtScale: accountDepositCapacity ? AR_m + depositCapacityDelta : AR_m,
  };
}
