/**
 * Certification scan verdict — PURE decision rules over what Claude read off
 * the uploaded document (2026-09-08, Greg: "We need to use AI").
 *
 * Mirrors the headshot gate: the machine auto-approves the clear passes,
 * auto-rejects only the unambiguous failures (with high model confidence),
 * and sends everything in between to the human queue with every field
 * pre-filled. The card is the source of truth over what the worker typed —
 * an approve fills `issuer` / `expirationDate` from the document.
 *
 * Never auto-rejects on a name mismatch or a tampering signal: both are
 * accusations a person should make (nicknames, maiden names, JPEG artifacts).
 */
import type {
  CertificationAiExtractionV1,
  CertificationScanReasonCode,
  CertificationScanVerdict,
} from '../shared/certifications/certificationAiVerification';

export type VerdictCatalogEntry = {
  displayName: string;
  hasExpiration: boolean;
  validityPeriodYears?: number | null;
};

export type VerdictInput = {
  extraction: CertificationAiExtractionV1 | null;
  /** Set when the scan never produced an extraction. */
  scanFailed?: { code: 'file_unsupported' | 'scan_error' } | null;
  catalog: VerdictCatalogEntry;
  claimed: { issuer?: string | null; expirationDate?: string | null; certificateNumber?: string | null };
  workerName: string | null;
  /** YYYY-MM-DD in the tenant's frame of reference (UTC is fine). */
  todayISO: string;
};

export type VerdictResult = {
  verdict: CertificationScanVerdict;
  reasonCode: CertificationScanReasonCode;
  /** Written onto the record on auto-approve (document beats worker input). */
  fill: { issuer?: string | null; expirationDate?: string | null; certificateNumber?: string | null };
  /** Expiration off the card, or issue date + catalog validity when the card omits it. */
  effectiveExpiration: string | null;
  notes: string[];
};

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

export function nameTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !NAME_SUFFIXES.has(t));
}

/**
 * Local sanity check next to the model's own answer: the worker's last name
 * must appear on the document, and the first name must appear or be
 * initialed. Compound last names pass when any of the last two tokens hits.
 */
export function namesCompatible(workerName: string | null, holderName: string | null): 'yes' | 'no' | 'unsure' {
  const w = nameTokens(workerName);
  const h = nameTokens(holderName);
  if (w.length === 0 || h.length === 0) return 'unsure';
  const hset = new Set(h);
  const lastCandidates = w.length >= 2 ? w.slice(-2) : w.slice(-1);
  const lastOk = lastCandidates.some((t) => hset.has(t));
  if (!lastOk) return 'no';
  if (w.length === 1) return 'yes';
  const first = w[0];
  const firstOk = hset.has(first) || h.some((t) => t.length === 1 && t === first[0]);
  return firstOk ? 'yes' : 'unsure';
}

export function addYearsISO(iso: string, years: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]) + Math.trunc(years);
  return `${String(y).padStart(4, '0')}-${m[2]}-${m[3]}`;
}

