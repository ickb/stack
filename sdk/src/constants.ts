import { ccc } from "@ckb-ccc/core";
import type { SdkManagers } from "./conversion/types.ts";
import { LogicManager } from "./logic.ts";
import { OrderManager } from "./order/order.ts";
import { OwnedOwnerManager } from "./owned_owner.ts";
import { IckbUdt } from "./udt.ts";
import type { SupportedChain } from "./utils/index.ts";

/** Nervos DAO type script. */
const DAO = ccc.Script.from({
  codeHash: "0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e",
  hashType: "type",
  args: "0x",
});

/** Raw xUDT type script; the iCKB args are computed by `IckbUdt.typeScriptFrom`. */
const UDT = ccc.Script.from({
  codeHash: "0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95",
  hashType: "data1",
  args: "0x",
});

/** iCKB Logic script. */
const ICKB_LOGIC = ccc.Script.from({
  codeHash: "0x2a8100ab5990fa055ab1b50891702e1e895c7bd1df6322cd725c1a6115873bd3",
  hashType: "data1",
  args: "0x",
});

/** Owned Owner lock script. */
const OWNED_OWNER = ccc.Script.from({
  codeHash: "0xacc79e07d107831feef4c70c9e683dac5644d5993b9cb106dca6e74baa381bd0",
  hashType: "data1",
  args: "0x",
});

/** Order lock script. */
const ORDER = ccc.Script.from({
  codeHash: "0x49dfb6afee5cc8ac4225aeea8cb8928b150caf3cd92fea33750683c74b13254a",
  hashType: "data1",
  args: "0x",
});

/** Each network's code cells, given as direct code deps, and the dep group of the rest. */
const DEPLOYMENTS = {
  mainnet: {
    udtCode: {
      txHash: "0xc07844ce21b38e4b071dd0e1ee3b0e27afd8d7532491327f39b786343f558ab7",
      index: 0,
    },
    logicCode: {
      txHash: "0xd7309191381f5a8a2904b8a79958a9be2752dbba6871fa193dab6aeb29dc8f44",
      index: 0,
    },
    depGroup: {
      txHash: "0x621a6f38de3b9f453016780edac3b26bfcbfa3e2ecb47c2da275471a5d3ed165",
      index: 0,
    },
  },
  testnet: {
    udtCode: {
      txHash: "0xbf6fb538763efec2a70a6a3dcb7242787087e1030c4e7d86585bc63a9d337f5f",
      index: 0,
    },
    logicCode: {
      txHash: "0x9ac989b3355764f76cdce02c69dedb819fdfbcbda49a7db1a2c9facdfdb9a7fe",
      index: 0,
    },
    depGroup: {
      txHash: "0xf7ece4fb33d8378344cab11fcd6a4c6f382fd4207ac921cf5821f30712dcd311",
      index: 0,
    },
  },
} as const;

/**
 * Plain CKB the bot keeps for its own cells and fees: its sizing line for matches and deposits.
 */
export const CKB_RESERVE = ccc.fixedPointFrom(1000);

/**
 * The managers of one network's iCKB deployment.
 *
 * @remarks Builders still return partial transactions. `IckbSdk` owns the shared iCKB
 * completion path as `sdk.completeTransaction(...)`, which callers invoke before send.
 */
export function getConfig(chain: SupportedChain): SdkManagers {
  // The runtime check stands for callers outside TypeScript (decisions amendment 30).
  if (!Object.hasOwn(DEPLOYMENTS, chain)) {
    throw new TypeError("unsupported iCKB network");
  }
  const { udtCode, logicCode, depGroup } = DEPLOYMENTS[chain];
  const cellDeps = [ccc.CellDep.from({ outPoint: depGroup, depType: "depGroup" })];
  const dao = { script: DAO, cellDeps };
  const ickbUdt = new IckbUdt({
    code: udtCode,
    script: IckbUdt.typeScriptFrom(UDT, ICKB_LOGIC),
    logicCode,
    logicScript: ICKB_LOGIC,
    daoScript: DAO,
  });
  return {
    ickbUdt,
    ownedOwner: new OwnedOwnerManager(OWNED_OWNER, cellDeps, dao),
    ickbLogic: new LogicManager(ICKB_LOGIC, cellDeps, dao),
    order: new OrderManager(ORDER, cellDeps, ickbUdt.script),
  };
}
