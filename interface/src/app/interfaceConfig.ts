import { ccc } from "@ckb-ccc/ccc";
import { ickb } from "@ickb/sdk";
import { QueryClient } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import type { RootConfig } from "../shared/utils.ts";

export const appName = "iCKB DApp";
// The connector draws in a shadow root, which custom properties still reach: it reads the
// palette of index.css, so the two can't drift.
export const connectorStyle: CSSProperties & Record<`--${string}`, string> = {
  "--background": "var(--color-ickb-surface)",
  "--divider": "var(--color-ickb-border)",
  "--btn-primary": "var(--color-ickb-panel)",
  "--btn-primary-hover": "oklch(24.5% 0.008 286)",
  "--btn-secondary": "var(--color-ickb-action-soft)",
  "--btn-secondary-hover": "oklch(56% 0.13 64)",
  "--icon-primary": "var(--color-ickb-text)",
  "--icon-secondary": "var(--color-ickb-action)",
  "--tip-color": "var(--color-ickb-muted)",
  color: "var(--color-ickb-text)",
  fontFamily: "inherit",
};
export const queryClient = new QueryClient();
// One client per chain on CCC's public pool (WebSocket first, HTTPS fallbacks), kept for
// the app's lifetime, so its owner is never disposed: the connector's network list borrows
// them. The SDK verifies what it reads through them.
export const mainnetClient = ccc.ClientPublicMainnet.open({
  cache: new ccc.ClientCacheMemory(...ickb.CACHE_SIZES),
}).value;
export const testnetClient = ccc.ClientPublicTestnet.open({
  cache: new ccc.ClientCacheMemory(...ickb.CACHE_SIZES),
}).value;
export const savedConnectionRestoreMs = 800;

export function createRootConfig(
  chain: RootConfig["chain"],
  cccClient: ccc.Client,
): RootConfig {
  return {
    chain,
    queryClient,
    cccClient,
  };
}
