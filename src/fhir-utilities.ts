import { Request } from "express";
import { FhirContext } from "./fhir-context";
import {
  FhirAccessTokenHeaderName,
  FhirServerUrlHeaderName,
  PatientIdHeaderName,
} from "./sharp-constants";
import * as jose from "jose";
import axios from "axios";

/**
 * Extracts the full FHIR context (server URL, token, and patient ID) from SHARP headers.
 * Follows the SHARP on MCP specification for context propagation.
 */
export function getFhirContext(req: Request): FhirContext | null {
  const headers = req.headers;
  const url = headers[FhirServerUrlHeaderName]?.toString();

  if (!url) {
    return null;
  }

  const token = headers[FhirAccessTokenHeaderName]?.toString();
  if (!token) {
    return null;
  }

  const patientId = getPatientIdIfContextExists(req);

  return { url, token, patientId };
}

/**
 * Extracts the patient ID from the SHARP context.
 * First tries to decode from the FHIR access token JWT claims,
 * then falls back to the X-Patient-ID header.
 */
export function getPatientIdIfContextExists(req: Request): string | null {
  const fhirToken = req.headers[FhirAccessTokenHeaderName]?.toString();
  if (fhirToken) {
    try {
      const claims = jose.decodeJwt(fhirToken);
      if (claims["patient"]) {
        return claims["patient"]?.toString() || null;
      }
    } catch {
      // Token might not be a valid JWT — fall through to header check
    }
  }

  return req.headers[PatientIdHeaderName]?.toString() || null;
}

/**
 * Makes an authenticated GET request to a FHIR server.
 */
export async function fhirGet(
  fhirContext: FhirContext,
  path: string
): Promise<any> {
  const url = `${fhirContext.url}/${path}`;
  const { data } = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${fhirContext.token}`,
      Accept: "application/fhir+json",
    },
  });
  return data;
}

/**
 * Searches for FHIR resources with query parameters.
 */
export async function fhirSearch(
  fhirContext: FhirContext,
  resourceType: string,
  params: Record<string, string>
): Promise<any[]> {
  const searchParams = new URLSearchParams(params).toString();
  const url = `${fhirContext.url}/${resourceType}?${searchParams}`;
  const { data } = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${fhirContext.token}`,
      Accept: "application/fhir+json",
    },
  });

  if (data?.entry && Array.isArray(data.entry)) {
    return data.entry.map((e: any) => e.resource);
  }
  return [];
}
