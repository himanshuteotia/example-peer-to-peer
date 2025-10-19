"use strict";

export class TicketStorage {
  constructor(hbee) {
    this.hbee = hbee;
  }

  async storeTicket(ticket) {
    const ticketData = {
      ...ticket,
      storedAt: Date.now(),
    };

    // Store main ticket data
    await this.hbee.put(
      `ticket:${ticket.id}`,
      Buffer.from(JSON.stringify(ticketData), "utf-8")
    );

    // Create indexes for efficient querying
    await this.createIndexes(ticket);

    return ticket.id;
  }

  async getTicket(ticketId) {
    const data = await this.hbee.get(`ticket:${ticketId}`);
    if (!data) return null;

    return JSON.parse(data.value.toString("utf-8"));
  }

  async updateTicket(ticket) {
    return this.storeTicket(ticket);
  }

  async createIndexes(ticket) {
    const timestamp = ticket.createdAt || Date.now();

    // Index by creation time
    await this.hbee.put(
      `index:time:${timestamp}:${ticket.id}`,
      Buffer.from("1", "utf-8")
    );

    // Index by urgency score (rounded to 1 decimal)
    const urgencyKey = Math.round(ticket.urgency * 10) / 10;
    await this.hbee.put(
      `index:urgency:${urgencyKey}:${ticket.id}`,
      Buffer.from("1", "utf-8")
    );

    // Index by status
    await this.hbee.put(
      `index:status:${ticket.status}:${ticket.id}`,
      Buffer.from("1", "utf-8")
    );

    // Index by type
    if (ticket.type) {
      await this.hbee.put(
        `index:type:${ticket.type}:${ticket.id}`,
        Buffer.from("1", "utf-8")
      );
    }

    // Index by deadline (if exists)
    if (ticket.deadline) {
      const deadlineTime = new Date(ticket.deadline).getTime();
      await this.hbee.put(
        `index:deadline:${deadlineTime}:${ticket.id}`,
        Buffer.from("1", "utf-8")
      );
    }
  }

  async searchTickets(options = {}) {
    const { startTime, endTime, minUrgency, status, limit = 50 } = options;

    const tickets = [];
    const seenIds = new Set();

    // Search by time range
    if (startTime || endTime) {
      const timeTickets = await this.searchByTimeRange(startTime, endTime);
      for (const ticketId of timeTickets) {
        if (!seenIds.has(ticketId)) {
          seenIds.add(ticketId);
          const ticket = await this.getTicket(ticketId);
          if (ticket) tickets.push(ticket);
        }
      }
    }

    // Search by minimum urgency
    if (minUrgency !== undefined) {
      const urgencyTickets = await this.searchByMinUrgency(minUrgency);
      for (const ticketId of urgencyTickets) {
        if (!seenIds.has(ticketId)) {
          seenIds.add(ticketId);
          const ticket = await this.getTicket(ticketId);
          if (ticket) tickets.push(ticket);
        }
      }
    }

    // Search by status
    if (status) {
      const statusTickets = await this.searchByStatus(status);
      for (const ticketId of statusTickets) {
        if (!seenIds.has(ticketId)) {
          seenIds.add(ticketId);
          const ticket = await this.getTicket(ticketId);
          if (ticket) tickets.push(ticket);
        }
      }
    }

    // If no specific filters, get all tickets
    if (!startTime && !endTime && minUrgency === undefined && !status) {
      const allTickets = await this.getAllTickets();
      tickets.push(...allTickets);
    }

    // Sort by urgency (descending) and creation time (descending)
    tickets.sort((a, b) => {
      if (a.urgency !== b.urgency) {
        return b.urgency - a.urgency;
      }
      return b.createdAt - a.createdAt;
    });

    return tickets.slice(0, limit);
  }

  async searchByTimeRange(startTime, endTime) {
    const ticketIds = [];

    const startKey = startTime ? `index:time:${startTime}` : "index:time:";
    const endKey = endTime ? `index:time:${endTime}` : "index:time:~";

    for await (const { key, value } of this.hbee.createReadStream({
      gte: startKey,
      lte: endKey,
    })) {
      const keyStr = key.toString("utf-8");
      if (keyStr.startsWith("index:time:")) {
        const parts = keyStr.split(":");
        if (parts.length >= 3) {
          ticketIds.push(parts[2]);
        }
      }
    }

    return ticketIds;
  }

