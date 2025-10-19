"use strict";

import RPC from "@hyperswarm/rpc";
import DHT from "hyperdht";
import Hypercore from "hypercore";
import Hyperbee from "hyperbee";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFile } from "fs/promises";

let config = {};
try {
  const raw = await readFile(
    new URL("../config.json", import.meta.url),
    "utf8"
  );
  config = JSON.parse(raw);
} catch (err) {
  // not fatal — we'll use defaults
  // console.warn("config.json not found; using defaults");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVICE_TOPIC = crypto
  .createHash("sha256")
  .update("triage-rpc-service")
  .digest();
const DEFAULT_BOOTSTRAP_PORT = Number(
  process.env.BOOTSTRAP_PORT || config.bootstrapPort || 30001
);
const LOOKUP_RETRIES = Number(process.env.LOOKUP_RETRIES || 6);
const LOOKUP_DELAY_MS = Number(process.env.LOOKUP_DELAY_MS || 1000);

export class TriageClient {
  constructor(config = {}) {
    this.config = {
      port: config.port || 50001,
      bootstrapPort: DEFAULT_BOOTSTRAP_PORT,
      dbPath: config.dbPath || join(__dirname, "../db/rpc-client"),
      serverPublicKey: config.serverPublicKey,
      ...config,
    };

    this.dht = null;
    this.rpc = null;
    this.hbee = null;
    this.connected = false;
  }

  async connect() {
    console.log("🔗 Connecting to Triage Server...");

    // Initialize storage
    await this.initializeStorage();

    // Start DHT and discovery
    await this.startDHT();

    // Initialize RPC (use the DHT instance)
    this.rpc = new RPC({ dht: this.dht });

    // small pause for DHT/RPC internals
    await new Promise((r) => setTimeout(r, 300));

    // If serverPublicKey not provided, attempt discovery via the shared topic
    if (!this.config.serverPublicKey) {
      console.log("🔎 Looking up server via DHT topic...");
      const nodes = await this.lookupWithRetry(
        SERVICE_TOPIC,
        LOOKUP_RETRIES,
        LOOKUP_DELAY_MS
      );

      if (nodes.length === 0) {
        console.warn(
          "⚠️ No nodes found for topic — ensure the server announced and DHT bootstrap is correct."
        );
      } else {
        // pick the first node that has a publicKey
        const node = nodes.find((n) => n && (n.publicKey || n));
        if (node) {
          const pub = node.publicKey ? node.publicKey : node;
          // normalize: if pub is hex string, convert to Buffer
          this.config.serverPublicKey =
            typeof pub === "string"
              ? Buffer.from(pub, "hex")
              : Buffer.from(pub);
          console.log(
            "✅ Found server publicKey via DHT lookup:",
            this.config.serverPublicKey.toString("hex")
          );
        }
      }
    }

    if (!this.config.serverPublicKey) {
      throw new Error("Server public key not configured and discovery failed");
    }

    this.connected = true;
    console.log("✅ Connected to Triage Server");
  }

  async initializeStorage() {
    const hcore = new Hypercore(this.config.dbPath);
    this.hbee = new Hyperbee(hcore, {
      keyEncoding: "utf-8",
      valueEncoding: "binary",
    });

    await this.hbee.ready();
  }

  async startDHT() {
    // Get or create DHT seed
    let dhtSeed = (await this.hbee.get("dht-seed"))?.value;
    if (!dhtSeed) {
      dhtSeed = crypto.randomBytes(32);
      await this.hbee.put("dht-seed", dhtSeed);
    }

    const bootstrapPort = this.config.bootstrapPort || DEFAULT_BOOTSTRAP_PORT;

    this.dht = new DHT({
      port: this.config.port,
      keyPair: DHT.keyPair(dhtSeed),
      bootstrap: [{ host: "127.0.0.1", port: bootstrapPort }],
    });

    await this.dht.ready();
    console.log("✅ DHT started (bootstrapped to port " + bootstrapPort + ")");
  }

  // lookup that supports both promise/array returns and stream-like returns
  async lookupWithRetry(
    topic,
    retries = LOOKUP_RETRIES,
    delayMs = LOOKUP_DELAY_MS
  ) {
    const tryOnce = async () => {
      try {
        const res = await this.dht.lookup(topic);

        // stream-like result (EventEmitter)
        if (res && typeof res.on === "function") {
          return await new Promise((resolve) => {
            const nodes = [];
            const timer = setTimeout(() => {
              res.removeAllListeners("data");
              res.removeAllListeners("end");
              resolve(nodes);
            }, 800);

            res.on("data", (d) => {
              nodes.push(d);
            });

            res.on("end", () => {
              clearTimeout(timer);
              resolve(nodes);
            });

            res.on("error", () => {
              clearTimeout(timer);
              resolve(nodes);
            });
          });
        }

        // array or single object
        const nodes = Array.isArray(res) ? res : res ? [res] : [];
        return nodes;
      } catch {
        return [];
      }
    };

    for (let i = 0; i < retries; i++) {
      const nodes = await tryOnce();
      if (nodes.length) return nodes;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return [];
  }

  async submitTicket(ticket) {
    if (!this.connected) {
      throw new Error("Client not connected");
    }

    if (!this.config.serverPublicKey) {
      throw new Error("Server public key not configured");
    }

    const payload = { ticket };
    const payloadRaw = Buffer.from(JSON.stringify(payload), "utf-8");

    const respRaw = await this.rpc.request(
      this.config.serverPublicKey,
      "submitTicket",
      payloadRaw
    );

    const response = JSON.parse(respRaw.toString("utf-8"));

    if (!response.success) {
      throw new Error(response.error || "Failed to submit ticket");
    }

    return response;
  }

  async getTicket(ticketId) {
    if (!this.connected) {
      throw new Error("Client not connected");
    }

    if (!this.config.serverPublicKey) {
      throw new Error("Server public key not configured");
    }

    const payload = { ticketId };
    const payloadRaw = Buffer.from(JSON.stringify(payload), "utf-8");

    const respRaw = await this.rpc.request(
      this.config.serverPublicKey,
      "getTicket",
      payloadRaw
    );

    const response = JSON.parse(respRaw.toString("utf-8"));

    if (!response.success) {
      throw new Error(response.error || "Failed to get ticket");
    }

    return response.ticket;
  }

  async searchTickets(options = {}) {
    if (!this.connected) {
      throw new Error("Client not connected");
    }

    if (!this.config.serverPublicKey) {
      throw new Error("Server public key not configured");
    }

    const payload = options;
    const payloadRaw = Buffer.from(JSON.stringify(payload), "utf-8");

    const respRaw = await this.rpc.request(
      this.config.serverPublicKey,
      "searchTickets",
      payloadRaw
    );

    const response = JSON.parse(respRaw.toString("utf-8"));

    if (!response.success) {
      throw new Error(response.error || "Failed to search tickets");
    }

    return response.tickets;
  }

  async ping() {
    if (!this.connected) {
      throw new Error("Client not connected");
    }

    if (!this.config.serverPublicKey) {
      throw new Error("Server public key not configured");
    }

    const payload = { nonce: Math.floor(Math.random() * 1000) };
    const payloadRaw = Buffer.from(JSON.stringify(payload), "utf-8");

    try {
      const respRaw = await this.rpc.request(
        this.config.serverPublicKey,
        "ping",
        payloadRaw
      );
      const response = JSON.parse(respRaw.toString("utf-8"));
      return response;
    } catch (error) {
      console.warn("Ping failed, retrying in 1 second...", error.message);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const respRaw = await this.rpc.request(
        this.config.serverPublicKey,
        "ping",
        payloadRaw
      );
      const response = JSON.parse(respRaw.toString("utf-8"));
      return response;
    }
  }

  async disconnect() {
    console.log("🔌 Disconnecting from Triage Server...");

    if (this.rpc) {
      await this.rpc.destroy();
    }

    if (this.dht) {
      await this.dht.destroy();
    }

    this.connected = false;
    console.log("✅ Disconnected");
  }
}
