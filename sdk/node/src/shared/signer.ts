import { ccc } from "@ckb-ccc/core";
import { SignerCombined, signerAccountLocks } from "../../../src/utils/signer.ts";
import type { RuntimeConfig } from "./runtime_config.ts";

/** An actor's signing account: one signer for every configured key, and what it owns. */
export interface KeyAccount {
  signer: ccc.Signer;
  /** The primary key's recommended address. */
  address: string;
  /** The primary key's lock: it receives change, and every other key's cells move to it. */
  primaryLock: ccc.Script;
  /** Every lock the keys own, the primary first: the account the state read scans. */
  accountLocks: ccc.Script[];
}

/** Combines one CCC key signer per configured key, the primary first. */
export async function keyAccount(
  client: ccc.Client,
  privateKeys: RuntimeConfig["privateKeys"],
): Promise<KeyAccount> {
  // BEFORE EDITING, STOP AND PROVE, LOCAL SAFETY IS NOT ENOUGH:
  // - OWNER: secret purpose boundary.
  // - INVARIANT: private keys pass only to signer construction and signing.
  // - FAILURE MODE: passing keys to logs, events, errors, telemetry, redaction, masking, or test hooks leaks signing authority.
  const signer = new SignerCombined(
    privateKeys.map((key) => new ccc.SignerCkbPrivateKey(client, key)),
  );
  const address = await signer.getRecommendedAddressObj();
  const primaryLock = address.script;
  return {
    signer,
    address: address.toString(),
    primaryLock,
    accountLocks: await signerAccountLocks(signer, primaryLock),
  };
}
