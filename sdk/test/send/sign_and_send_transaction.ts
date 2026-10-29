import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";
import { committedTransactionResponse, headerLike, script } from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import {
  isCommittedIn,
  signAndSendTransaction,
  TransactionExpiredError,
  type TransactionProof,
} from "../../src/send/sign_and_send_transaction.ts";
import { jsonRpcRequestor } from "../../src/utils/utils.ts";
import { hash } from "../transaction/base/support/sdk_core_support.ts";
import { PROOF_BLOCK, PROOF_TXS } from "./fixtures/transaction_proof.ts";

const TX_HASH = hash("81");
const TIP_EPOCH = ccc.Epoch.from([10n, 0n, 1n]);
const WITNESSES_ROOT = hash("c1");
// CCC raises a capacity below the occupied minimum wherever it builds a cell, so the
// fixtures use real sizes to keep every byte compared as written.
const CAPACITY = ccc.fixedPointFrom(100);
const CREATING = creatingTransaction(CAPACITY);
const INPUT_OUT_POINT = { txHash: CREATING.hash(), index: 0n };
const ALTERED_BODY_ERROR =
  "Signer altered the transaction inputs, outputs or outputs data";

describe("signAndSendTransaction", () => {
  it("verifies inputs before signing and records the hash before the send RPC", async () => {
    const signed = bodyTransaction();
    const { signer, signedHash, getTransaction, send, mark, signTransaction } =
      signerFixture(signed);
    const calls: string[] = [];
    signedHash.mockImplementation(() => {
      calls.push("hash");
      return TX_HASH;
    });
    getTransaction.mockImplementation(async (txHash) => {
      await Promise.resolve();
      calls.push("getTransaction");
      return creatingResponse(txHash);
    });
    signTransaction.mockImplementation(async () => {
      await Promise.resolve();
      calls.push("sign");
      return signed;
    });
    send.mockImplementation(async () => {
      await Promise.resolve();
      calls.push("send");
      return TX_HASH;
    });

    await expect(
      signAndSendTransaction(signer, bodyTransaction(), (txHash) => {
        expect(txHash).toBe(TX_HASH);
        calls.push("record");
      }),
    ).resolves.toBe(TX_HASH);

    expect(calls).toEqual(["getTransaction", "sign", "hash", "record", "send"]);
    expect(mark).not.toHaveBeenCalled();
  });

  it("rejects an excessive signed fee rate before recording or broadcast", async () => {
    const creating = creatingTransaction(CAPACITY + cccA.DEFAULT_MAX_FEE_RATE * 10_000n);
    const { signer, send } = signerFixture(bodyTransaction(undefined, creating), [
      creating,
    ]);
    const recordTxHash = vi.fn<(txHash: ccc.Hex) => void>();

    await expect(
      signAndSendTransaction(signer, bodyTransaction(undefined, creating), recordTxHash),
    ).rejects.toBeInstanceOf(ccc.ErrorClientMaxFeeRateExceeded);

    expect(recordTxHash).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("signAndSendTransaction input verification", () => {
  it("accepts a planned cell equal to the creating transaction's output", async () => {
    const { signer } = signerFixture(bodyTransaction());

    await expect(signAndSendTransaction(signer, bodyTransaction(CAPACITY))).resolves.toBe(
      TX_HASH,
    );
  });

  it("rejects a planned capacity under what the creating transaction created", async () => {
    const { signer, signTransaction, send } = signerFixture(bodyTransaction());

    await expect(
      signAndSendTransaction(signer, bodyTransaction(CAPACITY - 1n)),
    ).rejects.toThrow(
      `Input ${ccc.OutPoint.from(INPUT_OUT_POINT).toHex()} differs from the cell its transaction created`,
    );

    expect(signTransaction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a planned lock the creating transaction did not create", async () => {
    const { signer, send } = signerFixture(bodyTransaction());
    const requested = bodyTransaction(CAPACITY);
    for (const input of requested.inputs) {
      input.cellOutput = ccc.CellOutput.from({ capacity: CAPACITY, lock: script("22") });
    }

    await expect(signAndSendTransaction(signer, requested)).rejects.toThrow(
      "differs from the cell its transaction created",
    );

    expect(send).not.toHaveBeenCalled();
  });

  it("rejects planned data the creating transaction did not create", async () => {
    const { signer, send } = signerFixture(bodyTransaction());
    const requested = bodyTransaction(CAPACITY);
    for (const input of requested.inputs) {
      input.outputData = "0x01";
    }

    await expect(signAndSendTransaction(signer, requested)).rejects.toThrow(
      "differs from the cell its transaction created",
    );

    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a node body whose hash is not the one the OutPoint names", async () => {
    const { signer, getTransaction, send } = signerFixture(bodyTransaction());
    getTransaction.mockResolvedValue(
      committedTransactionResponse(creatingTransaction(CAPACITY, "0x02")),
    );

    await expect(signAndSendTransaction(signer, bodyTransaction())).rejects.toThrow(
      `Transaction ${INPUT_OUT_POINT.txHash} was answered with a body of another hash`,
    );

    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an input whose creating transaction is unknown", async () => {
    const { signer, send } = signerFixture(bodyTransaction(), []);

    await expect(signAndSendTransaction(signer, bodyTransaction())).rejects.toThrow(
      `Transaction ${INPUT_OUT_POINT.txHash} not found`,
    );

    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an input index beyond the creating transaction's outputs", async () => {
    const requested = bodyTransaction(undefined, CREATING, 1n);
    const { signer, send } = signerFixture(requested);

    await expect(signAndSendTransaction(signer, requested)).rejects.toThrow(
      `Input ${ccc.OutPoint.from({ ...INPUT_OUT_POINT, index: 1n }).toHex()} is not an output of its transaction`,
    );

    expect(send).not.toHaveBeenCalled();
  });

  it("reads the cache before the node and each creating transaction once", async () => {
    const creating = creatingTransaction(ccc.fixedPointFrom(50), "0x", 2);
    const cached = creatingTransaction(CAPACITY);
    const requested = ccc.Transaction.from({
      inputs: [
        { previousOutput: { txHash: creating.hash(), index: 0n } },
        { previousOutput: { txHash: creating.hash(), index: 1n } },
        { previousOutput: { txHash: cached.hash(), index: 0n } },
      ],
      outputs: [{ capacity: ccc.fixedPointFrom(200), lock: script("11") }],
      outputsData: ["0x"],
    });
    const { signer, getTransaction, getTransactionResponse } = signerFixture(requested, [
      creating,
    ]);
    getTransactionResponse.mockImplementation(async (txHash) => {
      await Promise.resolve();
      return ccc.hexFrom(txHash) === cached.hash()
        ? committedTransactionResponse(cached)
        : undefined;
    });

    await expect(signAndSendTransaction(signer, requested)).resolves.toBe(TX_HASH);

    expect(getTransaction).toHaveBeenCalledTimes(1);
    expect(getTransaction).toHaveBeenCalledWith(creating.hash());
  });
});

describe("signAndSendTransaction economic body", () => {
  it("accepts signer-owned witness and dependency preparation", async () => {
    const requested = bodyTransaction();
    const prepared = bodyTransaction();
    prepared.witnesses = ["0xaa"];
    prepared.cellDeps = [
      ccc.CellDep.from({
        outPoint: { txHash: hash("93"), index: 0n },
        depType: "depGroup",
      }),
    ];
    prepared.headerDeps = [hash("94")];
    const { signer } = signerFixture(prepared);

    await expect(signAndSendTransaction(signer, requested)).resolves.toBe(TX_HASH);
  });

  it("rejects a connector-added output before fee inspection or broadcast", async () => {
    const altered = bodyTransaction();
    altered.outputs.push(ccc.CellOutput.from({ capacity: 200n, lock: script("22") }));
    altered.outputsData.push("0x");
    const { signer, send } = signerFixture(altered);
    const recordTxHash = vi.fn<(txHash: ccc.Hex) => void>();

    await expect(
      signAndSendTransaction(signer, bodyTransaction(), recordTxHash),
    ).rejects.toThrow(ALTERED_BODY_ERROR);

    expect(recordTxHash).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an in-place edit of the requested outputs data", async () => {
    const requested = bodyTransaction();
    const { signer, send, signTransaction } = signerFixture(requested);
    signTransaction.mockImplementation(async () => {
      await Promise.resolve();
      requested.outputsData[0] = "0x02";
      return requested;
    });

    await expect(signAndSendTransaction(signer, requested)).rejects.toThrow(
      ALTERED_BODY_ERROR,
    );

    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a connector change to an input since value", async () => {
    const altered = bodyTransaction();
    for (const input of altered.inputs) {
      input.since = 1n;
    }
    const { signer, send } = signerFixture(altered);

    await expect(signAndSendTransaction(signer, bodyTransaction())).rejects.toThrow(
      ALTERED_BODY_ERROR,
    );

    expect(send).not.toHaveBeenCalled();
  });

  it("values the verified inputs when connector metadata understates the fee", async () => {
    const creating = creatingTransaction(CAPACITY + cccA.DEFAULT_MAX_FEE_RATE * 10_000n);
    const signed = bodyTransaction(CAPACITY, creating);
    const { signer, send } = signerFixture(signed, [creating]);
    const recordTxHash = vi.fn<(txHash: ccc.Hex) => void>();

    await expect(
      signAndSendTransaction(signer, bodyTransaction(undefined, creating), recordTxHash),
    ).rejects.toBeInstanceOf(ccc.ErrorClientMaxFeeRateExceeded);

    expect(recordTxHash).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

function bodyTransaction(
  inputCapacity?: bigint,
  creating: ccc.Transaction = CREATING,
  index = 0n,
): ccc.Transaction {
  const tx = ccc.Transaction.from({
    inputs: [{ previousOutput: { txHash: creating.hash(), index } }],
    outputs: [{ capacity: CAPACITY, lock: script("11") }],
    outputsData: ["0x01"],
  });
  if (inputCapacity !== undefined) {
    for (const input of tx.inputs) {
      input.cellOutput = plainCellOutput(inputCapacity);
      input.outputData = "0x";
    }
  }
  return tx;
}

describe("signAndSendTransaction DAO interest", () => {
  // The fixture's known Nervos DAO script; a phase-2 input names its deposit block in data.
  const DAO = ccc.Script.from({ codeHash: hash("90"), hashType: "type", args: "0x" });
  const AR = 10n ** 16n;
  // Each request block holds the request transaction alone: its transactions root is the
  // request's hash merged with the block's witnesses root, as `inBlockAlone` proves.
  const REQUEST = requestCreating().hash();
  const committing = ccc.hashCkb(REQUEST, WITNESSES_ROOT);
  // The request headers sit one epoch after the deposit, as the deployed dao.c requires.
  const deposit = headerLike({
    number: 1n,
    epoch: [1n, 0n, 1n],
    hash: hash("a1"),
    dao: { c: 0n, ar: AR, s: 0n, u: 0n },
  });
  const withdrawFlat = headerLike({
    number: 2n,
    epoch: [2n, 0n, 1n],
    hash: hash("b1"),
    transactionsRoot: committing,
    dao: { c: 0n, ar: AR, s: 0n, u: 0n },
  });
  const withdrawDoubled = headerLike({
    number: 2n,
    epoch: [2n, 0n, 1n],
    hash: hash("b2"),
    transactionsRoot: committing,
    dao: { c: 0n, ar: 2n * AR, s: 0n, u: 0n },
  });
  // A real request block of the same height that committed some other transaction.
  const withdrawElsewhere = headerLike({
    number: 2n,
    epoch: [2n, 0n, 1n],
    hash: hash("b3"),
    transactionsRoot: hash("c2"),
    dao: { c: 0n, ar: 2n * AR, s: 0n, u: 0n },
  });

  function requestCreating(): ccc.Transaction {
    return creatingTransaction(CAPACITY, ccc.hexFrom(ccc.numLeToBytes(1n, 8)), 1, DAO);
  }

  /** A body spending one phase-2 request created with `CAPACITY`, naming `deps`. */
  function request(deps: ccc.Hex[]): { creating: ccc.Transaction; tx: ccc.Transaction } {
    const creating = requestCreating();
    const tx = bodyTransaction(undefined, creating);
    tx.headerDeps = deps;
    return { creating, tx };
  }

  it("values a phase-2 input at the headers the transaction names", async () => {
    const flat = request([deposit.hash, withdrawFlat.hash]);
    const { signer } = signerFixture(flat.tx, [flat.creating], {
      deposit,
      withdraw: withdrawFlat,
    });

    await expect(signAndSendTransaction(signer, flat.tx)).resolves.toBe(TX_HASH);

    // The same body at a doubled rate collects the free capacity as interest: all fee.
    const doubled = request([deposit.hash, withdrawDoubled.hash]);
    const fixture = signerFixture(doubled.tx, [doubled.creating], {
      deposit,
      withdraw: withdrawDoubled,
    });
    await expect(
      signAndSendTransaction(fixture.signer, doubled.tx),
    ).rejects.toBeInstanceOf(ccc.ErrorClientMaxFeeRateExceeded);
  });

  it("refuses a phase-2 input whose request header is its own deposit header", async () => {
    // Both deps are real, and the node names the deposit block for the request cell: the
    // interest would be valued at zero while the chain collects it at the doubled rate, but
    // the deposit block does not hold the request.
    const { creating, tx } = request([deposit.hash, withdrawDoubled.hash]);
    const { signer, send } = signerFixture(tx, [creating], {
      deposit,
      withdraw: deposit,
    });

    await expect(signAndSendTransaction(signer, tx)).rejects.toThrow(
      `Transaction ${REQUEST} is not proven in block ${deposit.hash}`,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("proves a request transaction once for all its requests in a send", async () => {
    const pair = creatingTransaction(
      CAPACITY,
      ccc.hexFrom(ccc.numLeToBytes(1n, 8)),
      2,
      DAO,
    );
    const block = headerLike({
      number: 2n,
      epoch: [2n, 0n, 1n],
      hash: hash("b5"),
      transactionsRoot: ccc.hashCkb(pair.hash(), WITNESSES_ROOT),
      dao: { c: 0n, ar: AR, s: 0n, u: 0n },
    });
    const tx = ccc.Transaction.from({
      inputs: [0n, 1n].map((index) => ({
        previousOutput: { txHash: pair.hash(), index },
      })),
      outputs: [{ capacity: 2n * CAPACITY, lock: script("11") }],
      outputsData: ["0x"],
      headerDeps: [deposit.hash, block.hash],
    });
    const { signer } = signerFixture(tx, [pair], { deposit, withdraw: block });
    const requestor = jsonRpcRequestor(signer.client);
    if (requestor === undefined) {
      throw new Error("The fixture client has a requestor");
    }
    const requested = vi.spyOn(requestor, "request");

    await expect(signAndSendTransaction(signer, tx)).resolves.toBe(TX_HASH);
    expect(requested).toHaveBeenCalledExactlyOnceWith("get_transaction_proof", [
      [pair.hash()],
      block.hash,
    ]);
  });

  it("needs a JSON-RPC client to prove a request block", async () => {
    const { creating, tx } = request([deposit.hash, withdrawFlat.hash]);
    const { signer, send } = signerFixture(tx, [creating], {
      deposit,
      withdraw: withdrawFlat,
    });
    Reflect.deleteProperty(signer.client, "requestor");

    await expect(signAndSendTransaction(signer, tx)).rejects.toThrow(
      "Valuing a DAO withdrawal needs a JSON-RPC client",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a phase-2 input whose request block does not hold the request", async () => {
    // Both deps are real request blocks; the node names the one that committed another
    // transaction, so its proof cannot reach that block's transactions root.
    const { creating, tx } = request([deposit.hash, withdrawElsewhere.hash]);
    const { signer, send } = signerFixture(tx, [creating], {
      deposit,
      withdraw: withdrawElsewhere,
    });

    await expect(signAndSendTransaction(signer, tx)).rejects.toThrow(
      `Transaction ${REQUEST} is not proven in block ${withdrawElsewhere.hash}`,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a phase-2 input valued at a header outside the deps", async () => {
    for (const deps of [[deposit.hash], [withdrawFlat.hash]]) {
      const { creating, tx } = request(deps);
      const { signer, send } = signerFixture(tx, [creating], {
        deposit,
        withdraw: withdrawFlat,
      });

      await expect(signAndSendTransaction(signer, tx)).rejects.toThrow(
        "is valued at a header the transaction does not name",
      );
      expect(send).not.toHaveBeenCalled();
    }
  });
});

describe("isCommittedIn", () => {
  const header = cccA.JsonRpcTransformers.blockHeaderTo(PROOF_BLOCK);
  const { second, last } = PROOF_TXS;

  it("follows a real mainnet path from a transaction to its block's root", () => {
    expect(isCommittedIn(second.txHash, header, second.proof)).toBe(true);
    expect(isCommittedIn(last.txHash, header, last.proof)).toBe(true);
  });

  it("refuses another transaction's path or an altered path", () => {
    const { proof } = last.proof;
    expect(isCommittedIn(second.txHash, header, last.proof)).toBe(false);
    expect(isCommittedIn(last.txHash, header, second.proof)).toBe(false);
    const altered: TransactionProof[] = [
      { ...last.proof, witnesses_root: hash("02") },
      {
        ...last.proof,
        proof: { ...proof, lemmas: [hash("03"), ...proof.lemmas.slice(1)] },
      },
      // A path cut short, or run past the root, never lands on the root's position.
      { ...last.proof, proof: { ...proof, lemmas: proof.lemmas.slice(0, -1) } },
      { ...last.proof, proof: { ...proof, lemmas: [...proof.lemmas, hash("04")] } },
      { ...last.proof, proof: { ...proof, indices: [] } },
      { ...last.proof, proof: { ...proof, indices: [...proof.indices, "0x0"] } },
    ];
    for (const variant of altered) {
      expect(isCommittedIn(last.txHash, header, variant)).toBe(false);
    }
  });
});

describe("signAndSendTransaction broadcast outcomes", () => {
  it("accepts a duplicate submission naming the same transaction", async () => {
    const { signer, send } = signerFixture();
    send.mockRejectedValueOnce(duplicatedTransaction(TX_HASH));

    await expect(signAndSendTransaction(signer, ccc.Transaction.default())).resolves.toBe(
      TX_HASH,
    );
  });

  it("treats a duplicate submission naming another transaction as an ambiguous send", async () => {
    const { signer, send } = signerFixture();
    const duplicate = duplicatedTransaction(hash("82"));
    send.mockRejectedValueOnce(duplicate);

    await expect(
      signAndSendTransaction(signer, ccc.Transaction.default()),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "TransactionBroadcastError",
        txHash: TX_HASH,
        cause: duplicate,
      }),
    );
  });

  it("throws a public hash-preserving error when send is ambiguous", async () => {
    const { signer, send } = signerFixture();
    const transportError = new TypeError("fetch failed");
    send.mockRejectedValueOnce(transportError);

    await expect(
      signAndSendTransaction(signer, ccc.Transaction.default()),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "TransactionBroadcastError",
        txHash: TX_HASH,
        cause: transportError,
      }),
    );
  });

  it("keeps the local hash as the identity whatever the node returns", async () => {
    const { signer, send } = signerFixture();
    send.mockResolvedValueOnce(hash("82"));

    await expect(signAndSendTransaction(signer, ccc.Transaction.default())).resolves.toBe(
      TX_HASH,
    );
  });
});

describe("signAndSendTransaction broadcast deadline", () => {
  it("refuses the send once the tip has reached the deadline, before recording", async () => {
    const { signer, send, getTipHeader } = signerFixture(bodyTransaction());
    const recordTxHash = vi.fn<(txHash: ccc.Hex) => void>();

    await expect(
      signAndSendTransaction(signer, bodyTransaction(), recordTxHash, TIP_EPOCH),
    ).rejects.toBeInstanceOf(TransactionExpiredError);

    expect(getTipHeader).toHaveBeenCalledTimes(1);
    expect(recordTxHash).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("sends while the tip is before the deadline, and reads no tip without one", async () => {
    const { signer, getTipHeader } = signerFixture(bodyTransaction());

    await expect(
      signAndSendTransaction(
        signer,
        bodyTransaction(),
        undefined,
        TIP_EPOCH.add([0n, 1n, 2n]),
      ),
    ).resolves.toBe(TX_HASH);
    await expect(signAndSendTransaction(signer, bodyTransaction())).resolves.toBe(
      TX_HASH,
    );
    expect(getTipHeader).toHaveBeenCalledTimes(1);
  });
});

function duplicatedTransaction(txHash: ccc.Hex): ccc.ErrorClientDuplicatedTransaction {
  return new ccc.ErrorClientDuplicatedTransaction(
    { code: -1107, data: `Duplicated(Byte32(${txHash}))` },
    txHash,
  );
}

function signerFixture(
  signed = ccc.Transaction.default(),
  creating: readonly ccc.Transaction[] = [CREATING],
  dao?: { deposit: ccc.ClientBlockHeader; withdraw: ccc.ClientBlockHeader },
): {
  signer: ccc.Signer;
  signedHash: ReturnType<typeof vi.fn<() => ccc.Hex>>;
  getTransaction: ReturnType<
    typeof vi.fn<
      (txHash: ccc.HexLike) => Promise<ccc.ClientTransactionResponse | undefined>
    >
  >;
  getTransactionResponse: ReturnType<
    typeof vi.fn<
      (txHash: ccc.HexLike) => Promise<ccc.ClientTransactionResponse | undefined>
    >
  >;
  send: ReturnType<typeof vi.fn<(tx: ccc.TransactionLike) => Promise<ccc.Hex>>>;
  mark: ReturnType<typeof vi.fn<(tx: ccc.TransactionLike) => Promise<void>>>;
  signTransaction: ReturnType<typeof vi.fn<() => Promise<ccc.Transaction>>>;
  getTipHeader: ReturnType<typeof vi.fn<() => Promise<ccc.ClientBlockHeader>>>;
} {
  const signedHash = vi.spyOn(signed, "hash").mockReturnValue(TX_HASH);
  // The node answers with the creating transaction whose hash is asked, as a chain would.
  const getTransaction = vi.fn(async (txHash: ccc.HexLike) => {
    await Promise.resolve();
    const transaction = creating.find((tx) => tx.hash() === ccc.hexFrom(txHash));
    return transaction === undefined
      ? undefined
      : committedTransactionResponse(transaction);
  });
  // An empty cache by default; a test scripts a hit per hash.
  const getTransactionResponse = vi.fn<
    (txHash: ccc.HexLike) => Promise<ccc.ClientTransactionResponse | undefined>
  >(async () => {
    await Promise.resolve();
  });
  const send = vi.fn(async () => {
    await Promise.resolve();
    return TX_HASH;
  });
  const mark = vi.fn(async () => {
    await Promise.resolve();
  });
  const getTipHeader = vi.fn(async () => {
    await Promise.resolve();
    return headerLike({ epoch: TIP_EPOCH });
  });
  // CCC values a phase-2 DAO input from the deposit header by number and the header
  // beside the cell; the fixture answers both from `dao`.
  const getHeaderByNumber = vi.fn(async () => {
    await Promise.resolve();
    return dao?.deposit;
  });
  const getCellWithHeader = vi.fn(async (outPointLike: ccc.OutPointLike) => {
    await Promise.resolve();
    const outPoint = ccc.OutPoint.from(outPointLike);
    const created = creating
      .find((tx) => tx.hash() === outPoint.txHash)
      ?.getOutput(outPoint.index);
    return dao === undefined || created === undefined
      ? undefined
      : {
          cell: ccc.Cell.from({
            outPoint,
            cellOutput: created.cellOutput,
            outputData: created.outputData,
          }),
          header: dao.withdraw,
        };
  });
  // The node proves each request in a block of its own (see the DAO interest suite).
  const requestor = ccc.RequestorJsonRpc.new({
    transport: {
      request: async (payload): Promise<ccc.JsonRpcResponse> => {
        await Promise.resolve();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- the SDK sends the hashes, then the block.
        const [, blockHash] = payload.params as [ccc.Hex[], ccc.Hex];
        return {
          id: payload.id,
          jsonrpc: "2.0",
          result: {
            block_hash: blockHash,
            witnesses_root: WITNESSES_ROOT,
            proof: { indices: ["0x0"], lemmas: [] },
          },
        };
      },
    },
  });
  const client = {
    requestor,
    getTransaction,
    getTipHeader,
    getHeaderByNumber,
    getCellWithHeader,
    // CCC resolves the Nervos DAO script while checking inputs for withdrawal profit.
    getKnownScript: vi.fn(async () => {
      await Promise.resolve();
      return { codeHash: hash("90"), hashType: "type", cellDeps: [] };
    }),
    sendTransactionNoCache: send,
    cache: { markTransactions: mark, getTransactionResponse },
  };
  const signTransaction = vi.fn(async () => {
    await Promise.resolve();
    return signed;
  });
  const signer = { client, signTransaction };
  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Focused fixture supplies only the public signer/client methods under test.
    signer: signer as unknown as ccc.Signer,
    signedHash,
    getTransaction,
    getTransactionResponse,
    send,
    mark,
    signTransaction,
    getTipHeader,
  };
}

/** A node answer for one of the creating transactions, looked up by the hash asked. */
function creatingResponse(
  txHash: ccc.HexLike,
): ccc.ClientTransactionResponse | undefined {
  return CREATING.hash() === ccc.hexFrom(txHash)
    ? committedTransactionResponse(CREATING)
    : undefined;
}

/** A transaction creating `count` cells of `capacity` with `data`, typed when `type` is given. */
function creatingTransaction(
  capacity: bigint,
  data: ccc.Hex = "0x",
  count = 1,
  type?: ccc.Script,
): ccc.Transaction {
  return ccc.Transaction.from({
    outputs: Array.from({ length: count }, () =>
      ccc.CellOutput.from({ capacity, lock: script("11"), type }),
    ),
    outputsData: Array.from({ length: count }, () => data),
  });
}

function plainCellOutput(capacity: bigint): ccc.CellOutput {
  return ccc.CellOutput.from({ capacity, lock: script("11") });
}
