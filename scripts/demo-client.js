import DHT from "hyperdht";
import crypto from "crypto";

const SERVICE_TOPIC = crypto
  .createHash("sha256")
  .update("triage-demo")
  .digest();

async function main() {
  const dht = new DHT({ bootstrap: [{ host: "127.0.0.1", port: 51521 }] });
  await dht.ready();

  console.log("🔍 Looking up service...");
  const lookupStream = dht.lookup(SERVICE_TOPIC);

  lookupStream.on("data", (peer) => {
    console.log("✅ Found peer:", peer);
    if (peer.node && peer.node.publicKey) {
      console.log(
        "Public key:",
        Buffer.from(peer.node.publicKey).toString("hex")
      );
    }
  });

  lookupStream.on("end", () => {
    console.log("🔚 Lookup finished");
  });
}

main();
