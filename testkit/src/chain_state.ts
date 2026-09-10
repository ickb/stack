/**
 * In-memory chain model backing `FakeClient` test doubles.
 */

import { ccc } from "@ckb-ccc/core";

const committedStatus: ccc.TransactionStatus = "committed";

/**
 * Creates an empty {@link ChainState} for declarative chained composition.
 */
export function chainState(): ChainState {
  return new ChainState();
}

/**
 * Declarative in-memory chain model: live cells, headers, transactions, tip,
 * fee-rate statistics, cycles, and known scripts.
 *
 * @remarks
 * Builder methods (`tip`, `header`, `cell`, `tx`, `committedTx`, `feeRate`,
 * `cycles`, `sendStatus`, `knownScript`) mutate the model and return `this`
 * for chaining. Query methods serve `FakeClient` lookups. Indexer matches
 * follow cell insertion order; `desc` scans reverse it.
 */
export class ChainState {
  private readonly cells = new Map<ccc.Hex, ccc.Cell>();
  private readonly liveKeys = new Set<ccc.Hex>();
  private readonly headersByHash = new Map<ccc.Hex, ccc.ClientBlockHeader>();
  private readonly headersByNumber = new Map<ccc.Num, ccc.ClientBlockHeader>();
  private readonly transactions = new Map<ccc.Hex, ccc.ClientTransactionResponse>();
  private readonly knownScripts = new Map<ccc.KnownScript, ccc.ScriptInfo>();
  private tipHeaderValue: ccc.ClientBlockHeader | undefined;
  private feeRateStatistics = { mean: 1000n, median: 1000n };
  private cyclesValue: ccc.Num = 0n;
  private sendStatusValue: ccc.TransactionStatus = committedStatus;

  /** Registers a header, keyed by both number and hash. */
  public header(headerLike: ccc.ClientBlockHeaderLike): this {
    const header = ccc.ClientBlockHeader.from(headerLike);
    this.headersByNumber.set(header.number, header);
    this.headersByHash.set(header.hash, header);
    return this;
  }

  /** Registers a header and marks it as the chain tip. */
  public tip(headerLike: ccc.ClientBlockHeaderLike): this {
    const header = ccc.ClientBlockHeader.from(headerLike);
    this.tipHeaderValue = header;
    return this.header(header);
  }

  /** Adds a live cell, keyed by its out point. */
  public cell(cellLike: ccc.CellLike): this {
    const cell = ccc.Cell.from(cellLike);
    const key = cell.outPoint.toHex();
    this.cells.set(key, cell);
    this.liveKeys.add(key);
    return this;
  }

  /** Registers a transaction response, keyed by its transaction hash. */
  public tx(responseLike: ccc.ClientTransactionResponseLike): this {
    const response = ccc.ClientTransactionResponse.from(responseLike);
    this.transactions.set(response.transaction.hash(), response);
    return this;
  }

  /**
   * Registers a committed transaction, optionally anchored to a header that
   * is also registered and provides the block hash and number.
   *
   * @remarks
   * Registers history only: the transaction outputs are not added to the
   * live cell set. Declare them with {@link ChainState.cell} when indexer
   * scans should find them.
   */
  public committedTx(
    txLike: ccc.TransactionLike,
    headerLike?: ccc.ClientBlockHeaderLike,
  ): this {
    const response: ccc.ClientTransactionResponseLike = {
      transaction: txLike,
      status: committedStatus,
    };
    if (headerLike !== undefined) {
      const header = ccc.ClientBlockHeader.from(headerLike);
      this.header(header);
      response.blockHash = header.hash;
      response.blockNumber = header.number;
    }
    return this.tx(response);
  }

  /** Sets the fee-rate statistics; the median defaults to the mean. */
  public feeRate(mean: ccc.NumLike, median: ccc.NumLike = mean): this {
    this.feeRateStatistics = { mean: ccc.numFrom(mean), median: ccc.numFrom(median) };
    return this;
  }

  /** Sets the cycles reported for cycle estimates and dry-run sends. */
  public cycles(value: ccc.NumLike): this {
    this.cyclesValue = ccc.numFrom(value);
    return this;
  }

  /** Sets the status recorded for subsequently sent transactions. */
  public sendStatus(status: ccc.TransactionStatus): this {
    this.sendStatusValue = status;
    return this;
  }

  /** Registers deployment info for a well-known script. */
  public knownScript(known: ccc.KnownScript, info: ccc.ScriptInfoLike): this {
    this.knownScripts.set(known, ccc.ScriptInfo.from(info));
    return this;
  }

  /**
   * Records a sent transaction under the configured send status. Committed
   * sends spend the transaction inputs and add its outputs as live cells.
   */
  public applySend(txLike: ccc.TransactionLike): ccc.Hex {
    const transaction = ccc.Transaction.from(txLike);
    const txHash = transaction.hash();
    this.tx({ transaction, status: this.sendStatusValue });
    if (this.sendStatusValue !== committedStatus) {
      return txHash;
    }
    for (const input of transaction.inputs) {
      this.liveKeys.delete(input.previousOutput.toHex());
    }
    for (const [index, outputData] of transaction.outputsData.entries()) {
      const cellOutput = transaction.outputs[index];
      if (cellOutput === undefined) {
        break;
      }
      this.cell({ outPoint: { txHash, index }, cellOutput, outputData });
    }
    return txHash;
  }

  /** Returns the tip header, when one is set. */
  public getTipHeader(): ccc.ClientBlockHeader | undefined {
    return this.tipHeaderValue;
  }

  /** Returns the registered header with the given number, if any. */
  public getHeaderByNumber(blockNumber: ccc.NumLike): ccc.ClientBlockHeader | undefined {
    return this.headersByNumber.get(ccc.numFrom(blockNumber));
  }

