import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp";
import express from "express";
import { initializers } from "./src/tools/tools-list";

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());

// CORS headers for Prompt Opinion platform
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-fhir-server-url, x-fhir-access-token, x-patient-id, Accept");
  if (_req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "MedShield AI",
    version: "1.0.0",
    description: "Adverse Drug Event Prevention MCP Server",
    tools: [
      "get_patient_medication_context",
      "check_drug_interactions",
      "analyze_lab_trends",
      "assess_genomic_risk",
      "cross_reference_allergies",
      "generate_safety_report",
    ],
    sharp: {
      headers: ["x-fhir-server-url", "x-fhir-access-token", "x-patient-id"],
      spec: "https://sharponmcp.com",
    },
    timestamp: new Date().toISOString(),
  });
});

// MCP endpoint — SHARP-compliant
app.post("/mcp", async (req, res) => {
  console.log("=== INCOMING /mcp POST ===");
  console.log("HEADERS:", JSON.stringify(req.headers, null, 2));
  console.log("BODY:", JSON.stringify(req.body, null, 2));
  try {
    const server = new McpServer(
      {
        name: "MedShield AI",
        version: "1.0.0",
      },
      {
        capabilities: {
          extensions: {
            "ai.promptopinion/fhir-context": {
              scopes: [
                { name: "patient/Patient.rs", required: true },
                { name: "patient/MedicationRequest.rs" },
                { name: "patient/MedicationStatement.rs" },
                { name: "patient/Condition.rs" },
                { name: "patient/AllergyIntolerance.rs" }
              ]
            }
          }
        }
      }
    );

    // Register all 6 tools, passing the request for SHARP header extraction
    for (const initializer of initializers) {
      initializer(server, req, res);
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      console.log("Request closed");
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});


app.listen(port, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🛡️  MedShield AI — MCP Server Running                      ║
║                                                              ║
║   Port: ${String(port).padEnd(52)}║
║   MCP Endpoint: http://localhost:${port}/mcp${" ".repeat(Math.max(0, 28 - String(port).length))}║
║   Health Check: http://localhost:${port}/health${" ".repeat(Math.max(0, 25 - String(port).length))}║
║                                                              ║
║   SHARP Headers:                                             ║
║     x-fhir-server-url    → FHIR server base URL             ║
║     x-fhir-access-token  → SMART on FHIR access token       ║
║     x-patient-id          → Patient ID (fallback)            ║
║                                                              ║
║   Tools (6):                                                 ║
║     1. get_patient_medication_context                        ║
║     2. check_drug_interactions                               ║
║     3. analyze_lab_trends                                    ║
║     4. assess_genomic_risk                                   ║
║     5. cross_reference_allergies                             ║
║     6. generate_safety_report                                ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
});
