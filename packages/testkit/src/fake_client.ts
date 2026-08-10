/**
 * Explicit CCC client fake backed by an in-memory {@link ChainState}.
 */

import { ccc } from "@ckb-ccc/core";
import { cellWithoutData, type ChainState } from "./chain_state.ts";

type ClientMethod<K extends keyof ccc.Client> = Extract<
  ccc.Client[K],
  (...args: never[]) => unknown
>;

/**
 * Error reported by {@link FakeClient} members without scripted chain state.
 */
export class FakeClientError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FakeClientError";
  }
}

/**
 * Per-member handler overrides used as the error-injection escape hatch.
 */
export interface FakeClientOverrides {
  /** Address prefix reported by {@link FakeClient.addressPrefix}. */
  addressPrefix?: string;
  /** URL reported by {@link FakeClient.url}; never dialed. */
  url?: string;
  /** Cache implementation; defaults to a fresh `ccc.ClientCacheMemory`. */
  cache?: ccc.ClientCache;
  estimateCycles?: ClientMethod<"estimateCycles">;
  findCellsPagedNoCache?: ClientMethod<"findCellsPagedNoCache">;
  findTransactionsPaged?: ClientMethod<"findTransactionsPaged">;
  getBlockByHashNoCache?: ClientMethod<"getBlockByHashNoCache">;
  getBlockByNumberNoCache?: ClientMethod<"getBlockByNumberNoCache">;
  getCellLiveNoCache?: ClientMethod<"getCellLiveNoCache">;
  getCellsCapacity?: ClientMethod<"getCellsCapacity">;
  getFeeRateStatistics?: ClientMethod<"getFeeRateStatistics">;
  getHeaderByHashNoCache?: ClientMethod<"getHeaderByHashNoCache">;
  getHeaderByNumberNoCache?: ClientMethod<"getHeaderByNumberNoCache">;
  getKnownScript?: ClientMethod<"getKnownScript">;
  getTip?: ClientMethod<"getTip">;
  getTipHeader?: ClientMethod<"getTipHeader">;
  getTransactionNoCache?: ClientMethod<"getTransactionNoCache">;
  sendTransactionDry?: ClientMethod<"sendTransactionDry">;
  sendTransactionNoCache?: ClientMethod<"sendTransactionNoCache">;
}

/**
 * CCC client fake whose every RPC entry point either consults the supplied
 * {@link ChainState} or rejects with a {@link FakeClientError}; nothing ever
 * reaches a network.
 *
 * @remarks
 * Extends the abstract `ccc.Client`, so all concrete caching helpers
 * (`getCell`, `findCells`, `getHeaderByNumber`, `sendTransaction`, ...) run
 * their real code paths over a real `ccc.ClientCacheMemory`. Overrides
 * replace individual members for error injection. Two members have scripted
 * defaults instead of rejecting: fee-rate statistics (1000) and cycles (0).
 * CCC's `sendTransaction` fee path probes inputs for NervosDao profit, so
 * full send flows must register the NervosDao known script on the chain
 * state.
 */
export class FakeClient extends ccc.Client {
  public readonly chainState: ChainState;
  private readonly overrides: FakeClientOverrides;

  constructor(chainState: ChainState, overrides: FakeClientOverrides = {}) {
    super({ cache: overrides.cache });
    this.chainState = chainState;
    this.overrides = overrides;
  }

  /** Fake URL with no network meaning. */
  public override get url(): string {
    return this.overrides.url ?? "fake://chain-state";
  }

  /** Testnet-style address prefix. */
  public override get addressPrefix(): string {
    return this.overrides.addressPrefix ?? "ckt";
  }

  /** Resolves well-known scripts registered on the chain state. */
  public override async getKnownScript(script: ccc.KnownScript): Promise<ccc.ScriptInfo> {
    const handler = this.overrides.getKnownScript;
    if (handler !== undefined) {
      return handler(script);
    }
    const info = this.chainState.getKnownScript(script);
    if (info === undefined) {
      throw notScripted(`getKnownScript(${script})`);
    }
    return info;
  }

  /** Serves the configured fee-rate statistics. */
  public override async getFeeRateStatistics(
    blockRange?: ccc.NumLike,
  ): Promise<{ mean: ccc.Num; median: ccc.Num }> {
    const handler = this.overrides.getFeeRateStatistics;
    if (handler !== undefined) {
      return handler(blockRange);
    }
    return this.chainState.getFeeRateStatistics();
  }

