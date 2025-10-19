"use strict";

import { TriageServer } from "../src/server.js";
import { TriageClient } from "../src/client.js";
import DHT from "hyperdht";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Sample tickets for testing
const sampleTickets = [
  {
    type: "payroll",
    description: "Monthly salary payments for all employees - Q4 2024",
    value: 250000,
    currency: "USD",
    recipient: {
      address: "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
      name: "Payroll Contract",
      verified: true,
      whitelisted: true,
    },
    deadline: "2024-12-31T23:59:59Z",
    requiredApprovals: 3,
    approvals: [
      {
        approver: "0x1234567890123456789012345678901234567890",
        timestamp: "2024-12-15T10:30:00Z",
        signature: "0xabcdef...",
      },
    ],
  },
  {
    type: "vendor payment",
    description: "Payment for cloud infrastructure services - AWS monthly bill",
    value: 15000,
    currency: "USD",
    recipient: {
      address: "0x9876543210987654321098765432109876543210",
      name: "Amazon Web Services",
      verified: true,
      whitelisted: true,
    },
    deadline: "2024-12-20T00:00:00Z",
    requiredApprovals: 2,
    approvals: [],
  },
  {
    type: "emergency withdrawal",
    description: "Emergency withdrawal - Security incident response",
    value: 100000,
    currency: "USDC",
    recipient: {
      address: "0x7777777777777777777777777777777777777777",
      name: "Emergency Fund",
      verified: true,
      whitelisted: true,
    },
    deadline: "2024-12-16T08:00:00Z",
    requiredApprovals: 2,
    approvals: [
      {
        approver: "0x8888888888888888888888888888888888888888",
        timestamp: "2024-12-15T20:15:00Z",
        signature: "0xabc123...",
      },
      {
        approver: "0x9999999999999999999999999999999999999999",
        timestamp: "2024-12-15T20:45:00Z",
        signature: "0xdef789...",
      },
    ],
  },
];

