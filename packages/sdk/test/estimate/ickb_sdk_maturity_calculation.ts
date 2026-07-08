import { ccc } from "@ckb-ccc/core";
import { Info } from "@ickb/order";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IckbSdk } from "../../src/sdk.ts";
import { projectionOrderGroup } from "../conversion/planning/support/sdk_order_support.ts";
import {
  headerLike,
  ratio,
  system,
} from "../transaction/base/support/sdk_core_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IckbSdk.maturity", () => {
  it("returns undefined for dual-ratio orders", () => {
    const dualRatio = new Info(ratio, ratio, 1);

    expect(
      IckbSdk.maturity(
        { info: dualRatio, amounts: { ckbValue: 1n, udtValue: 1n } },
        system(),
      ),
    ).toBeUndefined();
  });

  it("returns zero for already fulfilled orders", () => {
    expect(
      IckbSdk.maturity(
        {
          info: Info.create(true, ratio),
          amounts: { ckbValue: 0n, udtValue: 0n },
        },
        system(),
      ),
    ).toBe(0n);
  });

  it("returns the baseline maturity when enough CKB is already available", () => {
    expect(
      IckbSdk.maturity(
        {
          info: Info.create(false, ratio),
          amounts: { ckbValue: 0n, udtValue: 100n },
        },
        system({
          ckbAvailable: 100n,
          tip: headerLike(0n, { timestamp: 1234n }),
        }),
      ),
    ).toBe(601234n);
  });
});

describe("IckbSdk.maturity CKB availability", () => {
  it("picks the first matching maturing CKB entry", () => {
    expect(
      IckbSdk.maturity(
        {
          info: Info.create(false, ratio),
          amounts: { ckbValue: 0n, udtValue: 100n },
        },
        system({
          ckbMaturing: [
            { ckbCumulative: 50n, maturity: 1000n },
            { ckbCumulative: 100n, maturity: 2000n },
            { ckbCumulative: 150n, maturity: 3000n },
          ],
        }),
      ),
    ).toBe(2000n);
  });

  it("counts existing CKB in UDT-to-CKB orders before requiring pool liquidity", () => {
    const info = Info.create(false, {
      ckbScale: 9n,
      udtScale: 10n,
    });

    expect(
      IckbSdk.maturity(
        {
          info,
          amounts: {
            ckbValue: 7n,
            udtValue: 10n,
          },
        },
        system({
          ckbMaturing: [
            { ckbCumulative: 5n, maturity: 1000n },
            { ckbCumulative: 6n, maturity: 2000n },
          ],
        }),
      ),
    ).toBe(1000n);
  });
});

describe("IckbSdk.maturity order pool pressure", () => {
  it("scales CKB-to-iCKB maturity when positive pressure exceeds the threshold", () => {
    expect(
      IckbSdk.maturity(
        {
          info: Info.create(true, ratio),
          amounts: { ckbValue: ccc.fixedPointFrom(400000), udtValue: 0n },
        },
        system({
          tip: headerLike(0n, { timestamp: 100n }),
        }),
      ),
    ).toBe(1800100n);
  });

  it("counts opposing order pressure before estimating maturity", () => {
    const pressure = projectionOrderGroup({
      ckbValue: 0n,
      udtValue: 50n,
      isDualRatio: false,
      isMatchable: true,
    }).order;

    expect(
      IckbSdk.maturity(
        {
          info: Info.create(true, ratio),
          amounts: { ckbValue: 100n, udtValue: 0n },
        },
        system({
          orderPool: [pressure],
          tip: headerLike(0n, { timestamp: 100n }),
        }),
      ),
    ).toBe(600100n);
  });

  it("counts UDT-to-CKB pressure at better reference ratios", () => {
    const pressure = projectionOrderGroup({
      ckbValue: 0n,
      udtValue: 25n,
      isDualRatio: false,
      isMatchable: true,
    }).order;
    pressure.data.info = Info.create(false, { ckbScale: 2n, udtScale: 1n });

    expect(
      IckbSdk.maturity(
        {
          info: Info.create(false, ratio),
          amounts: { ckbValue: 0n, udtValue: 100n },
        },
        system({
          ckbMaturing: [{ ckbCumulative: 100n, maturity: 1234n }],
          orderPool: [pressure],
        }),
      ),
    ).toBeUndefined();
  });
});

describe("IckbSdk.maturity order pressure", () => {
  it("keeps the base maturity when CKB-to-iCKB pressure is not positive", () => {
    expect(
      IckbSdk.maturity(
        {
          info: Info.create(true, ratio),
          amounts: { ckbValue: 100n, udtValue: 0n },
        },
        system({
          tip: headerLike(0n, { timestamp: 100n }),
        }),
      ),
    ).toBe(600100n);
  });

  it("keeps the base maturity when CKB-to-iCKB pressure is negative", () => {
    const pressure = projectionOrderGroup({
      ckbValue: 0n,
      udtValue: 200n,
      isDualRatio: false,
      isMatchable: true,
    }).order;
    pressure.data.info = Info.create(false, ratio);

    expect(
      IckbSdk.maturity(
        {
          info: Info.create(true, ratio),
          amounts: { ckbValue: 100n, udtValue: 0n },
        },
        system({
          orderPool: [pressure],
          tip: headerLike(0n, { timestamp: 100n }),
        }),
      ),
    ).toBe(600100n);
  });

  it("ignores UDT-to-CKB order pressure outside the reference direction", () => {
    const pressure = projectionOrderGroup({
      ckbValue: 0n,
      udtValue: 50n,
      isDualRatio: false,
      isMatchable: true,
    }).order;
    pressure.data.info = Info.create(false, { ckbScale: 1n, udtScale: 2n });

    expect(
      IckbSdk.maturity(
        {
          info: Info.create(false, ratio),
          amounts: { ckbValue: 0n, udtValue: 100n },
        },
        system({
          orderPool: [pressure],
          ckbAvailable: 100n,
          tip: headerLike(0n, { timestamp: 100n }),
        }),
      ),
    ).toBe(600100n);
  });
});
