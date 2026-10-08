import { ccc } from "@ckb-ccc/core";
import { expect, it } from "vitest";
import { FakeCkbSigner, script, StubClient } from "../src/index.ts";

it("exposes the configured locks as CKB testnet addresses", async () => {
  const locks = [script("11"), script("22", "0x01")];
  const signer = new FakeCkbSigner(new StubClient({}), locks);

  await signer.connect();

  expect(signer.type).toBe(ccc.SignerType.CKB);
  expect(signer.signType).toBe(ccc.SignerSignType.CkbSecp256k1);
  await expect(signer.isConnected()).resolves.toBe(true);
  await expect(signer.getInternalAddress()).resolves.toBe("ckt1test");
  await expect(signer.getAddressObjs()).resolves.toEqual(
    locks.map((lock) => new ccc.Address(lock, "ckt")),
  );
});
