import { OrderCell, OrderGroup } from "@ickb/order";
import type { SystemState } from "../client/sdk_types.ts";
import { maturity } from "./sdk_maturity.ts";

export function orderGroupWithMaturity(
  group: OrderGroup,
  system: SystemState,
): OrderGroup {
  const { order } = group;
  return new OrderGroup(
    group.master,
    new OrderCell(
      order.cell,
      order.data,
      order.ckbUnoccupied,
      order.absTotal,
      order.absProgress,
      maturity(order, system),
    ),
    group.origin,
  );
}
