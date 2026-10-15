import { describe, expect, it } from "vitest";
import { elementProps } from "../support/react.ts";
import { walletConfigGateProps, walletSigner } from "./fixtures/data.ts";
import { hookState } from "./fixtures/environment.ts";
import { App, WalletConfigGate, WalletConfigPendingView } from "./fixtures/modules.ts";

/** Lets the gate's read settle: the mocked effect starts it synchronously on render. */
async function settled(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Re-renders the gate with the same props, as React does after a state write. */
function rerender(
  props: Parameters<typeof WalletConfigGate>[0],
): ReturnType<typeof WalletConfigGate> {
  hookState.index = 0;
  hookState.effects = [];
  return WalletConfigGate(props);
}

describe("hook-based wallet config gate", () => {
  it("reads the signer once, connecting first when needed, then renders the app", async () => {
    const signer = walletSigner(false);
    const props = walletConfigGateProps(signer);

    expect(WalletConfigGate(props).type).toBe(WalletConfigPendingView);
    await settled();
    const app = rerender(props);

    expect(app.type).toBe(App);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() spy typed through ccc.Signer; the reference captures no `this`.
    expect(signer.connect).toHaveBeenCalledTimes(1);
    const { walletConfig } = elementProps<Parameters<typeof App>[0]>(app);
    expect(walletConfig.address).toBe("ckt1recommended");
    expect(walletConfig.accountLocks).toHaveLength(2);
    expect(walletConfig.cccClient).toBe(signer.client);
  });

  it("shows the read's error with a retry that reads again, and skips connect when connected", async () => {
    const signer = walletSigner(true);
    signer.getRecommendedAddressObj.mockRejectedValueOnce(new Error("denied"));
    const props = walletConfigGateProps(signer);

    WalletConfigGate(props);
    await settled();
    const failed = rerender(props);
    expect(failed.type).toBe(WalletConfigPendingView);
    const { error, retry } =
      elementProps<Parameters<typeof WalletConfigPendingView>[0]>(failed);
    expect(error).toEqual(new Error("denied"));

    retry?.();
    expect(rerender(props).type).toBe(WalletConfigPendingView);
    await settled();
    expect(rerender(props).type).toBe(App);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() spy typed through ccc.Signer; the reference captures no `this`.
    expect(signer.connect).not.toHaveBeenCalled();
  });

  it("drops a read that lands after the signer changed", async () => {
    const first = walletSigner(true);
    const second = walletSigner(true);
    const props = walletConfigGateProps(first);

    WalletConfigGate(props);
    for (const effect of hookState.effects) {
      effect();
    }
    await settled();
    hookState.index = 0;
    hookState.effects = [];
    expect(WalletConfigGate({ ...props, signer: second }).type).toBe(
      WalletConfigPendingView,
    );
    await settled();
    const app = rerender({ ...props, signer: second });
    expect(app.type).toBe(App);
    expect(elementProps<Parameters<typeof App>[0]>(app).walletConfig.signer).toBe(second);
  });
});
