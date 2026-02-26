import { ccc } from "@ckb-ccc/core";
import { IckbUdt, LogicManager, OwnedOwnerManager } from "@ickb/core";
import { DaoManager } from "@ickb/dao";
import { OrderManager } from "@ickb/order";
import { unique, type ScriptDeps } from "@ickb/utils";

/**
 * Retrieves the configuration for the given deployment environment.
 *
 * Accepts either a string identifier ("mainnet" or "testnet") or a custom configuration
 * object containing script dependencies for a devnet.
 *
 * It sets up various managers (UDT, Logic, OwnedOwner, Order, Dao) and also
 * aggregates a unique list of known bot scripts.
 *
 * @param d - Either a network identifier ("mainnet"/"testnet") or an object containing
 *   explicit script dependencies for devnet.
 * @param bots - An optional array of bot script-like objects to augment the list of known bots.
 * @returns An object containing the instantiated managers and bots.
 */
export function getConfig(
  d:
    | "mainnet"
    | "testnet"
    | {
        // For devnet configuration provide explicit script dependencies.
        udt: ScriptDeps;
        logic: ScriptDeps;
        ownedOwner: ScriptDeps;
        order: ScriptDeps;
        dao: ScriptDeps;
      },
  bots: ccc.ScriptLike[] = [],
): {
  managers: {
    dao: DaoManager;
    ickbUdt: IckbUdt;
    logic: LogicManager;
    ownedOwner: OwnedOwnerManager;
    order: OrderManager;
  };
  bots: ccc.Script[];
} {
  // Capture network before d gets reassigned to ScriptDeps.
  const network = typeof d === "string" ? d : undefined;

  // If deps is provided as a network string, use the pre-defined constants.
  if (d === "mainnet" || d === "testnet") {
    bots = bots.concat(
      d === "mainnet" ? MAINNET_KNOWN_BOTS : TESTNET_KNOWN_BOTS,
    );
    const depGroup = d === "mainnet" ? MAINNET_DEP_GROUP : TESTNET_DEP_GROUP;
    d = {
      udt: from(UDT, depGroup),
      logic: from(ICKB_LOGIC, depGroup),
      ownedOwner: from(OWNED_OWNER, depGroup),
      order: from(ORDER, depGroup),
      dao: from(DAO, depGroup),
    };
  }

  const dao = new DaoManager(d.dao.script, d.dao.cellDeps);

  // xUDT code cell OutPoint: use known constants for mainnet/testnet,
  // fall back to first cellDep's outPoint for devnet.
  const xudtCode = network
    ? network === "mainnet"
      ? MAINNET_XUDT_CODE
      : TESTNET_XUDT_CODE
    : d.udt.cellDeps[0]?.outPoint;
  if (!xudtCode) {
    throw new Error(
      "devnet config missing xUDT code cell outPoint in udt.cellDeps",
    );
  }

  // iCKB Logic code cell OutPoint: same pattern as above.
  const logicCode = network
    ? network === "mainnet"
      ? MAINNET_LOGIC_CODE
      : TESTNET_LOGIC_CODE
    : d.logic.cellDeps[0]?.outPoint;
  if (!logicCode) {
    throw new Error(
      "devnet config missing Logic code cell outPoint in logic.cellDeps",
    );
  }

  const ickbUdt = new IckbUdt(
    xudtCode,
    IckbUdt.typeScriptFrom(
      ccc.Script.from(d.udt.script),
      ccc.Script.from(d.logic.script),
    ),
    logicCode,
    d.logic.script,
    dao,
  );
  const logic = new LogicManager(d.logic.script, d.logic.cellDeps, dao);
  const ownedOwner = new OwnedOwnerManager(
    d.ownedOwner.script,
    d.ownedOwner.cellDeps,
    dao,
  );
  const order = new OrderManager(d.order.script, d.order.cellDeps, ickbUdt.script);

  return {
    managers: {
      dao,
      ickbUdt,
      logic,
      ownedOwner,
      order,
    },
    bots: [...unique(bots.map((b) => ccc.Script.from(b)))],
  };
}

/**
 * Wraps a script-like object into a ScriptDeps structure.
 *
 * @param script - The script or script-like object.
 * @param cellDeps - Additional cell dependencies that the script may require.
 * @returns An object containing the script and its associated cell dependencies.
 */