function isISODate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export function decideCertificationVerdict(input: VerdictInput): VerdictResult {
  const notes: string[] = [];
  const noFill = {} as VerdictResult['fill'];

  if (input.scanFailed || !input.extraction) {
    const code = input.scanFailed?.code ?? 'scan_error';
    return { verdict: 'needs_review', reasonCode: code, fill: noFill, effectiveExpiration: null, notes: ['Scan did not produce a reading.'] };
  }
  const x = input.extraction;
  const high = x.confidence === 'high';
  // Worker gave us enough to check by hand (issuer + expiration, or a
  // certificate number): a poor photo goes to a person instead of bouncing.
  const typedDetails = !!(input.claimed.issuer && input.claimed.expirationDate) || !!(input.claimed.certificateNumber && input.claimed.certificateNumber.trim());

  if (!x.documentReadable) {
    return {
      verdict: high && !typedDetails ? 'auto_reject' : 'needs_review',
      reasonCode: 'unreadable',
      fill: noFill,
      effectiveExpiration: null,
      notes: [x.reviewerNotes || 'Document could not be read.', ...(typedDetails ? ['Worker typed details — check them against the upload.'] : [])],
    };
  }
  if (!x.isCertificateOrCard) {
    return {
      verdict: high ? 'auto_reject' : 'needs_review',
      reasonCode: 'not_a_certificate',
      fill: noFill,
      effectiveExpiration: null,
      notes: [x.documentDescription || x.reviewerNotes || 'Not the credential itself.'],
    };
  }
  if (x.matchesClaimedCredential !== 'yes') {
    return {
      verdict: x.matchesClaimedCredential === 'no' && high ? 'auto_reject' : 'needs_review',
      reasonCode: 'wrong_credential',
      fill: noFill,
      effectiveExpiration: null,
      notes: [`Claimed ${input.catalog.displayName}; document reads as: ${x.documentDescription || 'unclear'}.`],
    };
  }

  // Expiration: the card, else issue date + catalog validity.
  let effectiveExpiration: string | null = isISODate(x.expirationDate) ? x.expirationDate : null;
  if (!effectiveExpiration && isISODate(x.issueDate) && input.catalog.hasExpiration && input.catalog.validityPeriodYears) {
    effectiveExpiration = addYearsISO(x.issueDate, input.catalog.validityPeriodYears);
    if (effectiveExpiration) notes.push(`No expiration printed; derived ${effectiveExpiration} from issue date + ${input.catalog.validityPeriodYears}y.`);
  }

  if (x.tamperingSignals.length > 0) {
    return {
      verdict: 'needs_review',
      reasonCode: 'tampering_suspected',
      fill: noFill,
      effectiveExpiration,
      notes: [...notes, `Signals: ${x.tamperingSignals.join('; ')}`],
    };
  }

  const local = namesCompatible(input.workerName, x.holderName);
  const nameOk = x.holderNameMatchesWorker === 'yes' && local !== 'no';
  if (!nameOk) {
    return {
      verdict: 'needs_review',
      reasonCode: 'name_mismatch',
      fill: noFill,
      effectiveExpiration,
      notes: [...notes, `Worker: ${input.workerName ?? '?'}; document holder: ${x.holderName ?? 'not found'} (model: ${x.holderNameMatchesWorker}, local: ${local}).`],
    };
  }

  if (effectiveExpiration && effectiveExpiration < input.todayISO) {
    return {
      verdict: high ? 'auto_reject' : 'needs_review',
      reasonCode: 'expired',
      fill: noFill,
      effectiveExpiration,
      notes: [...notes, `Expired ${effectiveExpiration}.`],
    };
  }
  if (input.catalog.hasExpiration && !effectiveExpiration) {
    return {
      verdict: 'needs_review',
      reasonCode: 'expiration_missing',
      fill: noFill,
      effectiveExpiration: null,
      notes: [...notes, 'Catalog expects an expiration; none found on the document.'],
    };
  }
  if (!high) {
    return {
      verdict: 'needs_review',
      reasonCode: 'low_confidence',
      fill: noFill,
      effectiveExpiration,
      notes: [...notes, x.reviewerNotes || `Model confidence ${x.confidence}.`],
    };
  }

  const claimedExp = isISODate(input.claimed.expirationDate) ? input.claimed.expirationDate : null;
  if (claimedExp && effectiveExpiration && claimedExp !== effectiveExpiration) {
    notes.push(`Worker entered ${claimedExp}; document shows ${effectiveExpiration} — document kept.`);
  }
  return {
    verdict: 'auto_approve',
    reasonCode: 'looks_valid',
    fill: {
      issuer: (x.issuer && x.issuer.trim()) || input.claimed.issuer || null,
      expirationDate: effectiveExpiration ?? claimedExp ?? null,
      certificateNumber: (x.certificateNumber && x.certificateNumber.trim()) || input.claimed.certificateNumber || null,
    },
    effectiveExpiration,
    notes,
  };
}
