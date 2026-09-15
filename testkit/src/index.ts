/**
 * Shared test fixtures for iCKB Stack packages.
 *
 * @packageDocumentation
 */

import { ccc } from "@ckb-ccc/core";
import { byte32FromByte } from "./bytes.ts";

export { byte32FromByte } from "./bytes.ts";
export { ChainState, chainState } from "./chain_state.ts";
export {
  AR_0,
  ckbMinMatchFromLog,
  depositToIckb,
  ICKB_SOFT_CAP,
  validateMatch,
  type OracleInfo,
  type OracleRatio,
  type OracleVerdict,
  type OrderState,
} from "./contract_oracle.ts";
export { FakeClient, FakeClientError, type FakeClientOverrides } from "./fake_client.ts";
export { FakeCkbSigner } from "./fake_signer.ts";

type ClientMethod<K extends keyof ccc.Client> = Extract<
  ccc.Client[K],
  (...args: never[]) => unknown
>;

interface StubClientHandlers {
  addressPrefix?: string;
  cache?: ccc.Client["cache"];
  findCellsOnChain?: ClientMethod<"findCellsOnChain">;
  findCellsPagedNoCache?: ClientMethod<"findCellsPagedNoCache">;
  getCell?: ClientMethod<"getCell">;
  getHeaderByNumber?: ClientMethod<"getHeaderByNumber">;
  getTipHeader?: ClientMethod<"getTipHeader">;
  getTransaction?: ClientMethod<"getTransaction">;
  getTransactionWithHeader?: ClientMethod<"getTransactionWithHeader">;
  sendTransactionDry?: ClientMethod<"sendTransactionDry">;
}

export interface TransactionWithHeader {
  transaction: ccc.ClientTransactionResponse;
  header: ccc.ClientBlockHeader;
}

/**
 * CCC client test double with per-method handler overrides.
 *
 * @remarks
 * Unspecified methods fall back to `ClientPublicTestnet`, whose URL is an
 * invalid host. Tests should override every method expected to cross the RPC
 * boundary.
 */
/** A transport that rejects every request: for clients a test never lets reach the network. */
export function offlineTransport(): ccc.JsonRpcTransport {
  return {
    request: async (payload): Promise<ccc.JsonRpcResponse> => {
      await Promise.resolve();
      throw new Error(`Offline test client received ${payload.method}`);
    },
  };
}

/**
 * Answers the SDK's status-only `get_transaction` from the stub's `getTransactionWithHeader`
 * handler and remembers the header for the follow-up lookup by number, so a test stubs one
 * typed method, not the wire; everything else is offline.
 */
function stubTransport(
  raw: { client?: StubClient },
  headers: Map<bigint, ccc.ClientBlockHeader>,
): ccc.JsonRpcTransport {
  return {
    request: async (payload): Promise<ccc.JsonRpcResponse> => {
      const txHash = Array.isArray(payload.params) ? payload.params[0] : undefined;
      if (
        raw.client === undefined ||
        payload.method !== "get_transaction" ||
        typeof txHash !== "string"
      ) {
        return offlineTransport().request(payload);
      }
      const header = (await raw.client.getTransactionWithHeader(txHash))?.header;
      if (header !== undefined) {
        headers.set(header.number, header);
      }
      return {
        id: payload.id,
        jsonrpc: "2.0",
        result: {
          transaction: null,
          tx_status:
            header === undefined
              ? { status: "unknown" }
              : { status: "committed", block_number: ccc.numToHex(header.number) },
        },
      };
    },
  };
}

/** A testnet client on the offline transport. */
export function offlineTestnetClient(): ccc.ClientPublicTestnet {
  return ccc.ClientPublicTestnet.new({ transport: offlineTransport() });
}

export class StubClient extends ccc.ClientPublicTestnet {
  private readonly handlers: StubClientHandlers;
  private readonly rememberedHeaders: Map<bigint, ccc.ClientBlockHeader>;
  private readonly findCellsOnChainHandler: ClientMethod<"findCellsOnChain">;
  private readonly legacyCellScanHandler: ClientMethod<"findCellsOnChain"> | undefined;
  private readonly getCellHandler: ClientMethod<"getCell">;
  private readonly getHeaderByNumberHandler: ClientMethod<"getHeaderByNumber">;
  private readonly getTransactionHandler: ClientMethod<"getTransaction">;
  private readonly getTransactionWithHeaderHandler: ClientMethod<"getTransactionWithHeader">;
  declare public findCellsPagedNoCache: ClientMethod<"findCellsPagedNoCache">;
  declare public getTipHeader: ClientMethod<"getTipHeader">;
  declare public sendTransactionDry: ClientMethod<"sendTransactionDry">;

