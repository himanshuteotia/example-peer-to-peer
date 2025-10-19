"use strict";

import { TriageServer } from "../src/server.js";
import { TriageClient } from "../src/client.js";
import DHT from "hyperdht";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function safeKeys(obj) {
  try {
    return Object.keys(obj || {}).slice(0, 50);
  } catch {
    return ["<no-keys>"];
  }
}

async function inspectDHT(dht, label) {
  try {
    console.log(`🔎 [${label}] dht keys:`, safeKeys(dht));
    if (typeof dht.peers === "function") {
      try {
        const peers = dht.peers();
        console.log(
          `🔎 [${label}] dht.peers():`,
          peers && peers.length ? peers : peers
        );
      } catch (e) {
        console.log(
          `🔎 [${label}] dht.peers() threw:`,
          e && e.message ? e.message : e
        );
      }
    }
    if (dht && dht.socket && dht.socket.address) {
      try {
        console.log(
          `🔎 [${label}] dht.socket.address():`,
          dht.socket.address()
        );
      } catch {}
    }
  } catch (e) {
    console.warn("error inspecting dht", e && e.message ? e.message : e);
  }
}

async function veryVerboseSmoke() {
  console.log("\n=== VERY VERBOSE Single-process smoke test ===\n");

  const bootstrapPort = 30001;
  const serverPort = 40001;
  const clientPort = 50001;

  let bootstrapDHT = null;
  let server = null;
  let client = null;

  try {
    // 1) bootstrap DHT
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
    await new Promise((r) => setTimeout(r, 200));

    // 2) Start server
    console.log("2) starting TriageServer...");
    server = new TriageServer({
      port: serverPort,
      bootstrapPort: bootstrapPort,
      dbPath: join(__dirname, "../db/very-verbose-server"),
    });

    // instrument server internals before start
    console.log("  server instance keys:", safeKeys(server));
    await server.start();
    console.log("  server started");

    // Inspect server RPC internals
    try {
      console.log("  rpcServer keys:", safeKeys(server.rpcServer));
      console.log("  rpc keys:", safeKeys(server.rpc));
      console.log(
        "  rpcServer.publicKey exists:",
        !!(server.rpcServer && server.rpcServer.publicKey)
      );
      console.log(
        "  rpcServer.publicKey isBuffer:",
        Buffer.isBuffer(server.rpcServer.publicKey)
      );
      if (server.rpcServer && server.rpcServer.publicKey) {
        try {
          console.log(
            "  rpcServer.publicKey length:",
            server.rpcServer.publicKey.length
          );
          console.log(
            "  rpcServer.publicKey hex (first 12 chars):",
            server.rpcServer.publicKey.toString("hex").slice(0, 24) + "..."
          );
        } catch (e) {
          console.log(
            "  couldn't stringify publicKey:",
            e && e.message ? e.message : e
          );
        }
      }
      if (
        server.rpcServer &&
        (server.rpcServer._protomux || server.rpcServer.protomux)
      ) {
        const prot = server.rpcServer._protomux || server.rpcServer.protomux;
        console.log("  rpcServer._protomux keys:", safeKeys(prot));
      }
    } catch (e) {
      console.warn(
        "  error inspecting server internals:",
        e && e.message ? e.message : e
      );
    }

    // Inspect DHT state on server
    await inspectDHT(server.dht, "server.dht");

    // 3) Start client
    console.log("\n3) starting TriageClient and connecting...");
    client = new TriageClient({
      port: clientPort,
      bootstrapPort: bootstrapPort,
      dbPath: join(__dirname, "../db/very-verbose-client"),
      serverPublicKey:
        server.rpcServer && server.rpcServer.publicKey
          ? server.rpcServer.publicKey
          : undefined,
    });

    console.log("  client instance keys:", safeKeys(client));
    // connect with extended timeout
    try {
      await client.connect({ discoveryTimeoutMs: 45000 });
      console.log(
        "  client.connect() finished - client.connected:",
        client.connected
      );
    } catch (e) {
      console.error("  client.connect() failed:", e && e.stack ? e.stack : e);
      throw e;
    }

    // inspect client internals
    try {
      console.log("  client.rpc keys:", safeKeys(client.rpc));
      if (client.rpc && (client.rpc._protomux || client.rpc.protomux)) {
        const prot = client.rpc._protomux || client.rpc.protomux;
        console.log("  client.rpc._protomux keys:", safeKeys(prot));
      }
      console.log("  client.dht keys:", safeKeys(client.dht));
      await inspectDHT(client.dht, "client.dht");
    } catch (e) {
      console.warn(
        "  error inspecting client internals:",
        e && e.message ? e.message : e
      );
    }

    // pause to allow DHT to propagate
    console.log(
      "\n4) waiting 800ms for discovery then trying ping (attempt 1)..."
    );
    await new Promise((r) => setTimeout(r, 800));

    // attempt ping 1
    try {
      console.log("  ping attempt 1 -> sending request");
      const resp = await client.ping();
      console.log("  ping attempt 1 response:", resp);
    } catch (err) {
      console.error(
        "  ping attempt 1 failed (stack):",
        err && err.stack ? err.stack : err
      );
      // dump dht peers/state when ping fails
      try {
        await inspectDHT(server.dht, "server.dht (after ping fail)");
      } catch {}
      try {
        await inspectDHT(client.dht, "client.dht (after ping fail)");
      } catch {}
      try {
        console.log(
          "  server.rpcServer keys post-fail:",
          safeKeys(server.rpcServer)
        );
      } catch {}
      try {
        console.log("  client.rpc keys post-fail:", safeKeys(client.rpc));
      } catch {}
    }

    // wait and do second attempt
    console.log("\n5) waiting 2s and trying ping (attempt 2)...");
    await new Promise((r) => setTimeout(r, 2000));

    try {
      console.log("  ping attempt 2 -> sending request");
      const resp2 = await client.ping();
      console.log("  ping attempt 2 response:", resp2);
    } catch (err2) {
      console.error(
        "  ping attempt 2 failed (stack):",
        err2 && err2.stack ? err2.stack : err2
      );

      // Final diagnostic dumps
      try {
        console.log("\n--- FINAL DIAGNOSTIC DUMPS ---");
        console.log("server.rpcServer keys:", safeKeys(server.rpcServer));
        if (server.rpcServer && server.rpcServer._protomux) {
          console.log(
            "server.rpcServer._protomux keys:",
            safeKeys(server.rpcServer._protomux)
          );
        }
        console.log("client.rpc keys:", safeKeys(client.rpc));
        if (client.rpc && client.rpc._protomux) {
          console.log(
            "client.rpc._protomux keys:",
            safeKeys(client.rpc._protomux)
          );
        }
      } catch (e) {
        console.warn(
          "error during final dumps:",
          e && e.message ? e.message : e
        );
      }

      throw err2;
    }

    console.log(
      "\n✅ VERY VERBOSE smoke test succeeded - RPC ping worked twice."
    );
  } catch (err) {
    console.error(
      "\n❌ VERY VERBOSE smoke test failed. Full error/stack below:\n"
    );
    console.error(err && err.stack ? err.stack : err);
  } finally {
    console.log("\n--- cleanup ---");
    try {
      if (client) await client.disconnect();
    } catch (e) {
      console.warn("error disconnect client:", e && e.message ? e.message : e);
    }
    try {
      if (server) await server.stop();
    } catch (e) {
      console.warn("error stop server:", e && e.message ? e.message : e);
    }
    try {
      if (bootstrapDHT) await bootstrapDHT.destroy();
    } catch (e) {
      console.warn("error destroy bootstrap:", e && e.message ? e.message : e);
    }
    console.log("\n=== VERBOSE smoke test complete ===\n");
  }
}

veryVerboseSmoke().catch((e) => {
  console.error("Fatal:", e && e.stack ? e.stack : e);
  process.exit(1);
});