function from(script: ccc.ScriptLike, ...cellDeps: ccc.CellDep[]): ScriptDeps {
  return {
    script: ccc.Script.from(script),
    cellDeps,
  };
}

/**
 * DAO (Decentralized Autonomous Organization) lock script information.
 */
const DAO = {
  codeHash:
    "0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e",
  hashType: "type",
  args: "0x",
};

/**
 * Raw xUDT type script (codeHash + hashType only).
 * The iCKB UDT type script args are computed dynamically by
 * IckbUdt.typeScriptFrom() from ICKB_LOGIC.
 */
const UDT = {
  codeHash:
    "0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95",
  hashType: "data1",
  args: "0x",
};

/**
 * Logic script information for the iCKB logic contract.
 */
const ICKB_LOGIC = {
  codeHash:
    "0x2a8100ab5990fa055ab1b50891702e1e895c7bd1df6322cd725c1a6115873bd3",
  hashType: "data1",
  args: "0x",
};

/**
 * OwnedOwner lock script information.
 */
const OWNED_OWNER = {
  codeHash:
    "0xacc79e07d107831feef4c70c9e683dac5644d5993b9cb106dca6e74baa381bd0",
  hashType: "data1",
  args: "0x",
};

/**
 * Order lock script information.
 */
const ORDER = {
  codeHash:
    "0x49dfb6afee5cc8ac4225aeea8cb8928b150caf3cd92fea33750683c74b13254a",
  hashType: "data1",
  args: "0x",
};

/**
 * Mainnet xUDT code cell OutPoint.
 * Source: forks/contracts/scripts/deployment/mainnet/deployment.toml
 */
const MAINNET_XUDT_CODE = {
  txHash:
    "0xc07844ce21b38e4b071dd0e1ee3b0e27afd8d7532491327f39b786343f558ab7",
  index: "0x0",
};

/**
 * Mainnet iCKB Logic code cell OutPoint.
 * Source: forks/contracts/scripts/deployment/mainnet/deployment.toml
 */
const MAINNET_LOGIC_CODE = {
  txHash:
    "0xd7309191381f5a8a2904b8a79958a9be2752dbba6871fa193dab6aeb29dc8f44",
  index: "0x0",
};

/**
 * Testnet xUDT code cell OutPoint.
 * Source: forks/contracts/scripts/deployment/testnet/deployment.toml
 */
const TESTNET_XUDT_CODE = {
  txHash:
    "0xbf6fb538763efec2a70a6a3dcb7242787087e1030c4e7d86585bc63a9d337f5f",
  index: "0x0",
};

/**
 * Testnet iCKB Logic code cell OutPoint.
 * Source: forks/contracts/scripts/deployment/testnet/deployment.toml
 */
const TESTNET_LOGIC_CODE = {
  txHash:
    "0x9ac989b3355764f76cdce02c69dedb819fdfbcbda49a7db1a2c9facdfdb9a7fe",
  index: "0x0",
};

/**
 * Mainnet dependency group cell dep.
 */
const MAINNET_DEP_GROUP = ccc.CellDep.from({
  outPoint: {
    txHash:
      "0x621a6f38de3b9f453016780edac3b26bfcbfa3e2ecb47c2da275471a5d3ed165",
    index: "0x0",
  },
  depType: "depGroup",
});

/**
 * Testnet dependency group cell dep.
 */
const TESTNET_DEP_GROUP = ccc.CellDep.from({
  outPoint: {
    txHash:
      "0xf7ece4fb33d8378344cab11fcd6a4c6f382fd4207ac921cf5821f30712dcd311",
    index: "0x0",
  },
  depType: "depGroup",
});

/**
 * Array of known bot scripts on the mainnet.
 */
const MAINNET_KNOWN_BOTS = [
  {
    codeHash:
      "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
    hashType: "type",
    args: "0xd096cb29e2f68a85a46bd6bf6cbee6327959ba64",
  },
];

/**
 * Array of known bot scripts on the testnet.
 */
const TESTNET_KNOWN_BOTS = [
  {
    codeHash:
      "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
    hashType: "type",
    args: "0xb4380110f7679ac31cefe4925485645d82bf619f",
  },
];
