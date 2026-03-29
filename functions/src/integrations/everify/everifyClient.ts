/**
 * E-Verify SOAP transport (ICA v31 — templates MUST match your signed ICA).
 * WSDL is not public without credentials; defaults are placeholders — set
 * EVERIFY_SOAP_* env vars or envelope templates from the ICA.
 */

import { logger } from 'firebase-functions/v2';
import { XMLParser } from 'fast-xml-parser';
import {
  getEverifyBaseUrl,
  getEverifyFakeProvider,
  getEverifySoapCreateCaseSoapAction,
  getEverifySoapLoginSoapAction,
  getEverifySoapServiceNamespace,
  getEverifySoapTimeoutMs,
  getEverifySoapUrl,
  getEverifySoapVersion,
  getEverifyMaxRetries,
} from './everifyConfig';
import type {
  EverifySoapCreateCaseResult,
  EverifySoapCredentials,
  EverifySoapEmployeeData,
  EverifySoapSessionResult,
} from './everifyTypes';
import { EverifySoapError } from './everifyTypes';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
});

function findStringByKeyPattern(obj: unknown, re: RegExp, depth = 0): string | undefined {
  if (depth > 30 || obj === null || obj === undefined) return undefined;
  if (typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (re.test(k) && typeof v === 'string' && v.length > 0) return v;
      if (typeof v === 'object' && v !== null) {
        const n = findStringByKeyPattern(v, re, depth + 1);
        if (n) return n;
      }
    }
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const n = findStringByKeyPattern(item, re, depth + 1);
      if (n) return n;
    }
  }
  return undefined;
}

function parseSoapFault(xml: string): { faultCode?: string; faultString?: string } | null {
  const lower = xml.toLowerCase();
  if (!lower.includes('<fault') && !lower.includes(':fault')) return null;
  try {
    const j = xmlParser.parse(xml) as Record<string, unknown>;
    const body = (j.Envelope as Record<string, unknown> | undefined)?.Body ?? (j['soap:Envelope'] as Record<string, unknown> | undefined)?.Body;
    const fault = (body as Record<string, unknown> | undefined)?.Fault ?? (body as Record<string, unknown> | undefined)?.fault;
    if (fault && typeof fault === 'object') {
      const f = fault as Record<string, unknown>;
      return {
        faultCode: typeof f.faultcode === 'string' ? f.faultcode : typeof f.Code === 'string' ? f.Code : undefined,
        faultString: typeof f.faultstring === 'string' ? f.faultstring : typeof f.Reason === 'string' ? f.Reason : undefined,
      };
    }
  } catch {
    // regex fallback
    const m = xml.match(/<faultstring[^>]*>([^<]*)</i) || xml.match(/<Reason[^>]*>([^<]*)</i);
    if (m?.[1]) return { faultString: m[1].trim() };
  }
  return { faultString: 'SOAP Fault (unparsed)' };
}

/**
 * Optional full envelope override (set in Secret Manager / env). Placeholders: {{username}}, {{password}}, {{sessionToken}}, {{firstName}}, etc.
 */
function applyEnvelopeTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

