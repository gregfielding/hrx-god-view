/**
 * E-Verify SOAP: create case + persist audit trail to Firestore.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { authenticateSoapSession, createCaseSoap } from './everifyClient';
import { getEverifyEnv } from './everifyConfig';
import type { CreateEverifyCaseParams, CreateEverifyCaseResult, EverifySoapRawPair } from './everifyTypes';
import { EverifySoapError } from './everifyTypes';

if (!admin.apps.length) {
  admin.initializeApp();
}

/** Redact credentials and SSN for Firestore, callable return, and Cloud Logging. */
export function redactSoapXmlForStorage(xml: string): string {
  let out = xml;
  out = out.replace(/<(?:[\w]+:)?Password[^>]*>[\s\S]*?<\/(?:[\w]+:)?Password>/gi, '<Password>***</Password>');
  out = out.replace(/<(?:[\w]+:)?SSN[^>]*>[\s\S]*?<\/(?:[\w]+:)?SSN>/gi, '<SSN>***</SSN>');
  out = out.replace(/\b(\d{3})(\d{2})(\d{4})\b/g, '***-**-$3');
  return out;
}

/**
 * Authenticate (SOAP), submit employment case (SOAP), write tenants/{tenantId}/everify_cases/{caseId}.
 */
export async function createEverifyCase(params: CreateEverifyCaseParams): Promise<CreateEverifyCaseResult> {
  const { tenantId, employeeData, credentials } = params;
  const db = admin.firestore();

  let session: Awaited<ReturnType<typeof authenticateSoapSession>>;
  try {
    session = await authenticateSoapSession(credentials);
  } catch (e) {
    if (e instanceof EverifySoapError) {
      logger.error('E-Verify SOAP authenticate failed', { kind: e.kind, message: e.message });
    }
    throw e;
  }

  let created: Awaited<ReturnType<typeof createCaseSoap>>;
  try {
    created = await createCaseSoap(session.sessionToken, employeeData);
  } catch (e) {
    if (e instanceof EverifySoapError) {
      logger.error('E-Verify SOAP createCase failed', { kind: e.kind, message: e.message });
    }
    throw e;
  }

  const rawPair: EverifySoapRawPair = {
    requestXml: [session.requestXml, created.requestXml].join('\n<!-- --- -->\n'),
    responseXml: [session.responseXml, created.responseXml].join('\n<!-- --- -->\n'),
  };

  const reqStored = redactSoapXmlForStorage(rawPair.requestXml);
  const resStored = redactSoapXmlForStorage(rawPair.responseXml);

  const caseRef = db.collection('tenants').doc(tenantId).collection('everify_cases').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const env = getEverifyEnv();

  await caseRef.set({
    tenantId,
    environment: env,
    transport: 'soap',
    everifyCaseNumber: created.caseNumber,
    providerStatus: created.caseStatus,
    soapRequestXml: reqStored,
    soapResponseXml: resStored,
    status: 'submitted',
    createdAt: now,
    updatedAt: now,
  });

  logger.info('E-Verify SOAP case persisted', {
    tenantId,
    firestoreCaseId: caseRef.id,
    everifyCaseNumber: created.caseNumber,
  });
  /** Redacted SOAP XML for Cloud Logging audit (matches Firestore fields; no raw SSN/password). */
  logger.info('E-Verify SOAP XML exchange (redacted)', {
    tenantId,
    firestoreCaseId: caseRef.id,
    requestXmlRedacted: reqStored,
    responseXmlRedacted: resStored,
    requestChars: reqStored.length,
    responseChars: resStored.length,
  });

  return {
    caseNumber: created.caseNumber,
    caseStatus: created.caseStatus,
    rawResponse: {
      requestXml: reqStored,
      responseXml: resStored,
    },
    firestoreCaseId: caseRef.id,
  };
}
