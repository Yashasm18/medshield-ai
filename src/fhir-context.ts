// FHIR context type — carries the server URL and access token from SHARP headers
export type FhirContext = {
  url: string;
  token: string;
  patientId: string | null;
};
