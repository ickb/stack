import { ccc } from "@ckb-ccc/core";
import { DaoManager, IckbUdt, LogicManager, OwnedOwnerManager } from "./core/index.ts";
import { OrderManager } from "./order/index.ts";
import type { ScriptDeps } from "./utils/index.ts";
/** Script deps plus the direct code out point for scripts used as direct code deps. */
interface CodeScriptDeps extends ScriptDeps {
  codeOutPoint: ccc.OutPointLike;
}

interface DeploymentConfig {
  udt: CodeScriptDeps;
  logic: CodeScriptDeps;
  ownedOwner: ScriptDeps;
  order: ScriptDeps;
  dao: ScriptDeps;
}

/**
 * Nervos DAO type script information.
 */
const DAO = {
  codeHash: "0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e",
  hashType: "type",
  args: "0x",
};

/**
 * Raw xUDT type script (codeHash + hashType only).
 * The iCKB UDT type script args are computed dynamically by
 * IckbUdt.typeScriptFrom() from ICKB_LOGIC.
 */
const UDT = {
  codeHash: "0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95",
  hashType: "data1",
  args: "0x",
};

/**
 * Logic script information for the iCKB logic contract.
 */
const ICKB_LOGIC = {
  codeHash: "0x2a8100ab5990fa055ab1b50891702e1e895c7bd1df6322cd725c1a6115873bd3",
  hashType: "data1",
  args: "0x",
};

/**
 * OwnedOwner lock script information.
 */
const OWNED_OWNER = {
  codeHash: "0xacc79e07d107831feef4c70c9e683dac5644d5993b9cb106dca6e74baa381bd0",
  hashType: "data1",
  args: "0x",
};

/**
 * Order lock script information.
 */
const ORDER = {
  codeHash: "0x49dfb6afee5cc8ac4225aeea8cb8928b150caf3cd92fea33750683c74b13254a",
  hashType: "data1",
  args: "0x",
};

/**
 * Mainnet xUDT code cell OutPoint.
 */
const MAINNET_XUDT_CODE = {
  txHash: "0xc07844ce21b38e4b071dd0e1ee3b0e27afd8d7532491327f39b786343f558ab7",
  index: "0x0",
};

/**
 * Mainnet iCKB Logic code cell OutPoint.
 */
const MAINNET_LOGIC_CODE = {
  txHash: "0xd7309191381f5a8a2904b8a79958a9be2752dbba6871fa193dab6aeb29dc8f44",
  index: "0x0",
};

/**
 * Testnet xUDT code cell OutPoint.
 */
const TESTNET_XUDT_CODE = {
  txHash: "0xbf6fb538763efec2a70a6a3dcb7242787087e1030c4e7d86585bc63a9d337f5f",
  index: "0x0",
};

/**
 * Testnet iCKB Logic code cell OutPoint.
 */
const TESTNET_LOGIC_CODE = {
  txHash: "0x9ac989b3355764f76cdce02c69dedb819fdfbcbda49a7db1a2c9facdfdb9a7fe",
  index: "0x0",
};

/**
 * Mainnet dependency group cell dep.
 */
const MAINNET_DEP_GROUP = ccc.CellDep.from({
  outPoint: {
    txHash: "0x621a6f38de3b9f453016780edac3b26bfcbfa3e2ecb47c2da275471a5d3ed165",
    index: "0x0",
  },
  depType: "depGroup",
});

/**
 * Testnet dependency group cell dep.
 */
const TESTNET_DEP_GROUP = ccc.CellDep.from({
  outPoint: {
    txHash: "0xf7ece4fb33d8378344cab11fcd6a4c6f382fd4207ac921cf5821f30712dcd311",
    index: "0x0",
  },
  depType: "depGroup",
});

/**
 * Plain CKB the bot keeps for its own cells and fees: its sizing line for matches and deposits.
 */
export const CKB_RESERVE = ccc.fixedPointFrom(1000);

/**
 * Retrieves the configuration for the given deployment environment.
 *
 * It sets up the managers (UDT, Logic, OwnedOwner, Order, Dao).
 *
 * @param d - Network identifier ("mainnet" or "testnet").
 * @returns An object containing the instantiated managers.
 *
 * @remarks Builders still return partial transactions. `IckbSdk` owns the
 * shared iCKB completion path as `sdk.completeTransaction(...)`, which callers
 * should invoke explicitly before send.
 */
export function getConfig(d: "mainnet" | "testnet"): {
  managers: {
    dao: DaoManager;
    ickbUdt: IckbUdt;
    logic: LogicManager;
    ownedOwner: OwnedOwnerManager;
    order: OrderManager;
  };
} {
  const deployment = resolveDeploymentConfig(d);

  const dao = new DaoManager(deployment.dao.script, deployment.dao.cellDeps);

  const ickbUdt = new IckbUdt({
    code: ccc.OutPoint.from(deployment.udt.codeOutPoint),
    script: IckbUdt.typeScriptFrom(
      ccc.Script.from(deployment.udt.script),
      ccc.Script.from(deployment.logic.script),
    ),
    logicCode: ccc.OutPoint.from(deployment.logic.codeOutPoint),
    logicScript: deployment.logic.script,
    daoManager: dao,
  });
  const logic = new LogicManager(deployment.logic.script, deployment.logic.cellDeps, dao);
  const ownedOwner = new OwnedOwnerManager(
    deployment.ownedOwner.script,
    deployment.ownedOwner.cellDeps,
    dao,
  );
  const order = new OrderManager(
    deployment.order.script,
    deployment.order.cellDeps,
    ickbUdt.script,
  );

  return {
    managers: {
      dao,
      ickbUdt,
      logic,
      ownedOwner,
      order,
    },
  };
}

function resolveDeploymentConfig(d: unknown): DeploymentConfig {
  if (d !== "mainnet" && d !== "testnet") {
    throw new TypeError("unsupported iCKB network");
  }

  const depGroup = d === "mainnet" ? MAINNET_DEP_GROUP : TESTNET_DEP_GROUP;
  const udtCode = d === "mainnet" ? MAINNET_XUDT_CODE : TESTNET_XUDT_CODE;
  const logicCode = d === "mainnet" ? MAINNET_LOGIC_CODE : TESTNET_LOGIC_CODE;
  return {
    udt: fromWithCode(UDT, udtCode, depGroup),
    logic: fromWithCode(ICKB_LOGIC, logicCode, depGroup),
    ownedOwner: from(OWNED_OWNER, depGroup),
    order: from(ORDER, depGroup),
    dao: from(DAO, depGroup),
  };
}

/**
 * Wraps a script-like object into a ScriptDeps structure.
 *
 * @param script - The script or script-like object.
 * @param cellDeps - Additional cell dependencies that the script may require.
 * @returns An object containing the script and its associated cell dependencies.
 */
function fromWithCode(
  script: ccc.ScriptLike,
  codeOutPoint: ccc.OutPointLike,
  ...cellDeps: ccc.CellDep[]
): CodeScriptDeps {
  return {
    ...from(script, ...cellDeps),
    codeOutPoint,
  };
}

function from(script: ccc.ScriptLike, ...cellDeps: ccc.CellDep[]): ScriptDeps {
  return {
    script: ccc.Script.from(script),
    cellDeps,
  };
}
