import { z } from "zod";
import { getFhirContext, getPatientIdIfContextExists, fhirSearch, fhirGet } from "../fhir-utilities";
import { createTextResponse, createJsonResponse } from "../mcp-utilities";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";

/**
 * Tool 1: get_patient_medication_context
 * 
 * Builds a comprehensive medication context for a patient by pulling:
 * - Current medications (MedicationRequest / MedicationStatement)
 * - Active conditions/diagnoses (Condition)
 * - Known allergies (AllergyIntolerance)
 * - Patient demographics (Patient)
 * 
 * This is the foundational tool — all other tools depend on this context.
 */
export const getPatientMedicationContextToolInitializer = (
  server: McpServer,
  req: Request
) => {
  server.tool(
    "get_patient_medication_context",
    "Retrieves a comprehensive medication context for a patient from the FHIR server. " +
      "Returns current medications, active conditions, allergies, and demographics. " +
      "This should be the FIRST tool called before any safety analysis. " +
      "If patient context exists in SHARP headers, no parameters are needed.",
    {
      patientId: z
        .string()
        .optional()
        .describe(
          "The patient's FHIR ID. If not provided, will use the patient ID from SHARP context headers."
        ),
    },
    async ({ patientId }) => {
      const fhirContext = getFhirContext(req);
      if (!fhirContext) {
        return createTextResponse(
          "A FHIR server URL or token was not provided in the SHARP context headers.",
          { isError: true }
        );
      }

      const pid = patientId || fhirContext.patientId;
      if (!pid) {
        return createTextResponse(
          "No patient ID found. Provide a patientId parameter or ensure SHARP headers include patient context.",
          { isError: true }
        );
      }

      try {
        // Fetch all data in parallel for speed
        const [patient, medications, conditions, allergies] = await Promise.all([
          fhirGet(fhirContext, `Patient/${pid}`).catch(() => null),
          fhirSearch(fhirContext, "MedicationRequest", {
            patient: pid,
            status: "active",
            _count: "100",
          }).catch(() => []),
          fhirSearch(fhirContext, "Condition", {
            patient: pid,
            "clinical-status": "active",
            _count: "100",
          }).catch(() => []),
          fhirSearch(fhirContext, "AllergyIntolerance", {
            patient: pid,
            "clinical-status": "active",
            _count: "100",
          }).catch(() => []),
        ]);

        // Extract relevant medication names and codes
        const medicationList = medications.map((med: any) => ({
          id: med.id,
          status: med.status,
          intent: med.intent,
          medication: med.medicationCodeableConcept?.coding?.[0] || med.medicationReference || null,
          medicationDisplay:
            med.medicationCodeableConcept?.coding?.[0]?.display ||
            med.medicationCodeableConcept?.text ||
            "Unknown medication",
          rxNormCode:
            med.medicationCodeableConcept?.coding?.find(
              (c: any) => c.system === "http://www.nlm.nih.gov/research/umls/rxnorm"
            )?.code || null,
          dosageInstruction: med.dosageInstruction?.[0]?.text || null,
          authoredOn: med.authoredOn || null,
        }));

        // Extract conditions
        const conditionList = conditions.map((cond: any) => ({
          id: cond.id,
          display:
            cond.code?.coding?.[0]?.display || cond.code?.text || "Unknown condition",
          code: cond.code?.coding?.[0]?.code || null,
          system: cond.code?.coding?.[0]?.system || null,
          onsetDateTime: cond.onsetDateTime || null,
        }));

        // Extract allergies
        const allergyList = allergies.map((allergy: any) => ({
          id: allergy.id,
          substance:
            allergy.code?.coding?.[0]?.display ||
            allergy.code?.text ||
            "Unknown allergen",
          code: allergy.code?.coding?.[0]?.code || null,
          type: allergy.type || null,
          category: allergy.category || null,
          criticality: allergy.criticality || null,
          reactions: allergy.reaction?.map((r: any) => ({
            substance: r.substance?.coding?.[0]?.display || null,
            manifestation: r.manifestation?.map(
              (m: any) => m.coding?.[0]?.display || m.text
            ),
            severity: r.severity || null,
          })) || [],
        }));

        // Patient demographics
        const patientInfo = patient
          ? {
              id: patient.id,
              name: patient.name?.[0]
                ? `${patient.name[0].given?.join(" ")} ${patient.name[0].family}`
                : "Unknown",
              birthDate: patient.birthDate || null,
              gender: patient.gender || null,
            }
          : null;

        const context = {
          patient: patientInfo,
          medications: medicationList,
          medicationCount: medicationList.length,
          conditions: conditionList,
          conditionCount: conditionList.length,
          allergies: allergyList,
          allergyCount: allergyList.length,
          timestamp: new Date().toISOString(),
        };

        return createJsonResponse(context);
      } catch (error: any) {
        return createTextResponse(
          `Error building patient medication context: ${error.message || "Unknown error"}`,
          { isError: true }
        );
      }
    }
  );
};
