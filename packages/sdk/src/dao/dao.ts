import { ccc } from "@ckb-ccc/core";
import { CheckedUint64LE, findCells, unique, type ScriptDeps } from "../utils/index.ts";
import {
  daoCellFrom,
  type DaoCellFromCache,
  type DaoCellFromOptions,
  type DaoDepositCell,
  type DaoWithdrawalRequestCell,
} from "./cells.ts";
import { assertDaoOutputLimit } from "./dao_output_limit.ts";
import { cellInputLikeFrom, cellOutputLikeFrom } from "./transaction_shape.ts";

/**
 * Builds and finds Nervos DAO deposit and withdrawal transactions.
 *
 * @public
 */
export class DaoManager implements ScriptDeps {
  /** The deployed Nervos DAO type script managed by this instance. */
  public readonly script: ccc.Script;

  /** Cell dependencies required to execute the DAO script. */
  public readonly cellDeps: ccc.CellDep[];

  /**
   * Creates a DAO manager for one deployed DAO script and its cell deps.
   */
  constructor(script: ccc.Script, cellDeps: ccc.CellDep[]) {
    this.script = script;
    this.cellDeps = cellDeps;
  }

  /**
   * Returns true when the cell is a DAO deposit for this manager's script.
   */
  public isDeposit(cell: ccc.CellAny): boolean {
    const {
      cellOutput: { type },
      outputData,
    } = cell;

    return outputData === DaoManager.depositData() && type?.eq(this.script) === true;
  }

  /**
   * Returns true when the cell uses this DAO script and is not deposit-shaped.
   *
   * @remarks
   * This structural check does not decode or validate the withdrawal request's
   * deposit block number payload.
   */
  public isWithdrawalRequest(cell: ccc.Cell): boolean {
    const {
      cellOutput: { type },
      outputData,
    } = cell;

    return outputData !== DaoManager.depositData() && type?.eq(this.script) === true;
  }

  /**
   * Returns the canonical DAO deposit data payload.
   */
  public static depositData(): ccc.Hex {
    return ccc.hexFrom(CheckedUint64LE.encode(0n));
  }

  /**
   * Loads and decodes a DAO deposit cell from a cell or out point.
   *
   * @remarks Cache maps in `options` are reused only for this caller-provided conversion batch.
   */
  public async depositCellFrom(
    cellLike: ccc.Cell | ccc.OutPoint,
    client: ccc.Client,
    options: Omit<DaoCellFromOptions, "client">,
  ): Promise<DaoDepositCell> {
    const cell = await cellFromLike(cellLike, client);
    if (!this.isDeposit(cell)) {
      throw new Error("Not a deposit");
    }

    return daoCellFrom(cell, { ...options, client, isDeposit: true });
  }

  /**
   * Loads and decodes a DAO withdrawal request cell from a cell or out point.
   *
   * @remarks Cache maps in `options` are reused only for this caller-provided conversion batch.
   */
  public async withdrawalRequestCellFrom(
    cellLike: ccc.Cell | ccc.OutPoint,
    client: ccc.Client,
    options: Omit<DaoCellFromOptions, "client">,
  ): Promise<DaoWithdrawalRequestCell> {
    const cell = await cellFromLike(cellLike, client);
    if (!this.isWithdrawalRequest(cell)) {
      throw new Error("Not a withdrawal request");
    }

    return daoCellFrom(cell, { ...options, client, isDeposit: false });
  }

  /**
   * Adds DAO deposit outputs with the given capacities and lock script.
   *
   * @returns The updated partial transaction.
   */
  public deposit(
    txLike: ccc.TransactionLike | ccc.Transaction,
    capacities: ccc.FixedPoint[],
    lock: ccc.Script,
  ): ccc.Transaction {
    const tx = ccc.Transaction.from(txLike);
    if (capacities.length === 0) {
      assertDaoOutputLimit(tx, this.script);
      return tx;
    }

    tx.addCellDeps(this.cellDeps);

    for (const capacity of capacities) {
      tx.addOutput(
        {
          capacity,
          lock,
          type: this.script,
        },
        DaoManager.depositData(),
      );
    }

    assertDaoOutputLimit(tx, this.script);
    return tx;
  }

