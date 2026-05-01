import { z } from "zod";
import { createTextResponse, createJsonResponse } from "../mcp-utilities";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";

/**
 * Tool 4: assess_genomic_risk
 * 
 * Checks pharmacogenomic variants that affect drug metabolism.
 * Uses CPIC (Clinical Pharmacogenetics Implementation Consortium) guidelines
 * to assess whether a patient's genetic profile puts them at risk for
 * adverse drug events with specific medications.
 */

// CPIC Guideline database — most clinically actionable gene-drug pairs
const CPIC_GUIDELINES: Record<string, {
  gene: string; enzyme: string;
  variants: { variant: string; phenotype: string; impact: string; recommendation: string }[];
}> = {
  warfarin: {
    gene: "CYP2C9", enzyme: "Cytochrome P450 2C9",
    variants: [
      { variant: "*1/*2", phenotype: "Intermediate Metabolizer", impact: "Reduced warfarin clearance — 20% dose reduction needed", recommendation: "Reduce initial dose by 20%. Monitor INR closely during titration." },
      { variant: "*1/*3", phenotype: "Intermediate Metabolizer", impact: "Significantly reduced warfarin clearance — 30-40% dose reduction", recommendation: "Reduce initial dose by 30-40%. High bleeding risk at standard doses. CPIC Level A evidence." },
      { variant: "*2/*2", phenotype: "Poor Metabolizer", impact: "Severely impaired warfarin metabolism — 50%+ dose reduction", recommendation: "Reduce dose by 50% or more. Consider alternative anticoagulant (e.g., apixaban). Mandatory frequent INR monitoring." },
      { variant: "*2/*3", phenotype: "Poor Metabolizer", impact: "Severely impaired warfarin metabolism", recommendation: "Use alternative anticoagulant if possible. If warfarin required, start at ≤2mg/day with INR every 48 hours." },
      { variant: "*3/*3", phenotype: "Poor Metabolizer", impact: "Most severe CYP2C9 impairment — warfarin essentially contraindicated", recommendation: "AVOID warfarin. Use direct oral anticoagulant (DOAC) instead. CPIC Level A — strong recommendation." },
    ],
  },
  clopidogrel: {
    gene: "CYP2C19", enzyme: "Cytochrome P450 2C19",
    variants: [
      { variant: "*1/*2", phenotype: "Intermediate Metabolizer", impact: "Reduced conversion to active metabolite — decreased antiplatelet effect", recommendation: "Consider alternative antiplatelet (prasugrel or ticagrelor). If clopidogrel used, higher dose may be needed." },
      { variant: "*2/*2", phenotype: "Poor Metabolizer", impact: "Minimal conversion to active metabolite — clopidogrel essentially ineffective", recommendation: "AVOID clopidogrel. Use prasugrel or ticagrelor. CPIC Level A — strong recommendation. FDA boxed warning exists." },
      { variant: "*17/*17", phenotype: "Ultrarapid Metabolizer", impact: "Enhanced activation — increased bleeding risk at standard doses", recommendation: "Monitor for signs of bleeding. Standard dose may be adequate or excessive." },
    ],
  },
  codeine: {
    gene: "CYP2D6", enzyme: "Cytochrome P450 2D6",
    variants: [
      { variant: "Poor Metabolizer", phenotype: "Poor Metabolizer", impact: "Cannot convert codeine to morphine — no analgesic effect", recommendation: "AVOID codeine. Use non-codeine analgesic (e.g., acetaminophen, NSAIDs, or non-CYP2D6 opioid). CPIC Level A." },
      { variant: "Ultrarapid Metabolizer", phenotype: "Ultrarapid Metabolizer", impact: "Rapid conversion to morphine — risk of respiratory depression and death", recommendation: "AVOID codeine. FDA boxed warning — deaths reported, especially in children. Use non-codeine analgesic." },
    ],
  },
  simvastatin: {
    gene: "SLCO1B1", enzyme: "Organic Anion Transporter 1B1",
    variants: [
      { variant: "*5/*5 (TT)", phenotype: "Poor Function", impact: "Markedly increased simvastatin exposure — high myopathy/rhabdomyolysis risk", recommendation: "AVOID simvastatin >20mg. Consider alternative statin (rosuvastatin, pravastatin). CPIC Level A." },
      { variant: "*1/*5 (CT)", phenotype: "Decreased Function", impact: "Moderately increased simvastatin exposure", recommendation: "Avoid simvastatin >40mg. Monitor for muscle symptoms. Consider lower dose or alternative statin." },
    ],
  },
  fluorouracil: {
    gene: "DPYD", enzyme: "Dihydropyrimidine Dehydrogenase",
    variants: [
      { variant: "Intermediate Metabolizer", phenotype: "Intermediate Metabolizer", impact: "Reduced 5-FU clearance — increased toxicity risk", recommendation: "Reduce starting dose by 50%. Monitor closely for severe toxicity (mucositis, neutropenia)." },
      { variant: "Poor Metabolizer", phenotype: "Poor Metabolizer", impact: "Severely impaired 5-FU clearance — potentially fatal toxicity", recommendation: "AVOID fluoropyrimidines (5-FU, capecitabine). Use alternative chemotherapy regimen. CPIC Level A." },
    ],
  },
};