  /**
   * Creates a stub client using the supplied method overrides.
   */
  constructor(handlers: StubClientHandlers = {}) {
    // The SDK reads a transaction's header through two raw calls on a JSON-RPC client; the
    // stub answers them from its own handlers so a test stubs one method, not the wire.
    const raw: { client?: StubClient } = {};
    const rememberedHeaders = new Map<bigint, ccc.ClientBlockHeader>();
    // A subclass has no factory, so the deprecated constructor is the only super call; the
    // offline transport keeps every unstubbed method off the network.
    // eslint-disable-next-line sonarjs/deprecation, @typescript-eslint/no-deprecated -- No non-deprecated constructor exists for a subclass.
    super({
      requestor: ccc.RequestorJsonRpc.new({
        transport: stubTransport(raw, rememberedHeaders),
      }),
    });
    raw.client = this;
    this.rememberedHeaders = rememberedHeaders;
    const baseFindCellsPagedNoCache = this.findCellsPagedNoCache.bind(this);
    this.handlers = handlers;
    if (handlers.cache !== undefined) {
      this.cache = handlers.cache;
    }
    this.findCellsOnChainHandler =
      handlers.findCellsOnChain ?? super.findCellsOnChain.bind(this);
    this.legacyCellScanHandler = handlers.findCellsOnChain;
    const findCellsPagedNoCache =
      handlers.findCellsPagedNoCache ??
      (this.legacyCellScanHandler === undefined
        ? baseFindCellsPagedNoCache
        : this.findCellsPaged.bind(this));
    this.findCellsPagedNoCache = async (
      ...args
    ): ReturnType<ClientMethod<"findCellsPagedNoCache">> =>
      findCellsPagedNoCache(...args);
    this.getCellHandler = handlers.getCell ?? super.getCell.bind(this);
    this.getHeaderByNumberHandler =
      handlers.getHeaderByNumber ?? super.getHeaderByNumber.bind(this);
    this.getTransactionHandler =
      handlers.getTransaction ?? super.getTransaction.bind(this);
    this.getTransactionWithHeaderHandler =
      handlers.getTransactionWithHeader ?? super.getTransactionWithHeader.bind(this);
    if (handlers.getTipHeader !== undefined) {
      this.getTipHeader = handlers.getTipHeader;
    }
    if (handlers.sendTransactionDry !== undefined) {
      this.sendTransactionDry = handlers.sendTransactionDry;
    }
  }

  /** Address prefix override used by address formatting tests. */
  public override get addressPrefix(): string {
    return this.handlers.addressPrefix ?? super.addressPrefix;
  }

  /** Delegates on-chain cell scans to the configured handler or the base client. */
  public override findCellsOnChain(
    ...args: Parameters<ClientMethod<"findCellsOnChain">>
  ): ReturnType<ClientMethod<"findCellsOnChain">> {
    return this.findCellsOnChainHandler(...args);
  }

  /** Delegates page scans or adapts a configured generator scan for existing fixtures. */
  public override async findCellsPaged(
    ...args: Parameters<ClientMethod<"findCellsPaged">>
  ): ReturnType<ClientMethod<"findCellsPaged">> {
    if (this.legacyCellScanHandler === undefined) {
      // A test double must never fall through to the real network.
      throw new Error("StubClient has no cell scan handler");
    }

    const [key, order, limit = 10, after] = args;
    const pageSize = Number(ccc.numFrom(limit));
    const offset = after === undefined ? 0 : Number(after.slice("stub:".length));
    const allCells: ccc.Cell[] = [];
    for await (const cell of this.legacyCellScanHandler(key, order, pageSize)) {
      allCells.push(cell);
    }
    const cells = allCells.slice(offset, offset + pageSize);
    return { cells, lastCursor: `stub:${String(offset + cells.length)}` };
  }

  /** Delegates single-cell lookup to the configured handler or the base client. */
  public override async getCell(
    ...args: Parameters<ClientMethod<"getCell">>
  ): ReturnType<ClientMethod<"getCell">> {
    return this.getCellHandler(...args);
  }

