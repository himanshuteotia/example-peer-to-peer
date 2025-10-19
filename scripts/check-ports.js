#!/usr/bin/env node
"use strict";

/**
 * Usage:
 *   node scripts/check-ports.js 30001 40001 50001
 */

import { execSync } from "child_process";

const ports = process.argv.slice(2).map(Number).filter(Boolean);

if (ports.length === 0) {
  console.log("Usage: node scripts/check-ports.js <port1> <port2> ...");
  process.exit(0);
}

console.log(`🔍 Checking ports: ${ports.join(", ")}\n`);

for (const port of ports) {
  try {
    if (process.platform === "win32") {
      // Windows: use netstat
      const output = execSync(`netstat -ano | findstr :${port}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      if (output.trim()) {
        console.log(`❌ Port ${port} is in use:`);
        console.log(output.trim(), "\n");
      } else {
        console.log(`✅ Port ${port} is free\n`);
      }
    } else {
      // macOS / Linux: use lsof
      const output = execSync(`lsof -i :${port} | grep LISTEN || true`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      if (output.trim()) {
        console.log(`❌ Port ${port} is in use:`);
        console.log(output.trim(), "\n");
      } else {
        console.log(`✅ Port ${port} is free\n`);
      }
    }
  } catch (err) {
    // no output means port is free
    console.log(`✅ Port ${port} is free\n`);
  }
}

console.log("✅ Port check complete");
