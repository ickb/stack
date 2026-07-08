import { ccc } from "@ckb-ccc/core";
import { IckbUdt, LogicManager, OwnedOwnerManager } from "@ickb/core";
import { DaoManager } from "@ickb/dao";
import { OrderManager } from "@ickb/order";
import { unique, type ScriptDeps } from "@ickb/utils";

/**
 * Script deps plus an optional code out point for scripts used as direct code deps.
 *
 * @public
 */
export interface CodeScriptDeps extends ScriptDeps {
  /** Optional direct code out point for deployments that reference code by cell dep. */
  codeOutPoint: ccc.OutPointLike | undefined;
}

/**
 * Deployment scripts and cell deps used to construct SDK managers.
 *
 * @public
 */
export interface IckbDeploymentConfig {
  /** xUDT type script deps and optional code out point. */
  udt: CodeScriptDeps;
  /** iCKB logic script deps and optional code out point. */
  logic: CodeScriptDeps;
  /** Owned-owner lock script deps. */
  ownedOwner: ScriptDeps;
  /** Order lock script deps. */
  order: ScriptDeps;
  /** Nervos DAO type script deps. */
  dao: ScriptDeps;
}

interface ResolvedDeploymentConfig {
  deployment: IckbDeploymentConfig;
  bots: ccc.ScriptLike[];
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
 * Array of known bot scripts on the mainnet.
 */
const MAINNET_KNOWN_BOTS = [
  {
    codeHash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
    hashType: "type",
    args: "0xd096cb29e2f68a85a46bd6bf6cbee6327959ba64",
  },
];

/**
 * Array of known bot scripts on the testnet.
 */
const TESTNET_KNOWN_BOTS = [
  {
    codeHash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
    hashType: "type",
    args: "0xb4380110f7679ac31cefe4925485645d82bf619f",
  },
];

/**
 * Retrieves the configuration for the given deployment environment.
 *
 * Accepts either a string identifier ("mainnet" or "testnet") or a custom
 * deployment configuration object containing script dependencies.
 *
 * It sets up various managers (UDT, Logic, OwnedOwner, Order, Dao) and also
 * aggregates a unique list of known bot scripts.
 *
 * @param d - Either a network identifier ("mainnet"/"testnet") or an explicit deployment config.
 * @param bots - An optional array of bot script-like objects to augment the list of known bots.
 * @returns An object containing the instantiated managers and bots.
 *
 * @remarks Builders still return partial transactions. `IckbSdk` owns the
 * shared iCKB completion path as `sdk.completeTransaction(...)`, which callers
 * should invoke explicitly before send. Custom `udt` and `logic` config entries
 * must include `codeOutPoint` values because the SDK adds those code deps
 * directly.
 *
 * @public
 */
export function getConfig(
  d: "mainnet" | "testnet" | IckbDeploymentConfig,
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
  const { deployment, bots: knownBots } = resolveDeploymentConfig(d, bots);

  const dao = new DaoManager(deployment.dao.script, deployment.dao.cellDeps);

  const ickbUdt = new IckbUdt(
    definedCodeOutPoint(deployment.udt.codeOutPoint, "xUDT"),
    IckbUdt.typeScriptFrom(
      ccc.Script.from(deployment.udt.script),
      ccc.Script.from(deployment.logic.script),
    ),
    definedCodeOutPoint(deployment.logic.codeOutPoint, "Logic"),
    deployment.logic.script,
    dao,
  );
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
    bots: [...unique(knownBots.map((b) => ccc.Script.from(b)))],
  };
}

function resolveDeploymentConfig(
  d: "mainnet" | "testnet" | IckbDeploymentConfig,
  bots: ccc.ScriptLike[],
): ResolvedDeploymentConfig {
  if (d !== "mainnet" && d !== "testnet") {
    return { deployment: d, bots };
  }

  const depGroup = d === "mainnet" ? MAINNET_DEP_GROUP : TESTNET_DEP_GROUP;
  const udtCode = d === "mainnet" ? MAINNET_XUDT_CODE : TESTNET_XUDT_CODE;
  const logicCode = d === "mainnet" ? MAINNET_LOGIC_CODE : TESTNET_LOGIC_CODE;
  const networkBots = d === "mainnet" ? MAINNET_KNOWN_BOTS : TESTNET_KNOWN_BOTS;
  return {
    deployment: {
      udt: fromWithCode(UDT, udtCode, depGroup),
      logic: fromWithCode(ICKB_LOGIC, logicCode, depGroup),
      ownedOwner: from(OWNED_OWNER, depGroup),
      order: from(ORDER, depGroup),
      dao: from(DAO, depGroup),
    },
    bots: bots.concat(networkBots),
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

function definedCodeOutPoint(
  codeOutPoint: ccc.OutPointLike | undefined,
  label: string,
): ccc.OutPoint {
  if (codeOutPoint === undefined) {
    throw new Error(`custom config missing ${label} code outPoint`);
  }

  return ccc.OutPoint.from(codeOutPoint);
}