function defaultLoginEnvelope(username: string, password: string): string {
  const ns = getEverifySoapServiceNamespace();
  const custom = process.env.EVERIFY_SOAP_LOGIN_ENVELOPE_TEMPLATE;
  if (custom?.trim()) {
    return applyEnvelopeTemplate(custom, {
      username: escapeXml(username),
      password: escapeXml(password),
      ns: escapeXml(ns),
    });
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ev="${escapeXml(ns)}">
  <soapenv:Header/>
  <soapenv:Body>
    <ev:AuthenticateRequest>
      <ev:Username>${escapeXml(username)}</ev:Username>
      <ev:Password>${escapeXml(password)}</ev:Password>
    </ev:AuthenticateRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function mapCitizenshipToIcaCode(status: string): string {
  const map: Record<string, string> = {
    US_CITIZEN: '1',
    NONCITIZEN_NATIONAL: '2',
    LAWFUL_PERMANENT_RESIDENT: '3',
    ALIEN_AUTHORIZED_TO_WORK: '4',
    OTHER: '5',
  };
  return map[status] ?? status;
}

function defaultCreateCaseEnvelope(sessionToken: string, emp: EverifySoapEmployeeData): string {
  const ns = getEverifySoapServiceNamespace();
  const custom = process.env.EVERIFY_SOAP_CREATE_CASE_ENVELOPE_TEMPLATE;
  if (custom?.trim()) {
    return applyEnvelopeTemplate(custom, {
      sessionToken: escapeXml(sessionToken),
      firstName: escapeXml(emp.firstName),
      lastName: escapeXml(emp.lastName),
      ssn: escapeXml(emp.ssn),
      dateOfBirth: escapeXml(emp.dateOfBirth),
      citizenshipStatusCode: escapeXml(mapCitizenshipToIcaCode(String(emp.citizenshipStatus))),
      ns: escapeXml(ns),
    });
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ev="${escapeXml(ns)}">
  <soapenv:Header>
    <ev:SessionToken>${escapeXml(sessionToken)}</ev:SessionToken>
  </soapenv:Header>
  <soapenv:Body>
    <ev:CreateCaseRequest>
      <ev:FirstName>${escapeXml(emp.firstName)}</ev:FirstName>
      <ev:LastName>${escapeXml(emp.lastName)}</ev:LastName>
      <ev:SSN>${escapeXml(emp.ssn)}</ev:SSN>
      <ev:DateOfBirth>${escapeXml(emp.dateOfBirth)}</ev:DateOfBirth>
      <ev:CitizenshipStatusCode>${escapeXml(mapCitizenshipToIcaCode(String(emp.citizenshipStatus)))}</ev:CitizenshipStatusCode>
    </ev:CreateCaseRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function extractSessionToken(xml: string): string | undefined {
  try {
    const parsed = xmlParser.parse(xml);
    const t = findStringByKeyPattern(parsed, /session|token|sessionid|access/i);
    if (t) return t;
  } catch {
    // fall through to regex
  }
  const m = xml.match(/<(?:[\w]+:)?(SessionToken|Token|session_token|AccessToken)[^>]*>([^<]+)</i);
  return m?.[2]?.trim();
}

function extractCaseNumberAndStatus(xml: string): { caseNumber?: string; caseStatus?: string } {
  try {
    const parsed = xmlParser.parse(xml);
    const num =
      findStringByKeyPattern(parsed, /case[_]?number|casenumber|everifycasenumber|caseid/i) ||
      undefined;
    const status = findStringByKeyPattern(parsed, /case[_]?status|statuscode|casestatus/i) || undefined;
    if (num || status) return { caseNumber: num, caseStatus: status };
  } catch {
    // regex fallback
  }
  const numM = xml.match(/<(?:[\w]+:)?(CaseNumber|case_number|Case_Id)[^>]*>([^<]+)</i);
  const stM = xml.match(/<(?:[\w]+:)?(CaseStatus|case_status)[^>]*>([^<]+)</i);
  return {
    caseNumber: numM?.[2]?.trim(),
    caseStatus: stM?.[2]?.trim(),
  };
}

export interface SendSoapResult {
  statusCode: number;
  responseXml: string;
}

export async function sendSoapRequest(opts: {
  url: string;
  soapAction: string;
  xmlBody: string;
  timeoutMs?: number;
}): Promise<SendSoapResult> {
  const timeoutMs = opts.timeoutMs ?? getEverifySoapTimeoutMs();
  const maxRetries = getEverifyMaxRetries();
  const v = getEverifySoapVersion();
  const headers: Record<string, string> = {
    'Content-Type':
      v === '1.2' ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8',
  };
  if (v === '1.1') {
    headers.SOAPAction = `"${opts.soapAction}"`;
  } else {
    headers['Content-Type'] = `application/soap+xml; charset=utf-8; action="${opts.soapAction}"`;
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(opts.url, {
        method: 'POST',
        headers,
        body: opts.xmlBody,
        signal: controller.signal,
      });
      clearTimeout(id);
      const responseXml = await res.text();
      const fault = parseSoapFault(responseXml);
      if (fault?.faultString || fault?.faultCode) {
        throw new EverifySoapError(fault.faultString || 'SOAP Fault', 'soap_fault', {
          faultCode: fault.faultCode,
          faultString: fault.faultString,
          rawXml: responseXml.substring(0, 8000),
        });
      }
      if (res.status === 401 || res.status === 403) {
        throw new EverifySoapError(`E-Verify SOAP auth HTTP ${res.status}`, 'auth', {
          statusCode: res.status,
          rawXml: responseXml.substring(0, 4000),
        });
      }
      if (!res.ok && res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new EverifySoapError(`E-Verify SOAP HTTP ${res.status}`, 'http', {
          statusCode: res.status,
          rawXml: responseXml.substring(0, 4000),
        });
      }
      if (!res.ok && res.status >= 500) {
        lastErr = new EverifySoapError(`E-Verify SOAP HTTP ${res.status}`, 'http', {
          statusCode: res.status,
          rawXml: responseXml.substring(0, 2000),
        });
        await sleep(300 * attempt);
        continue;
      }
      return { statusCode: res.status, responseXml };
    } catch (e) {
      clearTimeout(id);
      if (e instanceof EverifySoapError) throw e;
      const err = e as Error & { name?: string };
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        lastErr = new EverifySoapError('E-Verify SOAP request timeout', 'timeout');
        await sleep(400 * attempt);
        continue;
      }
      lastErr = e;
      if (attempt <= maxRetries) {
        await sleep(250 * attempt);
        continue;
      }
      throw e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new EverifySoapError('E-Verify SOAP: max retries exceeded', 'unknown');
}

export async function authenticateSoapSession(
  creds: EverifySoapCredentials
): Promise<EverifySoapSessionResult> {
  if (getEverifyFakeProvider()) {
    const tok = `FAKE-SESSION-${Date.now()}`;
    const xml = `<?xml version="1.0"?><Envelope><Body><Token>${tok}</Token></Body></Envelope>`;
    return {
      sessionToken: tok,
      requestXml: defaultLoginEnvelope(creds.username, '***'),
      responseXml: xml,
    };
  }
  const url = getEverifySoapUrl();
  const reqXml = defaultLoginEnvelope(creds.username, creds.password);
  const { responseXml } = await sendSoapRequest({
    url,
    soapAction: getEverifySoapLoginSoapAction(),
    xmlBody: reqXml,
  });
  const sessionToken = extractSessionToken(responseXml);
  if (!sessionToken) {
    logger.warn('E-Verify SOAP: could not parse session token; check ICA response shape');
    throw new EverifySoapError(
      'E-Verify SOAP: session token not found in auth response (adjust templates / parser)',
      'parse',
      { rawXml: responseXml.substring(0, 8000) }
    );
  }
  return { sessionToken, requestXml: reqXml, responseXml };
}

export async function createCaseSoap(
  sessionToken: string,
  employee: EverifySoapEmployeeData
): Promise<EverifySoapCreateCaseResult> {
  if (getEverifyFakeProvider()) {
    const reqXml = defaultCreateCaseEnvelope(sessionToken, employee);
    const num = `FAKE-CASE-${Date.now()}`;
    const resXml = `<?xml version="1.0"?><Envelope><Body><CaseNumber>${num}</CaseNumber><CaseStatus>SUBMITTED</CaseStatus></Body></Envelope>`;
    return { caseNumber: num, caseStatus: 'SUBMITTED', requestXml: reqXml, responseXml: resXml };
  }
  const url = getEverifySoapUrl();
  const reqXml = defaultCreateCaseEnvelope(sessionToken, employee);
  const { responseXml } = await sendSoapRequest({
    url,
    soapAction: getEverifySoapCreateCaseSoapAction(),
    xmlBody: reqXml,
  });
  const { caseNumber, caseStatus } = extractCaseNumberAndStatus(responseXml);
  if (!caseNumber) {
    throw new EverifySoapError(
      'E-Verify SOAP: case number not found in response (adjust ICA templates)',
      'parse',
      { rawXml: responseXml.substring(0, 8000) }
    );
  }
  return {
    caseNumber,
    caseStatus: caseStatus || 'UNKNOWN',
    requestXml: reqXml,
    responseXml,
  };
}

/** Base URL for diagnostics (REST + SOAP share project host). */
export function getEverifySoapDiagnosticsBaseUrl(): string {
  return getEverifyBaseUrl();
}
