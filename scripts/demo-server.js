import DHT from "hyperdht";
import crypto from "crypto";

const SERVICE_TOPIC = crypto
  .createHash("sha256")
  .update("triage-demo")
  .digest();

async function main() {
  const keyPair = DHT.keyPair();
  const dht = new DHT({ bootstrap: [{ host: "127.0.0.1", port: 51521 }] });

  await dht.ready();

  console.log("🚀 Server ready. Announcing...");
  const stream = dht.announce(SERVICE_TOPIC, keyPair);
  await stream.finished();

  console.log("✅ Announced on topic:", SERVICE_TOPIC.toString("hex"));
  console.log("📡 Public key:", keyPair.publicKey.toString("hex"));

  // Keep server running
  process.stdin.resume();
}

main();
