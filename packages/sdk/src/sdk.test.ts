import { ccc } from "@ckb-ccc/core";
import { Info, Ratio } from "@ickb/order";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IckbSdk, type SystemState } from "./sdk.js";

const ratio = Ratio.from({ ckbScale: 1n, udtScale: 1n });
const tip = { timestamp: 0n } as ccc.ClientBlockHeader;

function system(overrides: Partial<SystemState> = {}): SystemState {
  return {
    feeRate: 1n,
    tip,
    exchangeRatio: ratio,
    orderPool: [],
    ckbAvailable: 0n,
    ckbMaturing: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IckbSdk.estimate", () => {
  it("omits maturity below the fee threshold", () => {
    const result = IckbSdk.estimate(
      false,
      { ckbValue: 0n, udtValue: 100000n },
      system({ ckbAvailable: 100000n }),
    );

    expect(result.convertedAmount).toBe(99999n);
    expect(result.ckbFee).toBe(1n);
    expect(result.maturity).toBeUndefined();
  });

  it("includes maturity once the fee threshold is met", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);

    const result = IckbSdk.estimate(
      false,
      { ckbValue: 0n, udtValue: 1000000n },
      system({ ckbAvailable: 1000000n }),
    );

    expect(result.convertedAmount).toBe(999990n);
    expect(result.ckbFee).toBe(10n);
    expect(result.maturity).toBe(601234n);
  });
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
    vi.spyOn(Date, "now").mockReturnValue(1234);

    expect(
      IckbSdk.maturity(
        {
          info: Info.create(false, ratio),
          amounts: { ckbValue: 0n, udtValue: 100n },
        },
        system({ ckbAvailable: 100n }),
      ),
    ).toBe(601234n);
  });

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
});
