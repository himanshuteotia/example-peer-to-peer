"use strict";

import RPC from "@hyperswarm/rpc";
import DHT from "hyperdht";
import Hypercore from "hypercore";
import Hyperbee from "hyperbee";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { UrgencyScorer } from "./urgency-scorer.js";
import { TicketStorage } from "./ticket-storage.js";
import { readFile } from "fs/promises";

let config = {};
try {
  const raw = await readFile(
    new URL("../config.json", import.meta.url),
    "utf8"
  );
  config = JSON.parse(raw);
} catch (err) {
  // not fatal — fall back to defaults
  console.warn(
    "⚠️  config.json not found or unreadable; using defaults.",
    err.message
  );
}

const DEFAULT_BOOTSTRAP_PORT = Number(config.bootstrapPort || 30001);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVICE_TOPIC = crypto
  .createHash("sha256")
  .update("triage-rpc-service")
  .digest(); // 32 bytes

// helper: announce with retries and optional relay addresses
async function announceWithRetry(
  dht,
  topic,
  keyPair,
  relays = [],
  retries = 6,
  delayMs = 800
) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      await dht.announce(topic, keyPair, relays);
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`announce attempt ${i + 1} failed: ${err.message}`);
      // small backoff
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

class TriageServer {
  constructor(config = {}) {
    this.config = {
      port: config.port || 40001,
      bootstrapPort: DEFAULT_BOOTSTRAP_PORT,
      dbPath: config.dbPath || join(__dirname, "../db/rpc-server"),
      ...config,
    };

    this.dht = null;
    this.rpc = null;
    this.rpcServer = null;
    this.hbee = null;
    this.urgencyScorer = null;
    this.ticketStorage = null;
    this.scheduler = null;

    // stash rpc seed if needed for announce
    this._rpcSeed = null;
  }

  async start() {
    console.log("🚀 Starting Multisig Ticket Triage Server...");

    // Initialize storage
    await this.initializeStorage();

    // Initialize urgency scorer
    this.urgencyScorer = new UrgencyScorer();
    await this.urgencyScorer.initialize();

    // Initialize ticket storage
    this.ticketStorage = new TicketStorage(this.hbee);

    // Start DHT
    await this.startDHT();

    // Start RPC server
    await this.startRPC();

    // Start scheduler
    this.startScheduler();

    console.log("✅ Server started successfully!");
    console.log(
      `📡 RPC Server listening on public key: ${this.rpcServer.publicKey.toString(
        "hex"
      )}`
    );
  }

  async initializeStorage() {
    console.log("📦 Initializing Hyperbee storage...");

    const hcore = new Hypercore(this.config.dbPath);
    this.hbee = new Hyperbee(hcore, {
      keyEncoding: "utf-8",
      valueEncoding: "binary",
    });

    await this.hbee.ready();
    console.log("✅ Storage initialized");
  }

