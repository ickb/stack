import { ccc } from "@ckb-ccc/core";
import { sampleRows } from "./sampler/sampler.ts";

const clientOwner = ccc.ClientPublicMainnet.open();
try {
  for await (const line of sampleRows(clientOwner.value)) {
    process.stdout.write(`${line}\n`);
  }
} finally {
  await clientOwner.dispose();
}
