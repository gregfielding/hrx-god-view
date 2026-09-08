/**
 * Claude reads an uploaded credential (image or PDF) and reports what it is —
 * issuer, holder, dates, certificate number, jurisdiction, and whether it is
 * actually the credential the worker claimed. Structured output, no guessing:
 * a field the model cannot read comes back null.
 *
 * Why a frontier multimodal model and not Document AI: food handler cards
 * alone come in dozens of layouts (state agencies, counties, online
 * providers). There is no prebuilt parser, and a custom extractor cannot
 * answer "is this what they say it is". Document AI stays on I-9 IDs.
 *
 * Model: `CERT_SCAN_MODEL` env, else the app-wide `CLAUDE_MODEL` (Opus 5).
 */
import type Anthropic from '@anthropic-ai/sdk';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions/v2';
import sharp from 'sharp';
import { getStorageBucketName } from '../utils/storageBucket';
import { CLAUDE_MODEL, extractJsonText, getAnthropic } from '../utils/claudeChat';
import type {
  CertificationAiExtractionV1,
  CertificationScanConfidence,
  CertificationScanTriState,
} from '../shared/certifications/certificationAiVerification';

export const CERT_SCAN_MODEL = (process.env.CERT_SCAN_MODEL || '').trim() || CLAUDE_MODEL;

export type EvidenceRefLike = { storagePath?: string | null; storageUrl?: string | null; fileName?: string | null };

export function evidenceKeyOf(ref: EvidenceRefLike | null | undefined): string | null {
  if (!ref) return null;
  const p = String(ref.storagePath || '').trim();
  if (p) return p;
  const u = String(ref.storageUrl || '').trim();
  return u || null;
}

/** `https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<enc path>?...` → decoded path. */
export function storagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const m = /\/o\/([^?]+)/.exec(u.pathname + (u.pathname.endsWith('/') ? '' : ''));
    if (!m) return null;
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/tiff', 'image/bmp']);
const MAX_PDF_BYTES = 20 * 1024 * 1024;

function mimeFromName(name: string): string | null {
  const ext = name.toLowerCase().split('?')[0].split('.').pop() || '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp', pdf: 'application/pdf',
  };
  return map[ext] ?? null;
}

export type LoadedEvidence =
  | { ok: true; block: Anthropic.Beta.BetaContentBlockParam; mediaType: string; bytes: number; storagePath: string }
  | { ok: false; code: 'file_unsupported' | 'file_not_found'; message: string };

/** Download the evidence and turn it into a Claude content block (JPEG ≤2000px, or PDF). */
export async function loadEvidenceForModel(ref: EvidenceRefLike): Promise<LoadedEvidence> {
  const storagePath = String(ref.storagePath || '').trim() || storagePathFromUrl(ref.storageUrl);
  if (!storagePath) return { ok: false, code: 'file_not_found', message: 'No storagePath and the storageUrl is not a Firebase Storage URL.' };
  const file = getStorage().bucket(getStorageBucketName()).file(storagePath);
  let buf: Buffer;
  let contentType: string | null = null;
  try {
    const [meta] = await file.getMetadata();
    contentType = String((meta as { contentType?: unknown })?.contentType || '').trim().toLowerCase() || null;
    [buf] = await file.download();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/No such object|404/.test(msg)) return { ok: false, code: 'file_not_found', message: msg.slice(0, 200) };
    throw err;
  }
  const mime = (contentType && contentType !== 'application/octet-stream' ? contentType : null) || mimeFromName(ref.fileName || storagePath) || '';

  if (mime === 'application/pdf') {
    if (buf.length > MAX_PDF_BYTES) return { ok: false, code: 'file_unsupported', message: `PDF is ${buf.length} bytes; cap is ${MAX_PDF_BYTES}.` };
    return {
      ok: true,
      storagePath,
      mediaType: mime,
      bytes: buf.length,
      block: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } },
    };
  }
  if (!IMAGE_MIMES.has(mime)) {
    return { ok: false, code: 'file_unsupported', message: `Unsupported content type "${mime || 'unknown'}" for ${storagePath}.` };
  }
  // sharp handles EXIF rotation and HEIC → JPEG; keep the long edge at 2000px so text stays legible.
  const jpeg = await sharp(buf).rotate().resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  return {
    ok: true,
    storagePath,
    mediaType: 'image/jpeg',
    bytes: jpeg.length,
    block: { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
  };
}

