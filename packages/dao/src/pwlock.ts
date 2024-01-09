import { default as createKeccak } from "keccak";
import { bytes } from "@ckb-lumos/codec";
import { Cell, blockchain } from "@ckb-lumos/base";
import { TransactionSkeletonType, createTransactionFromSkeleton } from "@ckb-lumos/helpers";
import { createP2PKHMessageGroup } from "@ckb-lumos/common-scripts";
import { I8Cell, I8Script, scriptEq, witness } from "./cell";
import { defaultScript } from "./config";

export interface EthereumRpc {
    (payload: { method: 'personal_sign'; params: [string /*from*/, string /*message*/] }): Promise<string>;
}

export interface EthereumProvider {
    selectedAddress: string;
    isMetaMask?: boolean;
    enable: () => Promise<string[]>;
    addListener: (event: 'accountsChanged', listener: (addresses: string[]) => void) => void;
    removeEventListener: (event: 'accountsChanged', listener: (addresses: string[]) => void) => void;
    request: EthereumRpc;
}

export function getEthereumProvider() {
    // @ts-ignore
    return window.ethereum as EthereumProvider;
}

export function pwlockSifter(inputs: Iterable<Cell>, ethereumAddress: string) {
    const owned: I8Cell[] = [];
    const unknowns: Cell[] = [];

    const accountLock = I8Script.from({
        ...defaultScript("PW_LOCK"),
        args: ethereumAddress,
        [witness]: "0x" + "00".repeat(65)
    });

    for (const c of inputs) {
        if (!scriptEq(c.cellOutput.lock, accountLock)) {
            unknowns.push(c);
            continue;
        }

        owned.push(I8Cell.from({ ...c, lock: accountLock }));
    }

    return { owned, unknowns };
}

export async function pwlockSigner(transaction: TransactionSkeletonType, ethereumAddress: string) {
    // just like P2PKH: https://github.com/nervosnetwork/ckb-system-scripts/wiki/How-to-sign-transaction
    const accountLock = { ...defaultScript("PW_LOCK"), args: ethereumAddress };

    const keccak = createKeccak("keccak256");

    const messageForSigning = createP2PKHMessageGroup(transaction, [accountLock], {
        hasher: {
            update: (message) => keccak.update(Buffer.from(new Uint8Array(message))),
            digest: () => keccak.digest(),
        },
    })[0];

    const ethereum = getEthereumProvider();

    let signedMessage = await ethereum.request({
        method: "personal_sign",
        params: [ethereum.selectedAddress, messageForSigning.message],
    });

    let v = Number.parseInt(signedMessage.slice(-2), 16);
    if (v >= 27) v -= 27;
    signedMessage = "0x" + signedMessage.slice(2, -2) + v.toString(16).padStart(2, "0");

    const index = transaction.inputs.findIndex((c) => scriptEq(c.cellOutput.lock, accountLock));
    const unpackedWitness = blockchain.WitnessArgs.unpack(transaction.witnesses.get(index)!)
    const packedWitness = bytes.hexify(
        blockchain.WitnessArgs.pack({
            ...unpackedWitness,
            lock: signedMessage
        })
    );

    transaction = transaction.update("witnesses", (witnesses) => witnesses.set(index, packedWitness));

    return createTransactionFromSkeleton(transaction);
}