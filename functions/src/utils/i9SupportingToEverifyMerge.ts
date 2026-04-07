/**
 * **Must stay in sync** with `src/utils/i9SupportingToEverifyPrefill.ts` (`i9SupportingApprovedToI9CaseFlatPartial`).
 * Functions `rootDir` is `src` only; duplicate by design.
 *
 * Approved rows: merge `documentExtraction` (when complete) with non-empty `documentReview.verifiedFields`;
 * identity splits `fullName` when first/last missing; List B+C uses List C expiration/state as fallback.
 */

export type I9SupportingDocLike = {
  documentType?: string;
  status?: string;
  reviewedAt?: unknown;
  documentReview?: {
    verifiedFields?: {
      fullName?: string | null;
      documentNumber?: string | null;
      dateOfBirth?: string | null;
      expirationDate?: string | null;
      issueDate?: string | null;
      issuingState?: string | null;
      issuingCountry?: string | null;
    } | null;
  } | null;
  documentExtraction?: {
    status?: string;
    extractedFields?: {
      documentNumber?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      fullName?: string | null;
      dateOfBirth?: string | null;
      expirationDate?: string | null;
      issueDate?: string | null;
      issuingState?: string | null;
      issuingCountry?: string | null;
    } | null;
  } | null;
};

const EXTRACTION_READY = 'extraction_complete';

/** Verified non-empty values overlay extraction (same rules as review UI). */
const REVIEW_OVERLAY_KEYS = [
  'fullName',
  'documentNumber',
  'dateOfBirth',
  'expirationDate',
  'issueDate',
  'issuingState',
  'issuingCountry',
] as const;

type EverifySourceFields = NonNullable<I9SupportingDocLike['documentExtraction']>['extractedFields'];

function reviewedAtMs(r: I9SupportingDocLike): number {
  const v = r.reviewedAt as { toMillis?: () => number } | undefined;
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  return 0;
}

function effectiveFieldsForEverify(doc: I9SupportingDocLike): EverifySourceFields | null {
  const ex = doc.documentExtraction;
  const base: Record<string, string | null | undefined> =
    ex?.status === EXTRACTION_READY && ex.extractedFields ? { ...ex.extractedFields } : {};
  const vf = doc.documentReview?.verifiedFields;
  if (vf) {
    for (const k of REVIEW_OVERLAY_KEYS) {
      const v = vf[k];
      if (v != null && String(v).trim() !== '') {
        base[k] = String(v).trim();
      }
    }
  }
  const hasAny = Object.values(base).some((v) => v != null && String(v).trim() !== '');
  return hasAny ? (base as EverifySourceFields) : null;
}

/** Align with `i9SupportingDocumentExtractionMapper.splitFullNameConservative` (comma = LAST, FIRST). */
function splitFullNameForEverify(full: string): { first?: string; last?: string } {
  const t = full.trim();
  if (!t) return {};
  if (t.includes(',')) {
    const parts = t.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { last: parts[0], first: parts.slice(1).join(' ') };
    }
  }
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return {};
  return { first: words[0], last: words.slice(1).join(' ') };
}

function normCountryCode(raw: string | null | undefined): string | undefined {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (s.length < 2 || s.length > 8) return undefined;
  return s;
}

function normState2(raw: string | null | undefined): string | undefined {
  const s = String(raw || '').trim().toUpperCase();
  if (s.length === 2) return s;
  return undefined;
}

function listADocCode(dt: string): { code: string } | null {
  switch (dt) {
    case 'list_a_us_passport':
      return { code: 'US_PASSPORT' };
    case 'list_a_pr_card':
      return { code: 'FORM_I551' };
    case 'list_a_ead':
      return { code: 'FORM_I766' };
    default:
      return null;
  }
}

function listBCode(dt: string): string | null {
  if (dt === 'list_b_drivers_license') return 'DRIVERS_LICENSE';
  if (dt === 'list_b_gov_id') return 'GOVERNMENT_ID_CARD';
  return null;
}