  /**
   * Adds DAO withdrawal request inputs and outputs for the selected deposits.
   *
   * @param options - Set `isReadyOnly` to only process ready deposits.
   * @returns The updated partial transaction.
   * @throws Error if the transaction has different input and output lengths.
   * @throws Error if the withdrawal request lock args have a different size from the deposit.
   */
  public requestWithdrawal(
    txLike: ccc.TransactionLike | ccc.Transaction,
    deposits: DaoDepositCell[],
    lock: ccc.Script,
    options?: {
      isReadyOnly?: boolean;
    },
  ): ccc.Transaction {
    const tx = ccc.Transaction.from(txLike);
    const selectedDeposits =
      options?.isReadyOnly === true ? deposits.filter((d) => d.isReady) : deposits;
    if (selectedDeposits.length === 0) {
      assertDaoOutputLimit(tx, this.script);
      return tx;
    }

    if (
      tx.inputs.length !== tx.outputs.length ||
      tx.outputs.length !== tx.outputsData.length
    ) {
      throw new Error("Transaction has different inputs and outputs lengths");
    }
    assertUniqueUnspentInputs(
      tx,
      selectedDeposits.map((deposit) => deposit.cell.outPoint),
      "DAO deposit",
    );

    for (const deposit of selectedDeposits) {
      const { cell, headers } = deposit;
      this.assertDepositReadyForWithdrawalRequest(deposit);
      if (cell.cellOutput.lock.args.length !== lock.args.length) {
        throw new Error("Withdrawal request lock args has different size from deposit");
      }

      tx.addCellDeps(this.cellDeps);
      const depositHeader = headers[0];
      const depositHash = depositHeader.header.hash;
      if (!tx.headerDeps.includes(depositHash)) {
        tx.headerDeps.push(depositHash);
      }
      tx.addInput(cellInputLikeFrom(cell));
      tx.addOutput(
        {
          capacity: cell.cellOutput.capacity,
          lock,
          type: this.script,
        },
        CheckedUint64LE.encode(depositHeader.header.number),
      );
    }

    assertDaoOutputLimit(tx, this.script);
    return tx;
  }

  /**
   * Adds DAO withdrawal request inputs with required header deps and witness input types.
   *
   * @param options - Set `isReadyOnly` to skip requests that are not ready yet.
   * @returns The updated partial transaction.
   * @throws Error if a withdrawal request witness input type is already in use.
   */
  public withdraw(
    txLike: ccc.TransactionLike | ccc.Transaction,
    withdrawalRequests: DaoWithdrawalRequestCell[],
    options?: {
      isReadyOnly?: boolean;
    },
  ): ccc.Transaction {
    const tx = ccc.Transaction.from(txLike);
    const selectedWithdrawalRequests =
      options?.isReadyOnly === true
        ? withdrawalRequests.filter((d) => d.isReady)
        : withdrawalRequests;
    if (selectedWithdrawalRequests.length === 0) {
      assertDaoOutputLimit(tx, this.script);
      return tx;
    }

    tx.addCellDeps(this.cellDeps);
    assertUniqueUnspentInputs(
      tx,
      selectedWithdrawalRequests.map((request) => request.cell.outPoint),
      "DAO withdrawal request",
    );

    for (const withdrawalRequest of selectedWithdrawalRequests) {
      this.assertWithdrawalRequestReadyForWithdrawal(withdrawalRequest);
      const {
        cell: { outPoint, cellOutput, outputData },
        headers,
        maturity,
      } = withdrawalRequest;
      for (const th of headers) {
        const hash = th.header.hash;
        if (!tx.headerDeps.includes(hash)) {
          tx.headerDeps.push(hash);
        }
      }
      const depositHeader = headers[0];
      const headerIndex = tx.headerDeps.indexOf(depositHeader.header.hash);

      const inputIndex =
        tx.addInput({
          outPoint,
          cellOutput: cellOutputLikeFrom(cellOutput),
          outputData,
          since: {
            relative: "absolute",
            metric: "epoch",
            value: maturity.toHex(),
          },
        }) - 1;

      const witness = tx.getWitnessArgs(inputIndex) ?? ccc.WitnessArgs.from({});
      if ((witness.inputType ?? "") !== "") {
        throw new Error("Witnesses of withdrawal request already in use");
      }
      witness.inputType = ccc.hexFrom(CheckedUint64LE.encode(headerIndex));
      tx.setWitnessArgs(inputIndex, witness);
    }

    assertDaoOutputLimit(tx, this.script);
    return tx;
  }

  /**
   * Finds DAO deposit cells for the given locks.
   *
   * @param options - Scan options. `tip` controls readiness calculations;
   * `minLockUp` and `maxLockUp` override deposit readiness windows.
   * @remarks The transaction cache is shared across the scan so deposit conversions reuse transaction-header reads.
   */
  public async *findDeposits(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: {
      tip?: ccc.ClientBlockHeader;
      minLockUp?: ccc.Epoch;
      maxLockUp?: ccc.Epoch;
    },
  ): AsyncGenerator<DaoDepositCell> {
    const tip = options?.tip ?? (await client.getTipHeader());
    const locksToScan = Array.from(unique(locks));

    const transactionCache: DaoCellFromCache["transactionCache"] = new Map();
    const foundDeposits: DaoDepositCell[] = [];
    for (const lock of locksToScan) {
      const depositCandidates = (
        await findCells(client, {
          script: lock,
          scriptType: "lock",
          filter: {
            script: this.script,
            outputData: DaoManager.depositData(),
            outputDataSearchMode: "exact",
          },
          scriptSearchMode: "exact",
          withData: true,
        })
      ).filter((cell) => this.isDeposit(cell) && cell.cellOutput.lock.eq(lock));

      const deposits = await Promise.all(
        depositCandidates.map(async (cell) =>
          this.depositCellFrom(cell, client, {
            tip,
            transactionCache,
            ...(options?.minLockUp === undefined ? {} : { minLockUp: options.minLockUp }),
            ...(options?.maxLockUp === undefined ? {} : { maxLockUp: options.maxLockUp }),
          }),
        ),
      );
      foundDeposits.push(...deposits);
    }
    for (const deposit of foundDeposits) {
      yield deposit;
    }
  }

