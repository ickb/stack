import { ccc } from "@ckb-ccc/core";
import { ickb } from "@ickb/sdk";

// A bigger cache than the CCC default: the pool and the order book span many blocks.
export const client = ccc.ClientPublicTestnet.open({
  cache: new ccc.ClientCacheMemory(...ickb.CACHE_SIZES),
}).value;
