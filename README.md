# 🛡️ MedShield AI: Clinical Safety Agent

> MedShield AI is an MCP server that gives any LLM agent six clinical safety tools – drug interactions, lab trend analysis, genomic risk, allergy cross-reactivity, medication context, and a safety report – using live FHIR data via SHARP headers, with zero PHI storage.

Designed to integrate directly into Electronic Health Records (EHR) via the Prompt Opinion platform, MedShield acts as a real-time safeguard against Adverse Drug Events (ADEs).

By leveraging the **Model Context Protocol (MCP)** and **SHARP (Secure Healthcare Agent Request Protocol)** headers, the agent securely extracts patient context and orchestrates a suite of specialized clinical tools to generate comprehensive, actionable safety reports.

---

## 🚀 Architecture & Capabilities

MedShield AI operates as an **MCP Server** that exposes 6 highly specialized clinical evaluation tools to any compatible LLM agent. 

### The 6 Core Clinical Tools
1. 📋 **`get_patient_medication_context`**: Extracts live FHIR patient data (Conditions, Active Medications) via SHARP headers.
2. 💊 **`check_drug_interactions`**: Queries OpenFDA FAERS (FDA Adverse Event Reporting System) and a curated clinical database to detect high-severity drug-drug interactions (e.g., CYP450 inhibition).
3. 🔬 **`analyze_lab_trends`**: Evaluates recent FHIR `Observation` data (e.g., eGFR, AST/ALT, INR) to detect organ function deterioration that impacts drug clearance.
4. 🧬 **`assess_genomic_risk`**: Cross-references proposed drugs against **CPIC guidelines** (Clinical Pharmacogenetics Implementation Consortium) to evaluate gene-drug toxicity risks.
5. ⚠️ **`cross_reference_allergies`**: Goes beyond simple name-matching to evaluate **drug-class cross-reactivity** (e.g., Penicillin → Cephalosporins).
6. 📝 **`generate_safety_report`**: Synthesizes all findings into a structured, severity-ranked clinical recommendation for the prescribing physician.

---

## 🔒 Security & SHARP Compliance

Healthcare data security is paramount. MedShield AI strictly adheres to the SHARP specification for secure context propagation:
- **Zero-Storage Policy**: No patient health information is ever persisted – all data processed in-memory during tool execution.
- **Contextual Execution**: Tool access is strictly gated by the presence of `x-fhir-server-url` and `x-fhir-access-token` headers propagated by the parent platform.

### SHARP Header Implementation
The parent Prompt Opinion platform injects these headers using SHARP extensions. Our server never stores them – it only uses them to fetch live patient data on the fly.

```typescript
export function getFhirContext(req: Request): FhirContext | null {
  const serverUrl = req.headers['x-fhir-server-url'] as string;
  const accessToken = req.headers['x-fhir-access-token'] as string;
  const patientId = req.headers['x-patient-id'] as string;

  return { url: serverUrl, token: accessToken, patientId };
}
```

---

## 💻 Tech Stack

- **Framework**: Node.js, Express, TypeScript
- **Protocol**: Model Context Protocol (MCP) SDK (`@modelcontextprotocol/sdk`)
- **Transport**: Server-Sent Events (SSE) / `StreamableHTTPServerTransport`
- **Integrations**: OpenFDA API, RxNorm API, SMART on FHIR

---

## 🛠️ Local Development

### Prerequisites
- Node.js v18+
- npm or pnpm

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/medshield-ai.git
cd medshield-ai

# Install dependencies
npm install

# Run the MCP server
npm run dev
```

The server will start on `http://localhost:3001`. It will expose the `/mcp` endpoint for tool discovery and execution.

---

## 🏆 Hackathon Demo Scenario
In our submitted demonstration, MedShield AI intercepts a dangerous prescription scenario:
- **Patient Profile**: Edward Balistreri (Mock Data Fallback)
- **Current Meds**: Warfarin
- **Proposed Med**: Fluconazole
- **Agent Action**: Automatically detects the severe CYP2C9 inhibition interaction, identifies declining renal function from lab trends, and outputs a **🔴 CRITICAL — ACTION REQUIRED** alert advising immediate dose reduction and INR monitoring.

---
*Built with ❤️ for the Agents Assemble Hackathon.*
