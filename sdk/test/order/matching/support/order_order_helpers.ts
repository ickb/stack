import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, FRESH_BLOCK } from "@ickb/testkit";
import { ICKB_UDT, ORDER } from "../../../../src/constants.ts";
import { OrderCell } from "../../../../src/order/cells.ts";
import { Info } from "../../../../src/order/info.ts";
import { OrderData } from "../../../../src/order/order_data.ts";
import { Ratio } from "../../../../src/order/ratio.ts";

export function directionalInfo(): Info {
  return Info.from({
    ckbToUdt: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
    udtToCkb: Ratio.empty(),
    ckbMinMatchLog: 0,
  });
}

export function dualInfo(): Info {
  const ratio = Ratio.from({ ckbScale: 1n, udtScale: 1n });
  return Info.from({
    ckbToUdt: ratio,
    udtToCkb: ratio,
    ckbMinMatchLog: 0,
  });
}

export function absoluteOrderCell(options: {
  master: { txHash: `0x${string}`; index: bigint };
  outPointByte: string;
  info: Info;
  lock?: ccc.Script;
}): OrderCell {
  return makeOrderCell({
    ckbUnoccupied: ccc.fixedPointFrom(100),
    udtValue: 0n,
    info: options.info,
    master: { type: "absolute", value: options.master },
    lock: options.lock,
    outPoint: { txHash: byte32FromByte(options.outPointByte), index: 0n },
  });
}

export function makeOrderCell(options: {
  ckbUnoccupied: ccc.FixedPoint;
  udtValue: ccc.FixedPoint;
  info: Info;
  lock?: ccc.Script;
  master:
    | {
        type: "relative";
        value: {
          padding: Uint8Array;
          distance: bigint;
        };
      }
    | {
        type: "absolute";
        value: {
          txHash: `0x${string}`;
          index: bigint;
        };
      };
  outPoint: {
    txHash: `0x${string}`;
    index: bigint;
  };
}): OrderCell {
  const lock = options.lock ?? ORDER;
  const outputData = OrderData.from({
    udtValue: options.udtValue,
    master: options.master,
    info: options.info,
  }).toBytes();
  const minimalCell = ccc.Cell.from({
    previousOutput: {
      txHash: byte32FromByte("ff"),
      index: 0n,
    },
    cellOutput: {
      lock,
      type: ICKB_UDT,
    },
    outputData,
  });

  return OrderCell.mustFrom(
    ccc.Cell.from({
      outPoint: options.outPoint,
      cellOutput: {
        capacity: minimalCell.cellOutput.capacity + options.ckbUnoccupied,
        lock,
        type: ICKB_UDT,
      },
      outputData,
    }),
    FRESH_BLOCK,
  );
}
