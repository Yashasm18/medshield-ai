import { z } from "zod";
import { createTextResponse, createJsonResponse } from "../mcp-utilities";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";
import axios from "axios";

// Curated high-severity interaction pairs
const CRITICAL_INTERACTIONS: Record<string, { interactsWith: string; severity: string; description: string; mechanism: string }[]> = {
  warfarin: [
    { interactsWith: "fluconazole", severity: "HIGH", description: "CYP2C9 inhibition increases warfarin levels 2-3x, major bleeding risk", mechanism: "CYP2C9 Inhibition" },
    { interactsWith: "aspirin", severity: "HIGH", description: "Dual anticoagulant/antiplatelet increases bleeding risk", mechanism: "Additive Anticoagulation" },
    { interactsWith: "ibuprofen", severity: "HIGH", description: "NSAIDs increase bleeding risk and displace warfarin from protein binding", mechanism: "Protein Binding Displacement" },
    { interactsWith: "amiodarone", severity: "HIGH", description: "CYP2C9/CYP3A4 inhibition significantly increases warfarin INR", mechanism: "CYP Enzyme Inhibition" },
    { interactsWith: "metronidazole", severity: "HIGH", description: "Inhibits warfarin metabolism, increasing bleeding risk", mechanism: "CYP2C9 Inhibition" },
  ],
  metformin: [
    { interactsWith: "contrast dye", severity: "HIGH", description: "Risk of lactic acidosis with iodinated contrast", mechanism: "Renal Impairment" },
  ],
  lisinopril: [
    { interactsWith: "spironolactone", severity: "HIGH", description: "Hyperkalemia risk from dual RAAS blockade", mechanism: "Potassium Retention" },
    { interactsWith: "potassium", severity: "HIGH", description: "Hyperkalemia risk — ACE inhibitors reduce K+ excretion", mechanism: "Potassium Retention" },
  ],
  simvastatin: [
    { interactsWith: "clarithromycin", severity: "HIGH", description: "CYP3A4 inhibition causes rhabdomyolysis risk", mechanism: "CYP3A4 Inhibition" },
  ],
  fluoxetine: [
    { interactsWith: "tramadol", severity: "HIGH", description: "Serotonin syndrome risk", mechanism: "Serotonin Excess" },
    { interactsWith: "linezolid", severity: "HIGH", description: "MAO inhibition causes serotonin syndrome with SSRIs", mechanism: "MAO Inhibition" },
  ],
  digoxin: [
    { interactsWith: "amiodarone", severity: "HIGH", description: "Increases digoxin levels by 70-100%, causing toxicity", mechanism: "P-glycoprotein Inhibition" },
    { interactsWith: "verapamil", severity: "HIGH", description: "Increased digoxin + additive AV nodal depression", mechanism: "P-gp Inhibition + AV Block" },
  ],
  methotrexate: [
    { interactsWith: "trimethoprim", severity: "HIGH", description: "Both are folate antagonists — pancytopenia risk", mechanism: "Additive Folate Antagonism" },
    { interactsWith: "ibuprofen", severity: "HIGH", description: "NSAIDs reduce methotrexate clearance, causing toxicity", mechanism: "Renal Clearance Reduction" },
  ],
};

export const checkDrugInteractionsToolInitializer = (server: McpServer, req: Request) => {
  server.tool(
    "check_drug_interactions",
    "Checks for drug-drug interactions across a patient's medication list plus a new proposed medication. " +
      "Uses OpenFDA Adverse Events and a curated clinical database. Returns severity-ranked interactions.",
    {
      currentMedications: z.array(z.string()).describe("Current medication names"),
      newMedication: z.string().describe("The NEW medication being proposed"),
    },
    async ({ currentMedications, newMedication }) => {
      try {
        const interactions: any[] = [];
        const newMedLower = newMedication.toLowerCase().trim();

        // Check curated database
        for (const currentMed of currentMedications) {
          const currentMedLower = currentMed.toLowerCase().trim();
          for (const [drug, ixns] of Object.entries(CRITICAL_INTERACTIONS)) {
            if (newMedLower.includes(drug) || drug.includes(newMedLower)) {
              const found = ixns.find(i => currentMedLower.includes(i.interactsWith) || i.interactsWith.includes(currentMedLower));
              if (found) interactions.push({ drug1: newMedication, drug2: currentMed, ...found, source: "MedShield Clinical DB" });
            }
            if (currentMedLower.includes(drug) || drug.includes(currentMedLower)) {
              const found = ixns.find(i => newMedLower.includes(i.interactsWith) || i.interactsWith.includes(newMedLower));
              if (found && !interactions.find(e => e.drug1.toLowerCase() === currentMedLower && e.drug2.toLowerCase() === newMedLower))
                interactions.push({ drug1: currentMed, drug2: newMedication, ...found, source: "MedShield Clinical DB" });
            }
          }
        }

        // Query OpenFDA for adverse events
        for (const currentMed of currentMedications.slice(0, 3)) {
          try {
            const q = encodeURIComponent(`patient.drug.medicinalproduct:"${newMedication}" AND patient.drug.medicinalproduct:"${currentMed}"`);
            const { data } = await axios.get(`https://api.fda.gov/drug/event.json?search=${q}&limit=3`, { timeout: 5000 });
            if (data?.results?.length > 0) {
              const reactions = data.results.flatMap((r: any) => r.patient?.reaction || []).map((r: any) => r.reactionmeddrapt).filter(Boolean);
              const counts: Record<string, number> = {};
              reactions.forEach((r: string) => { counts[r] = (counts[r] || 0) + 1; });
              const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
              if (top.length > 0) {
                interactions.push({
                  drug1: newMedication, drug2: currentMed, severity: "REVIEW",
                  description: `FDA adverse event reports found. Top reactions: ${top.map(r => r[0]).join(", ")}`,
                  source: "OpenFDA FAERS", totalFdaReports: data.meta?.results?.total || 0,
                });
              }
            }
          } catch { /* continue */ }
        }

        return createJsonResponse({
          newMedication, currentMedications, interactions,
          totalInteractions: interactions.length,
          highSeverityCount: interactions.filter(i => i.severity === "HIGH").length,
          timestamp: new Date().toISOString(),
        });
      } catch (error: any) {
        return createTextResponse(`Error checking drug interactions: ${error.message}`, { isError: true });
      }
    }
  );
};