  /**
   * Serves the header a stubbed transaction lookup already produced, so the SDK's follow-up
   * by number lands on that header even when a test stubs the lookup with one fixed answer;
   * otherwise delegates to the configured handler or the base client.
   */
  public override async getHeaderByNumber(
    ...args: Parameters<ClientMethod<"getHeaderByNumber">>
  ): ReturnType<ClientMethod<"getHeaderByNumber">> {
    return (
      this.rememberedHeaders.get(ccc.numFrom(args[0])) ??
      this.getHeaderByNumberHandler(...args)
    );
  }

  /** Delegates transaction lookup to the configured handler or the base client. */
  public override async getTransaction(
    ...args: Parameters<ClientMethod<"getTransaction">>
  ): ReturnType<ClientMethod<"getTransaction">> {
    return this.getTransactionHandler(...args);
  }

  /** Delegates transaction-with-header lookup to the configured handler or the base client. */
  public override async getTransactionWithHeader(
    ...args: Parameters<ClientMethod<"getTransactionWithHeader">>
  ): ReturnType<ClientMethod<"getTransactionWithHeader">> {
    return this.getTransactionWithHeaderHandler(...args);
  }
}

/**
 * Creates a type-hash script whose code hash is a repeated byte.
 *
 * @param codeHashByte - Two hex characters repeated to form the 32-byte code hash.
 * @param args - Script args hex string.
 */
export function script(codeHashByte: string, args = "0x"): ccc.Script {
  return ccc.Script.from({
    codeHash: byte32FromByte(codeHashByte),
    hashType: "type",
    args,
  });
}

/**
 * Creates an out point whose transaction hash is a repeated byte.
 *
 * @param txHashByte - Two hex characters repeated to form the 32-byte tx hash.
 * @param index - Output index for the out point.
 */
export function outPoint(txHashByte: string, index = 0n): ccc.OutPoint {
  return ccc.OutPoint.from({
    txHash: byte32FromByte(txHashByte),
    index,
  });
}

/**
 * Creates a live-cell-shaped capacity cell fixture with empty data.
 *
 * @param capacity - Cell capacity in shannons.
 * @param lock - Lock script assigned to the cell output.
 * @param txHashByte - Two hex characters repeated to form the out point tx hash.
 */
export function capacityCell(
  capacity: bigint,
  lock: ccc.Script,
  txHashByte: string,
): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(txHashByte), index: 0n },
    cellOutput: { capacity, lock },
    outputData: "0x",
  });
}

/**
 * Async form of {@link passthroughTransaction} for client handler tests.
 */
export async function asyncPassthroughTransaction(
  txLike: ccc.TransactionLike,
): Promise<ccc.Transaction> {
  await Promise.resolve();
  return passthroughTransaction(txLike);
}

/**
 * Normalizes a transaction-like value into a CCC transaction.
 */
export function passthroughTransaction(txLike: ccc.TransactionLike): ccc.Transaction {
  return ccc.Transaction.from(txLike);
}

/**
 * Creates a committed transaction response fixture.
 */
export function committedTransactionResponse(
  transaction: ccc.TransactionLike,
  overrides: Partial<
    Omit<ccc.ClientTransactionResponseLike, "transaction" | "status">
  > = {},
): ccc.ClientTransactionResponse {
  return ccc.ClientTransactionResponse.from({
    transaction,
    status: "committed",
    ...overrides,
  });
}

/**
 * Creates a transaction-with-header response using a default committed transaction.
 */
export function transactionWithHeader(
  header: ccc.ClientBlockHeader,
): TransactionWithHeader {
  return {
    transaction: committedTransactionResponse(ccc.Transaction.default()),
    header,
  };
}

/**
 * Creates a block-header fixture with deterministic defaults.
 *
 * @param overrides - Header fields to replace after defaults are applied.
 */
export function headerLike(
  overrides: Partial<ccc.ClientBlockHeaderLike> = {},
): ccc.ClientBlockHeader {
  return ccc.ClientBlockHeader.from({
    compactTarget: 0n,
    dao: { c: 0n, ar: 1000n, s: 0n, u: 0n },
    epoch: [181n, 0n, 1n],
    extraHash: byte32FromByte("aa"),
    hash: byte32FromByte("bb"),
    nonce: 0n,
    number: 3n,
    parentHash: byte32FromByte("cc"),
    proposalsHash: byte32FromByte("dd"),
    timestamp: 0n,
    transactionsRoot: byte32FromByte("ee"),
    version: 0n,
    ...overrides,
  });
}
