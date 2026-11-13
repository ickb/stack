import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { BOT_TURN_MS, maturity } from "../../src/conversion/maturity.ts";
import { Info } from "../../src/order/info.ts";
import { ICKB_DEPOSIT_CAP } from "../../src/udt.ts";
import { projectionReadyDeposit } from "../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import {
  headerLike,
  ratio,
  state,
} from "../transaction/base/support/sdk_core_support.ts";
import {
  DOUBLE_PRICE,
  fillableBuyer,
  HALF_PRICE,
  sittingSeller,
} from "./support/estimate_support.ts";

const CAP = ICKB_DEPOSIT_CAP;
const tip = headerLike(1n, { timestamp: 100n });
const seller = (udtValue: bigint): Parameters<typeof maturity>[0] => ({
  info: Info.create(false, ratio),
  amounts: { ckbValue: 0n, udtValue },
});
const buyer = (ckbValue: bigint): Parameters<typeof maturity>[0] => ({
  info: Info.create(true, ratio),
  amounts: { ckbValue, udtValue: 0n },
});

describe("maturity", () => {
  it("returns zero for fulfilled orders", () => {
    expect(maturity(seller(0n), state())).toBe(0n);
    expect(maturity(buyer(0n), state())).toBe(0n);
  });
});

describe("maturity of a seller", () => {
  it("counts the bot's one deposit of CKB as ready now, then the pool's last claim date", () => {
    expect(maturity(seller(CAP), state({ tip }))).toBe(100n + BOT_TURN_MS);
    // Above par, past the whole pool: the last claim date, here the tip itself.
    expect(maturity(seller(CAP + 1n), state({ tip }))).toBe(100n + BOT_TURN_MS);
  });

  it("adds the pool deposits at their real claim dates, in claim order", () => {
    const sampled = state({
      tip,
      poolDeposits: [
        projectionReadyDeposit(CAP, 5000n, { id: "44", isReady: false }),
        projectionReadyDeposit(CAP, 3000n, { id: "45" }),
      ],
    });

    expect(maturity(seller(CAP), sampled)).toBe(100n + BOT_TURN_MS);
    expect(maturity(seller(CAP + 1n), sampled)).toBe(3000n + BOT_TURN_MS);
    expect(maturity(seller(2n * CAP + 1n), sampled)).toBe(5000n + BOT_TURN_MS);
    expect(maturity(seller(3n * CAP + 1n), sampled)).toBe(5000n + BOT_TURN_MS);
  });

  it("leaves out the deposits the same plan withdraws directly", () => {
    const taken = projectionReadyDeposit(CAP, 3000n, { id: "45" });
    const sampled = state({
      tip,
      poolDeposits: [taken, projectionReadyDeposit(CAP, 5000n, { id: "44" })],
    });

    expect(maturity(seller(CAP + 1n), sampled, [taken])).toBe(5000n + BOT_TURN_MS);
  });

  it("owes the remaining iCKB at its price whatever CKB earlier fills already paid in", () => {
    const halfFilled: Parameters<typeof maturity>[0] = {
      info: Info.create(false, ratio),
      amounts: { ckbValue: CAP, udtValue: CAP + 1n },
    };
    const deposit = projectionReadyDeposit(1n, 3000n);
    expect(maturity(halfFilled, state({ tip, poolDeposits: [deposit] }))).toBe(
      3000n + BOT_TURN_MS,
    );
    // A cap asked at twice the DAO price needs two caps of CKB: the bot's and a claim.
    const dear: Parameters<typeof maturity>[0] = {
      info: Info.create(false, DOUBLE_PRICE),
      amounts: { ckbValue: 0n, udtValue: CAP },
    };
    const capDeposit = projectionReadyDeposit(CAP, 3000n);
    expect(maturity(dear, state({ tip, poolDeposits: [capDeposit] }))).toBe(
      3000n + BOT_TURN_MS,
    );
  });

  it("gives the bot no CKB while a fillable seller has sat on the book for over a turn", () => {
    // This order asks a quarter of the DAO price, so the sitting seller at half is not ahead.
    const cheap: Parameters<typeof maturity>[0] = {
      info: Info.create(false, { ckbScale: 4n, udtScale: 1n }),
      amounts: { ckbValue: 0n, udtValue: 4n },
    };
    const deposit = projectionReadyDeposit(CAP, 3000n);
    // Block 0 under a tip at block 1 in a one-block epoch: over an eighth of an epoch.
    expect(
      maturity(
        cheap,
        state({ tip, orderBook: [sittingSeller(0n)], poolDeposits: [deposit] }),
      ),
    ).toBe(3000n + BOT_TURN_MS);

    // Uncommitted, or committed within the turn, or too small for the bot to take: fresh.
    for (const pool of [
      [sittingSeller(undefined)],
      [sittingSeller(1n)],
      [sittingSeller(0n, { ckbScale: 2n, udtScale: 1n }, 10n)],
    ]) {
      expect(maturity(cheap, state({ tip, orderBook: pool }))).toBe(100n + BOT_TURN_MS);
    }
    // An eighth of an 1800-block epoch is 225 blocks: fresh at 225, sitting at 226.
    const atEighth = (number: bigint): ccc.ClientBlockHeader =>
      headerLike(number, { timestamp: 100n, epoch: ccc.Epoch.from([1n, 0n, 1800n]) });
    expect(
      maturity(cheap, state({ tip: atEighth(225n), orderBook: [sittingSeller(0n)] })),
    ).toBe(100n + BOT_TURN_MS);
    expect(
      maturity(
        cheap,
        state({
          tip: atEighth(226n),
          orderBook: [sittingSeller(0n)],
          poolDeposits: [deposit],
        }),
      ),
    ).toBe(3000n + BOT_TURN_MS);
  });

  it("queues behind fillable sellers asking at most its CKB per iCKB, valued at the DAO ratio", () => {
    // This order asks half the DAO price: a quarter or a half is ahead, three quarters is not.
    const half: Parameters<typeof maturity>[0] = {
      info: Info.create(false, HALF_PRICE),
      amounts: { ckbValue: 0n, udtValue: 2n },
    };
    const cheaper = sittingSeller(1n, { ckbScale: 4n, udtScale: 1n }, CAP);
    const same = sittingSeller(1n, HALF_PRICE, CAP);
    const dearer = sittingSeller(1n, { ckbScale: 4n, udtScale: 3n }, CAP);
    const deposit = projectionReadyDeposit(CAP, 3000n);

    for (const ahead of [cheaper, same]) {
      expect(
        maturity(half, state({ tip, orderBook: [ahead], poolDeposits: [deposit] })),
      ).toBe(3000n + BOT_TURN_MS);
    }
    expect(
      maturity(half, state({ tip, orderBook: [dearer], poolDeposits: [deposit] })),
    ).toBe(100n + BOT_TURN_MS);
  });

  it("leaves its own book order out of the queue ahead", () => {
    const own = sittingSeller(1n, HALF_PRICE, CAP);
    const other = sittingSeller(1n, HALF_PRICE, CAP / 2n);
    // Fixture groups share one master; the other seller needs its own.
    other.master.cell.outPoint = ccc.OutPoint.from({
      txHash: `0x${"78".repeat(32)}`,
      index: 0n,
    });
    const sampled = state({
      tip,
      orderBook: [own, other],
      poolDeposits: [
        projectionReadyDeposit(CAP, 3000n, { id: "44" }),
        projectionReadyDeposit(CAP, 5000n, { id: "45" }),
      ],
    });

    // Half a cap of its own plus the other's half cap: the bot's cap now.
    expect(maturity(own.order, sampled)).toBe(100n + BOT_TURN_MS);
    // A fresh order at par queues behind both: the bot's cap now and both claim dates.
    expect(maturity(seller(CAP), sampled)).toBe(5000n + BOT_TURN_MS);
  });

  it("gives the bot no CKB while its own order has sat, alone on the book", () => {
    const own = sittingSeller(0n, HALF_PRICE, CAP / 2n);
    const deposit = projectionReadyDeposit(CAP, 3000n);

    // Not ahead of itself, but a seller the bot keeps leaving shows the shortage too.
    expect(
      maturity(own.order, state({ tip, orderBook: [own], poolDeposits: [deposit] })),
    ).toBe(3000n + BOT_TURN_MS);
  });
});