export type ScanCatalogContext = {
  displayName: string;
  category: string;
  type: string;
  issuerHint?: string | null;
  aliases?: string[];
  hasExpiration: boolean;
  validityPeriodYears?: number | null;
};

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'documentReadable', 'isCertificateOrCard', 'documentDescription', 'matchesClaimedCredential', 'holderName',
    'holderNameMatchesWorker', 'issuer', 'issuingJurisdiction', 'accreditation', 'certificateNumber', 'issueDate',
    'expirationDate', 'tamperingSignals', 'confidence', 'reviewerNotes',
  ],
  properties: {
    documentReadable: { type: 'boolean' },
    isCertificateOrCard: { type: 'boolean' },
    documentDescription: { type: 'string' },
    matchesClaimedCredential: { type: 'string', enum: ['yes', 'no', 'unsure'] },
    holderName: { type: ['string', 'null'] },
    holderNameMatchesWorker: { type: 'string', enum: ['yes', 'no', 'unsure'] },
    issuer: { type: ['string', 'null'] },
    issuingJurisdiction: { type: ['string', 'null'] },
    accreditation: { type: ['string', 'null'] },
    certificateNumber: { type: ['string', 'null'] },
    issueDate: { type: ['string', 'null'] },
    expirationDate: { type: ['string', 'null'] },
    tamperingSignals: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reviewerNotes: { type: 'string' },
  },
} as const;

const SYSTEM_PROMPT = `You verify worker credential documents for a staffing company. A worker uploaded a file and said it is a specific credential. Read the file carefully and report exactly what it shows.

Rules:
- Report only what is printed. If a field is not on the document or is not legible, return null. Never infer or guess a date, number, or name.
- Dates must be YYYY-MM-DD. Convert printed formats (e.g. "Exp 03/15/2027", "March 15, 2027") faithfully; if the year is ambiguous, return null and say so in reviewerNotes.
- isCertificateOrCard is true only for the credential itself (a card, certificate, wallet card, or official completion certificate). Receipts, course catalogs, enrollment or purchase confirmations, screenshots of a course dashboard, ID cards, resumes, and unrelated photos are false.
- matchesClaimedCredential: "yes" if the document is the claimed credential or a widely accepted equivalent of the same kind (a state or ANSI-accredited food handler certificate counts for "Food Handler Card"; TIPS, TABC, RBS, or similar responsible-beverage certificates count for "Alcohol Server Permit"; a ServSafe Manager certificate does NOT count as a Food Handler Card and vice versa). "no" if it is a different kind of credential or not a credential. "unsure" only when you genuinely cannot tell.
- holderNameMatchesWorker compares the printed holder name to the worker's profile name. Nicknames, missing middle names, initials, and accent differences still count as "yes". A different surname is "no". Use "unsure" if no name is printed.
- tamperingSignals: list concrete visual evidence of editing (mismatched fonts on one field, misaligned text, pixel artifacts around a date, a name that sits on a different baseline). An empty list means nothing looks edited. Do not list ordinary photo problems (glare, blur, angle) here.
- confidence is "high" only when the document is clearly legible and every reported field is unambiguous. Blur, glare, partial crops, or any doubt lowers it.
- reviewerNotes: one or two plain sentences a human reviewer would want, including anything odd.
- Respond with the JSON object only.`;

export type ScanResult = {
  extraction: CertificationAiExtractionV1;
  model: string;
  tokens: { input: number; output: number };
};