  /** Returns the registered header with the given hash, if any. */
  public getHeaderByHash(blockHash: ccc.HexLike): ccc.ClientBlockHeader | undefined {
    return this.headersByHash.get(ccc.hexFrom(blockHash));
  }

  /** Returns the registered transaction response for the hash, if any. */
  public getTransaction(txHash: ccc.HexLike): ccc.ClientTransactionResponse | undefined {
    return this.transactions.get(ccc.hexFrom(txHash));
  }

  /** Returns the recorded cell at the out point, live or spent. */
  public getCell(outPointLike: ccc.OutPointLike): ccc.Cell | undefined {
    return this.cells.get(ccc.OutPoint.from(outPointLike).toHex());
  }

  /** Returns the cell at the out point only while it is live. */
  public getLiveCell(outPointLike: ccc.OutPointLike): ccc.Cell | undefined {
    const key = ccc.OutPoint.from(outPointLike).toHex();
    return this.liveKeys.has(key) ? this.cells.get(key) : undefined;
  }

  /** Returns a copy of the configured fee-rate statistics. */
  public getFeeRateStatistics(): { mean: ccc.Num; median: ccc.Num } {
    return { ...this.feeRateStatistics };
  }

  /** Returns the configured cycles value. */
  public getCycles(): ccc.Num {
    return this.cyclesValue;
  }

  /** Returns the registered info for a well-known script, if any. */
  public getKnownScript(known: ccc.KnownScript): ccc.ScriptInfo | undefined {
    return this.knownScripts.get(known);
  }

  /**
   * Returns live cells matching an indexer search key, in insertion order
   * for `asc` scans and reversed for `desc` scans.
   *
   * @remarks
   * Cells carry no block number, so `blockRange` filters and the `partial`
   * search mode are unsupported and throw.
   */
  public matchLiveCells(
    keyLike: ccc.ClientIndexerSearchKeyLike,
    order: "asc" | "desc",
  ): ccc.Cell[] {
    const key = ccc.ClientIndexerSearchKey.from(keyLike);
    const matches: ccc.Cell[] = [];
    for (const [outPointKey, cell] of this.cells) {
      if (this.liveKeys.has(outPointKey) && cellMatches(cell, key)) {
        matches.push(cell);
      }
    }
    if (order === "desc") {
      matches.reverse();
    }
    return key.withData === false ? matches.map(cellWithoutData) : matches;
  }
}

/**
 * Returns a copy of the cell with blanked output data, mirroring indexer
 * responses when cell data is not requested.
 */
export function cellWithoutData(cell: ccc.Cell): ccc.Cell {
  return ccc.Cell.from({
    outPoint: cell.outPoint,
    cellOutput: cell.cellOutput,
    outputData: "0x",
  });
}

function cellMatches(cell: ccc.Cell, key: ccc.ClientIndexerSearchKey): boolean {
  const { lock, type } = cell.cellOutput;
  const [primary, complement] = key.scriptType === "lock" ? [lock, type] : [type, lock];
  if (
    primary === undefined ||
    !bytesMatch(
      scriptSearchTarget(primary),
      scriptSearchTarget(key.script),
      key.scriptSearchMode,
    )
  ) {
    return false;
  }
  return key.filter === undefined || filterMatches(cell, complement, key.filter);
}

function filterMatches(
  cell: ccc.Cell,
  complement: ccc.Script | undefined,
  filter: ccc.ClientIndexerSearchKeyFilter,
): boolean {
  if (filter.blockRange !== undefined) {
    throw new Error(
      "ChainState cells carry no block number; blockRange filters are unsupported",
    );
  }
  if (
    filter.script !== undefined &&
    (complement === undefined ||
      !bytesMatch(
        scriptSearchTarget(complement),
        scriptSearchTarget(filter.script),
        "prefix",
      ))
  ) {
    return false;
  }
  if (
    filter.scriptLenRange !== undefined &&
    !inRange(scriptLen(complement), filter.scriptLenRange)
  ) {
    return false;
  }
  if (
    filter.outputData !== undefined &&
    !bytesMatch(
      cell.outputData.slice(2),
      filter.outputData.slice(2),
      filter.outputDataSearchMode ?? "prefix",
    )
  ) {
    return false;
  }
  if (
    filter.outputDataLenRange !== undefined &&
    !inRange(byteLength(cell.outputData), filter.outputDataLenRange)
  ) {
    return false;
  }
  return (
    filter.outputCapacityRange === undefined ||
    inRange(cell.cellOutput.capacity, filter.outputCapacityRange)
  );
}

function scriptSearchTarget(script: ccc.Script): string {
  const hashType = ccc.hexFrom(ccc.hashTypeToBytes(script.hashType));
  return `${script.codeHash.slice(2)}${hashType.slice(2)}${script.args.slice(2)}`;
}

function bytesMatch(
  target: string,
  pattern: string,
  mode: "prefix" | "exact" | "partial",
): boolean {
  if (mode === "exact") {
    return target === pattern;
  }
  if (mode === "prefix") {
    return target.startsWith(pattern);
  }
  throw new Error("ChainState does not support the partial search mode");
}

function inRange(value: ccc.Num, [lower, upper]: [ccc.Num, ccc.Num]): boolean {
  return lower <= value && value < upper;
}

function byteLength(data: ccc.Hex): ccc.Num {
  return BigInt((data.length - 2) / 2);
}

function scriptLen(script: ccc.Script | undefined): ccc.Num {
  return script === undefined ? 0n : BigInt(33 + (script.args.length - 2) / 2);
}