export const assessGenomicRiskToolInitializer = (server: McpServer, req: Request) => {
  server.tool(
    "assess_genomic_risk",
    "Assesses pharmacogenomic risk for a specific medication based on known genetic variants. " +
      "Uses CPIC (Clinical Pharmacogenetics Implementation Consortium) guidelines to identify " +
      "patients who may be at risk for adverse drug events due to genetic metabolism differences. " +
      "If specific variant data is not available, returns the full risk profile for the drug.",
    {
      medication: z.string().describe("The medication name to assess genomic risk for"),
      knownVariants: z.array(z.object({
        gene: z.string().describe("Gene name (e.g., CYP2C9, CYP2D6)"),
        variant: z.string().describe("Variant designation (e.g., *1/*3, Poor Metabolizer)"),
      })).optional().describe("Known patient genetic variants, if available from FHIR or external source"),
    },
    async ({ medication, knownVariants }) => {
      const medLower = medication.toLowerCase().trim();
      const guideline = CPIC_GUIDELINES[medLower];

      if (!guideline) {
        return createJsonResponse({
          medication, hasGuideline: false,
          message: `No CPIC pharmacogenomic guideline found for ${medication}. This does not mean the drug is safe — it means pharmacogenomic testing may not be clinically actionable for this specific drug.`,
          availableDrugs: Object.keys(CPIC_GUIDELINES),
        });
      }

      let matchedVariants: any[] = [];
      if (knownVariants && knownVariants.length > 0) {
        for (const kv of knownVariants) {
          if (kv.gene.toUpperCase() === guideline.gene.toUpperCase()) {
            const match = guideline.variants.find(v =>
              v.variant.includes(kv.variant) || kv.variant.includes(v.variant) ||
              v.phenotype.toLowerCase().includes(kv.variant.toLowerCase())
            );
            if (match) matchedVariants.push({ ...match, patientVariant: kv.variant });
          }
        }
      }

      return createJsonResponse({
        medication, gene: guideline.gene, enzyme: guideline.enzyme,
        hasGuideline: true,
        patientVariantsProvided: (knownVariants && knownVariants.length > 0) || false,
        matchedRisks: matchedVariants,
        allKnownRisks: guideline.variants,
        riskLevel: matchedVariants.length > 0
          ? (matchedVariants.some(v => v.phenotype.includes("Poor")) ? "CRITICAL" : "ELEVATED")
          : "UNKNOWN — genetic testing recommended",
        recommendation: matchedVariants.length > 0
          ? matchedVariants.map(v => v.recommendation).join(" | ")
          : `Pharmacogenomic testing for ${guideline.gene} is recommended before prescribing ${medication}. CPIC guidelines exist for this gene-drug pair.`,
        timestamp: new Date().toISOString(),
      });
    }
  );
};
