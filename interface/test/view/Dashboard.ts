import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Dashboard } from "../../src/view/Dashboard.tsx";

describe("shortenAddress", () => {
  it("keeps both ends visible with the ellipsis in the middle", () => {
    expect(
      renderDashboardAddress("ckt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhxqd5v3my"),
    ).toContain("ckt1qxy2kg...xqd5v3my");
  });

  it("leaves short addresses intact", () => {
    expect(renderDashboardAddress("ckt1short")).toContain("ckt1short");
  });
});

function renderDashboardAddress(address: string): string {
  return renderToStaticMarkup(
    Dashboard({
      walletConfig: dashboardWalletConfig(address),
      walletName: "JoyID",
      openWallet: (): undefined => undefined,
      destination: {
        text: "",
        setText: (): undefined => undefined,
        isValid: true,
        isForeign: false,
      },
    }),
  );
}

function dashboardWalletConfig(
  address: string,
): Parameters<typeof Dashboard>[0]["walletConfig"] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Dashboard only reads chain and address from the wallet config.
  return { chain: "testnet", address } as Parameters<typeof Dashboard>[0]["walletConfig"];
}
