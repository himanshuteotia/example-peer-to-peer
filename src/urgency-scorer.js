"use strict";

import { LlamaModel, LlamaContext, LlamaChatSession } from "node-llama-cpp";

export class UrgencyScorer {
  constructor(config = {}) {
    this.config = {
      modelPath: config.modelPath || "./models/llama-2-7b-chat.Q4_K_M.gguf",
      ...config,
    };

    this.model = null;
    this.context = null;
    this.session = null;
    this.initialized = false;
  }

  async initialize() {
    try {
      console.log("🤖 Initializing LLM for urgency scoring...");

      // Try to load the model, but don't fail if it's not available
      try {
        this.model = new LlamaModel({
          modelPath: this.config.modelPath,
        });

        this.context = new LlamaContext({
          model: this.model,
          contextSize: 4096,
        });

        this.session = new LlamaChatSession({
          context: this.context,
        });

        this.initialized = true;
        console.log("✅ LLM initialized successfully");
      } catch (error) {
        console.warn(
          "⚠️  LLM not available, using deterministic scoring only:",
          error.message
        );
        this.initialized = false;
      }
    } catch (error) {
      console.error("❌ Failed to initialize LLM:", error);
      this.initialized = false;
    }
  }

  async calculateUrgency(ticket) {
    // Calculate deterministic base urgency
    const baseUrgency = this.calculateDeterministicUrgency(ticket);

    // Get LLM-adjusted urgency if available
    let llmAdjustment = 0;
    let summary = "";
    let tags = [];

    if (this.initialized) {
      try {
        const llmResult = await this.getLLMUrgencyAdjustment(
          ticket,
          baseUrgency
        );
        llmAdjustment = llmResult.adjustment;
        summary = llmResult.summary;
        tags = llmResult.tags;
      } catch (error) {
        console.warn(
          "⚠️  LLM adjustment failed, using base urgency:",
          error.message
        );
      }
    }

    // Fallback to deterministic summary if LLM not available
    if (!summary) {
      summary = this.generateDeterministicSummary(ticket);
    }

    if (tags.length === 0) {
      tags = this.generateDeterministicTags(ticket);
    }

    const finalUrgency = Math.max(0, Math.min(1, baseUrgency + llmAdjustment));

    return {
      score: finalUrgency,
      breakdown: {
        baseUrgency,
        llmAdjustment,
        factors: this.getUrgencyFactors(ticket),
      },
      summary,
      tags,
    };
  }

