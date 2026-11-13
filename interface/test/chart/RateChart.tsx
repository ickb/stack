import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import RateChart from "../../src/chart/RateChart.tsx";
import { CKB } from "../../src/shared/utils.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("RateChart", () => {
  // The layout itself, its classes and positions, is pinned by the snapshot (docs/layout.md).
  it("lays the unscaled labels and the tip dot over the stretched plot", () => {
    // Without a live tip the curve ends at the clock, so the clock is pinned.
    vi.useFakeTimers({ now: new Date("2026-06-07T18:43:08.091Z") });

    expect(
      renderToStaticMarkup(<RateChart chain="mainnet" isCkb2Udt={false} amount={CKB} />),
    ).toMatchSnapshot("rate chart markup");
  });
});
