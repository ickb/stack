import { ccc } from "@ckb-ccc/core";

/**
 * Wraps `inner` into a client that checks every header it hands out against the
 * header's own hash, a header read by number or by hash against what was asked for, a
 * transaction read by hash against the hash of its body, and refuses a tip that trails
 * the local clock by more than `tipMaxAgeMs` when one is given.
 *
 * @remarks The check sits on the client rather than in the SDK's readers because CCC's
 * own completion values a withdrawal's interest from headers it reads through the
 * client it is given. The header beside a transaction or a cell is pinned only to the
 * block the node names, so what a transaction is valued at is settled at the send
 * boundary against its header deps. CCC parses headers but has no codec for them, so
 * the encoding is here.
 */
export function verifiedClient(inner: ccc.Client, tipMaxAgeMs?: number): ccc.Client {
  return new VerifiedClient(inner, tipMaxAgeMs);
}

// @ts-expect-error TS2655: the abstract members are forwarded by the proxy at runtime, as in CCC's own connector.
class VerifiedClient extends ccc.Proxy.Base(ccc.Client) {
  public static readonly [ccc.Proxy.localKeys] = ["tipMaxAgeMs"];

  /** How far the tip may trail the local clock, in ms; absent, any age passes. */
  public readonly tipMaxAgeMs: number | undefined;

  /** Wraps `inner`, bounding the tip's age when `tipMaxAgeMs` is given. */
  constructor(inner: ccc.Client, tipMaxAgeMs?: number) {
    super(inner);
    this.tipMaxAgeMs = tipMaxAgeMs;
  }

  public override async getTipHeader(): Promise<ccc.ClientBlockHeader> {
    const tip = verified(await this[ccc.Proxy.inner].getTipHeader());
    if (
      this.tipMaxAgeMs !== undefined &&
      BigInt(Date.now()) - tip.timestamp > BigInt(this.tipMaxAgeMs)
    ) {
      throw new Error(`Tip ${tip.hash} is more than ${String(this.tipMaxAgeMs)} ms old`);
    }
    return tip;
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

  public override async getHeaderByHash(
    ...args: Parameters<ccc.Client["getHeaderByHash"]>
  ): Promise<ccc.ClientBlockHeader | undefined> {
    const header = ccc.apply(
      verified,
      await this[ccc.Proxy.inner].getHeaderByHash(...args),
    );
    if (header !== undefined && header.hash !== ccc.hexFrom(args[0])) {
      throw new Error(`Header ${header.hash} answers for ${ccc.hexFrom(args[0])}`);
    }
    return header;
  }

  public override async getTransaction(
    ...args: Parameters<ccc.Client["getTransaction"]>
  ): ReturnType<ccc.Client["getTransaction"]> {
    return verifiedBody(await this[ccc.Proxy.inner].getTransaction(...args), args[0]);
  }

  public override async getTransactionNoCache(
    ...args: Parameters<ccc.Client["getTransactionNoCache"]>
  ): ReturnType<ccc.Client["getTransactionNoCache"]> {
    return verifiedBody(
      await this[ccc.Proxy.inner].getTransactionNoCache(...args),
      args[0],
    );
  }

  public override async getTransactionWithHeader(
    ...args: Parameters<ccc.Client["getTransactionWithHeader"]>
  ): ReturnType<ccc.Client["getTransactionWithHeader"]> {
    const result = await this[ccc.Proxy.inner].getTransactionWithHeader(...args);
    ccc.apply(verified, result?.header);
    return result;
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
function headerHash(header: ccc.ClientBlockHeader): ccc.Hex {
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
