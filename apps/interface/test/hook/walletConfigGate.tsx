import { describe, expect, it, vi } from "vitest";
import { elementProps } from "../support/react.ts";
import { walletConfig, walletConfigGateProps, walletSigner } from "./fixtures/data.ts";
import {
  queryMock,
  resetHooks,
  walletConfigQueryOptions,
} from "./fixtures/environment.ts";
import { App, WalletConfigGate, WalletConfigPendingView } from "./fixtures/modules.ts";

describe("hook-based wallet config gate", () => {
  it("builds wallet config query state and renders loading, error, and success branches", async () => {
    const signer = walletSigner(false);
    queryMock.result = { data: undefined, error: null, isPending: true };
    expect(WalletConfigGate(walletConfigGateProps(signer)).type).toBe(
      WalletConfigPendingView,
    );
    signer.replaceCallback?.();
    const firstConfig = await walletConfigQueryOptions().queryFn();

    expect(signer.connect).toHaveBeenCalledTimes(1);
    expect(signer.connect).toHaveBeenCalledWith();
    expect(firstConfig.address).toBe("ckt1recommended");
    expect(firstConfig.accountLocks).toHaveLength(2);
    expect(firstConfig.cccClient).toBe(signer.client);

    resetHooks();
    const connectedSigner = walletSigner(true);
    queryMock.result = { data: undefined, error: new Error("denied"), isPending: false };
    expect(WalletConfigGate(walletConfigGateProps(connectedSigner)).type).toBe(
      WalletConfigPendingView,
    );
    await walletConfigQueryOptions().queryFn();
    expect(connectedSigner.connect).not.toHaveBeenCalled();

    resetHooks();
    queryMock.result = { data: walletConfig(), error: null, isPending: false };
    expect(WalletConfigGate(walletConfigGateProps(walletSigner(true))).type).toBe(App);
  });

  it("retries the exact failed query for the same signer and reaches success", () => {
    const signer = walletSigner(true);
    const props = walletConfigGateProps(signer);
    const refetch = vi.fn(async () => {
      await Promise.resolve();
    });
    queryMock.result = {
      data: undefined,
      error: new Error("denied"),
      isPending: false,
      refetch,
    };
    const failed = WalletConfigGate(props);
    const failedKey = walletConfigQueryOptions().queryKey;
    const { retry: retryWalletData } =
      elementProps<Parameters<typeof WalletConfigPendingView>[0]>(failed);

    retryWalletData?.();

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(walletConfigQueryOptions().retry).toBe(false);

    resetHooks();
    queryMock.result = {
      data: walletConfig(),
      error: null,
      isPending: false,
      refetch,
    };
    const succeeded = WalletConfigGate(props);

    expect(walletConfigQueryOptions().queryKey).toEqual(failedKey);
    expect(succeeded.type).toBe(App);
  });
});
