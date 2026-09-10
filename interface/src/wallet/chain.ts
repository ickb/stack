import type { ccc } from "@ckb-ccc/ccc";
import type { RootConfig } from "../shared/utils.ts";

/**
 * Maps CCC address prefixes to the interface chain name.
 */
export function chainFromClient(client: ccc.Client): RootConfig["chain"] | undefined {
  switch (client.addressPrefix) {
    case "ckb":
      return "mainnet";
    case "ckt":
      return "testnet";
    default:
      return undefined;
  }
}