  /** Serves the tip header number. */
  public override async getTip(): Promise<ccc.Num> {
    const handler = this.overrides.getTip;
    if (handler !== undefined) {
      return handler();
    }
    return this.tipHeaderOrThrow("getTip").number;
  }

  /** Serves the tip header. */
  public override async getTipHeader(
    verbosity?: number | null,
  ): Promise<ccc.ClientBlockHeader> {
    const handler = this.overrides.getTipHeader;
    if (handler !== undefined) {
      return handler(verbosity);
    }
    return this.tipHeaderOrThrow("getTipHeader");
  }

  /** Blocks are not modeled; rejects unless overridden. */
  public override async getBlockByNumberNoCache(
    blockNumber: ccc.NumLike,
    verbosity?: number | null,
    withCycles?: boolean | null,
  ): Promise<ccc.ClientBlock | undefined> {
    const handler = this.overrides.getBlockByNumberNoCache;
    if (handler !== undefined) {
      return handler(blockNumber, verbosity, withCycles);
    }
    throw notScripted("getBlockByNumberNoCache");
  }

  /** Blocks are not modeled; rejects unless overridden. */
  public override async getBlockByHashNoCache(
    blockHash: ccc.HexLike,
    verbosity?: number | null,
    withCycles?: boolean | null,
  ): Promise<ccc.ClientBlock | undefined> {
    const handler = this.overrides.getBlockByHashNoCache;
    if (handler !== undefined) {
      return handler(blockHash, verbosity, withCycles);
    }
    throw notScripted("getBlockByHashNoCache");
  }

  /** Serves registered headers by number; unknown numbers resolve undefined. */
  public override async getHeaderByNumberNoCache(
    blockNumber: ccc.NumLike,
    verbosity?: number | null,
  ): Promise<ccc.ClientBlockHeader | undefined> {
    const handler = this.overrides.getHeaderByNumberNoCache;
    if (handler !== undefined) {
      return handler(blockNumber, verbosity);
    }
    return this.chainState.getHeaderByNumber(blockNumber);
  }

  /** Serves registered headers by hash; unknown hashes resolve undefined. */
  public override async getHeaderByHashNoCache(
    blockHash: ccc.HexLike,
    verbosity?: number | null,
  ): Promise<ccc.ClientBlockHeader | undefined> {
    const handler = this.overrides.getHeaderByHashNoCache;
    if (handler !== undefined) {
      return handler(blockHash, verbosity);
    }
    return this.chainState.getHeaderByHash(blockHash);
  }

  /** Serves the configured cycles value. */
  public override async estimateCycles(
    transaction: ccc.TransactionLike,
  ): Promise<ccc.Num> {
    const handler = this.overrides.estimateCycles;
    if (handler !== undefined) {
      return handler(transaction);
    }
    return this.chainState.getCycles();
  }

  /** Serves the configured cycles value without recording the transaction. */
  public override async sendTransactionDry(
    transaction: ccc.TransactionLike,
    validator?: ccc.OutputsValidator,
  ): Promise<ccc.Num> {
    const handler = this.overrides.sendTransactionDry;
    if (handler !== undefined) {
      return handler(transaction, validator);
    }
    return this.chainState.getCycles();
  }

  /** Applies the send to the chain state under the configured status. */
  public override async sendTransactionNoCache(
    transaction: ccc.TransactionLike,
    validator?: ccc.OutputsValidator,
  ): Promise<ccc.Hex> {
    const handler = this.overrides.sendTransactionNoCache;
    if (handler !== undefined) {
      return handler(transaction, validator);
    }
    return this.chainState.applySend(transaction);
  }

  /** Serves registered transactions; unknown hashes resolve undefined. */
  public override async getTransactionNoCache(
    txHash: ccc.HexLike,
  ): Promise<ccc.ClientTransactionResponse | undefined> {
    const handler = this.overrides.getTransactionNoCache;
    if (handler !== undefined) {
      return handler(txHash);
    }
    return this.chainState.getTransaction(txHash);
  }

  /** Serves live chain-state cells; spent or unknown cells resolve undefined. */
  public override async getCellLiveNoCache(
    outPointLike: ccc.OutPointLike,
    withData?: boolean | null,
    includeTxPool?: boolean | null,
  ): Promise<ccc.Cell | undefined> {
    const handler = this.overrides.getCellLiveNoCache;
    if (handler !== undefined) {
      return handler(outPointLike, withData, includeTxPool);
    }
    const cell = this.chainState.getLiveCell(outPointLike);
    if (cell === undefined || (withData ?? true)) {
      return cell;
    }
    return cellWithoutData(cell);
  }

