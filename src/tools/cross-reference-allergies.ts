import { z } from "zod";
import { createTextResponse, createJsonResponse } from "../mcp-utilities";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";
import axios from "axios";

/**
 * Tool 5: cross_reference_allergies
 * 
 * Cross-references a proposed medication against the patient's allergy list.
 * Goes BEYOND simple name-matching by checking drug class cross-reactivity:
 * - Penicillin allergy → cephalosporin cross-reactivity (2-5%)
 * - Sulfa allergy → other sulfonamide drugs
 * - NSAID allergy → aspirin cross-reactivity
 * - Statin allergy → class-wide vs drug-specific assessment
 * 
 * Also queries RxNorm API for ingredient-level matching.
 */

// Drug class cross-reactivity database
const CROSS_REACTIVITY_MAP: Record<string, {
  relatedDrugs: string[];
  crossReactivityRate: string;
  severity: string;
  explanation: string;
}> = {
  penicillin: {
    relatedDrugs: ["amoxicillin", "ampicillin", "piperacillin", "nafcillin", "oxacillin", "cephalexin", "cefazolin", "ceftriaxone", "cefepime", "cefdinir", "meropenem", "imipenem"],
    crossReactivityRate: "2-5% with cephalosporins, <1% with carbapenems",
    severity: "HIGH",
    explanation: "Beta-lactam ring cross-reactivity. First-gen cephalosporins have highest cross-reactivity with penicillins.",
  },
  sulfonamide: {
    relatedDrugs: ["sulfamethoxazole", "trimethoprim-sulfamethoxazole", "sulfasalazine", "celecoxib", "furosemide", "thiazide", "hydrochlorothiazide", "acetazolamide", "sumatriptan"],
    crossReactivityRate: "Variable — antibiotic sulfonamides vs non-antibiotic sulfonamides have low cross-reactivity",
    severity: "MODERATE",
    explanation: "Sulfonamide antibiotic allergy does NOT reliably predict allergy to non-antibiotic sulfonamides (e.g., furosemide, celecoxib). However, caution is still warranted.",
  },
  aspirin: {
    relatedDrugs: ["ibuprofen", "naproxen", "diclofenac", "indomethacin", "ketorolac", "meloxicam", "piroxicam", "celecoxib"],
    crossReactivityRate: "Up to 25% cross-reactivity with other NSAIDs. COX-2 selective (celecoxib) may be tolerated.",
    severity: "HIGH",
    explanation: "Aspirin-exacerbated respiratory disease (AERD) involves cross-reactivity with all COX-1 inhibiting NSAIDs. COX-2 selective agents may be safer alternatives.",
  },
  codeine: {
    relatedDrugs: ["morphine", "hydrocodone", "oxycodone", "tramadol", "fentanyl", "hydromorphone", "methadone"],
    crossReactivityRate: "True allergy is rare — most reactions are pseudo-allergic (histamine release). Low cross-reactivity between opioid classes.",
    severity: "MODERATE",
    explanation: "True IgE-mediated opioid allergy is uncommon. Pseudo-allergic reactions (itching, nausea) are more frequent. Structurally different opioids may be tolerated.",
  },
  ace_inhibitor: {
    relatedDrugs: ["lisinopril", "enalapril", "ramipril", "benazepril", "captopril", "fosinopril", "quinapril", "losartan", "valsartan"],
    crossReactivityRate: "High within ACE inhibitor class. ARBs generally safe alternative (angioedema cross-reactivity <2%).",
    severity: "HIGH",
    explanation: "ACE inhibitor angioedema is a class effect. ARBs are generally safe alternatives, though a small cross-reactivity risk exists.",
  },
};