describe("maturity of a buyer", () => {
  it("waits one turn, plus one per cap of net CKB demand ahead", () => {
    expect(maturity(buyer(1n), state({ tip }))).toBe(100n + BOT_TURN_MS);
    expect(maturity(buyer(CAP), state({ tip }))).toBe(100n + 2n * BOT_TURN_MS);
    expect(maturity(buyer(4n * CAP + 1n), state({ tip }))).toBe(100n + 5n * BOT_TURN_MS);
  });

  it("counts fillable buyers paying more per iCKB ahead, and fillable sellers as supply", () => {
    const paysMore = fillableBuyer(CAP, { ckbScale: 1n, udtScale: 2n });
    const paysLess = fillableBuyer(CAP, { ckbScale: 4n, udtScale: 1n });
    const supply = sittingSeller(1n, { ckbScale: 2n, udtScale: 1n }, CAP);

    expect(maturity(buyer(1n), state({ tip, orderBook: [paysMore] }))).toBe(
      100n + 2n * BOT_TURN_MS,
    );
    expect(maturity(buyer(1n), state({ tip, orderBook: [paysLess] }))).toBe(
      100n + BOT_TURN_MS,
    );
    expect(maturity(buyer(CAP), state({ tip, orderBook: [supply] }))).toBe(
      100n + BOT_TURN_MS,
    );
    // At twice the DAO price, an equal buyer is ahead; a fillable one paying less is not.
    const atDouble: Parameters<typeof maturity>[0] = {
      info: Info.create(true, DOUBLE_PRICE),
      amounts: { ckbValue: 1n, udtValue: 0n },
    };
    expect(maturity(atDouble, state({ tip, orderBook: [paysMore] }))).toBe(
      100n + 2n * BOT_TURN_MS,
    );
    const paysBetween = fillableBuyer(CAP, { ckbScale: 2n, udtScale: 3n });
    expect(maturity(atDouble, state({ tip, orderBook: [paysBetween] }))).toBe(
      100n + BOT_TURN_MS,
    );
    // Supply beyond the request leaves the one turn.
    expect(
      maturity(
        buyer(1n),
        state({ tip, orderBook: [sittingSeller(1n, HALF_PRICE, 2n * CAP)] }),
      ),
    ).toBe(100n + BOT_TURN_MS);
    // A buyer too small for the bot to take whole is not ahead of anyone.
    expect(maturity(buyer(1n), state({ tip, orderBook: [fillableBuyer(10n)] }))).toBe(
      100n + BOT_TURN_MS,
    );
    // Nor is one at par, which the bot gains nothing filling, however large.
    expect(
      maturity(buyer(CAP), state({ tip, orderBook: [fillableBuyer(10n * CAP, ratio)] })),
    ).toBe(100n + 2n * BOT_TURN_MS);
  });

  it("leaves its own book order out of the queue ahead", () => {
    const own = fillableBuyer(CAP);

    expect(maturity(own.order, state({ tip, orderBook: [own] }))).toBe(
      100n + 2n * BOT_TURN_MS,
    );
  });
});
