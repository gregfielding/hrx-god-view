/**
 * E-Verify SOAP layer types (server-side).
 * Element names in ICA templates must match your signed Interface Control Agreement.
 */

import { z } from 'zod';

/** HRX-friendly citizenship labels → ICA citizenship_status_code (override map in everifyCases if needed). */
export const EverifyCitizenshipStatus = z.enum([
  'US_CITIZEN',
  'NONCITIZEN_NATIONAL',
  'LAWFUL_PERMANENT_RESIDENT',
  'ALIEN_AUTHORIZED_TO_WORK',
  'OTHER',
]);
export type EverifyCitizenshipStatus = z.infer<typeof EverifyCitizenshipStatus>;

export const EverifySoapEmployeeDataSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  /** Nine digits, no separators */
  ssn: z.string().regex(/^\d{9}$/),
  /** ISO date YYYY-MM-DD */
  dateOfBirth: z.string().min(8),
  citizenshipStatus: z.union([EverifyCitizenshipStatus, z.string()]),
});

export type EverifySoapEmployeeData = z.infer<typeof EverifySoapEmployeeDataSchema>;

/** Default ICA-style codes — confirm against your ICA. */
export const DEFAULT_CITIZENSHIP_ICA_CODE: Record<string, string> = {
  US_CITIZEN: '1',
  NONCITIZEN_NATIONAL: '2',
  LAWFUL_PERMANENT_RESIDENT: '3',
  ALIEN_AUTHORIZED_TO_WORK: '4',
  OTHER: '5',
};

export interface EverifySoapCredentials {
  username: string;
  password: string;
}

export interface EverifySoapRawPair {
  requestXml: string;
  responseXml: string;
}

export interface EverifySoapSessionResult {
  sessionToken: string;
  /** Full SOAP XML (sensitive — redact before persisting) */
  requestXml: string;
  responseXml: string;
}

export interface EverifySoapCreateCaseResult {
  caseNumber: string;
  caseStatus: string;
  requestXml: string;
  responseXml: string;
}

export interface CreateEverifyCaseParams {
  tenantId: string;
  employeeData: EverifySoapEmployeeData;
  credentials: EverifySoapCredentials;
}

export interface CreateEverifyCaseResult {
  caseNumber: string;
  caseStatus: string;
  rawResponse: EverifySoapRawPair;
  /** Firestore document id under tenants/{tenantId}/everify_cases */
  firestoreCaseId: string;
}

export class EverifySoapError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'soap_fault' | 'http' | 'parse' | 'timeout' | 'unknown',
    readonly detail?: { faultCode?: string; faultString?: string; statusCode?: number; rawXml?: string }
  ) {
    super(message);
    this.name = 'EverifySoapError';
  }
}
