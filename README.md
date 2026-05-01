# MedShield AI 🛡️

**Adverse Drug Event Prevention Agent — Built for the Agents Assemble Hackathon**

MedShield AI is a SHARP-compliant MCP server that prevents adverse drug events (ADEs) by cross-referencing a patient's medications, lab values, genetic profile, and allergies in real-time before a new prescription is dispensed.

> 🔴 **100,000+ Americans die each year from ADEs. 50%+ are preventable.**
> MedShield AI is the safety net that catches what EHR alerts miss.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│              PROMPT OPINION PLATFORM                     │
│                                                         │
│  Clinician types: "Prescribe Warfarin 5mg for patient"  │
│           ↓                                              │
│  ┌──────────────────┐    ┌─────────────────────────┐    │
│  │ MedShield Agent  │◄──►│ Orchestrator (A2A)      │    │
│  │ (A2A on Platform)│    │ Calls 6 MCP tools       │    │
│  └────────┬─────────┘    └─────────────────────────┘    │
│           │                                              │
│  ┌────────▼──────────────────────────────────────────┐  │
│  │        MedShield MCP Server (SHARP-Compliant)      │  │
│  │                                                    │  │
│  │  Tool 1: get_patient_medication_context (FHIR)    │  │
│  │  Tool 2: check_drug_interactions (OpenFDA + DB)   │  │
│  │  Tool 3: analyze_lab_trends (FHIR Observations)   │  │
│  │  Tool 4: assess_genomic_risk (CPIC Guidelines)    │  │
│  │  Tool 5: cross_reference_allergies (RxNorm + DB)  │  │
│  │  Tool 6: generate_safety_report (AI Synthesis)    │  │
│  └────────────────────────────────────────────────────┘  │
│                                                         │
│  SHARP Headers: x-fhir-server-url, x-fhir-access-token │
│                 x-patient-id                             │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
npm install

# Start the MCP server
npm run dev

# Run tests (in a separate terminal)
npm test
```

## MCP Tools

| # | Tool | Description |
|---|------|-------------|
| 1 | `get_patient_medication_context` | Fetches patient's medications, conditions, allergies from FHIR |
| 2 | `check_drug_interactions` | Checks drug-drug interactions via OpenFDA + curated clinical DB |
| 3 | `analyze_lab_trends` | Detects deteriorating kidney/liver function affecting drug metabolism |
| 4 | `assess_genomic_risk` | Checks pharmacogenomic variants against CPIC guidelines |
| 5 | `cross_reference_allergies` | Cross-references drug class allergies (e.g., penicillin → cephalosporin) |
| 6 | `generate_safety_report` | Synthesizes all findings into a human-readable safety report |

## SHARP Compliance

This MCP server follows the [SHARP on MCP](https://sharponmcp.com) specification:

- Reads patient context from standard HTTP headers
- Works with any FHIR R4 server
- Decoupled from specific EHR implementations
- Auditable: every tool call produces traceable output

## API Endpoints

- `POST /mcp` — MCP protocol endpoint (Streamable HTTP)
- `GET /health` — Health check + tool listing

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **FHIR:** Standard R4 via SHARP headers
- **Drug Data:** OpenFDA API, NIH RxNorm API
- **Genomics:** CPIC Clinical Guidelines
- **Transport:** Express + Streamable HTTP

## License

MIT — Built for the Agents Assemble: Healthcare AI Endgame hackathon.