  /**
   * Pages matching live cells with a monotonically advancing decimal cursor,
   * honoring cursor-progress guards: a full page always returns a cursor
   * strictly beyond every previously returned one.
   */
  public override async findCellsPagedNoCache(
    key: ccc.ClientIndexerSearchKeyLike,
    order?: "asc" | "desc",
    limit?: ccc.NumLike,
    after?: string,
  ): Promise<ccc.ClientFindCellsResponse> {
    const handler = this.overrides.findCellsPagedNoCache;
    if (handler !== undefined) {
      return handler(key, order, limit, after);
    }
    const matches = this.chainState.matchLiveCells(key, order ?? "asc");
    const offset = parseCursor(after);
    const cells = matches.slice(offset, offset + Number(ccc.numFrom(limit ?? 10)));
    return { cells, lastCursor: String(offset + cells.length) };
  }

  /** Transaction indexing is not modeled; rejects unless overridden. */
  public override findTransactionsPaged(
    key: Omit<ccc.ClientIndexerSearchKeyTransactionLike, "groupByTransaction"> & {
      groupByTransaction: true;
    },
    order?: "asc" | "desc",
    limit?: ccc.NumLike,
    after?: string,
  ): Promise<ccc.ClientFindTransactionsGroupedResponse>;
  public override findTransactionsPaged(
    key: Omit<ccc.ClientIndexerSearchKeyTransactionLike, "groupByTransaction"> & {
      groupByTransaction?: false | null;
    },
    order?: "asc" | "desc",
    limit?: ccc.NumLike,
    after?: string,
  ): Promise<ccc.ClientFindTransactionsResponse>;
  public override findTransactionsPaged(
    key: ccc.ClientIndexerSearchKeyTransactionLike,
    order?: "asc" | "desc",
    limit?: ccc.NumLike,
    after?: string,
  ): Promise<
    ccc.ClientFindTransactionsResponse | ccc.ClientFindTransactionsGroupedResponse
  >;
  public override async findTransactionsPaged(
    key: ccc.ClientIndexerSearchKeyTransactionLike,
    order?: "asc" | "desc",
    limit?: ccc.NumLike,
    after?: string,
  ): Promise<
    ccc.ClientFindTransactionsResponse | ccc.ClientFindTransactionsGroupedResponse
  > {
    const handler = this.overrides.findTransactionsPaged;
    if (handler !== undefined) {
      return handler(key, order, limit, after);
    }
    throw notScripted("findTransactionsPaged");
  }

  /** Sums the capacities of matching live chain-state cells. */
  public override async getCellsCapacity(
    key: ccc.ClientIndexerSearchKeyLike,
  ): Promise<ccc.Num> {
    const handler = this.overrides.getCellsCapacity;
    if (handler !== undefined) {
      return handler(key);
    }
    let total = 0n;
    for (const cell of this.chainState.matchLiveCells(key, "asc")) {
      total += cell.cellOutput.capacity;
    }
    return total;
  }

  /**
   * Resolves cells through the real cache and transaction path first, then
   * falls back to chain-state cells (live or spent) so declaratively added
   * cells resolve for input completion and fee computation.
   */
  public override async getCell(
    outPointLike: ccc.OutPointLike,
  ): Promise<ccc.Cell | undefined> {
    const resolved = await super.getCell(outPointLike);
    if (resolved !== undefined) {
      return resolved;
    }
    const cell = this.chainState.getCell(outPointLike);
    if (cell !== undefined) {
      await this.cache.recordCells(cell);
    }
    return cell;
  }

  private tipHeaderOrThrow(member: string): ccc.ClientBlockHeader {
    const header = this.chainState.getTipHeader();
    if (header === undefined) {
      throw notScripted(member);
    }
    return header;
  }
}

function notScripted(member: string): FakeClientError {
  return new FakeClientError(`${member} is not scripted`);
}

function parseCursor(after: string | undefined): number {
  if (after === undefined) {
    return 0;
  }
  const offset = Number(after);
  if (!/^\d+$/.test(after) || !Number.isSafeInteger(offset)) {
    throw new FakeClientError(`findCellsPagedNoCache received unknown cursor "${after}"`);
  }
  return offset;
}