  async searchByMinUrgency(minUrgency) {
    const ticketIds = [];

    for await (const { key, value } of this.hbee.createReadStream({
      gte: `index:urgency:${minUrgency}`,
      lte: "index:urgency:~",
    })) {
      const keyStr = key.toString("utf-8");
      if (keyStr.startsWith("index:urgency:")) {
        const parts = keyStr.split(":");
        if (parts.length >= 3) {
          ticketIds.push(parts[2]);
        }
      }
    }

    return ticketIds;
  }

  async searchByStatus(status) {
    const ticketIds = [];

    for await (const { key, value } of this.hbee.createReadStream({
      gte: `index:status:${status}`,
      lte: `index:status:${status}~`,
    })) {
      const keyStr = key.toString("utf-8");
      if (keyStr.startsWith(`index:status:${status}:`)) {
        const parts = keyStr.split(":");
        if (parts.length >= 3) {
          ticketIds.push(parts[2]);
        }
      }
    }

    return ticketIds;
  }

  async getAllTickets() {
    const tickets = [];

    for await (const { key, value } of this.hbee.createReadStream({
      gte: "ticket:",
      lte: "ticket:~",
    })) {
      const keyStr = key.toString("utf-8");
      if (keyStr.startsWith("ticket:")) {
        try {
          const ticket = JSON.parse(value.toString("utf-8"));
          tickets.push(ticket);
        } catch (error) {
          console.warn("Failed to parse ticket:", error.message);
        }
      }
    }

    return tickets;
  }

  async getPendingTickets() {
    const ticketIds = await this.searchByStatus("pending");
    const tickets = [];
    for (const ticketId of ticketIds) {
      const ticket = await this.getTicket(ticketId);
      if (ticket) tickets.push(ticket);
    }
    return tickets;
  }

  async getTicketsByDeadline(deadlineThreshold) {
    const ticketIds = [];

    for await (const { key, value } of this.hbee.createReadStream({
      gte: "index:deadline:",
      lte: `index:deadline:${deadlineThreshold}`,
    })) {
      const keyStr = key.toString("utf-8");
      if (keyStr.startsWith("index:deadline:")) {
        const parts = keyStr.split(":");
        if (parts.length >= 3) {
          ticketIds.push(parts[2]);
        }
      }
    }

    const tickets = [];
    for (const ticketId of ticketIds) {
      const ticket = await this.getTicket(ticketId);
      if (ticket) tickets.push(ticket);
    }

    return tickets;
  }

  async getTicketStats() {
    const stats = {
      total: 0,
      byStatus: {},
      byUrgency: {},
      byType: {},
    };

    for await (const { key, value } of this.hbee.createReadStream({
      gte: "ticket:",
      lte: "ticket:~",
    })) {
      const keyStr = key.toString("utf-8");
      if (keyStr.startsWith("ticket:")) {
        try {
          const ticket = JSON.parse(value.toString("utf-8"));
          stats.total++;

          // Count by status
          stats.byStatus[ticket.status] =
            (stats.byStatus[ticket.status] || 0) + 1;

          // Count by urgency range
          const urgencyRange = Math.floor(ticket.urgency * 10) / 10;
          stats.byUrgency[urgencyRange] =
            (stats.byUrgency[urgencyRange] || 0) + 1;

          // Count by type
          const type = ticket.type || "unknown";
          stats.byType[type] = (stats.byType[type] || 0) + 1;
        } catch (error) {
          console.warn("Failed to parse ticket for stats:", error.message);
        }
      }
    }

    return stats;
  }

  async deleteTicket(ticketId) {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) return false;

    // Delete main ticket
    await this.hbee.del(`ticket:${ticketId}`);

    // Delete indexes
    await this.deleteIndexes(ticket);

    return true;
  }

  async deleteIndexes(ticket) {
    const timestamp = ticket.createdAt;
    const urgencyKey = Math.round(ticket.urgency * 10) / 10;

    // Delete time index
    await this.hbee.del(`index:time:${timestamp}:${ticket.id}`);

    // Delete urgency index
    await this.hbee.del(`index:urgency:${urgencyKey}:${ticket.id}`);

    // Delete status index
    await this.hbee.del(`index:status:${ticket.status}:${ticket.id}`);

    // Delete type index
    if (ticket.type) {
      await this.hbee.del(`index:type:${ticket.type}:${ticket.id}`);
    }

    // Delete deadline index
    if (ticket.deadline) {
      const deadlineTime = new Date(ticket.deadline).getTime();
      await this.hbee.del(`index:deadline:${deadlineTime}:${ticket.id}`);
    }
  }
}
