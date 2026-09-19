/**
 * Shared test fixtures for iCKB Stack packages.
 *
 * @packageDocumentation
 */

import { ccc } from "@ckb-ccc/core";

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
export { FakeCkbSigner } from "./fake_signer.ts";

export type ClientMethod<K extends keyof ccc.Client> = Extract<
  ccc.Client[K],
  (...args: never[]) => unknown
>;

/** The client methods a test may script; every other call stays off the network. */
export interface StubClientHandlers {
  addressPrefix?: string;
  cache?: ccc.Client["cache"];
  findCellsPagedNoCache?: ClientMethod<"findCellsPagedNoCache">;
  getCell?: ClientMethod<"getCell">;
  getHeaderByNumber?: ClientMethod<"getHeaderByNumber">;
  getTipHeader?: ClientMethod<"getTipHeader">;
  getTransaction?: ClientMethod<"getTransaction">;
  getTransactionNoCache?: ClientMethod<"getTransactionNoCache">;
  getTransactionWithHeader?: ClientMethod<"getTransactionWithHeader">;
  sendTransactionDry?: ClientMethod<"sendTransactionDry">;
}

/**
 * Creates a 32-byte hex string by repeating one byte.
 *
 * @param hexByte - Exactly two hex characters.
 */
export function byte32FromByte(hexByte: string): `0x${string}` {
  if (!/^[0-9a-f]{2}$/iu.test(hexByte)) {
    throw new Error("Expected exactly one byte as two hex chars");
  }

  return `0x${hexByte.repeat(32)}`;
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
  private readonly prefix: string | undefined;
  private readonly rememberedHeaders: Map<bigint, ccc.ClientBlockHeader>;
  private readonly headerByNumber: ClientMethod<"getHeaderByNumber"> | undefined;

  /**
   * Creates a stub client using the supplied method overrides. Each handler becomes the
   * instance's own method, ahead of the class's, so an unscripted method still runs CCC's
   * real code down to the offline transport.
   */
  constructor({
    addressPrefix,
    cache,
    getHeaderByNumber,
    ...handlers
  }: StubClientHandlers = {}) {
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
    this.prefix = addressPrefix;
    this.headerByNumber = getHeaderByNumber;
    if (cache !== undefined) {
      this.cache = cache;
    }
    Object.assign(this, handlers);
  }

  /** Address prefix override used by address formatting tests. */
  public override get addressPrefix(): string {
    return this.prefix ?? super.addressPrefix;
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
      (this.headerByNumber ?? super.getHeaderByNumber.bind(this))(...args)
    );
  }
}

/**
 * A page handler over a cell list, sliced the way the SDK's `findCells` reads it: the
 * cursor is the count served so far and a short page ends the scan. A function picks the
 * list per search key.
 */
export function pagedCells(
  cells:
    readonly ccc.Cell[] | ((key: ccc.ClientIndexerSearchKeyLike) => readonly ccc.Cell[]),
): ClientMethod<"findCellsPagedNoCache"> {
  return async (key, _order, limit, after) => {
    await Promise.resolve();
    const all = typeof cells === "function" ? cells(key) : cells;
    const offset = after === undefined ? 0 : Number(after);
    const page = all.slice(offset, offset + Number(ccc.numFrom(limit ?? 10)));
    return { cells: [...page], lastCursor: String(offset + page.length) };
  };
}

// @ts-expect-error TS2655: the abstract members are forwarded by the Proxy at runtime, as in the connector.
class ComposedClient extends ccc.Proxy.Base(ccc.Client) {}

/**
 * The client the connector hands the interface: a composition proxy over the public
 * client (`ClientWithFeeRate`), an instance of `ccc.Client` but not of `ccc.ClientJsonRpc`,
 * so the SDK takes its typed read paths. Tests reach those paths through this.
 */
export function composedClient(inner: ccc.Client): ccc.Client {
  return new ComposedClient(inner);
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