export async function scanCertificationWithClaude(params: {
  fileBlock: Anthropic.Beta.BetaContentBlockParam;
  catalog: ScanCatalogContext;
  claimed: { issuer?: string | null; expirationDate?: string | null };
  workerName: string | null;
  todayISO: string;
}): Promise<ScanResult> {
  const { catalog, claimed } = params;
  const lines = [
    `Today's date: ${params.todayISO}.`,
    `Claimed credential: ${catalog.displayName} (category: ${catalog.category}; type: ${catalog.type}).`,
    catalog.issuerHint ? `Typical issuers: ${catalog.issuerHint}.` : '',
    catalog.aliases && catalog.aliases.length ? `Also known as: ${catalog.aliases.join(', ')}.` : '',
    catalog.hasExpiration
      ? `This credential normally expires${catalog.validityPeriodYears ? ` about ${catalog.validityPeriodYears} years after issue` : ''}.`
      : 'This credential normally does not expire.',
    `Worker's profile name: ${params.workerName || '(unknown)'}.`,
    claimed.issuer ? `Issuer the worker typed: ${claimed.issuer}.` : 'The worker did not type an issuer.',
    claimed.expirationDate ? `Expiration the worker typed: ${claimed.expirationDate}.` : 'The worker did not type an expiration.',
    'Read the attached file and produce the JSON object.',
  ].filter(Boolean);

  const client = getAnthropic();
  const response = await client.beta.messages.create({
    model: CERT_SCAN_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [params.fileBlock, { type: 'text', text: lines.join('\n') }] }],
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown> } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  if (response.stop_reason === 'refusal') {
    const details = response.stop_details as { category?: string; explanation?: string } | null | undefined;
    throw new Error(`Claude refused (${details?.category ?? 'unknown'}): ${details?.explanation ?? ''}`.trim());
  }
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  const parsed = JSON.parse(extractJsonText(text)) as Record<string, unknown>;
  const extraction = coerceExtraction(parsed);
  logger.info('certification_scan.model_reply', {
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    readable: extraction.documentReadable,
    isCert: extraction.isCertificateOrCard,
    matches: extraction.matchesClaimedCredential,
    confidence: extraction.confidence,
  });
  return {
    extraction,
    model: response.model,
    tokens: { input: response.usage.input_tokens, output: response.usage.output_tokens },
  };
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, 300) : null;
}
function isoDate(v: unknown): string | null {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function tri(v: unknown): CertificationScanTriState {
  return v === 'yes' || v === 'no' ? v : 'unsure';
}
function conf(v: unknown): CertificationScanConfidence {
  return v === 'high' || v === 'medium' ? v : 'low';
}

/** Defensive shaping of the model's JSON — a malformed field degrades to "unknown", never throws. */
export function coerceExtraction(raw: Record<string, unknown>): CertificationAiExtractionV1 {
  const signals = Array.isArray(raw.tamperingSignals)
    ? raw.tamperingSignals.map((s) => str(s)).filter((s): s is string => !!s).slice(0, 8)
    : [];
  return {
    documentReadable: raw.documentReadable === true,
    isCertificateOrCard: raw.isCertificateOrCard === true,
    documentDescription: str(raw.documentDescription) ?? '',
    matchesClaimedCredential: tri(raw.matchesClaimedCredential),
    holderName: str(raw.holderName),
    holderNameMatchesWorker: tri(raw.holderNameMatchesWorker),
    issuer: str(raw.issuer),
    issuingJurisdiction: str(raw.issuingJurisdiction),
    accreditation: str(raw.accreditation),
    certificateNumber: str(raw.certificateNumber),
    issueDate: isoDate(raw.issueDate),
    expirationDate: isoDate(raw.expirationDate),
    tamperingSignals: signals,
    confidence: conf(raw.confidence),
    reviewerNotes: (str(raw.reviewerNotes) ?? '').slice(0, 600),
  };
}
