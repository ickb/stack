import { ccc } from "@ckb-ccc/core";
import { sampleRows } from "./sampler.ts";

const client = new ccc.ClientPublicMainnet({
  url: "https://mainnet.ckb.dev/",
  fallbacks: [],
});
for await (const line of sampleRows(client)) {
  process.stdout.write(`${line}\n`);
}
