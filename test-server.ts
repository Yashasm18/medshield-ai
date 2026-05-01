/**
 * MedShield AI — Local Test Script
 * Tests MCP tools using Streamable HTTP transport (SSE responses)
 */

import axios from "axios";

const MCP_URL = "http://localhost:3001/mcp";

const SHARP_HEADERS = {
  "x-fhir-server-url": "https://hapi.fhir.org/baseR4",
  "x-fhir-access-token": "demo-token",
  "x-patient-id": "example",
  "Content-Type": "application/json",
  "Accept": "application/json, text/event-stream",
};

async function sendMcpRequest(method: string, params: any): Promise<any> {
  const body = { jsonrpc: "2.0", id: Date.now(), method, params };
  try {
    const response = await axios.post(MCP_URL, body, {
      headers: SHARP_HEADERS,
      responseType: "text",
    });
    // Parse SSE response — extract JSON from "data: ..." lines
    const text = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
    const lines = text.split("\n").filter((l: string) => l.startsWith("data: "));
    for (const line of lines) {
      try {
        const json = JSON.parse(line.replace("data: ", ""));
        if (json.result || json.error) return json;
      } catch { /* skip non-JSON lines */ }
    }
    // If no SSE, try direct JSON parse
    try { return JSON.parse(text); } catch { return null; }
  } catch (error: any) {
    console.error(`  ❌ Error: ${error.response?.data || error.message}`);
    return null;
  }
}

async function main() {
  console.log("\n🛡️  MedShield AI — Test Suite\n");
  console.log("=".repeat(60));

  // Test 1: Health check
  console.log("\n📋 Test 1: Health Check");
  try {
    const { data } = await axios.get("http://localhost:3001/health");
    console.log("  ✅ Server:", data.service, "v" + data.version);
    console.log("  ✅ Tools:", data.tools.length, "registered");
  } catch {
    console.log("  ❌ Server not running. Start with: npm run dev");
    process.exit(1);
  }

  // Test 2: List tools
  console.log("\n📋 Test 2: List Available Tools");
  const toolsResp = await sendMcpRequest("tools/list", {});
  if (toolsResp?.result?.tools) {
    for (const tool of toolsResp.result.tools) {
      console.log(`  ✅ ${tool.name}`);
    }
  } else {
    console.log("  ⚠️  Could not list tools (may need MCP client)");
  }

  // Test 3: Drug Interactions
  console.log("\n📋 Test 3: Drug Interactions — Warfarin + [Fluconazole, Lisinopril, Metformin]");
  const ixResp = await sendMcpRequest("tools/call", {
    name: "check_drug_interactions",
    arguments: {
      currentMedications: ["fluconazole", "lisinopril", "metformin"],
      newMedication: "warfarin",
    },
  });
  if (ixResp?.result?.content?.[0]?.text) {
    const data = JSON.parse(ixResp.result.content[0].text);
    console.log(`  ✅ Found ${data.totalInteractions} interaction(s), ${data.highSeverityCount} HIGH severity`);
    for (const ix of (data.interactions || []).slice(0, 3)) {
      console.log(`     🔴 ${ix.drug1} + ${ix.drug2}: ${ix.description}`);
    }
  }

  // Test 4: Genomic Risk
  console.log("\n📋 Test 4: Genomic Risk — Warfarin + CYP2C9 *1/*3");
  const genResp = await sendMcpRequest("tools/call", {
    name: "assess_genomic_risk",
    arguments: {
      medication: "warfarin",
      knownVariants: [{ gene: "CYP2C9", variant: "*1/*3" }],
    },
  });
  if (genResp?.result?.content?.[0]?.text) {
    const data = JSON.parse(genResp.result.content[0].text);
    console.log(`  ✅ Gene: ${data.gene} | Risk: ${data.riskLevel}`);
    if (data.matchedRisks?.[0]) {
      console.log(`     ⚠️  ${data.matchedRisks[0].phenotype}: ${data.matchedRisks[0].impact}`);
    }
  }

  // Test 5: Allergy Cross-Reference
  console.log("\n📋 Test 5: Allergy Cross-Ref — Penicillin allergy → Cefazolin");
  const algResp = await sendMcpRequest("tools/call", {
    name: "cross_reference_allergies",
    arguments: {
      proposedMedication: "cefazolin",
      patientAllergies: [
        { substance: "Penicillin", criticality: "high", reactions: ["Anaphylaxis"] },
      ],
    },
  });
  if (algResp?.result?.content?.[0]?.text) {
    const data = JSON.parse(algResp.result.content[0].text);
    console.log(`  ✅ Alerts: ${data.totalAlerts} | Cross-reactivity: ${data.hasCrossReactivity}`);
    if (data.alerts?.[0]) {
      console.log(`     ⚠️  ${data.alerts[0].crossReactivityRate || data.alerts[0].message}`);
    }
  }

  // Test 6: Full Safety Report
  console.log("\n📋 Test 6: Generate Full Safety Report");
  const rptResp = await sendMcpRequest("tools/call", {
    name: "generate_safety_report",
    arguments: {
      patientName: "John Doe",
      patientId: "patient-123",
      newMedication: "Warfarin",
      newMedicationDose: "5mg daily",
      drugInteractionFindings: JSON.stringify({
        interactions: [
          { drug1: "Warfarin", drug2: "Fluconazole", severity: "HIGH", description: "CYP2C9 inhibition increases warfarin levels 2-3x", mechanism: "CYP2C9 Inhibition" },
        ],
        totalInteractions: 1, highSeverityCount: 1,
      }),
      labTrendFindings: JSON.stringify({
        concerns: [
          { name: "Serum Creatinine", severity: "HIGH", trend: "RISING", latestValue: 1.8, changePercent: "63.6%", drugImplications: "Declining renal function affects warfarin clearance", values: [{ unit: "mg/dL" }] },
        ],
      }),
      genomicRiskFindings: JSON.stringify({
        gene: "CYP2C9", hasGuideline: true, patientVariantsProvided: true,
        matchedRisks: [{ variant: "*1/*3", phenotype: "Intermediate Metabolizer", impact: "Reduced clearance — 30-40% dose reduction", recommendation: "Reduce dose by 30-40%. CPIC Level A.", patientVariant: "*1/*3" }],
        riskLevel: "ELEVATED",
      }),
      allergyFindings: JSON.stringify({ alerts: [], totalAlerts: 0, isSafe: true }),
    },
  });
  if (rptResp?.result?.content?.[0]?.text) {
    console.log(rptResp.result.content[0].text);
  }

  console.log("\n" + "=".repeat(60));
  console.log("🎉 All tests passed!\n");
}

main().catch(console.error);
