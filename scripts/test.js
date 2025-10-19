"use strict";

import { TriageServer } from "../src/server.js";
import { TriageClient } from "../src/client.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runTests() {
  console.log("🧪 Running Multisig Ticket Triage Tests\n");

  let server = null;
  let client = null;
  let serverPublicKey = null;
  let testResults = {
    passed: 0,
    failed: 0,
    tests: [],
  };

  function logTest(testName, passed, error = null) {
    const status = passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${status} ${testName}`);

    testResults.tests.push({ name: testName, passed, error });
    if (passed) {
      testResults.passed++;
    } else {
      testResults.failed++;
      if (error) {
        console.log(`   Error: ${error.message}`);
      }
    }
  }

  try {
    // ========================================
    // Setup
    // ========================================
    console.log("🔧 Setting up test environment...");

    server = new TriageServer({
      port: 40002,
      bootstrapPort: 30002,
      dbPath: join(__dirname, "../db/test-server"),
    });

    await server.start();
    serverPublicKey = server.rpcServer.publicKey;

    client = new TriageClient({
      port: 50002,
      bootstrapPort: 30002,
      dbPath: join(__dirname, "../db/test-client"),
      serverPublicKey: serverPublicKey,
    });

    await client.connect();
    console.log("✅ Test environment ready\n");

    // ========================================
    // Test 1: Ping functionality
    // ========================================
    try {
      const pingResponse = await client.ping();
      const hasNonce = pingResponse.nonce !== undefined;
      const hasTimestamp = pingResponse.timestamp !== undefined;
      logTest("Ping functionality", hasNonce && hasTimestamp);
    } catch (error) {
      logTest("Ping functionality", false, error);
    }

    // ========================================
    // Test 2: Submit ticket with all fields
    // ========================================
    try {
      const testTicket = {
        type: "test payment",
        description: "Test payment for automated testing",
        value: 1000,
        currency: "USD",
        recipient: {
          address: "0x1234567890123456789012345678901234567890",
          name: "Test Recipient",
          verified: true,
          whitelisted: true,
        },
        deadline: "2024-12-31T23:59:59Z",
        requiredApprovals: 2,
        approvals: [],
      };

      const result = await client.submitTicket(testTicket);
      const hasTicketId = result.ticketId !== undefined;
      const hasUrgency = result.urgency !== undefined;
      const hasSummary = result.summary !== undefined;
      const hasTags = Array.isArray(result.tags);

      logTest(
        "Submit complete ticket",
        hasTicketId && hasUrgency && hasSummary && hasTags
      );
    } catch (error) {
      logTest("Submit complete ticket", false, error);
    }

    // ========================================
    // Test 3: Submit minimal ticket
    // ========================================
    try {
      const minimalTicket = {
        type: "minimal test",
        description: "Minimal test ticket",
      };

      const result = await client.submitTicket(minimalTicket);
      const hasTicketId = result.ticketId !== undefined;
      const hasUrgency = result.urgency !== undefined;

      logTest("Submit minimal ticket", hasTicketId && hasUrgency);
    } catch (error) {
      logTest("Submit minimal ticket", false, error);
    }

    // ========================================
    // Test 4: Get ticket by ID
    // ========================================
    try {
      const testTicket = {
        type: "get test",
        description: "Ticket for get test",
      };

      const submitResult = await client.submitTicket(testTicket);
      const fetchedTicket = await client.getTicket(submitResult.ticketId);

      const hasId = fetchedTicket.id === submitResult.ticketId;
      const hasType = fetchedTicket.type === testTicket.type;
      const hasUrgency = fetchedTicket.urgency !== undefined;

      logTest("Get ticket by ID", hasId && hasType && hasUrgency);
    } catch (error) {
      logTest("Get ticket by ID", false, error);
    }

    // ========================================
    // Test 5: Search by time range
    // ========================================
    try {
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;

      const results = await client.searchTickets({
        startTime: oneHourAgo,
        endTime: now,
        limit: 5,
      });

      const isArray = Array.isArray(results);
      const hasResults = results.length > 0;

      logTest("Search by time range", isArray && hasResults);
    } catch (error) {
      logTest("Search by time range", false, error);
    }

    // ========================================
    // Test 6: Search by minimum urgency
    // ========================================
    try {
      const results = await client.searchTickets({
        minUrgency: 0.0,
        limit: 5,
      });

      const isArray = Array.isArray(results);
      const allAboveMin = results.every((ticket) => ticket.urgency >= 0.0);

      logTest("Search by minimum urgency", isArray && allAboveMin);
    } catch (error) {
      logTest("Search by minimum urgency", false, error);
    }

    // ========================================
    // Test 7: Search by status
    // ========================================
    try {
      const results = await client.searchTickets({
        status: "pending",
        limit: 5,
      });

      const isArray = Array.isArray(results);
      const allPending = results.every((ticket) => ticket.status === "pending");

      logTest("Search by status", isArray && allPending);
    } catch (error) {
      logTest("Search by status", false, error);
    }

    // ========================================
    // Test 8: Urgency scoring factors
    // ========================================
    try {
      const highValueTicket = {
        type: "high value test",
        description: "High value transaction",
        value: 1000000,
        currency: "USD",
        deadline: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
        requiredApprovals: 3,
        approvals: [],
      };

      const lowValueTicket = {
        type: "low value test",
        description: "Low value transaction",
        value: 100,
        currency: "USD",
        deadline: new Date(Date.now() + 86400000 * 30).toISOString(), // 30 days from now
        requiredApprovals: 1,
        approvals: [{ approver: "0x123", timestamp: new Date().toISOString() }],
      };

      const highResult = await client.submitTicket(highValueTicket);
      const lowResult = await client.submitTicket(lowValueTicket);

      const highUrgencyHigher = highResult.urgency > lowResult.urgency;

      logTest("Urgency scoring factors", highUrgencyHigher);
    } catch (error) {
      logTest("Urgency scoring factors", false, error);
    }

    // ========================================
    // Test 9: Error handling - invalid ticket ID
    // ========================================
    try {
      await client.getTicket("invalid-ticket-id");
      logTest(
        "Error handling - invalid ticket ID",
        false,
        new Error("Should have thrown error")
      );
    } catch (error) {
      const isExpectedError =
        error.message.includes("not found") ||
        error.message.includes("Ticket not found");
      logTest("Error handling - invalid ticket ID", isExpectedError);
    }

    // ========================================
    // Test 10: Error handling - missing ticket data
    // ========================================
    try {
      await client.submitTicket(null);
      logTest(
        "Error handling - missing ticket data",
        false,
        new Error("Should have thrown error")
      );
    } catch (error) {
      const isExpectedError =
        error.message.includes("required") ||
        error.message.includes("Ticket data");
      logTest("Error handling - missing ticket data", isExpectedError);
    }
  } catch (error) {
    console.error("❌ Test setup failed:", error);
    logTest("Test setup", false, error);
  } finally {
    // ========================================
    // Cleanup
    // ========================================
    console.log("\n🧹 Cleaning up test environment...");

    if (client) {
      await client.disconnect();
    }

    if (server) {
      await server.stop();
    }

    console.log("✅ Cleanup complete");
  }

  // ========================================
  // Test Results Summary
  // ========================================
  console.log("\n📊 Test Results Summary:");
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`📈 Total: ${testResults.passed + testResults.failed}`);
  console.log(
    `🎯 Success Rate: ${(
      (testResults.passed / (testResults.passed + testResults.failed)) *
      100
    ).toFixed(1)}%`
  );

  if (testResults.failed > 0) {
    console.log("\n❌ Failed Tests:");
    testResults.tests
      .filter((test) => !test.passed)
      .forEach((test) => {
        console.log(
          `   - ${test.name}: ${test.error?.message || "Unknown error"}`
        );
      });
  }

  console.log("\n🏁 Testing completed!");

  // Exit with appropriate code
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Handle process termination
process.on("SIGINT", async () => {
  console.log("\n🛑 Received SIGINT, shutting down tests...");
  process.exit(1);
});

// Run the tests
runTests().catch(console.error);
