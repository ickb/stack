import { ccc } from "@ckb-ccc/core";
import {
  byte32FromByte,
  script,
  StubClient,
  headerLike as testHeaderLike,
  transactionWithHeader,
} from "@ickb/testkit";
import { ReceiptData } from "../../../src/entities.ts";

export const RECEIPT_PREFIX_DECODING_SUITE = "receipt prefix decoding";

export function headerLike(ar: bigint): ccc.ClientBlockHeader {
  return testHeaderLike({
    dao: { c: 0n, ar, s: 0n, u: 0n },
    epoch: [1n, 0n, 1n],
    number: 1n,
  });
}

export function clientWithHeader(header: ccc.ClientBlockHeader): ccc.Client {
  return new StubClient({
    getTransactionWithHeader: async (): ReturnType<
      ccc.Client["getTransactionWithHeader"]
    > => {
      await Promise.resolve();
      return transactionWithHeader(header);
    },
  });
}

export function receiptOutputData(
  depositQuantity: number,
  depositAmount: ccc.FixedPoint,
): ccc.Hex {
  return ccc.hexFrom([
    ...ReceiptData.from({ depositQuantity, depositAmount }).toBytes(),
    0xab,
    0xcd,
  ]);
}

export function receiptCell(outputData: ccc.Hex, logic: ccc.Script): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte("11"), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock: script("22"),
      type: logic,
    },
    outputData,
  });
}

export function xudtCell(
  balance: ccc.Num,
  type: ccc.Script,
  lock = script("22"),
): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte("99"), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100),
      lock,
      type,
    },
    outputData: ccc.numLeToBytes(balance, 16),
  });
}

export function signerWithCells(cells: ccc.Cell[], client: ccc.Client): ccc.Signer {
  return new TestSigner(client, cells);
}

class TestSigner extends ccc.Signer {
  private readonly cells: ccc.Cell[];

  constructor(client: ccc.Client, cells: ccc.Cell[]) {
    super(client);
    this.cells = cells;
  }

  public override get type(): ccc.SignerType {
    return ccc.SignerType.CKB;
  }

  public override get signType(): ccc.SignerSignType {
    return ccc.SignerSignType.CkbSecp256k1;
  }

  public override async connect(): Promise<void> {
    await Promise.resolve();
  }

  public override async isConnected(): Promise<boolean> {
    await Promise.resolve();
    return true;
  }

  public override async getInternalAddress(): Promise<string> {
    await Promise.resolve();
    return "ckt1test";
  }

  public override async getAddressObjs(): Promise<ccc.Address[]> {
    await Promise.resolve();
    return [new ccc.Address(script("22"), "ckt")];
  }

  public override async *findCells(): AsyncGenerator<ccc.Cell> {
    await Promise.resolve();
    yield* this.cells;
  }
}

export { byte32FromByte, script, StubClient, transactionWithHeader };
