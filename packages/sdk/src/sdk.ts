import type { ccc } from "@ckb-ccc/core";
import type { IckbUdt, LogicManager, OwnedOwnerManager } from "@ickb/core";
import type { OrderManager } from "@ickb/order";
import type { ValueComponents } from "@ickb/utils";
import { IckbSdkL1 } from "./client/sdk_l1_class.ts";
import { setSdkManagers } from "./client/sdk_state_store.ts";
import type {
  ConversionOrderEstimate,
  IckbToCkbOrderEstimate,
  MaturityOrderInput,
  SystemState,
} from "./client/sdk_types.ts";
import type { getConfig } from "./constants.ts";
import { estimate, estimateIckbToCkbOrder } from "./estimate/sdk_estimate.ts";
import { maturity } from "./estimate/sdk_maturity.ts";

export { IckbSdkBase } from "./client/sdk_base.ts";
export { IckbSdkConversion } from "./client/sdk_conversion_class.ts";
export { IckbSdkL1 } from "./client/sdk_l1_class.ts";
export type {
  AccountAvailabilityProjection,
  AccountState,
  BuildBaseTransactionOptions,
  CkbCumulative,
  CompleteIckbTransactionOptions,
  ConversionDirection,
  ConversionMetadata,
  ConversionNotice,
  ConversionOrderEstimate,
  ConversionTransactionContext,
  ConversionTransactionContextProjection,
  ConversionTransactionFailureReason,
  ConversionTransactionOptions,
  ConversionTransactionResult,
  GetL1StateOptions,
  GetPoolDepositsOptions,
  IckbToCkbOrderEstimate,
  MaturityOrderInput,
  PoolDepositRangeOptions,
  PoolDepositState,
  SystemState,
} from "./client/sdk_types.ts";
export { estimateMaturityFeeThreshold } from "./estimate/sdk_estimate.ts";
export {
  projectAccountAvailability,
  projectConversionTransactionContext,
} from "./estimate/sdk_projection.ts";
export { sendAndWaitForCommit } from "./send/send_and_wait.ts";
export type {
  SendAndWaitForCommitEvent,
  SendAndWaitForCommitOptions,
} from "./send/send_and_wait.ts";

/**
 * SDK for managing iCKB operations.
 *
 * @public
 */
export class IckbSdk extends IckbSdkL1 {
  /** Creates an SDK from resolved protocol managers and bot lock scripts. */
  constructor(
    ...[ickbUdt, ownedOwner, ickbLogic, order, bots]: [
      ickbUdt: IckbUdt,
      ownedOwner: OwnedOwnerManager,
      ickbLogic: LogicManager,
      order: OrderManager,
      bots: ccc.Script[],
    ]
  ) {
    super();
    setSdkManagers(this, { ickbUdt, ownedOwner, ickbLogic, order, bots });
  }

  /** Estimates one conversion order against the sampled system state. */
  public static estimate(
    isCkb2Udt: boolean,
    amounts: ValueComponents,
    system: SystemState,
    options?: { fee?: ccc.Num; feeBase?: ccc.Num },
  ): ConversionOrderEstimate {
    return estimate(isCkb2Udt, amounts, system, options);
  }

  /** Estimates the order path for an iCKB-to-CKB conversion when one is available. */
  public static estimateIckbToCkbOrder(
    amounts: ValueComponents,
    system: SystemState,
  ): IckbToCkbOrderEstimate | undefined {
    return estimateIckbToCkbOrder(amounts, system);
  }

  /**
   * Creates an SDK from a chain config object.
   */
  public static fromConfig(config: ReturnType<typeof getConfig>): IckbSdk {
    const {
      managers: { ickbUdt, ownedOwner, logic, order },
      bots,
    } = config;

    return new IckbSdk(ickbUdt, ownedOwner, logic, order, bots);
  }

  /** Estimates maturity for an order input from the sampled system state. */
  public static maturity(o: MaturityOrderInput, system: SystemState): bigint | undefined {
    return maturity(o, system);
  }
}
