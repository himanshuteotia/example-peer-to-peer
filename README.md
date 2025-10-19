# Multisig Ticket Triage System

A P2P service that triages multisig-style transaction tickets using Hyperswarm RPC, Hyperbee storage, and local GGUF LLM integration. The system validates, scores urgency, provides summaries/tags, and emits Safe-compatible transaction hints for human operators.

## 🚀 Quick Start

### Prerequisites

- Node.js ≥ 18.0.0
- npm or yarn package manager

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd multisig-triage-exact
```

2. Install dependencies:
```bash
npm install
```

3. Run the simple demo (recommended - fully working):
```bash
npm run simple-demo
```

Or try the RPC demo (may have connection issues in local environment):
```bash
npm run working-demo
```

## 📋 Available Scripts

- `npm start` - Start the triage server
- `npm run simple-demo` - Run the simple demo (recommended - fully working)
- `npm run working-demo` - Run the RPC demo with bootstrap DHT
- `npm run demo` - Run the original RPC demo script
- `npm test` - Run automated tests
- `npm run clean` - Clean up database and node_modules

## 🏗️ Architecture

### Core Components

#### 1. **TriageServer** (`src/server.js`)
The main server that handles RPC requests and manages the triage process.

**Key Features:**
- Hyperswarm RPC server for P2P communication
- Hyperbee storage for persistent data
- Automatic urgency scoring and re-triaging
- Scheduler for periodic ticket updates

#### 2. **UrgencyScorer** (`src/urgency-scorer.js`)
Handles deterministic urgency calculation and optional LLM integration.

**Scoring Factors:**
- **Value Factor (30%)**: Transaction value impact
- **Deadline Factor (25%)**: Deadline proximity
- **Approvals Factor (20%)**: Current approval status
- **Type Factor (15%)**: Transaction type classification
- **Recipient Factor (10%)**: Recipient verification status

#### 3. **TicketStorage** (`src/ticket-storage.js`)
Manages Hyperbee storage with efficient indexing for quick lookups.

**Indexes:**
- By creation time
- By urgency score
- By status
- By transaction type
- By deadline

#### 4. **TriageClient** (`src/client.js`)
Client library for interacting with the triage server.

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
# Server Configuration
SERVER_PORT=40001
BOOTSTRAP_PORT=30001
DB_PATH=./db/rpc-server

# LLM Configuration (Optional)
LLM_MODEL_PATH=./models/llama-2-7b-chat.Q4_K_M.gguf

# Client Configuration
CLIENT_PORT=50001
```

### Server Configuration

```javascript
const server = new TriageServer({
  port: 40001,           // DHT port
  bootstrapPort: 30001,  // Bootstrap DHT port
  dbPath: './db/server', // Hyperbee storage path
  modelPath: './models/llama-2-7b-chat.Q4_K_M.gguf' // Optional LLM model
});
```

## 📊 Ticket Format

### Basic Ticket Structure

```json
{
  "type": "payroll",
  "description": "Monthly salary payments for all employees",
  "value": 250000,
  "currency": "USD",
  "recipient": {
    "address": "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
    "name": "Payroll Contract",
    "verified": true,
    "whitelisted": true
  },
  "deadline": "2024-12-31T23:59:59Z",
  "requiredApprovals": 3,
  "approvals": [
    {
      "approver": "0x1234567890123456789012345678901234567890",
      "timestamp": "2024-12-15T10:30:00Z",
      "signature": "0xabcdef..."
    }
  ],
  "metadata": {
    "department": "HR",
    "payrollPeriod": "2024-Q4"
  }
}
```

### Required Fields

- `type`: Transaction type (e.g., "payroll", "vendor payment", "treasury management")
- `description`: Human-readable description of the transaction

### Optional Fields

- `value`: Transaction value (number)
- `currency`: Currency type (default: "USD")
- `recipient`: Recipient information object
- `deadline`: ISO 8601 deadline timestamp
- `requiredApprovals`: Number of required approvals (default: 2)
- `approvals`: Array of existing approvals
- `metadata`: Additional transaction metadata

## 🔌 RPC API

### Submit Ticket

**Method:** `submitTicket`

**Request:**
```json
{
  "ticket": {
    "type": "payroll",
    "description": "Monthly salary payments",
    "value": 250000,
    "currency": "USD"
  }
}
```

**Response:**
```json
{
  "success": true,
  "ticketId": "abc123...",
  "urgency": 0.75,
  "summary": "Payroll transaction of 250000 USD to verified recipient",
  "tags": ["payroll", "high-value", "pending-approval"]
}
```

### Get Ticket

**Method:** `getTicket`

**Request:**
```json
{
  "ticketId": "abc123..."
}
```

**Response:**
```json
{
  "success": true,
  "ticket": {
    "id": "abc123...",
    "type": "payroll",
    "urgency": 0.75,
    "summary": "Payroll transaction of 250000 USD to verified recipient",
    "tags": ["payroll", "high-value", "pending-approval"],
    "createdAt": 1703123456789,
    "status": "pending"
  }
}
```

### Search Tickets

**Method:** `searchTickets`

**Request:**
```json
{
  "startTime": 1703123456789,
  "endTime": 1703209856789,
  "minUrgency": 0.5,
  "status": "pending",
  "limit": 50
}
```

