import { describe, expect, it } from "vitest";
import { elementProps } from "../support/react.ts";
import { walletConfigGateProps, walletSigner } from "./fixtures/data.ts";
import { hookState } from "./fixtures/environment.ts";
import {
  App,
  QuotePage,
  WalletConfigGate,
  type ActionLayout,
} from "./fixtures/modules.ts";

/** Lets the gate's read settle: the mocked effect starts it synchronously on render. */
async function settled(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** The props of the action the quote page shows while the read is pending or failed. */
function pendingAction(
  element: ReturnType<typeof WalletConfigGate>,
): Parameters<typeof ActionLayout>[0] {
  expect(element.type).toBe(QuotePage);
  const { action } = elementProps<{ action: ReturnType<typeof WalletConfigGate> }>(
    element,
  );
  return elementProps<Parameters<typeof ActionLayout>[0]>(action);
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

    const connecting = pendingAction(WalletConfigGate(props));
    expect(connecting).toMatchObject({
      action: "Connect wallet",
      disabled: true,
      isDone: false,
      message: "JoyID may ask you to authorize this connection.",
    });
    expect(connecting.onAction).toBeUndefined();
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
    const failed = pendingAction(rerender(props));
    expect(failed).toMatchObject({
      action: "Retry wallet data",
      disabled: false,
      isDone: true,
      message: "⚠️ Unable to connect to JoyID: denied",
    });

    failed.onAction?.();
    expect(rerender(props).type).toBe(QuotePage);
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
    expect(WalletConfigGate({ ...props, signer: second }).type).toBe(QuotePage);
    await settled();
    const app = rerender({ ...props, signer: second });
    expect(app.type).toBe(App);
    expect(elementProps<Parameters<typeof App>[0]>(app).walletConfig.signer).toBe(second);
  });
});