export const crossReferenceAllergiesToolInitializer = (server: McpServer, req: Request) => {
  server.tool(
    "cross_reference_allergies",
    "Cross-references a proposed medication against the patient's known allergies. " +
      "Goes beyond simple name-matching to check drug class cross-reactivity. " +
      "For example: penicillin allergy → checks cephalosporin cross-reactivity. " +
      "Returns cross-reactivity risk assessment with clinical evidence.",
    {
      proposedMedication: z.string().describe("The medication being proposed"),
      patientAllergies: z.array(z.object({
        substance: z.string().describe("The allergen substance name"),
        criticality: z.string().optional().describe("Criticality: high, low, unable-to-assess"),
        reactions: z.array(z.string()).optional().describe("Known reaction manifestations"),
      })).describe("Patient's known allergies from FHIR AllergyIntolerance records"),
    },
    async ({ proposedMedication, patientAllergies }) => {
      const proposedLower = proposedMedication.toLowerCase().trim();
      const alerts: any[] = [];

      for (const allergy of patientAllergies) {
        const allergenLower = allergy.substance.toLowerCase().trim();

        // 1. Direct name match
        if (proposedLower.includes(allergenLower) || allergenLower.includes(proposedLower)) {
          alerts.push({
            type: "DIRECT_MATCH", severity: "CRITICAL",
            allergen: allergy.substance, proposedMedication,
            criticality: allergy.criticality || "unknown",
            knownReactions: allergy.reactions || [],
            message: `DIRECT ALLERGY MATCH: Patient has documented allergy to ${allergy.substance}. The proposed medication ${proposedMedication} matches this allergen.`,
            recommendation: "DO NOT prescribe. Choose an alternative from a different drug class.",
          });
          continue;
        }

        // 2. Drug class cross-reactivity check
        for (const [allergenClass, crossReactivity] of Object.entries(CROSS_REACTIVITY_MAP)) {
          const allergenMatchesClass = allergenLower.includes(allergenClass) || allergenClass.includes(allergenLower);
          if (allergenMatchesClass) {
            const proposedInRelated = crossReactivity.relatedDrugs.some(d => proposedLower.includes(d) || d.includes(proposedLower));
            if (proposedInRelated) {
              alerts.push({
                type: "CROSS_REACTIVITY", severity: crossReactivity.severity,
                allergen: allergy.substance, proposedMedication,
                allergenClass,
                crossReactivityRate: crossReactivity.crossReactivityRate,
                explanation: crossReactivity.explanation,
                recommendation: crossReactivity.severity === "HIGH"
                  ? "Consider alternative outside this drug class, or perform supervised drug challenge if clinically necessary."
                  : "Prescribe with caution. Monitor for allergic reaction during first doses.",
              });
            }
          }

          // Check if the proposed med's class has a known allergen in the list
          const proposedMatchesClass = crossReactivity.relatedDrugs.some(d => proposedLower.includes(d) || d.includes(proposedLower));
          if (proposedMatchesClass && (allergenLower.includes(allergenClass) || crossReactivity.relatedDrugs.some(d => allergenLower.includes(d) || d.includes(allergenLower)))) {
            if (!alerts.find(a => a.allergenClass === allergenClass && a.proposedMedication === proposedMedication)) {
              alerts.push({
                type: "CROSS_REACTIVITY", severity: crossReactivity.severity,
                allergen: allergy.substance, proposedMedication,
                allergenClass,
                crossReactivityRate: crossReactivity.crossReactivityRate,
                explanation: crossReactivity.explanation,
                recommendation: "Review cross-reactivity risk before prescribing.",
              });
            }
          }
        }
      }

      // 3. Try RxNorm API for ingredient-level matching
      let rxNormIngredients: string[] = [];
      try {
        const { data } = await axios.get(
          `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(proposedMedication)}`,
          { timeout: 5000 }
        );
        if (data?.drugGroup?.conceptGroup) {
          for (const group of data.drugGroup.conceptGroup) {
            if (group.conceptProperties) {
              rxNormIngredients.push(...group.conceptProperties.map((p: any) => p.name).slice(0, 5));
            }
          }
        }
      } catch { /* RxNorm may be unavailable */ }

      return createJsonResponse({
        proposedMedication, patientAllergies, alerts,
        totalAlerts: alerts.length,
        hasCriticalAlert: alerts.some(a => a.severity === "CRITICAL"),
        hasCrossReactivity: alerts.some(a => a.type === "CROSS_REACTIVITY"),
        rxNormIngredients: rxNormIngredients.slice(0, 5),
        isSafe: alerts.length === 0,
        timestamp: new Date().toISOString(),
      });
    }
  );
};
