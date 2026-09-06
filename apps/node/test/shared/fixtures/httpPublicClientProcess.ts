import { ccc } from "@ckb-ccc/core";
import { once } from "node:events";
import { createServer } from "node:http";
import { createPublicClient } from "../../../src/shared/index.ts";

const server = createServer((request, response) => {
  request.resume();
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ jsonrpc: "2.0", id: 0, result: "ok" }));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (address === null || typeof address === "string") {
  throw new TypeError("Expected a local TCP server address");
}

const client = createPublicClient("testnet", `http://127.0.0.1:${String(address.port)}`);
if (!(client instanceof ccc.ClientJsonRpc)) {
  throw new TypeError("Expected a JSON-RPC public client");
}
await client.requestor.request("test", []);
await new Promise<void>((resolve, reject) => {
  server.close((error) => {
    if (error === undefined) {
      resolve();
    } else {
      reject(error);
    }
  });
});
process.stdout.write("completed\n");