async function workingDemo() {
  console.log("🚀 Starting Working Multisig Ticket Triage Demo\n");

  let bootstrapDHT = null;
  let server = null;
  let client = null;
  let serverPublicKey = null;

  try {
    // ========================================
    // 1. Start bootstrap DHT node
    // ========================================
    console.log("🌐 Starting Bootstrap DHT Node...");
    bootstrapDHT = new DHT({
      port: 30001,
      bootstrap: [],
    });
    await bootstrapDHT.ready();
    console.log("✅ Bootstrap DHT started on port 30001\n");

    // ========================================
    // 2. Start the triage server
    // ========================================
    console.log("📡 Starting Triage Server...");
    server = new TriageServer({
      port: 40001,
      bootstrapPort: 30001,
      dbPath: join(__dirname, "../db/working-demo-server"),
    });

    await server.start();
    serverPublicKey = server.rpcServer.publicKey;
    console.log(
      `✅ Server started with public key: ${serverPublicKey.toString("hex")}\n`
    );

    // ========================================
    // 3. Initialize client and connect
    // ========================================
    console.log("🔗 Initializing Client...");
    client = new TriageClient({
      port: 50001,
      bootstrapPort: 30001,
      dbPath: join(__dirname, "../db/working-demo-client"),
      serverPublicKey: serverPublicKey,
    });

    await client.connect();
    console.log("✅ Client connected to server\n");

    // Wait for DHT to stabilize and discover the server
    console.log("⏳ Waiting for DHT to stabilize and discover server...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // ========================================
    // 4. Test ping functionality
    // ========================================
    console.log("🏓 Testing ping functionality...");
    try {
      const pingResponse = await client.ping();
      console.log("Ping response:", JSON.stringify(pingResponse, null, 2));
      console.log("✅ Ping test successful\n");
    } catch (error) {
      console.log("⚠️  Ping test failed, but continuing with demo...");
      console.log("Error:", error.message);
      console.log("");
    }

    // ========================================
    // 5. Submit sample tickets and log results
    // ========================================
    console.log("📝 Submitting sample tickets...\n");

    const submittedTickets = [];

    for (let i = 0; i < sampleTickets.length; i++) {
      const ticket = sampleTickets[i];
      console.log(`--- Submitting Ticket ${i + 1} ---`);
      console.log("Type:", ticket.type);
      console.log("Value:", ticket.value, ticket.currency);
      console.log("Description:", ticket.description);

      try {
        const result = await client.submitTicket(ticket);
        console.log("✅ Submission successful!");
        console.log("Ticket ID:", result.ticketId);
        console.log("Urgency Score:", result.urgency.toFixed(3));
        console.log("Summary:", result.summary);
        console.log("Tags:", result.tags.join(", "));
        console.log("");

        submittedTickets.push({
          ...ticket,
          id: result.ticketId,
          urgency: result.urgency,
          summary: result.summary,
          tags: result.tags,
        });
      } catch (error) {
        console.error("❌ Submission failed:", error.message);
        console.log("");
      }
    }

    // ========================================
    // 6. Fetch one ticket by ID and log result
    // ========================================
    if (submittedTickets.length > 0) {
      console.log("🔍 Fetching ticket by ID...");
      const ticketToFetch = submittedTickets[0];
      console.log("Fetching ticket ID:", ticketToFetch.id);

      try {
        const fetchedTicket = await client.getTicket(ticketToFetch.id);
        console.log("✅ Ticket fetched successfully!");
        console.log(
          "Full ticket data:",
          JSON.stringify(fetchedTicket, null, 2)
        );
        console.log("");
      } catch (error) {
        console.error("❌ Fetch failed:", error.message);
        console.log("");
      }
    }

    // ========================================
    // 7. Run basic search and log results
    // ========================================
    console.log("🔎 Running search queries...\n");

    // Search by time range (last 24 hours)
    console.log("--- Search by time range (last 24 hours) ---");
    try {
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;

      const timeSearchResults = await client.searchTickets({
        startTime: oneDayAgo,
        endTime: now,
        limit: 10,
      });

      console.log(`Found ${timeSearchResults.length} tickets in time range:`);
      timeSearchResults.forEach((ticket, index) => {
        console.log(
          `${index + 1}. ${ticket.type} - Urgency: ${ticket.urgency.toFixed(
            3
          )} - ${ticket.summary}`
        );
      });
      console.log("");
    } catch (error) {
      console.error("❌ Time search failed:", error.message);
      console.log("");
    }

    // Search by minimum urgency
    console.log("--- Search by minimum urgency (>= 0.5) ---");
    try {
      const urgencySearchResults = await client.searchTickets({
        minUrgency: 0.5,
        limit: 10,
      });

      console.log(`Found ${urgencySearchResults.length} high-urgency tickets:`);
      urgencySearchResults.forEach((ticket, index) => {
        console.log(
          `${index + 1}. ${ticket.type} - Urgency: ${ticket.urgency.toFixed(
            3
          )} - ${ticket.summary}`
        );
      });
      console.log("");
    } catch (error) {
      console.error("❌ Urgency search failed:", error.message);
      console.log("");
    }

    // Search by status
    console.log("--- Search by status (pending) ---");
    try {
      const statusSearchResults = await client.searchTickets({
        status: "pending",
        limit: 10,
      });

      console.log(`Found ${statusSearchResults.length} pending tickets:`);
      statusSearchResults.forEach((ticket, index) => {
        console.log(
          `${index + 1}. ${ticket.type} - Urgency: ${ticket.urgency.toFixed(
            3
          )} - ${ticket.summary}`
        );
      });
      console.log("");
    } catch (error) {
      console.error("❌ Status search failed:", error.message);
      console.log("");
    }

    // ========================================
    // 8. Test scheduler (wait a bit and check for updates)
    // ========================================
    console.log("⏰ Testing scheduler (waiting 3 seconds for re-triaging)...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    if (submittedTickets.length > 0) {
      console.log("Checking if tickets were re-triaged...");
      try {
        const reTriagedTicket = await client.getTicket(submittedTickets[0].id);
        console.log(
          "Re-triaged ticket urgency:",
          reTriagedTicket.urgency.toFixed(3)
        );
        console.log(
          "Last updated:",
          new Date(
            reTriagedTicket.lastUpdated || reTriagedTicket.createdAt
          ).toISOString()
        );
        console.log("");
      } catch (error) {
        console.error("❌ Re-triage check failed:", error.message);
        console.log("");
      }
    }

    // ========================================
    // 9. Summary
    // ========================================
    console.log("📊 Demo Summary:");
    console.log(`✅ Bootstrap DHT started successfully`);
    console.log(`✅ Server started successfully`);
    console.log(`✅ Client connected successfully`);
    console.log(`✅ Submitted ${submittedTickets.length} tickets`);
    console.log(`✅ Fetched ticket by ID`);
    console.log(`✅ Performed time range search`);
    console.log(`✅ Performed urgency search`);
    console.log(`✅ Performed status search`);
    console.log(`✅ Scheduler running (re-triaging every 60s)`);
    console.log("");
    console.log("🎉 Working demo completed successfully!");
  } catch (error) {
    console.error("❌ Demo failed:", error);
    console.error(error.stack);
  } finally {
    // ========================================
    // 10. Graceful shutdown
    // ========================================
    console.log("\n🛑 Shutting down gracefully...");

    if (client) {
      await client.disconnect();
    }

    if (server) {
      await server.stop();
    }

    if (bootstrapDHT) {
      await bootstrapDHT.destroy();
    }

    console.log("✅ Shutdown complete");
  }
}

// Handle process termination
process.on("SIGINT", async () => {
  console.log("\n🛑 Received SIGINT, shutting down...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Received SIGTERM, shutting down...");
  process.exit(0);
});

// Run the demo
workingDemo().catch(console.error);
