"use strict";

import RPC from "@hyperswarm/rpc";
import DHT from "hyperdht";
import Hypercore from "hypercore";
import Hyperbee from "hyperbee";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class TriageClient {
  constructor(config = {}) {
    this.config = {
      port: config.port || 50001,
      bootstrapPort: config.bootstrapPort || 30001,
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

    // Start DHT
    await this.startDHT();

    // Initialize RPC
    this.rpc = new RPC({ dht: this.dht });

    // Wait a moment for DHT to be ready
    await new Promise((resolve) => setTimeout(resolve, 1000));

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

    this.dht = new DHT({
      port: this.config.port,
      keyPair: DHT.keyPair(dhtSeed),
      bootstrap: [{ host: "127.0.0.1", port: this.config.bootstrapPort }],
    });

    await this.dht.ready();
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
