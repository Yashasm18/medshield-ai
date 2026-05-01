import { z } from "zod";
import { createTextResponse } from "../mcp-utilities";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";

/**
 * Tool 6: generate_safety_report
 * 
 * Synthesizes all findings from the other 5 tools into a unified, human-readable
 * safety report. Uses Gen AI reasoning to connect the dots across drug interactions,
 * lab trends, genomic risk, and allergy cross-reactivity.
 * 
 * This is the "brain" tool — it produces the final deliverable.
 */

export const generateSafetyReportToolInitializer = (server: McpServer, req: Request) => {
  server.tool(
    "generate_safety_report",
    "Generates a comprehensive MedShield Safety Report by synthesizing findings from drug interactions, " +
      "lab trends, genomic risk, and allergy cross-referencing. This should be the LAST tool called, " +
      "after all analysis tools have been run. It produces a human-readable safety assessment " +
      "with risk level, findings, and clinical recommendations.",
    {
      patientName: z.string().describe("Patient name for the report header"),
      patientId: z.string().describe("Patient FHIR ID"),
      newMedication: z.string().describe("The proposed new medication"),
      newMedicationDose: z.string().optional().describe("Proposed dose (e.g., '5mg daily')"),
      drugInteractionFindings: z.string().describe("JSON string of drug interaction results from check_drug_interactions"),
      labTrendFindings: z.string().optional().describe("JSON string of lab trend results from analyze_lab_trends"),
      genomicRiskFindings: z.string().optional().describe("JSON string of genomic risk results from assess_genomic_risk"),
      allergyFindings: z.string().optional().describe("JSON string of allergy cross-reference results from cross_reference_allergies"),
    },
    async ({ patientName, patientId, newMedication, newMedicationDose, drugInteractionFindings, labTrendFindings, genomicRiskFindings, allergyFindings }) => {
      try {
        // Parse all findings
        const interactions = JSON.parse(drugInteractionFindings || "{}");
        const labs = labTrendFindings ? JSON.parse(labTrendFindings) : null;
        const genomics = genomicRiskFindings ? JSON.parse(genomicRiskFindings) : null;
        const allergies = allergyFindings ? JSON.parse(allergyFindings) : null;

        // Calculate overall risk level
        const issues: { severity: string; category: string; description: string; recommendation: string }[] = [];

        // Process drug interactions
        if (interactions.interactions) {
          for (const ix of interactions.interactions) {
            if (ix.severity === "HIGH") {
              issues.push({
                severity: "HIGH", category: "DRUG-DRUG INTERACTION",
                description: `${ix.drug1} + ${ix.drug2}: ${ix.description}`,
                recommendation: ix.mechanism ? `Mechanism: ${ix.mechanism}. Consider alternative medication.` : "Review and consider alternatives.",
              });
            } else if (ix.severity === "MODERATE" || ix.severity === "REVIEW") {
              issues.push({
                severity: "MODERATE", category: "DRUG-DRUG INTERACTION",
                description: `${ix.drug1} + ${ix.drug2}: ${ix.description}`,
                recommendation: "Monitor closely. Adjust dose if needed.",
              });
            }
          }
        }

        // Process lab trends
        if (labs?.concerns) {
          for (const concern of labs.concerns) {
            issues.push({
              severity: concern.severity === "HIGH" || concern.severity === "LOW" ? "HIGH" : "MODERATE",
              category: "LAB TREND CONCERN",
              description: `${concern.name}: ${concern.latestValue} ${concern.values?.[0]?.unit || ""} (trend: ${concern.trend}, change: ${concern.changePercent || "N/A"})`,
              recommendation: concern.drugImplications || "Review lab values and adjust medications accordingly.",
            });
          }
        }

        // Process genomic risk
        if (genomics?.matchedRisks?.length > 0) {
          for (const risk of genomics.matchedRisks) {
            issues.push({
              severity: risk.phenotype?.includes("Poor") ? "HIGH" : "MODERATE",
              category: "GENOMIC RISK",
              description: `${genomics.gene} ${risk.patientVariant || risk.variant}: ${risk.phenotype} — ${risk.impact}`,
              recommendation: risk.recommendation,
            });
          }
        } else if (genomics?.hasGuideline && !genomics?.patientVariantsProvided) {
          issues.push({
            severity: "INFO", category: "GENOMIC RISK",
            description: `CPIC guideline exists for ${genomics.gene} and ${newMedication}, but no patient genetic data available.`,
            recommendation: genomics.recommendation || "Consider pharmacogenomic testing before prescribing.",
          });
        }

        // Process allergies
        if (allergies?.alerts?.length > 0) {
          for (const alert of allergies.alerts) {
            issues.push({
              severity: alert.severity === "CRITICAL" ? "CRITICAL" : alert.severity,
              category: alert.type === "DIRECT_MATCH" ? "ALLERGY — DIRECT MATCH" : "ALLERGY — CROSS-REACTIVITY",
              description: alert.message || `${alert.allergen} → ${alert.proposedMedication}: ${alert.explanation || ""}`,
              recommendation: alert.recommendation,
            });
          }
        }

        // Determine overall risk level
        let overallRisk = "🟢 LOW RISK";
        if (issues.some(i => i.severity === "CRITICAL")) overallRisk = "🔴 CRITICAL — DO NOT PRESCRIBE";
        else if (issues.filter(i => i.severity === "HIGH").length >= 2) overallRisk = "🔴 CRITICAL — MULTIPLE HIGH RISKS";
        else if (issues.some(i => i.severity === "HIGH")) overallRisk = "🟠 HIGH RISK — RECOMMEND ALTERNATIVE";
        else if (issues.some(i => i.severity === "MODERATE")) overallRisk = "🟡 MODERATE RISK — MONITOR CLOSELY";

        // Build the report
        const highIssues = issues.filter(i => i.severity === "HIGH" || i.severity === "CRITICAL");
        const modIssues = issues.filter(i => i.severity === "MODERATE");
        const infoIssues = issues.filter(i => i.severity === "INFO");

        let report = `\n╔${"═".repeat(68)}╗\n`;
        report += `║${"MEDSHIELD AI — SAFETY REPORT".padStart(48).padEnd(68)}║\n`;
        report += `╠${"═".repeat(68)}╣\n`;
        report += `║ Patient: ${patientName.padEnd(58)}║\n`;
        report += `║ Patient ID: ${patientId.padEnd(55)}║\n`;
        report += `║ New Rx: ${(newMedication + (newMedicationDose ? ` ${newMedicationDose}` : "")).padEnd(59)}║\n`;
        report += `║ Assessment: ${overallRisk.padEnd(55)}║\n`;
        report += `╠${"═".repeat(68)}╣\n`;

        if (highIssues.length > 0) {
          report += `║${"".padEnd(68)}║\n`;
          report += `║ 🔴 CRITICAL/HIGH SEVERITY FINDINGS (${highIssues.length})${"".padEnd(68 - 39 - String(highIssues.length).length)}║\n`;
          highIssues.forEach((issue, idx) => {
            report += `║${"".padEnd(68)}║\n`;
            report += `║ ${idx + 1}. [${issue.category}]${"".padEnd(Math.max(0, 68 - 5 - issue.category.length - 2))}║\n`;
            const descLines = wrapText(issue.description, 64);
            descLines.forEach(line => { report += `║    ${line.padEnd(64)}║\n`; });
            const recLines = wrapText(`→ ${issue.recommendation}`, 64);
            recLines.forEach(line => { report += `║    ${line.padEnd(64)}║\n`; });
          });
        }

        if (modIssues.length > 0) {
          report += `║${"".padEnd(68)}║\n`;
          report += `║ 🟡 MODERATE SEVERITY FINDINGS (${modIssues.length})${"".padEnd(Math.max(0, 68 - 34 - String(modIssues.length).length))}║\n`;
          modIssues.forEach((issue, idx) => {
            report += `║${"".padEnd(68)}║\n`;
            report += `║ ${idx + 1}. [${issue.category}]${"".padEnd(Math.max(0, 68 - 5 - issue.category.length - 2))}║\n`;
            const descLines = wrapText(issue.description, 64);
            descLines.forEach(line => { report += `║    ${line.padEnd(64)}║\n`; });
          });
        }

        if (infoIssues.length > 0) {
          report += `║${"".padEnd(68)}║\n`;
          report += `║ ℹ️  INFORMATIONAL${"".padEnd(50)}║\n`;
          infoIssues.forEach((issue) => {
            const lines = wrapText(issue.description, 64);
            lines.forEach(line => { report += `║    ${line.padEnd(64)}║\n`; });
          });
        }

        if (issues.length === 0) {
          report += `║${"".padEnd(68)}║\n`;
          report += `║ ✅ No safety concerns identified.${"".padEnd(35)}║\n`;
          report += `║    Standard prescribing protocols apply.${"".padEnd(28)}║\n`;
        }

        report += `║${"".padEnd(68)}║\n`;
        report += `╠${"═".repeat(68)}╣\n`;
        report += `║ Generated by MedShield AI | ${new Date().toISOString().padEnd(39)}║\n`;
        report += `║ This is a clinical decision SUPPORT tool. Always verify.${"".padEnd(11)}║\n`;
        report += `╚${"═".repeat(68)}╝\n`;

        return createTextResponse(report);
      } catch (error: any) {
        return createTextResponse(`Error generating safety report: ${error.message}`, { isError: true });
      }
    }
  );
};

function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    if ((currentLine + " " + word).trim().length > maxWidth) {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? currentLine + " " + word : word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}
