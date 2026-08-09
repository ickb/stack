import { describe, expect, it } from "vitest";
import indexHtml from "../../index.html?raw";

describe("wallet app mount", () => {
  it("keeps the wallet app empty until React mounts", () => {
    expect(indexHtml).not.toContain("WALLET_APP_SHELL");
    expect(indexHtml).toContain(
      '<div id="wallet-header" class="ickb-wallet-header-mount"></div>',
    );
    expect(indexHtml).toContain(
      '<div id="wallet-app" class="ickb-app-mount min-h-0"></div>',
    );
  });
});
