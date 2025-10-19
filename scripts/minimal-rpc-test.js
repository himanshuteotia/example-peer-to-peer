#!/usr/bin/env node
import DHT from "hyperdht";
import RPC from "@hyperswarm/rpc";

async function main() {
  const dht = new DHT({ port: 30001, bootstrap: [] });
  await dht.ready();
  console.log("DHT ready");

  const rpcServerRoot = new RPC({ dht });
  const server = rpcServerRoot.createServer();
  server.respond(
    "ping",
    { requestEncoding: "json", responseEncoding: "json" },
    async (req) => {
      return { nonce: req && req.nonce ? req.nonce + 1 : 1, ts: Date.now() };
    }
  );
  await server.listen();
  console.log("Server listening on pk:", server.publicKey.toString("hex"));

  const clientRpcRoot = new RPC({ dht });
  // small delay to let server advertise
  await new Promise((r) => setTimeout(r, 200));
  try {
    const resp = await clientRpcRoot.request(server.publicKey, "ping", {
      nonce: 1,
    });
    console.log("Ping ok:", resp);
  } catch (err) {
    console.error("Ping failed:", err && err.stack ? err.stack : err);
  }

  await server.close();
  await clientRpcRoot.destroy();
  await dht.destroy();
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
