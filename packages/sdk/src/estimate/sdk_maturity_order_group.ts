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
    new OrderCell({
      cell: order.cell,
      data: order.data,
      ckbUnoccupied: order.ckbUnoccupied,
      absTotal: order.absTotal,
      absProgress: order.absProgress,
      maturity: maturity(order, system),
    }),
    group.origin,
  );
}
