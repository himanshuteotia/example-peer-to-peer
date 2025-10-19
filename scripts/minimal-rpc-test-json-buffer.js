#!/usr/bin/env node
import DHT from "hyperdht";
import RPC from "@hyperswarm/rpc";

async function main() {
  const dht = new DHT({ port: 30001, bootstrap: [] });
  await dht.ready();
  console.log("DHT ready");

  const rpcServerRoot = new RPC({ dht });
  const server = rpcServerRoot.createServer();

  // Server expects JSON: we'll attempt to accept Buffer and parse if needed
  server.respond(
    "submit",
    { requestEncoding: "json", responseEncoding: "json" },
    async (req) => {
      // If the rpc layer already parsed JSON, req will be object.
      // If it forwarded a Buffer, it might be a Buffer or Uint8Array - handle both.
      let parsed = req;
      if (req && (Buffer.isBuffer(req) || req instanceof Uint8Array)) {
        try {
          parsed = JSON.parse(Buffer.from(req).toString("utf-8"));
        } catch (e) {
          parsed = { _raw: Buffer.from(req).toString("utf-8") };
        }
      }
      return { received: parsed, ok: true, ts: Date.now() };
    }
  );

  await server.listen();
  console.log("Server listening on pk:", server.publicKey.toString("hex"));

  const clientRpcRoot = new RPC({ dht });
  await new Promise((r) => setTimeout(r, 200));

  try {
    const payload = { hello: "world", nonce: 13 };
    // send JSON explicitly as Buffer to avoid compact-encoding errors
    const buf = Buffer.from(JSON.stringify(payload), "utf-8");
    const resp = await clientRpcRoot.request(server.publicKey, "submit", buf);
    console.log("Submit response:", resp);
  } catch (err) {
    console.error("Submit failed:", err && err.stack ? err.stack : err);
  }

  await server.close();
  await clientRpcRoot.destroy();
  await dht.destroy();
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
