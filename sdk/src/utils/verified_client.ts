import { ccc } from "@ckb-ccc/core";

/**
 * Wraps `inner` into a client that checks the reads the SDK makes: every header it hands
 * out against the header's own hash, a header read by number against the number asked
 * for, a transaction read by hash against the hash of its body, and a cell against the
 * body of its creating transaction. Other reads pass through unchecked; the cell
 * beside `getCellWithHeader`'s header is one, since the SDK reads only its header.
 *
 * @remarks It wraps the client, not the SDK's readers, because CCC's own DAO valuation
 * (`Cell.getNervosDaoInfo`, in the send) reads headers through the client it is given.
 * Why each check exists: SDK README, Account state.
 */
export function verifiedClient(inner: ccc.Client): ccc.Client {
  return new VerifiedClient(inner);
}

// @ts-expect-error TS2655: the abstract members are forwarded by the proxy at runtime, as in CCC's own connector.
class VerifiedClient extends ccc.Proxy.Base(ccc.Client) {
  public static readonly [ccc.Proxy.localKeys] = ["bodies"];

  /** Creating transactions `getCell` read, so concurrent reads of one share a request. */
  private readonly bodies = new Map<
    ccc.Hex,
    Promise<ccc.ClientTransactionResponse | undefined>
  >();

  public override async getTipHeader(): Promise<ccc.ClientBlockHeader> {
    return verified(await this[ccc.Proxy.inner].getTipHeader());
  }

  public override async getHeaderByNumber(
    ...args: Parameters<ccc.Client["getHeaderByNumber"]>
  ): Promise<ccc.ClientBlockHeader | undefined> {
    const header = ccc.apply(
      verified,
      await this[ccc.Proxy.inner].getHeaderByNumber(...args),
    );
    const number = ccc.numFrom(args[0]);
    if (header !== undefined && header.number !== number) {
      throw new Error(`Header ${header.hash} answers for block ${number.toString()}`);
    }
    return header;
  }

  public override async getTransaction(
    ...args: Parameters<ccc.Client["getTransaction"]>
  ): ReturnType<ccc.Client["getTransaction"]> {
    return verifiedBody(await this[ccc.Proxy.inner].getTransaction(...args), args[0]);
  }

  /**
   * The output of the verified creating transaction, cache first: CCC keys cached
   * transactions by their body's hash, and its own `getCell` would build the cell from a
   * read this wrapper never sees, then cache it.
   */
  public override async getCell(
    ...args: Parameters<ccc.Client["getCell"]>
  ): ReturnType<ccc.Client["getCell"]> {
    const outPoint = ccc.OutPoint.from(args[0]);
    const { txHash } = outPoint;
    let body = this.bodies.get(txHash);
    if (body === undefined) {
      body = this.readBody(txHash);
      this.bodies.set(txHash, body);
    }
    const output = (await body)?.transaction.getOutput(outPoint.index);
    return output === undefined
      ? undefined
      : ccc.Cell.from({
          outPoint,
          cellOutput: output.cellOutput,
          outputData: output.outputData,
        });
  }

  private async readBody(
    txHash: ccc.Hex,
  ): Promise<ccc.ClientTransactionResponse | undefined> {
    // CCC's own cache keys bodies by their hash, but a consumer's cache need not.
    return (
      verifiedBody(await this.cache.getTransactionResponse(txHash), txHash) ??
      (await this.getTransaction(txHash))
    );
  }

  public override async getCellWithHeader(
    ...args: Parameters<ccc.Client["getCellWithHeader"]>
  ): ReturnType<ccc.Client["getCellWithHeader"]> {
    const result = await this[ccc.Proxy.inner].getCellWithHeader(...args);
    ccc.apply(verified, result?.header);
    return result;
  }
}

/** The response when its body hashes to the hash asked for, else throws. */
function verifiedBody(
  response: ccc.ClientTransactionResponse | undefined,
  txHash: ccc.HexLike,
): ccc.ClientTransactionResponse | undefined {
  const asked = ccc.hexFrom(txHash);
  if (response !== undefined && response.transaction.hash() !== asked) {
    throw new Error(`Transaction ${asked} was answered with a body of another hash`);
  }
  return response;
}

/** The header when its fields hash to the hash it carries, else throws. */
function verified(header: ccc.ClientBlockHeader): ccc.ClientBlockHeader {
  const computed = headerHash(header);
  if (computed !== header.hash) {
    throw new Error(`Header ${header.hash} carries the fields of ${computed}`);
  }
  return header;
}

/**
 * The hash of a header as the chain computes it: blake2b over the header struct, each
 * number little-endian, in declaration order, the nonce last.
 */
export function headerHash(header: ccc.ClientBlockHeader): ccc.Hex {
  const { dao } = header;
  return ccc.hashCkb(
    ccc.numLeToBytes(header.version, 4),
    ccc.numLeToBytes(header.compactTarget, 4),
    ccc.numLeToBytes(header.timestamp, 8),
    ccc.numLeToBytes(header.number, 8),
    ccc.numLeToBytes(header.epoch.toNum(), 8),
    header.parentHash,
    header.transactionsRoot,
    header.proposalsHash,
    header.extraHash,
    ...[dao.c, dao.ar, dao.s, dao.u].map((field) => ccc.numLeToBytes(field, 8)),
    ccc.numLeToBytes(header.nonce, 16),
  );
}
