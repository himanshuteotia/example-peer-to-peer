#!/usr/bin/env node
import DHT from "hyperdht";
import RPC from "@hyperswarm/rpc";

async function sameDhtSmoke() {
  console.log("Starting same-DHT smoke test...");

  // single DHT used by both sides, bootstrap local
  const bootstrap = new DHT({ port: 30001, bootstrap: [] });
  await bootstrap.ready();
  console.log("  bootstrap ready");

  // create server-side RPC using the same DHT instance
  const rpcServerRoot = new RPC({ dht: bootstrap });
  const server = rpcServerRoot.createServer();

  // use JSON encoding on handler to be explicit
  server.respond(
    "ping",
    { requestEncoding: "json", responseEncoding: "json" },
    async (req) => {
      return {
        nonce: req && typeof req.nonce === "number" ? req.nonce + 1 : 1,
        ts: Date.now(),
      };
    }
  );

  await server.listen(); // listen on default keypair
  console.log(
    "  server listening, publicKey (hex):",
    server.publicKey.toString("hex")
  );

  // create client-side RPC using same DHT
  const rpcClientRoot = new RPC({ dht: bootstrap });

  // Send null payload for ping (avoids compact-encoding error)
  console.log("  client requesting ping (null payload)...");
  const resp = await rpcClientRoot.request(server.publicKey, "ping", null);
  console.log("  ping response:", resp);

  // cleanup
  await server.close();
  await rpcClientRoot.destroy();
  await bootstrap.destroy();
  console.log("same-DHT smoke test done.");
}

sameDhtSmoke().catch((e) => {
  console.error("Error:", e && e.stack ? e.stack : e);
  process.exit(1);
});
