import { ccc } from "@ckb-ccc/ccc";
import { byte32FromByte, script } from "@ickb/testkit";

export function transactionWith(
  inputCount: number,
  outputCount: number,
): ccc.Transaction {
  const transaction = ccc.Transaction.default();
  transaction.inputs = Array.from({ length: inputCount }, () =>
    ccc.CellInput.from({ previousOutput: { txHash: byte32FromByte("11"), index: 0n } }),
  );
  transaction.outputs = Array.from({ length: outputCount }, () =>
    ccc.CellOutput.from({ capacity: 1n, lock: script("11") }),
  );
  return transaction;
}