  async startDHT() {
    console.log("🌐 Starting DHT...");

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

  async startRPC() {
    console.log("🔗 Starting RPC server...");

    // Get or create RPC seed
    let rpcSeed = (await this.hbee.get("rpc-seed"))?.value;
    if (!rpcSeed) {
      rpcSeed = crypto.randomBytes(32);
      await this.hbee.put("rpc-seed", rpcSeed);
    }

    // stash seed so we can use it when announcing
    this._rpcSeed = rpcSeed;

    // Create RPC instance with the seed and the dht
    this.rpc = new RPC({ seed: rpcSeed, dht: this.dht });
    this.rpcServer = this.rpc.createServer();

    // Bind RPC handlers
    this.bindHandlers();

    // listen() may accept an optional keyPair; calling without args should still populate publicKey
    await this.rpcServer.listen();

    if (!this.rpcServer.publicKey) {
      throw new Error(
        "rpcServer.publicKey is null after listen(); ensure your @hyperswarm/rpc version exposes it"
      );
    }

    console.log("✅ RPC server started - publicKey available");

    // ANNOUNCE: use a stable topic + the RPC keyPair (derived from rpcSeed)
    // Here we pass the publicKey and secretKey (seed) as the keyPair the server listens on.
    const rpcKeyPair = {
      publicKey: this.rpcServer.publicKey,
      secretKey: this._rpcSeed, // rpcSeed is the secret/seed used to derive RPC keypair
    };

    // provide bootstrap as relay to improve connectivity and retry if needed
    const relayAddrs = [
      {
        host: "127.0.0.1",
        port: this.config.bootstrapPort || DEFAULT_BOOTSTRAP_PORT,
      },
    ];
    await announceWithRetry(
      this.dht,
      SERVICE_TOPIC,
      rpcKeyPair,
      relayAddrs,
      6,
      1000
    );
    console.log("📡 Announced RPC under service topic on DHT");

    // give the DHT a moment to propagate
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  bindHandlers() {
    // Submit ticket handler
    this.rpcServer.respond("submitTicket", async (reqRaw) => {
      try {
        const req = JSON.parse(reqRaw.toString("utf-8"));
        const result = await this.handleSubmitTicket(req);
        return Buffer.from(JSON.stringify(result), "utf-8");
      } catch (error) {
        return Buffer.from(
          JSON.stringify({
            error: error.message,
            success: false,
          }),
          "utf-8"
        );
      }
    });

    // Get ticket by ID handler
    this.rpcServer.respond("getTicket", async (reqRaw) => {
      try {
        const req = JSON.parse(reqRaw.toString("utf-8"));
        const result = await this.handleGetTicket(req);
        return Buffer.from(JSON.stringify(result), "utf-8");
      } catch (error) {
        return Buffer.from(
          JSON.stringify({
            error: error.message,
            success: false,
          }),
          "utf-8"
        );
      }
    });

    // Search tickets handler
    this.rpcServer.respond("searchTickets", async (reqRaw) => {
      try {
        const req = JSON.parse(reqRaw.toString("utf-8"));
        const result = await this.handleSearchTickets(req);
        return Buffer.from(JSON.stringify(result), "utf-8");
      } catch (error) {
        return Buffer.from(
          JSON.stringify({
            error: error.message,
            success: false,
          }),
          "utf-8"
        );
      }
    });

    // Ping handler for testing
    this.rpcServer.respond("ping", async (reqRaw) => {
      const req = JSON.parse(reqRaw.toString("utf-8"));
      const resp = { nonce: req.nonce + 1, timestamp: Date.now() };
      return Buffer.from(JSON.stringify(resp), "utf-8");
    });
  }

  async handleSubmitTicket(req) {
    const { ticket } = req;

    if (!ticket) {
      throw new Error("Ticket data is required");
    }

    // Generate ticket ID if not provided
    if (!ticket.id) {
      ticket.id = crypto.randomBytes(16).toString("hex");
    }

    // Add metadata
    ticket.createdAt = Date.now();
    ticket.status = "pending";
    ticket.approvals = ticket.approvals || [];
    ticket.requiredApprovals = ticket.requiredApprovals || 2;

    // Calculate urgency score
    const urgencyResult = await this.urgencyScorer.calculateUrgency(ticket);
    ticket.urgency = urgencyResult.score;
    ticket.urgencyBreakdown = urgencyResult.breakdown;
    ticket.summary = urgencyResult.summary;
    ticket.tags = urgencyResult.tags;

    // Store ticket
    await this.ticketStorage.storeTicket(ticket);

    return {
      success: true,
      ticketId: ticket.id,
      urgency: ticket.urgency,
      summary: ticket.summary,
      tags: ticket.tags,
    };
  }

  async handleGetTicket(req) {
    const { ticketId } = req;

    if (!ticketId) {
      throw new Error("Ticket ID is required");
    }

    const ticket = await this.ticketStorage.getTicket(ticketId);

    if (!ticket) {
      throw new Error("Ticket not found");
    }

    return {
      success: true,
      ticket,
    };
  }

  async handleSearchTickets(req) {
    const { startTime, endTime, minUrgency, status, limit = 50 } = req;

    const tickets = await this.ticketStorage.searchTickets({
      startTime,
      endTime,
      minUrgency,
      status,
      limit,
    });

    return {
      success: true,
      tickets,
      count: tickets.length,
    };
  }

  startScheduler() {
    console.log("⏰ Starting scheduler for re-triaging tickets...");

    this.scheduler = setInterval(async () => {
      try {
        await this.reTriagePendingTickets();
      } catch (error) {
        console.error("❌ Scheduler error:", error);
      }
    }, 60000); // 60 seconds
  }

  async reTriagePendingTickets() {
    console.log("🔄 Re-triaging pending tickets...");

    const pendingTickets = await this.ticketStorage.getPendingTickets();
    let updatedCount = 0;

    for (const ticket of pendingTickets) {
      // Recalculate urgency
      const urgencyResult = await this.urgencyScorer.calculateUrgency(ticket);

      // Update if urgency changed significantly
      if (Math.abs(urgencyResult.score - ticket.urgency) > 0.1) {
        ticket.urgency = urgencyResult.score;
        ticket.urgencyBreakdown = urgencyResult.breakdown;
        ticket.summary = urgencyResult.summary;
        ticket.tags = urgencyResult.tags;
        ticket.lastUpdated = Date.now();

        await this.ticketStorage.updateTicket(ticket);
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      console.log(`✅ Updated ${updatedCount} tickets`);
    }
  }

  async stop() {
    console.log("🛑 Stopping server...");

    if (this.scheduler) {
      clearInterval(this.scheduler);
    }

    if (this.rpcServer) {
      await this.rpcServer.close();
    }

    if (this.dht) {
      await this.dht.destroy();
    }

    if (this.urgencyScorer) {
      await this.urgencyScorer.cleanup();
    }

    console.log("✅ Server stopped");
  }
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new TriageServer();

  process.on("SIGINT", async () => {
    await server.stop();
    process.exit(0);
  });

  server.start().catch(console.error);
}

export { TriageServer };
