import { describe, expect, it } from "vitest";
import { elementProps } from "../support/react.ts";
import { inAct, renderHook, settle } from "../support/renderHook.ts";
import { walletConfigGateProps, walletSigner } from "./fixtures/data.ts";
import {
  App,
  QuotePage,
  WalletConfigGate,
  type ActionLayout,
} from "./fixtures/modules.ts";

type GateProps = Parameters<typeof WalletConfigGate>[0];
type GateElement = ReturnType<typeof WalletConfigGate>;

describe("hook-based wallet config gate", () => {
  it("shows the connect step until the read lands, then renders the app once", async () => {
    const signer = walletSigner(false);
    const connected = Promise.withResolvers<undefined>();
    signer.connect.mockReturnValueOnce(connected.promise);
    const props = walletConfigGateProps(signer);
    const { result, rerender, unmount } = await renderGate(props);

    const connecting = pendingAction(result.current);
    expect(connecting).toMatchObject({
      action: "Connect wallet",
      disabled: true,
      isDone: false,
      message: "JoyID may ask you to authorize this connection.",
    });
    expect(connecting.onAction).toBeUndefined();

    connected.resolve(undefined);
    await settle();
    expect(result.current.type).toBe(App);
    const { walletConfig } = elementProps<Parameters<typeof App>[0]>(result.current);
    expect(walletConfig.address).toBe("ckt1recommended");
    expect(walletConfig.accountLocks).toHaveLength(2);
    expect(walletConfig.cccClient).toBe(signer.client);

    // The same signer and config read nothing again, however often the gate renders.
    await rerender({ ...props, text: "2" });
    await settle();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() spy typed through ccc.Signer; the reference captures no `this`.
    expect(signer.connect).toHaveBeenCalledTimes(1);
    // One read asks twice: for the wallet's address and, first of its account locks, its lock.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() spy typed through ccc.Signer; the reference captures no `this`.
    expect(signer.getRecommendedAddressObj).toHaveBeenCalledTimes(2);
    expect(elementProps<Parameters<typeof App>[0]>(result.current).walletConfig).toBe(
      walletConfig,
    );
    await unmount();
  });

  it("shows the read's error with a retry that reads again, and skips connect when connected", async () => {
    const signer = walletSigner(true);
    signer.getRecommendedAddressObj.mockRejectedValueOnce(new Error("denied"));
    const { result, unmount } = await renderGate(walletConfigGateProps(signer));
    await settle();

    const failed = pendingAction(result.current);
    expect(failed).toMatchObject({
      action: "Retry wallet data",
      disabled: false,
      isDone: true,
      message: "⚠️ Unable to connect to JoyID: denied",
    });

    await inAct(() => {
      failed.onAction?.();
    });
    await settle();
    expect(result.current.type).toBe(App);
    // The failed read stopped at its first ask; the retry asked twice.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() spy typed through ccc.Signer; the reference captures no `this`.
    expect(signer.getRecommendedAddressObj).toHaveBeenCalledTimes(3);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() spy typed through ccc.Signer; the reference captures no `this`.
    expect(signer.connect).not.toHaveBeenCalled();
    await unmount();
  });

  it("drops a read that lands after the signer changed", async () => {
    const first = walletSigner(true);
    const second = walletSigner(true);
    const firstAddress = Promise.withResolvers<unknown>();
    first.getRecommendedAddressObj.mockReturnValueOnce(firstAddress.promise);
    const props = walletConfigGateProps(first);
    const { result, rerender, unmount } = await renderGate(props);

    await rerender({ ...props, signer: second });
    await settle();
    expect(
      elementProps<Parameters<typeof App>[0]>(result.current).walletConfig.signer,
    ).toBe(second);

    // The first signer's read lands last; taking it would show the wrong account.
    firstAddress.resolve(await second.getRecommendedAddressObj());
    await settle();
    expect(result.current.type).toBe(App);
    expect(
      elementProps<Parameters<typeof App>[0]>(result.current).walletConfig.signer,
    ).toBe(second);
    await unmount();
  });
});

/** The props of the action the quote page shows while the read is pending or failed. */
function pendingAction(element: GateElement): Parameters<typeof ActionLayout>[0] {
  expect(element.type).toBe(QuotePage);
  const { action } = elementProps<{ action: GateElement }>(element);
  return elementProps<Parameters<typeof ActionLayout>[0]>(action);
}

async function renderGate(
  props: GateProps,
): ReturnType<typeof renderHook<GateProps, GateElement>> {
  return renderHook((current: GateProps) => WalletConfigGate(current), props);
}
