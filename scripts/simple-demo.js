"use strict";

import { UrgencyScorer } from "../src/urgency-scorer.js";
import { TicketStorage } from "../src/ticket-storage.js";
import Hypercore from "hypercore";
import Hyperbee from "hyperbee";
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

async function simpleDemo() {
  console.log("🚀 Starting Simple Multisig Ticket Triage Demo\n");

  try {
    // ========================================
    // 1. Initialize components
    // ========================================
    console.log("📦 Initializing components...");

    // Initialize urgency scorer
    const urgencyScorer = new UrgencyScorer();
    await urgencyScorer.initialize();

    // Initialize storage
    const hcore = new Hypercore(join(__dirname, "../db/simple-demo"));
    const hbee = new Hyperbee(hcore, {
      keyEncoding: "utf-8",
      valueEncoding: "binary",
    });
    await hbee.ready();

    const ticketStorage = new TicketStorage(hbee);
    console.log("✅ Components initialized\n");

    // ========================================
    // 2. Submit sample tickets and log results
    // ========================================
    console.log("📝 Submitting sample tickets...\n");

    const submittedTickets = [];

    for (let i = 0; i < sampleTickets.length; i++) {
      const ticket = sampleTickets[i];
      console.log(`--- Submitting Ticket ${i + 1} ---`);
      console.log("Type:", ticket.type);
      console.log("Value:", ticket.value, ticket.currency);
      console.log("Description:", ticket.description);

      // Calculate urgency score
      const urgencyResult = await urgencyScorer.calculateUrgency(ticket);

      // Add metadata
      const ticketWithId = {
        ...ticket,
        id: `ticket-${Date.now()}-${i}`,
        urgency: urgencyResult.score,
        summary: urgencyResult.summary,
        tags: urgencyResult.tags,
        createdAt: Date.now(),
        status: "pending",
        approvals: ticket.approvals || [],
        requiredApprovals: ticket.requiredApprovals || 2,
      };

      // Store ticket
      await ticketStorage.storeTicket(ticketWithId);
      submittedTickets.push(ticketWithId);

      console.log("✅ Submission successful!");
      console.log("Ticket ID:", ticketWithId.id);
      console.log("Urgency Score:", ticketWithId.urgency.toFixed(3));
      console.log("Summary:", ticketWithId.summary);
      console.log("Tags:", ticketWithId.tags.join(", "));
      console.log(
        "Urgency Breakdown:",
        JSON.stringify(urgencyResult.breakdown.factors, null, 2)
      );
      console.log("");
    }

    // ========================================
    // 3. Fetch one ticket by ID and log result
    // ========================================
    if (submittedTickets.length > 0) {
      console.log("🔍 Fetching ticket by ID...");
      const ticketToFetch = submittedTickets[0];
      console.log("Fetching ticket ID:", ticketToFetch.id);

      const fetchedTicket = await ticketStorage.getTicket(ticketToFetch.id);
      console.log("✅ Ticket fetched successfully!");
      console.log("Full ticket data:", JSON.stringify(fetchedTicket, null, 2));
      console.log("");
    }

    // ========================================
    // 4. Run basic search and log results
    // ========================================
    console.log("🔎 Running search queries...\n");

    // Search by time range (last 24 hours)
    console.log("--- Search by time range (last 24 hours) ---");
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const timeSearchResults = await ticketStorage.searchTickets({
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

    // Search by minimum urgency
    console.log("--- Search by minimum urgency (>= 0.5) ---");
    const urgencySearchResults = await ticketStorage.searchTickets({
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

    // Search by status
    console.log("--- Search by status (pending) ---");
    const statusSearchResults = await ticketStorage.searchTickets({
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

    // ========================================
    // 5. Test scheduler simulation
    // ========================================
    console.log("⏰ Testing scheduler simulation...");
    console.log("Re-triaging pending tickets...");

    const pendingTickets = await ticketStorage.getPendingTickets();
    let updatedCount = 0;

    for (const ticket of pendingTickets) {
      // Recalculate urgency
      const urgencyResult = await urgencyScorer.calculateUrgency(ticket);

      // Update if urgency changed significantly
      if (Math.abs(urgencyResult.score - ticket.urgency) > 0.1) {
        ticket.urgency = urgencyResult.score;
        ticket.urgencyBreakdown = urgencyResult.breakdown;
        ticket.summary = urgencyResult.summary;
        ticket.tags = urgencyResult.tags;
        ticket.lastUpdated = Date.now();

        await ticketStorage.updateTicket(ticket);
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      console.log(`✅ Updated ${updatedCount} tickets`);
    } else {
      console.log("✅ No tickets needed updating");
    }
    console.log("");

    // ========================================
    // 6. Get statistics
    // ========================================
    console.log("📊 Getting ticket statistics...");
    const stats = await ticketStorage.getTicketStats();
    console.log("Total tickets:", stats.total);
    console.log("By status:", JSON.stringify(stats.byStatus, null, 2));
    console.log("By urgency:", JSON.stringify(stats.byUrgency, null, 2));
    console.log("By type:", JSON.stringify(stats.byType, null, 2));
    console.log("");

    // ========================================
    // 7. Summary
    // ========================================
    console.log("📊 Demo Summary:");
    console.log(`✅ Components initialized successfully`);
    console.log(`✅ Submitted ${submittedTickets.length} tickets`);
    console.log(`✅ Fetched ticket by ID`);
    console.log(`✅ Performed time range search`);
    console.log(`✅ Performed urgency search`);
    console.log(`✅ Performed status search`);
    console.log(`✅ Simulated scheduler re-triaging`);
    console.log(`✅ Generated statistics`);
    console.log("");
    console.log("🎉 Simple demo completed successfully!");

    await urgencyScorer.cleanup();
  } catch (error) {
    console.error("❌ Demo failed:", error);
    console.error(error.stack);
  }
}

// Run the demo
simpleDemo().catch(console.error);