**Response:**
```json
{
  "success": true,
  "tickets": [
    {
      "id": "abc123...",
      "type": "payroll",
      "urgency": 0.75,
      "summary": "Payroll transaction of 250000 USD to verified recipient",
      "tags": ["payroll", "high-value", "pending-approval"]
    }
  ],
  "count": 1
}
```

## 🧮 Urgency Scoring System

### Deterministic Base Scoring

The system calculates a base urgency score (0-1) using weighted factors:

1. **Value Factor (30%)**
   - Unknown value: 0.1
   - < $1,000: 0.2
   - $1,000 - $10,000: 0.4
   - $10,000 - $100,000: 0.7
   - $100,000 - $1,000,000: 0.9
   - > $1,000,000: 1.0

2. **Deadline Factor (25%)**
   - Overdue: 1.0
   - < 1 hour: 0.9
   - < 1 day: 0.7
   - < 1 week: 0.5
   - < 1 month: 0.3
   - > 1 month: 0.1

3. **Approvals Factor (20%)**
   - Fully approved: 0.1
   - No approvals: 0.9
   - One approval left: 0.3
   - Some approvals: 0.6

4. **Type Factor (15%)**
   - Emergency/Urgent: 0.9
   - Security/Breach: 0.8
   - Payroll/Salary: 0.7
   - Vendor/Payment: 0.5
   - Treasury/Investment: 0.4
   - Maintenance/Upgrade: 0.2
   - Test/Demo: 0.1

5. **Recipient Factor (10%)**
   - New/Unverified: 0.8
   - Verified & Whitelisted: 0.2
   - Default: 0.5

### LLM Integration

When a local GGUF model is available, the system:

1. Calculates the deterministic base score
2. Sends ticket details to the LLM for analysis
3. Receives an adjustment (-0.2 to +0.2) and summary
4. Applies the adjustment to the final score

**LLM Prompt Example:**
```
You are a financial risk analyst. Analyze this multisig transaction ticket and provide:

1. Urgency adjustment (-0.2 to +0.2): How much should the base urgency score of 0.75 be adjusted?
2. Brief summary (1-2 sentences): What is this transaction about?
3. Tags: 3-5 relevant tags (comma-separated)

Ticket details:
- Type: payroll
- Value: 250000 USD
- Description: Monthly salary payments for all employees - Q4 2024
- Deadline: 2024-12-31T23:59:59Z
- Approvals: 1/3
- Recipient: 0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6

Respond in JSON format:
{
  "adjustment": 0.05,
  "summary": "Brief description",
  "tags": ["tag1", "tag2", "tag3"]
}
```

## 📁 Project Structure

```
multi-sig/
├── src/
│   ├── server.js          # Main triage server
│   ├── client.js          # RPC client
│   ├── urgency-scorer.js  # Urgency calculation & LLM integration
│   └── ticket-storage.js  # Hyperbee storage management
├── scripts/
│   ├── demo.js            # Complete demo script
│   └── test.js            # Automated tests
├── fixtures/
│   ├── payroll-ticket.json
│   ├── vendor-payment.json
│   ├── treasury-update.json
│   ├── new-recipient.json
│   ├── bridged-transaction.json
│   ├── unknown-usd.json
│   ├── threshold-met.json
│   ├── low-urgency.json
│   └── urgent-deadline.json
├── db/                    # Hyperbee storage (created at runtime)
├── package.json
└── README.md
```

## 🧪 Testing

### Running Tests

```bash
npm test
```

### Test Coverage

The test suite covers:

- ✅ Ping functionality
- ✅ Ticket submission (complete and minimal)
- ✅ Ticket retrieval by ID
- ✅ Search by time range
- ✅ Search by minimum urgency
- ✅ Search by status
- ✅ Urgency scoring factors
- ✅ Error handling

### Demo Script

The demo script (`scripts/demo.js`) demonstrates:

1. Starting the triage server in-process
2. Connecting a client
3. Submitting 3 sample tickets
4. Fetching tickets by ID
5. Performing various search operations
6. Testing the scheduler
7. Graceful shutdown

## 🔄 Scheduler

The system includes a scheduler that runs every 60 seconds to:

1. Find pending tickets
2. Recalculate urgency scores
3. Update tickets with significant urgency changes
4. Log update statistics

## 🚨 Known Limitations

### Current Limitations

1. **LLM Dependency**: The system works without LLM but provides better summaries with it
2. **Model Path**: Requires manual configuration of GGUF model path
3. **RPC Connection Issues**: Local testing of RPC functionality may have connection issues due to DHT bootstrap configuration
4. **Network Discovery**: Relies on bootstrap DHT nodes for peer discovery
5. **Storage Persistence**: Database files are stored locally and not replicated

### Next Steps for Complete Implementation

1. **Model Management**: Automatic model downloading and management
2. **Network Resilience**: Better peer discovery and connection management
3. **Data Replication**: Cross-peer data synchronization
4. **Safe Integration**: Direct Safe-compatible transaction generation
5. **Web Interface**: Optional web UI for ticket management
6. **Advanced Analytics**: Historical urgency trends and reporting
7. **Multi-chain Support**: Support for multiple blockchain networks

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details


**Note**: This implementation focuses on the core triage functionality as specified in the requirements. The system is designed to be extensible and can be enhanced with additional features as needed.