  calculateDeterministicUrgency(ticket) {
    const factors = this.getUrgencyFactors(ticket);

    // Weighted scoring system
    const weights = {
      value: 0.3, // 30% - Transaction value impact
      deadline: 0.25, // 25% - Deadline proximity
      approvals: 0.2, // 20% - Approval status
      type: 0.15, // 15% - Transaction type
      recipient: 0.1, // 10% - Recipient status
    };

    let totalScore = 0;
    let totalWeight = 0;

    for (const [factor, value] of Object.entries(factors)) {
      if (weights[factor]) {
        totalScore += value * weights[factor];
        totalWeight += weights[factor];
      }
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0.5;
  }

  getUrgencyFactors(ticket) {
    const factors = {};

    // Value factor (0-1)
    factors.value = this.calculateValueFactor(ticket);

    // Deadline factor (0-1)
    factors.deadline = this.calculateDeadlineFactor(ticket);

    // Approvals factor (0-1)
    factors.approvals = this.calculateApprovalsFactor(ticket);

    // Type factor (0-1)
    factors.type = this.calculateTypeFactor(ticket);

    // Recipient factor (0-1)
    factors.recipient = this.calculateRecipientFactor(ticket);

    return factors;
  }

  calculateValueFactor(ticket) {
    const value = ticket.value || 0;
    const currency = ticket.currency || "USD";

    // Convert to USD equivalent (simplified)
    let usdValue = value;
    if (currency === "ETH") {
      usdValue = value * 2000; // Approximate ETH price
    } else if (currency === "BTC") {
      usdValue = value * 45000; // Approximate BTC price
    }

    // Score based on value ranges
    if (usdValue === 0 || !ticket.value) return 0.1; // Unknown value
    if (usdValue < 1000) return 0.2; // Low value
    if (usdValue < 10000) return 0.4; // Medium value
    if (usdValue < 100000) return 0.7; // High value
    if (usdValue < 1000000) return 0.9; // Very high value
    return 1.0; // Critical value
  }

  calculateDeadlineFactor(ticket) {
    if (!ticket.deadline) return 0.3; // No deadline = medium urgency

    const now = Date.now();
    const deadline = new Date(ticket.deadline).getTime();
    const timeLeft = deadline - now;

    if (timeLeft < 0) return 1.0; // Overdue
    if (timeLeft < 3600000) return 0.9; // Less than 1 hour
    if (timeLeft < 86400000) return 0.7; // Less than 1 day
    if (timeLeft < 604800000) return 0.5; // Less than 1 week
    if (timeLeft < 2592000000) return 0.3; // Less than 1 month
    return 0.1; // More than 1 month
  }

  calculateApprovalsFactor(ticket) {
    const approvals = ticket.approvals || [];
    const required = ticket.requiredApprovals || 2;
    const current = approvals.length;

    if (current >= required) return 0.1; // Fully approved
    if (current === 0) return 0.9; // No approvals yet
    if (current === required - 1) return 0.3; // One approval left
    return 0.6; // Some approvals but not enough
  }

  calculateTypeFactor(ticket) {
    const type = (ticket.type || "").toLowerCase();

    // High urgency types
    if (type.includes("emergency") || type.includes("urgent")) return 0.9;
    if (type.includes("security") || type.includes("breach")) return 0.8;
    if (type.includes("payroll") || type.includes("salary")) return 0.7;

    // Medium urgency types
    if (type.includes("vendor") || type.includes("payment")) return 0.5;
    if (type.includes("treasury") || type.includes("investment")) return 0.4;

    // Low urgency types
    if (type.includes("maintenance") || type.includes("upgrade")) return 0.2;
    if (type.includes("test") || type.includes("demo")) return 0.1;

    return 0.3; // Default medium urgency
  }

  calculateRecipientFactor(ticket) {
    const recipient = ticket.recipient || {};

    // New recipient = higher risk
    if (recipient.isNew || !recipient.verified) return 0.8;

    // Verified recipient = lower risk
    if (recipient.verified && recipient.whitelisted) return 0.2;

    return 0.5; // Default medium risk
  }

  async getLLMUrgencyAdjustment(ticket, baseUrgency) {
    if (!this.initialized) {
      throw new Error("LLM not initialized");
    }

    const prompt = this.buildUrgencyPrompt(ticket, baseUrgency);

    const response = await this.session.prompt(prompt, {
      maxTokens: 200,
      temperature: 0.3,
    });

    return this.parseLLMResponse(response);
  }

  buildUrgencyPrompt(ticket, baseUrgency) {
    return `You are a financial risk analyst. Analyze this multisig transaction ticket and provide:

1. Urgency adjustment (-0.2 to +0.2): How much should the base urgency score of ${baseUrgency.toFixed(
      2
    )} be adjusted?
2. Brief summary (1-2 sentences): What is this transaction about?
3. Tags: 3-5 relevant tags (comma-separated)

Ticket details:
- Type: ${ticket.type || "Unknown"}
- Value: ${ticket.value || "Unknown"} ${ticket.currency || "USD"}
- Description: ${ticket.description || "No description"}
- Deadline: ${ticket.deadline || "No deadline"}
- Approvals: ${(ticket.approvals || []).length}/${ticket.requiredApprovals || 2}
- Recipient: ${ticket.recipient?.address || "Unknown"}

Respond in JSON format:
{
  "adjustment": 0.05,
  "summary": "Brief description",
  "tags": ["tag1", "tag2", "tag3"]
}`;
  }

  parseLLMResponse(response) {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        adjustment: Math.max(-0.2, Math.min(0.2, parsed.adjustment || 0)),
        summary: parsed.summary || "LLM analysis unavailable",
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      };
    } catch (error) {
      console.warn("Failed to parse LLM response:", error.message);
      return {
        adjustment: 0,
        summary: "LLM analysis failed",
        tags: [],
      };
    }
  }

  generateDeterministicSummary(ticket) {
    const type = ticket.type || "transaction";
    const value = ticket.value
      ? `${ticket.value} ${ticket.currency || "USD"}`
      : "unknown value";
    const recipient = ticket.recipient?.address
      ? `to ${ticket.recipient.address.slice(0, 8)}...`
      : "to unknown recipient";

    return `${type} of ${value} ${recipient}`;
  }

  generateDeterministicTags(ticket) {
    const tags = [];

    // Add type-based tags
    if (ticket.type) {
      tags.push(ticket.type.toLowerCase());
    }

    // Add value-based tags
    if (ticket.value) {
      if (ticket.value > 100000) tags.push("high-value");
      else if (ticket.value < 1000) tags.push("low-value");
      else tags.push("medium-value");
    }

    // Add approval-based tags
    const approvals = (ticket.approvals || []).length;
    const required = ticket.requiredApprovals || 2;
    if (approvals >= required) tags.push("approved");
    else if (approvals === 0) tags.push("pending-approval");
    else tags.push("partially-approved");

    // Add deadline-based tags
    if (ticket.deadline) {
      const timeLeft = new Date(ticket.deadline).getTime() - Date.now();
      if (timeLeft < 86400000) tags.push("urgent-deadline");
      else if (timeLeft < 604800000) tags.push("near-deadline");
    }

    return tags.slice(0, 5); // Limit to 5 tags
  }

  async cleanup() {
    if (this.session) {
      await this.session.dispose();
    }
    if (this.context) {
      await this.context.dispose();
    }
    if (this.model) {
      await this.model.dispose();
    }
  }
}
