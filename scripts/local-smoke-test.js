"use strict";

import { TriageServer } from "../src/server.js";
import { TriageClient } from "../src/client.js";
import DHT from "hyperdht";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function smokeTest() {
  console.log(
    "\n=== Single-process local smoke test (bootstrap + server + client) ===\n"
  );

  const bootstrapPort = 30001;
  const serverPort = 40001;
  const clientPort = 50001;

  let bootstrapDHT = null;
  let server = null;
  let client = null;

  try {
    // 1) Start a dedicated bootstrap DHT node (bootstrap: [])
    console.log("1) starting bootstrap DHT...");
    bootstrapDHT = new DHT({ port: bootstrapPort, bootstrap: [] });
    bootstrapDHT.on &&
      bootstrapDHT.on("listening", () =>
        console.log(`  bootstrap DHT listening on ${bootstrapPort}`)
      );
    bootstrapDHT.on &&
      bootstrapDHT.on("error", (e) =>
        console.warn("  bootstrap DHT error:", e && e.message)
      );
    await bootstrapDHT.ready();
    console.log("  bootstrap ready\n");

    // small pause to ensure the bootstrap DHT is fully available
    await new Promise((r) => setTimeout(r, 200));

    // 2) Start your TriageServer pointing at that bootstrap
    console.log("2) starting TriageServer...");
    server = new TriageServer({
      port: serverPort,
      bootstrapPort: bootstrapPort,
      dbPath: join(__dirname, "../db/smoke-server"),
    });

    // attach extra logs to server rpc/dht (if available) - done inside server implementation too
    await server.start();
    console.log("  server started");
    const serverPk =
      server.rpcServer && server.rpcServer.publicKey
        ? server.rpcServer.publicKey.toString("hex")
        : "<no-pk>";
    console.log("  server public key:", serverPk, "\n");

    // 3) Start a client and connect with long timeout
    console.log("3) starting TriageClient and connecting...");
    client = new TriageClient({
      port: clientPort,
      bootstrapPort: bootstrapPort,
      dbPath: join(__dirname, "../db/smoke-client"),
      serverPublicKey:
        server.rpcServer && server.rpcServer.publicKey
          ? server.rpcServer.publicKey
          : serverPk,
    });

    // connect with generous discovery timeout
    try {
      await client.connect({ discoveryTimeoutMs: 45000 });
      console.log(
        "  client.connect() finished - client.connected:",
        client.connected
      );
    } catch (err) {
      console.error("  client.connect() failed!");
      console.error(err && err.stack ? err.stack : err);
      throw err;
    }

    // 4) Ping the server (single guarded attempt)
    console.log("\n4) pinging server via RPC...");
    try {
      const pingResp = await client.ping();
      console.log("  ping response:", pingResp);
    } catch (err) {
      console.error("  ping failed:");
      console.error(err && err.stack ? err.stack : err);
      throw err;
    }

    // 5) Submit a minimal ticket
    console.log("\n5) submitting a test ticket...");
    const ticket = {
      type: "smoke-test",
      description: "Smoke test ticket",
      value: 123,
      currency: "USD",
      requiredApprovals: 2,
      approvals: [],
    };

    try {
      const result = await client.submitTicket(ticket);
      console.log("  submit result:", result);
    } catch (err) {
      console.error("  submitTicket failed:");
      console.error(err && err.stack ? err.stack : err);
      throw err;
    }

    console.log(
      "\n✅ Smoke test finished: server <-> client RPC flow succeeded.\n"
    );
  } catch (err) {
    console.error("\n❌ Smoke test failed. Full error below:\n");
    console.error(err && err.stack ? err.stack : err);
  } finally {
    // Cleanup
    try {
      if (client) {
        await client.disconnect();
      }
    } catch (e) {
      console.warn("error disconnecting client:", e && e.message);
    }

    try {
      if (server) {
        await server.stop();
      }
    } catch (e) {
      console.warn("error stopping server:", e && e.message);
    }

    try {
      if (bootstrapDHT) {
        await bootstrapDHT.destroy();
      }
    } catch (e) {
      console.warn("error destroying bootstrap DHT:", e && e.message);
    }

    console.log("\n=== Smoke test cleanup complete ===\n");
  }
}

smokeTest().catch((e) => {
  console.error("Fatal:", e && e.stack ? e.stack : e);
  process.exit(1);
});