function listCCode(dt: string): string | null {
  if (dt === 'list_c_ssn_card') return 'SOCIAL_SECURITY_CARD';
  if (dt === 'list_c_birth_certificate') return 'BIRTH_CERTIFICATE';
  return null;
}

export function i9SupportingApprovedToI9CaseFlatPartial(
  rows: I9SupportingDocLike[],
): Record<string, string> {
  const approved = rows
    .filter((r) => String(r.status || '').toLowerCase() === 'approved')
    .sort((a, b) => reviewedAtMs(b) - reviewedAtMs(a));
  const out: Record<string, string> = {};

  const listA = approved.map((r) => ({ r, meta: listADocCode(String(r.documentType || '')) })).filter((x) => x.meta);
  const listB = approved.filter((r) => listBCode(String(r.documentType || '')));
  const listC = approved.filter((r) => listCCode(String(r.documentType || '')));

  const pickIdentityFrom = (docs: I9SupportingDocLike[]) => {
    for (const d of docs) {
      const f = effectiveFieldsForEverify(d);
      if (!f) continue;
      let fn = String(f.firstName || '').trim();
      let ln = String(f.lastName || '').trim();
      if ((!fn || !ln) && f.fullName) {
        const sp = splitFullNameForEverify(String(f.fullName));
        if (!fn) fn = sp.first || '';
        if (!ln) ln = sp.last || '';
      }
      const dob = String(f.dateOfBirth || '').trim();
      if (fn) out.first_name = fn;
      if (ln) out.last_name = ln;
      if (dob && /^\d{4}-\d{2}-\d{2}$/.test(dob)) out.date_of_birth = dob;
      if (out.first_name && out.last_name && out.date_of_birth) return;
    }
  };

  if (listA.length) {
    const first = listA[0];
    const dt = String(first.r.documentType || '');
    out.document_a_type_code = first.meta!.code;
    const f = effectiveFieldsForEverify(first.r);
    const num = String(f?.documentNumber || '').trim();
    if (dt === 'list_a_us_passport' && num) {
      out.us_passport_number = num;
    } else if (dt === 'list_a_ead' && num) {
      out.i766_number = num;
    } else if (dt === 'list_a_pr_card' && num) {
      const digits = num.replace(/\D/g, '');
      if (digits.length >= 9) {
        const rest = digits.slice(-9);
        out.alien_number = `A${rest}`;
      }
    }
    const exp = String(f?.expirationDate || '').trim();
    if (exp && /^\d{4}-\d{2}-\d{2}$/.test(exp)) out.expiration_date = exp;
    const st = normState2(f?.issuingState ?? null);
    if (st) out.us_state_code = st;
    if (dt === 'list_a_us_passport') {
      const cc = normCountryCode(f?.issuingCountry ?? null);
      if (cc) out.country_code = cc;
    }
    pickIdentityFrom(listA.map((x) => x.r));
    return out;
  }

  if (listB.length && listC.length) {
    const b = listB[0];
    const c = listC[0];
    const bDt = String(b.documentType || '');
    const cDt = String(c.documentType || '');
    const bCode = listBCode(bDt);
    const cCode = listCCode(cDt);
    if (bCode) out.document_b_type_code = bCode;
    if (cCode) out.document_c_type_code = cCode;
    const bf = effectiveFieldsForEverify(b);
    const cf = effectiveFieldsForEverify(c);
    const bNum = String(bf?.documentNumber || '').trim();
    const cNum = String(cf?.documentNumber || '').trim();
    if (bNum) out.document_bc_number = bNum;
    if (cNum) out.document_c_number = cNum;
    const bExp = String(bf?.expirationDate || '').trim();
    const cExp = String(cf?.expirationDate || '').trim();
    const exp = bExp || cExp;
    if (exp && /^\d{4}-\d{2}-\d{2}$/.test(exp)) out.expiration_date = exp;
    const st = normState2(bf?.issuingState ?? cf?.issuingState ?? null);
    if (st) out.us_state_code = st;
    pickIdentityFrom([b, c]);
  }

  return out;
}
