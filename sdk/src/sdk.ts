import type { ccc } from "@ckb-ccc/core";
import { getConfig } from "./constants.ts";
import { IckbSdkL1 } from "./conversion/sdk_l1_class.ts";
import type {
  AccountState,
  BuildBaseTransactionOptions,
  CompleteIckbTransactionOptions,
  ConversionTransactionOptions,
  ConversionTransactionResult,
  GetL1StateOptions,
  SdkManagers,
  SystemState,
} from "./conversion/sdk_types.ts";
import type { OrderGroup } from "./order/cells.ts";
import type { Info } from "./order/info.ts";
import type { SupportedChain, ValueComponents } from "./utils/index.ts";

/**
 * The whole SDK, which the Node actors drive by relative import; the package barrel
 * exposes the two conversion-workflow methods, and its assignment checks they agree.
 */
export interface IckbSdk {
  /** Builds and completes a conversion, or returns a typed planning failure. */
  buildConversionTransaction(
    txLike: ccc.TransactionLike,
    options: ConversionTransactionOptions,
  ): Promise<ConversionTransactionResult>;
  /** Reads system, user-order, and account state against one sampled tip. */
  getL1AccountState(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: GetL1StateOptions,
  ): Promise<{
    system: SystemState;
    user: { orders: OrderGroup[] };
    account: AccountState;
  }>;
  /** Adds requested withdrawal, collection, receipt, and ready-withdrawal steps. */
  buildBaseTransaction(
    txLike: ccc.TransactionLike,
    options?: BuildBaseTransactionOptions,
  ): ccc.Transaction;
  /** Adds order-group inputs for collection or fulfilled-order cleanup. */
  collect(txLike: ccc.TransactionLike, groups: OrderGroup[]): ccc.Transaction;
  /** Completes iCKB inputs and fees without signing or sending the transaction. */
  completeTransaction(
    txLike: ccc.TransactionLike,
    options: CompleteIckbTransactionOptions,
  ): Promise<ccc.Transaction>;
  /** Adds a user-owned order request, deriving its lock from a signer when needed. */
  request(
    txLike: ccc.TransactionLike,
    user: ccc.Signer | ccc.Script,
    info: Info,
    amounts: ValueComponents,
  ): Promise<ccc.Transaction>;
}

// eslint-disable-next-line @typescript-eslint/no-shadow -- Preserve the runtime constructor name.
const IckbSdkImplementation = class IckbSdk extends IckbSdkL1 {
  /** Creates the SDK for one chain's deployment. */
  public static fromChain(chain: SupportedChain): IckbSdk {
    const {
      managers: { ickbUdt, ownedOwner, logic, order },
    } = getConfig(chain);
    return new IckbSdk({ ickbUdt, ownedOwner, ickbLogic: logic, order });
  }
};

/** Concrete iCKB SDK constructor and static estimators. */
// eslint-disable-next-line @typescript-eslint/no-redeclare -- The public type and runtime constructor intentionally share a name.
export const IckbSdk: {
  new (managers: SdkManagers): IckbSdk;
  fromChain: (chain: SupportedChain) => IckbSdk;
} = IckbSdkImplementation;