  /**
   * Finds DAO withdrawal request cells for the given locks.
   *
   * @param options - Scan options. `tip` controls readiness calculations.
   * @remarks Header and transaction caches are shared across the scan so withdrawal conversions reuse DAO reads.
   */
  public async *findWithdrawalRequests(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: { tip?: ccc.ClientBlockHeader },
  ): AsyncGenerator<DaoWithdrawalRequestCell> {
    const tip = options?.tip ?? (await client.getTipHeader());
    const locksToScan = Array.from(unique(locks));

    const headerCache: DaoCellFromCache["headerCache"] = new Map();
    const transactionCache: DaoCellFromCache["transactionCache"] = new Map();
    const foundWithdrawals: DaoWithdrawalRequestCell[] = [];
    for (const lock of locksToScan) {
      const withdrawalCandidates = (
        await findCells(client, {
          script: lock,
          scriptType: "lock",
          filter: { script: this.script },
          scriptSearchMode: "exact",
          withData: true,
        })
      ).filter((cell) => this.isWithdrawalRequest(cell) && cell.cellOutput.lock.eq(lock));

      const withdrawals = await Promise.all(
        withdrawalCandidates.map(async (cell) =>
          this.withdrawalRequestCellFrom(cell, client, {
            tip,
            headerCache,
            transactionCache,
          }),
        ),
      );
      foundWithdrawals.push(...withdrawals);
    }
    for (const withdrawal of foundWithdrawals) {
      yield withdrawal;
    }
  }

  private assertDepositReadyForWithdrawalRequest(deposit: DaoDepositCell): void {
    const outPoint = deposit.cell.outPoint.toHex();
    if (!this.isDeposit(deposit.cell)) {
      throw new Error(`DAO deposit ${outPoint} does not match this DAO script`);
    }
    const depositTxHash = deposit.headers[0].txHash;
    if (depositTxHash !== deposit.cell.outPoint.txHash) {
      throw new Error(
        `DAO deposit ${outPoint} header txHash ${String(depositTxHash)} does not match cell txHash ${deposit.cell.outPoint.txHash}`,
      );
    }
  }

  private assertWithdrawalRequestReadyForWithdrawal(
    withdrawalRequest: DaoWithdrawalRequestCell,
  ): void {
    const outPoint = withdrawalRequest.cell.outPoint.toHex();
    if (!this.isWithdrawalRequest(withdrawalRequest.cell)) {
      throw new Error(
        `DAO withdrawal request ${outPoint} does not match this DAO script`,
      );
    }
    const requestTxHash = withdrawalRequest.headers[1].txHash;
    if (requestTxHash !== withdrawalRequest.cell.outPoint.txHash) {
      throw new Error(
        `DAO withdrawal request ${outPoint} header txHash ${String(requestTxHash)} does not match cell txHash ${withdrawalRequest.cell.outPoint.txHash}`,
      );
    }
    let depositBlockNumber: ccc.Num;
    try {
      depositBlockNumber = CheckedUint64LE.decode(withdrawalRequest.cell.outputData);
    } catch (error) {
      throw new Error(
        `Invalid DAO withdrawal request payload at ${outPoint}: ${withdrawalRequest.cell.outputData}`,
        { cause: error },
      );
    }
    if (depositBlockNumber !== withdrawalRequest.headers[0].header.number) {
      throw new Error(
        `DAO withdrawal request ${outPoint} deposit block ${String(depositBlockNumber)} does not match header block ${String(withdrawalRequest.headers[0].header.number)}`,
      );
    }
  }
}

function assertUniqueUnspentInputs(
  tx: ccc.Transaction,
  outPoints: ccc.OutPoint[],
  label: string,
): void {
  const spent = new Set(tx.inputs.map((input) => input.previousOutput.toHex()));
  const selected = new Set<string>();
  for (const outPoint of outPoints) {
    const key = outPoint.toHex();
    if (selected.has(key)) {
      throw new Error(`${label} ${key} is duplicated`);
    }
    selected.add(key);
    if (spent.has(key)) {
      throw new Error(`${label} ${key} is already being spent`);
    }
  }
}

async function cellFromLike(
  cellLike: ccc.Cell | ccc.OutPoint,
  client: ccc.Client,
): Promise<ccc.Cell> {
  if (!(cellLike instanceof ccc.OutPoint)) {
    return cellLike;
  }
  let cell: ccc.Cell | undefined;
  try {
    cell = await client.getCell(cellLike);
  } catch (error) {
    throw new Error(`Failed to load cell for out point ${cellLike.toHex()}`, {
      cause: error,
    });
  }
  if (cell === undefined) {
    throw new Error(`Cell not found for out point ${cellLike.toHex()}`);
  }
  return cell;
}
