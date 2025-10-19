#!/usr/bin/env node
import net from "net";
import { TriageServer } from "../src/server.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function tcpSmoke() {
  // Start server's storage/scorer but DO NOT start DHT or RPC
  const server = new TriageServer({
    port: 0,
    bootstrapPort: 0,
    dbPath: join(__dirname, "../db/tcp-smoke-server"),
  });

  // Initialize storage and scorer but skip DHT/RPC. We'll call bindHandlers functions directly.
  await server.initializeStorage?.();
  server.urgencyScorer =
    server.urgencyScorer ||
    new (await import("../src/urgency-scorer.js")).UrgencyScorer();
  await server.urgencyScorer.initialize?.();
  server.ticketStorage = new (
    await import("../src/ticket-storage.js")
  ).TicketStorage(server.hbee);

  // Create a tiny TCP server that accepts JSON lines: { method: 'submitTicket', params: {...} }
  const tcpServer = net.createServer((socket) => {
    console.log("TCP client connected");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      // support newline separated messages
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        try {
          const req = JSON.parse(line);
          handleRequest(req)
            .then((res) => {
              socket.write(JSON.stringify(res) + "\n");
            })
            .catch((err) => {
              socket.write(
                JSON.stringify({ error: err.message || String(err) }) + "\n"
              );
            });
        } catch (e) {
          socket.write(JSON.stringify({ error: "invalid json" }) + "\n");
        }
      }
    });

    socket.on("end", () => console.log("TCP client disconnected"));
  });

  tcpServer.listen(7000, async () => {
    console.log("TCP smoke server listening on port 7000");
    console.log(
      'Try: echo \'{"method":"ping","params":{}}\' | nc localhost 7000'
    );
  });

  async function handleRequest(req) {
    const { method, params } = req;
    if (method === "ping")
      return { nonce: ((params && params.nonce) || 0) + 1, ts: Date.now() };
    if (method === "submitTicket") return server.handleSubmitTicket(params);
    if (method === "getTicket") return server.handleGetTicket(params);
    if (method === "searchTickets") return server.handleSearchTickets(params);
    throw new Error("unknown method");
  }
}

tcpSmoke().catch((e) => {
  console.error("Fatal tcp smoke error", e && e.stack ? e.stack : e);
  process.exit(1);
});
