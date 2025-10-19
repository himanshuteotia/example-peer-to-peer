// scripts/debug-loopback.js
import DHT from "hyperdht";
import RPC from "@hyperswarm/rpc";
import crypto from "crypto";
const dht = new DHT({ bootstrap: [] });

await dht.ready();
console.log("DHT ready, socket addr:", dht.socket.address());

const rpcSeed = crypto.randomBytes(32);
const serverRpc = new RPC({ seed: rpcSeed, dht });
const server = serverRpc.createServer();
server.respond("ping", async (raw) => {
  try {
    const req = JSON.parse(raw.toString());
    return Buffer.from(
      JSON.stringify({ nonce: req.nonce + 1, ts: Date.now() }),
      "utf8"
    );
  } catch (e) {
    return Buffer.from(JSON.stringify({ error: e.message }), "utf8");
  }
});
await server.listen();
console.log("server listening pk:", server.publicKey.toString("hex"));

const clientRpc = new RPC({ dht });
console.log("client rpc created");

try {
  const payloadRaw = Buffer.from(JSON.stringify({ nonce: 111 }), "utf8");
  const respRaw = await clientRpc.request(server.publicKey, "ping", payloadRaw);
  console.log("response:", respRaw.toString());
} catch (err) {
  console.error("request failed:", err.stack || err);
}

await clientRpc.destroy();
await server.close();
await serverRpc.destroy();
await dht.destroy();
