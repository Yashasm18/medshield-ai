import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request, Response } from "express";
import { getPatientMedicationContextToolInitializer } from "./get-patient-medication-context";
import { checkDrugInteractionsToolInitializer } from "./check-drug-interactions";
import { analyzeLabTrendsToolInitializer } from "./analyze-lab-trends";
import { assessGenomicRiskToolInitializer } from "./assess-genomic-risk";
import { crossReferenceAllergiesToolInitializer } from "./cross-reference-allergies";
import { generateSafetyReportToolInitializer } from "./generate-safety-report";

/**
 * MedShield AI — All 6 MCP Tools
 * 
 * Tool 1: get_patient_medication_context — Fetches patient data from FHIR
 * Tool 2: check_drug_interactions — Checks drug-drug interactions
 * Tool 3: analyze_lab_trends — Analyzes organ function lab trends
 * Tool 4: assess_genomic_risk — Checks pharmacogenomic risks (CPIC)
 * Tool 5: cross_reference_allergies — Cross-references allergy cross-reactivity
 * Tool 6: generate_safety_report — Synthesizes all findings into a report
 */
const initializers: ((
  server: McpServer,
  req: Request,
  res: Response
) => void)[] = [];

initializers.push(getPatientMedicationContextToolInitializer);
initializers.push(checkDrugInteractionsToolInitializer);
initializers.push(analyzeLabTrendsToolInitializer);
initializers.push(assessGenomicRiskToolInitializer);
initializers.push(crossReferenceAllergiesToolInitializer);
initializers.push(generateSafetyReportToolInitializer);

export { initializers };
