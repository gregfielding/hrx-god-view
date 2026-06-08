/**
 * Build the Assignment Details confirmation email (subject + HTML body).
 * Mirrors the worker Assignment Details page so the email contains the same fields.
 * See: docs/assignment-details-fields-for-confirmation-email.md
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

const db = admin.firestore();

const PLACEHOLDER = '—';
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DOW_LABELS: Record<number, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

function toDate(v: unknown): Date | undefined {
  if (!v) return undefined;
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (typeof v === 'string' || typeof v === 'number') return new Date(v);
  return undefined;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatDateTime(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** HH:mm → "9:00 AM" */
function formatTime(t: string | undefined): string {
  if (!t || typeof t !== 'string') return '';
  const [h, m] = t.trim().split(':');
  const hh = Math.max(0, Math.min(23, parseInt(h, 10) || 0));
  const mm = Math.max(0, Math.min(59, parseInt(m, 10) || 0));
  const d = new Date(2000, 0, 1, hh, mm);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function looksLikeDocId(s: unknown): boolean {
  if (typeof s !== 'string' || !s) return false;
  const t = s.trim();
  return t.length >= 15 && t.length <= 30 && /^[a-zA-Z0-9_-]+$/.test(t);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** http(s) only — shift clock-in URL from recruiter. */
function safeClockInHref(raw: unknown): string | null {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  let u = t;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Convert plain text to HTML with newlines as `<br>` AND auto-linkify URLs
 * + US phone numbers.
 *
 * Used for every user-provided text section in the confirmation email
 * (parking, check-in, first-day instructions, what-to-bring, additional
 * notes, shift description, uniform, email intro). Recruiters paste
 * Apple/Google Maps links + Streetcar info + carrier portal URLs + venue
 * contact phone numbers into these fields and expect them to be
 * clickable in the email.
 *
 * Pipeline:
 *   1. Escape HTML so the input can't inject tags
 *   2. Replace newlines with `<br>`
 *   3. Detect URLs (http://, https://, and bare `www.` forms) in the
 *      already-escaped output and wrap them in `<a>` tags
 *
 * URL matching:
 *   - `https?://` + non-space chars up to whitespace, `<`, or `>`
 *   - bare `www.` URLs are also caught (and rewritten to `https://www.`
 *     for the href; the visible text stays as the user typed it)
 *
 * Trailing punctuation (`.`, `,`, `;`, `:`, `!`, `?`, `)`, `]`) is trimmed
 * off the URL so prose like "see https://example.com." doesn't include
 * the period in the link. The trimmed chars are re-emitted after the
 * closing `</a>` so the rendered text matches the input.
 *
 * IMPORTANT: HTML-escaping comes first, so a URL like
 * `?a=1&b=2` becomes `?a=1&amp;b=2` in the matched text. Mail clients
 * (Gmail, Outlook, Apple Mail) all correctly decode `&amp;` in `href`
 * attributes back to `&` when the user clicks. The visible link text
 * also renders correctly because the browser/mail client decodes
 * `&amp;` → `&` when rendering anchor children. So escape-then-linkify
 * is safe and produces the right output.
 */
function nl2br(s: string): string {
  const escaped = escapeHtml(s).replace(/\n/g, '<br>\n');
  return linkifyUrls(escaped);
}

/** Trailing chars that almost always belong to surrounding prose, not the URL. */
const URL_TRAILING_PUNCT = /[.,;:!?)\]]+$/;

/**
 * Match URLs OR US phone numbers in one pass. URL alternatives come first
 * so the regex engine prefers them when both could match (e.g., a phone
 * number embedded in a URL query string is consumed by the URL match).
 *
 * Phone matching is conservative: requires at least one explicit separator
 * (space, dash, dot, or parens around area code) so we don't grab arbitrary
 * 10-digit numeric strings like account numbers or timestamps. Patterns we
 * match:
 *   (555) 123-4567
 *   555-123-4567
 *   555.123.4567
 *   555 123 4567
 *   +1 555 123 4567
 *   1-555-123-4567
 *
 * Patterns we DON'T match (intentional):
 *   5551234567   — bare 10 digits, ambiguous with account numbers
 *   7:15a-8:30a  — `:` isn't a recognized phone separator
 *   12345-6789   — ZIP+4 is 5-4 not 3-3-4
 *   123-45-6789  — SSN is 3-2-4 not 3-3-4
 */
const URL_OR_PHONE_REGEX =
  /(https?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+|(?:\+?1[-.\s])?\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]?\d{4}\b)/g;

function linkifyUrls(html: string): string {
  return html.replace(URL_OR_PHONE_REGEX, (match) => {
    const isUrl = /^(https?:\/\/|www\.)/i.test(match);
    if (isUrl) {
      // Trim trailing punctuation off the URL so "see https://example.com."
      // doesn't include the period. Re-emit the punctuation after the </a>.
      const trailingMatch = match.match(URL_TRAILING_PUNCT);
      const trailing = trailingMatch ? trailingMatch[0] : '';
      const url = trailing ? match.slice(0, match.length - trailing.length) : match;
      // Safety: if after trimming there's no URL body left (e.g., the match
      // was just `https://` or `www.`), bail and leave as-is.
      if (url === 'https://' || url === 'http://' || url === 'www.') return match;
      // href: bare `www.X` → `https://www.X`. We don't try to validate the URL
      // beyond that — the user typed it; trust them. (Email clients sandbox.)
      // The escaped `&amp;` in the URL stays escaped in the href; clicking
      // decodes it correctly per the function-level comment above.
      const href = url.startsWith('www.') ? `https://${url}` : url;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:#1976d2; word-break:break-all;">${url}</a>${trailing}`;
    }
    // Phone branch. Normalize to E.164 (+1NXXNXXXXXX) for the tel: href so
    // mobile dialers parse it consistently. Visible text stays as the user
    // typed it.
    const digits = match.replace(/\D/g, '');
    let e164: string;
    if (digits.length === 10) {
      e164 = `+1${digits}`;
    } else if (digits.length === 11 && digits.startsWith('1')) {
      e164 = `+${digits}`;
    } else {
      // Weird digit count — leave as plain text so we don't generate a
      // broken tel: link.
      return match;
    }
    return `<a href="tel:${e164}" style="color:#1976d2;">${match}</a>`;
  });
}

/** Same section keys as worker Assignment Details (see src/pages/AssignmentDetails.tsx). */
const STAFF_SECTION_KEYS = [
  'firstDay',
  'parking',
  'checkIn',
  'uniform',
  'credentials',
  'other',
  'attachments',
] as const;

type StaffSectionMap = Record<string, { text?: unknown; files?: any[] } | undefined>;

function normalizeStaffInstructionMap(input: unknown): StaffSectionMap {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const map = input as Record<string, unknown>;
  const out: StaffSectionMap = {};
  for (const key of STAFF_SECTION_KEYS) {
    const value = map[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const section = value as Record<string, unknown>;
    out[key] = {
      text: section.text,
      files: Array.isArray(section.files) ? section.files : [],
    };
  }
  return out;
}

type StaffI18nMap = Record<string, { en?: string; es?: string } | undefined>;

function normalizeStaffInstructionI18nMap(input: unknown): StaffI18nMap {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const map = input as Record<string, unknown>;
  const out: StaffI18nMap = {};
  for (const key of STAFF_SECTION_KEYS) {
    const value = map[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const section = value as Record<string, unknown>;
    const en = typeof section.en === 'string' ? section.en : undefined;
    const es = typeof section.es === 'string' ? section.es : undefined;
    if (en || es) out[key] = { en, es };
  }
  return out;
}

function hasStaffTextValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  const en = typeof obj.en === 'string' ? obj.en : '';
  const es = typeof obj.es === 'string' ? obj.es : '';
  return en.trim().length > 0 || es.trim().length > 0;
}

/**
 * Merge staff instruction maps with the same precedence as the worker Assignment Details page:
 * parent account defaults < account < location defaults < job order < shift < assignment.
 */
function mergeStaffInstructionLayers(
  staffSources: StaffSectionMap[],
  i18nSources: StaffI18nMap[],
): { merged: StaffSectionMap; mergedI18n: StaffI18nMap } {
  const resolvedStaff: StaffSectionMap = {};
  const resolvedI18n: StaffI18nMap = {};

  for (const sectionKey of STAFF_SECTION_KEYS) {
    let pickedText: unknown = undefined;
    let pickedFiles: any[] | undefined = undefined;
    let pickedI18n: { en?: string; es?: string } | undefined = undefined;

    for (let i = staffSources.length - 1; i >= 0; i -= 1) {
      const candidate = staffSources[i]?.[sectionKey];
      if (!candidate) continue;
      if (pickedText === undefined && hasStaffTextValue(candidate.text)) {
        pickedText = candidate.text;
      }
      if (pickedFiles === undefined && Array.isArray(candidate.files) && candidate.files.length > 0) {
        pickedFiles = candidate.files;
      }
    }
    for (let i = i18nSources.length - 1; i >= 0; i -= 1) {
      const candidate = i18nSources[i]?.[sectionKey];
      if (!candidate) continue;
      if (
        !pickedI18n &&
        ((candidate.en && candidate.en.trim()) || (candidate.es && candidate.es.trim()))
      ) {
        pickedI18n = candidate;
      }
    }
    if (pickedText !== undefined || (pickedFiles && pickedFiles.length > 0)) {
      resolvedStaff[sectionKey] = { text: pickedText, files: pickedFiles || [] };
    }
    if (pickedI18n) {
      resolvedI18n[sectionKey] = pickedI18n;
    }
  }
  return { merged: resolvedStaff, mergedI18n: resolvedI18n };
}

function getEnglishStaffSectionText(
  section: string,
  merged: StaffSectionMap,
  mergedI18n: StaffI18nMap,
  assignmentCheckInFallback: string,
): string {
  const raw = merged[section]?.text;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const en = typeof o.en === 'string' ? o.en : '';
    const es = typeof o.es === 'string' ? o.es : '';
    if (en.trim()) return en.trim();
    if (es.trim()) return es.trim();
  }
  const i18n = mergedI18n[section];
  if (i18n?.en?.trim()) return i18n.en.trim();
  if (i18n?.es?.trim()) return i18n.es.trim();
  if (section === 'checkIn') return assignmentCheckInFallback.trim();
  return '';
}

/**
 * Load cascaded staff instructions (account / location / shift / job order / assignment) so the email
 * matches what workers see on Assignment Details.
 */
async function loadMergedStaffInstructions(
  tenantId: string,
  a: Record<string, unknown>,
  jobOrderData: Record<string, unknown> | null,
  shiftDocData: Record<string, unknown> | null,
): Promise<{ merged: StaffSectionMap; mergedI18n: StaffI18nMap }> {
  const assignmentStaff = normalizeStaffInstructionMap(a.staffInstructions);
  const assignmentStaffI18n = normalizeStaffInstructionI18nMap(a.staffInstructions_i18n);
  const jobOrderStaff = jobOrderData ? normalizeStaffInstructionMap(jobOrderData.staffInstructions) : {};
  const jobOrderStaffI18n = jobOrderData
    ? normalizeStaffInstructionI18nMap(jobOrderData.staffInstructions_i18n)
    : {};
  const shiftStaff = shiftDocData ? normalizeStaffInstructionMap(shiftDocData.staffInstructions) : {};
  const shiftStaffI18n = shiftDocData
    ? normalizeStaffInstructionI18nMap(shiftDocData.staffInstructions_i18n)
    : {};

  const accountId =
    (typeof a.companyId === 'string' && a.companyId) ||
    (typeof a.accountId === 'string' && a.accountId) ||
    (jobOrderData && (jobOrderData.accountId as string | undefined)) ||
    (jobOrderData && (jobOrderData.companyId as string | undefined)) ||
    undefined;
  const parentAccountId =
    (typeof a.parentAccountId === 'string' && a.parentAccountId) ||
    (jobOrderData && (jobOrderData.parentAccountId as string | undefined)) ||
    undefined;
  const locationId =
    (typeof a.worksiteId === 'string' && a.worksiteId) ||
    (typeof a.locationId === 'string' && a.locationId) ||
    (jobOrderData && (jobOrderData.worksiteId as string | undefined)) ||
    (jobOrderData && (jobOrderData.locationId as string | undefined)) ||
    undefined;
  const companyIdForKey = jobOrderData && (jobOrderData.companyId as string | undefined);

  const locationKeyCandidates = [
    typeof jobOrderData?.locationKey === 'string' ? (jobOrderData.locationKey as string) : '',
    accountId && locationId ? `${accountId}_${locationId}` : '',
    companyIdForKey && locationId ? `${companyIdForKey}_${locationId}` : '',
  ].filter(Boolean);

  let parentAccountStaff: StaffSectionMap = {};
  let parentAccountStaffI18n: StaffI18nMap = {};
  let accountStaff: StaffSectionMap = {};
  let accountStaffI18n: StaffI18nMap = {};
  let locationStaff: StaffSectionMap = {};
  let locationStaffI18n: StaffI18nMap = {};

  try {
    if (parentAccountId) {
      const snap = await db.doc(`tenants/${tenantId}/accounts/${parentAccountId}`).get();
      if (snap.exists) {
        const d = snap.data() || {};
        const od = (d.orderDefaults as Record<string, unknown> | undefined) || {};
        parentAccountStaff = normalizeStaffInstructionMap(od.staffInstructions);
        parentAccountStaffI18n = normalizeStaffInstructionI18nMap(od.staffInstructions_i18n);
      }
    }
  } catch (_) {
    /* best-effort */
  }

  try {
    if (accountId) {
      const snap = await db.doc(`tenants/${tenantId}/accounts/${accountId}`).get();
      if (snap.exists) {
        const d = snap.data() || {};
        const od = (d.orderDefaults as Record<string, unknown> | undefined) || {};
        accountStaff = normalizeStaffInstructionMap(od.staffInstructions);
        accountStaffI18n = normalizeStaffInstructionI18nMap(od.staffInstructions_i18n);
      }
    }
  } catch (_) {
    /* best-effort */
  }

  try {
    if (accountId && locationKeyCandidates.length > 0) {
      for (const key of locationKeyCandidates) {
        const snap = await db.doc(`tenants/${tenantId}/accounts/${accountId}/location_defaults/${key}`).get();
        if (!snap.exists) continue;
        const d = snap.data() || {};
        const od = (d.orderDefaults as Record<string, unknown> | undefined) || {};
        locationStaff = normalizeStaffInstructionMap(od.staffInstructions);
        locationStaffI18n = normalizeStaffInstructionI18nMap(od.staffInstructions_i18n);
        break;
      }
    }
  } catch (_) {
    /* best-effort */
  }

  const staffSources: StaffSectionMap[] = [
    parentAccountStaff,
    accountStaff,
    locationStaff,
    jobOrderStaff,
    shiftStaff,
    assignmentStaff,
  ];
  const i18nSources: StaffI18nMap[] = [
    parentAccountStaffI18n,
    accountStaffI18n,
    locationStaffI18n,
    jobOrderStaffI18n,
    shiftStaffI18n,
    assignmentStaffI18n,
  ];
  return mergeStaffInstructionLayers(staffSources, i18nSources);
}

export interface AssignmentDetailsEmailResult {
  subject: string;
  html: string;
}

/**
 * Load assignment and related data, then build subject and HTML for the confirmation email.
 * Subject format: "JOB TITLE - Assignment Details"
 */
export async function buildAssignmentDetailsEmail(
  tenantId: string,
  assignmentId: string
): Promise<AssignmentDetailsEmailResult | null> {
  try {
    const assignmentRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
    const assignmentSnap = await assignmentRef.get();
    if (!assignmentSnap.exists) {
      logger.warn(`buildAssignmentDetailsEmail: assignment not found ${tenantId}/${assignmentId}`);
      return null;
    }
    const a = assignmentSnap.data() || {};
    const jobTitle = (a.jobTitle || 'Assignment').trim();
    const subject = `${jobTitle} - Assignment Details`;

    // Resolve company name
    let resolvedCompanyName: string | null = null;
    const companyId = a.companyId;
    if (companyId && (!a.companyName || looksLikeDocId(a.companyName))) {
      const companySnap = await db.doc(`tenants/${tenantId}/crm_companies/${companyId}`).get();
      if (companySnap.exists) {
        const d = companySnap.data() || {};
        const name = (d.name || d.companyName) as string | undefined;
        if (name && !looksLikeDocId(name)) resolvedCompanyName = name;
      }
    }
    const companyName = resolvedCompanyName ?? a.companyName ?? PLACEHOLDER;

    // Resolve worksite name and address
    let resolvedWorksiteName: string | null = null;
    let resolvedWorksiteAddress: string | null = null;
    const worksiteId = a.worksiteId || a.locationId;
    if (worksiteId) {
      const needLookup =
        !a.worksiteName &&
        !a.location ||
        looksLikeDocId(a.worksiteName) ||
        looksLikeDocId(a.location);
      const wa = a.worksiteAddress || {};
      const needAddress = !wa.street && !wa.address && !wa.city && !wa.state && !wa.zipCode;
      if (needLookup || needAddress) {
        let locSnap = companyId
          ? await db.doc(`tenants/${tenantId}/crm_companies/${companyId}/locations/${worksiteId}`).get()
          : null;
        if (!locSnap?.exists) {
          locSnap = await db.doc(`tenants/${tenantId}/locations/${worksiteId}`).get();
        }
        if (locSnap?.exists) {
          const loc = locSnap.data() || {};
          if (needLookup) {
            const name = (loc.nickname || loc.title || loc.name || loc.locationName) as string | undefined;
            if (name && !looksLikeDocId(name)) resolvedWorksiteName = name;
          }
          if (needAddress) {
            const street = (loc.address || loc.street) as string | undefined;
            const zip = (loc.zipCode ?? loc.zipcode) as string | undefined;
            const parts = [street, loc.city, loc.state, zip].filter(Boolean) as string[];
            if (parts.length) resolvedWorksiteAddress = parts.join(', ');
          }
        }
      }
    }
    const worksiteName = resolvedWorksiteName ?? a.worksiteName ?? a.location ?? PLACEHOLDER;
    let worksiteAddressStr = resolvedWorksiteAddress || '';
    if (!worksiteAddressStr && (a.worksiteAddress || a.address)) {
      const wa = a.worksiteAddress || a.address;
      const parts = [wa.street || wa.address, wa.city, wa.state, wa.zipCode].filter(Boolean);
      worksiteAddressStr = parts.join(', ');
    }
    if (!worksiteAddressStr) worksiteAddressStr = PLACEHOLDER;

    const startDate = toDate(a.startDate);
    const endDate = toDate(a.endDate);
    const payRate = a.payRate != null ? `$${Number(a.payRate)}/hr` : PLACEHOLDER;
    const uniformText = [a.uniformRequirements, a.customUniformRequirements].filter(Boolean).join('\n\n') || PLACEHOLDER;
    const ppeText = a.ppeRequirements || PLACEHOLDER;

    // Shift (schedule) + raw shift doc for cascaded staff instructions (matches worker Assignment Details)
    let scheduleShift: {
      shiftMode?: string;
      weeklySchedule?: Record<
        string,
        { enabled?: boolean; startTime?: string; endTime?: string; workersNeeded?: number; overstaff?: number }
      >;
      defaultStartTime?: string;
      defaultEndTime?: string;
      endDate?: string;
      shiftDescription?: string;
      emailIntro?: string;
      clockInUrl?: string;
    } | null = null;
    let shiftDocData: Record<string, unknown> | null = null;
    if (a.jobOrderId && a.shiftId) {
      const shiftSnap = await db
        .doc(`tenants/${tenantId}/job_orders/${a.jobOrderId}/shifts/${a.shiftId}`)
        .get();
      if (shiftSnap.exists) {
        const d = shiftSnap.data() || {};
        shiftDocData = d as Record<string, unknown>;
        scheduleShift = {
          shiftMode: d.shiftMode,
          weeklySchedule: d.weeklySchedule,
          defaultStartTime: d.defaultStartTime,
          defaultEndTime: d.defaultEndTime,
          endDate: d.endDate,
          shiftDescription: d.shiftDescription,
          emailIntro: d.emailIntro,
          clockInUrl: d.clockInUrl,
        };
      }
    }

    const jobOrderType = a.jobOrderType === 'gig' || a.jobOrderType === 'career' ? a.jobOrderType : undefined;

    // Job order (recruiters + cascaded staff instructions)
    let jobOrderData: Record<string, unknown> | null = null;
    if (a.jobOrderId) {
      const jobOrderSnap = await db.doc(`tenants/${tenantId}/job_orders/${a.jobOrderId}`).get();
      if (jobOrderSnap.exists) {
        jobOrderData = (jobOrderSnap.data() || {}) as Record<string, unknown>;
      }
    }

    const shiftCheckIn =
      shiftDocData && typeof shiftDocData.checkInInstructions === 'string'
        ? String(shiftDocData.checkInInstructions).trim()
        : '';
    const jobOrderCheckIn =
      jobOrderData && typeof jobOrderData.checkInInstructions === 'string'
        ? String(jobOrderData.checkInInstructions).trim()
        : '';
    const assignmentCheckIn = String(a.checkInInstructions || '').trim();
    const checkInFallback = assignmentCheckIn || shiftCheckIn || jobOrderCheckIn;

    const { merged: mergedStaff, mergedI18n: mergedStaffI18n } = await loadMergedStaffInstructions(
      tenantId,
      a,
      jobOrderData,
      shiftDocData,
    );

    // Recruiters
    const recruiters: Array<{ displayName: string; email?: string; phone?: string }> = [];
    if (a.jobOrderId && jobOrderData) {
      const ids: string[] = [];
      {
        const jo = jobOrderData;
        const assigned = jo.assignedRecruiters as string[] | undefined;
        const legacyId = jo.recruiterId as string | undefined;
        if (Array.isArray(assigned) && assigned.length) ids.push(...assigned);
        else if (legacyId) ids.push(legacyId);
      }
      const uniq = Array.from(new Set(ids));
      for (const uid of uniq) {
        const userSnap = await db.doc(`users/${uid}`).get();
        if (userSnap.exists) {
          const u = userSnap.data() || {};
          const firstName = (u.firstName as string) || '';
          const lastName = (u.lastName as string) || '';
          const displayName =
            `${firstName} ${lastName}`.trim() ||
            (u.displayName as string) ||
            (u.email as string) ||
            'Recruiter';
          const phone = (u.phone || u.phoneNumber || u.phoneE164) as string | undefined;
          recruiters.push({
            displayName,
            email: u.email as string | undefined,
            phone: phone && String(phone).trim() ? String(phone).trim() : undefined,
          });
        } else {
          recruiters.push({ displayName: 'Recruiter' });
        }
      }
    }

    // Build HTML sections
    const sections: string[] = [];

    // Assignment Info
    sections.push(`
<h2 style="margin:0 0 8px 0; font-size:18px; font-weight:700;">Assignment Info</h2>
<table style="border-collapse:collapse; width:100%; max-width:560px;">
<tr><td style="padding:4px 12px 4px 0; color:#666; font-size:12px;">Job Title</td></tr>
<tr><td style="padding:0 0 12px 0; font-weight:600;">${escapeHtml((a.jobTitle as string) || PLACEHOLDER)}</td></tr>
<tr><td style="padding:4px 12px 4px 0; color:#666; font-size:12px;">Start Date</td></tr>
<tr><td style="padding:0 0 12px 0;">${startDate ? formatDate(startDate) : PLACEHOLDER}</td></tr>
<tr><td style="padding:4px 12px 4px 0; color:#666; font-size:12px;">Pay Rate</td></tr>
<tr><td style="padding:0 0 12px 0; font-weight:600;">${escapeHtml(String(payRate))}</td></tr>
<tr><td style="padding:4px 12px 4px 0; color:#666; font-size:12px;">Company Name</td></tr>
<tr><td style="padding:0 0 12px 0;">${escapeHtml(companyName)}</td></tr>
<tr><td style="padding:4px 12px 4px 0; color:#666; font-size:12px;">Worksite name</td></tr>
<tr><td style="padding:0 0 12px 0;">${escapeHtml(worksiteName)}</td></tr>
<tr><td style="padding:4px 12px 4px 0; color:#666; font-size:12px;">Worksite address</td></tr>
<tr><td style="padding:0 0 12px 0;">${worksiteAddressStr !== PLACEHOLDER ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(worksiteAddressStr)}" style="color:#1976d2;">${escapeHtml(worksiteAddressStr)}</a>` : PLACEHOLDER}</td></tr>
<tr><td style="padding:4px 12px 4px 0; color:#666; font-size:12px;">Required uniform</td></tr>
<tr><td style="padding:0 0 12px 0; white-space:pre-wrap;">${nl2br(String(uniformText))}</td></tr>
<tr><td style="padding:4px 12px 4px 0; color:#666; font-size:12px;">Required PPE</td></tr>
<tr><td style="padding:0 0 16px 0;">${escapeHtml(String(ppeText))}</td></tr>
</table>`);

    // My Schedule
    const weeklySchedule = scheduleShift?.shiftMode === 'multi' && scheduleShift?.weeklySchedule && Object.keys(scheduleShift.weeklySchedule).length > 0;
    let scheduleHtml = '<h2 style="margin:0 0 8px 0; font-size:18px; font-weight:700;">My Schedule</h2>';
    if (weeklySchedule && scheduleShift?.weeklySchedule) {
      const lines: string[] = [];
      for (const dow of DOW_ORDER) {
        const entry = scheduleShift.weeklySchedule[String(dow)];
        if (!entry?.enabled) continue;
        const start = formatTime(entry.startTime);
        const end = formatTime(entry.endTime);
        lines.push(`${DOW_LABELS[dow]}: ${start} – ${end}`);
      }
      if (lines.length) {
        scheduleHtml += `<p style="margin:0 0 4px 0; color:#666; font-size:12px;">Weekly schedule</p><ul style="margin:0 0 12px 0; padding-left:20px;">${lines.map((l) => `<li style="margin:4px 0;">${escapeHtml(l)}</li>`).join('')}</ul>`;
      }
      if (startDate) {
        scheduleHtml += `<p style="margin:0 0 4px 0; color:#666; font-size:12px;">Start date</p><p style="margin:0 0 12px 0;">${formatDate(startDate)}</p>`;
      }
      if (jobOrderType === 'gig' && (endDate || scheduleShift.endDate)) {
        const endVal = endDate ? formatDate(endDate) : (scheduleShift.endDate ? formatDate(new Date(scheduleShift.endDate)) : PLACEHOLDER);
        scheduleHtml += `<p style="margin:0 0 4px 0; color:#666; font-size:12px;">End date</p><p style="margin:0 0 12px 0;">${endVal}</p>`;
      }
      if (jobOrderType === 'career' && !endDate && !scheduleShift.endDate) {
        scheduleHtml += `<p style="margin:0 0 4px 0; color:#666; font-size:12px;">Duration</p><p style="margin:0 0 12px 0;">Ongoing</p>`;
      }
    } else {
      if (startDate) {
        scheduleHtml += `<p style="margin:0 0 4px 0; color:#666; font-size:12px;">Date</p><p style="margin:0 0 12px 0;">${formatDate(startDate)}</p>`;
      }
      const startT = a.startTime || scheduleShift?.defaultStartTime;
      const endT = a.endTime || scheduleShift?.defaultEndTime;
      if (startT || endT) {
        const timeStr = [formatTime(startT), formatTime(endT)].filter(Boolean).join(' – ');
        scheduleHtml += `<p style="margin:0 0 4px 0; color:#666; font-size:12px;">Time</p><p style="margin:0 0 12px 0;">${escapeHtml(timeStr)}</p>`;
      }
      if (endDate) {
        scheduleHtml += `<p style="margin:0 0 4px 0; color:#666; font-size:12px;">End date</p><p style="margin:0 0 12px 0;">${formatDate(endDate)}</p>`;
      }
      if (!startDate && !startT && !endT && !scheduleShift?.defaultStartTime) {
        scheduleHtml += `<p style="margin:0 0 12px 0; color:#666;">No schedule details available.</p>`;
      }
    }
    const clockInHref = safeClockInHref(scheduleShift?.clockInUrl);
    if (clockInHref) {
      scheduleHtml += `<p style="margin:12px 0 4px 0; color:#666; font-size:12px;">Clock-in</p><p style="margin:0 0 12px 0;"><a href="${escapeHtml(clockInHref)}" style="color:#1976d2;">${escapeHtml(clockInHref)}</a></p>`;
    }
    if (scheduleShift?.shiftDescription?.trim()) {
      scheduleHtml += `<p style="margin:12px 0 4px 0; color:#666; font-size:12px;">Shift-Specific Details or Job Description</p><p style="margin:0 0 12px 0; white-space:pre-wrap;">${nl2br(scheduleShift.shiftDescription)}</p>`;
    }
    if (scheduleShift?.emailIntro?.trim()) {
      scheduleHtml += `<p style="margin:12px 0 4px 0; color:#666; font-size:12px;">Shift Info to Email Staff</p><p style="margin:0 0 12px 0; white-space:pre-wrap;">${nl2br(scheduleShift.emailIntro)}</p>`;
    }
    sections.push(scheduleHtml);

    // Staff Instructions – same cascade as worker Assignment Details (account → location → job order → shift → assignment)
    const getStaffText = (section: string): string =>
      getEnglishStaffSectionText(section, mergedStaff, mergedStaffI18n, checkInFallback);
    const getStaffFiles = (section: string): any[] => mergedStaff[section]?.files ?? [];
    const staffSections: Array<{ title: string; text: string; files: any[] }> = [
      { title: 'First Day Instructions', text: getStaffText('firstDay'), files: getStaffFiles('firstDay') },
      { title: 'Parking Instructions', text: getStaffText('parking'), files: getStaffFiles('parking') },
      { title: 'Check-In Instructions', text: getStaffText('checkIn'), files: getStaffFiles('checkIn') },
      { title: 'Uniform Instructions', text: getStaffText('uniform'), files: getStaffFiles('uniform') },
      { title: 'Credential Instructions', text: getStaffText('credentials'), files: getStaffFiles('credentials') },
      { title: 'Other Instructions', text: getStaffText('other'), files: getStaffFiles('other') },
      { title: 'Other Attachments', text: '', files: getStaffFiles('attachments') },
    ];
    for (const sec of staffSections) {
      if (sec.text || (Array.isArray(sec.files) && sec.files.length > 0)) {
        let block = `<h2 style="margin:16px 0 8px 0; font-size:18px; font-weight:700;">${escapeHtml(sec.title)}</h2>`;
        if (sec.text) block += `<p style="margin:0 0 8px 0; color:#444; white-space:pre-wrap;">${nl2br(sec.text)}</p>`;
        if (Array.isArray(sec.files) && sec.files.length > 0) {
          block += '<p style="margin:8px 0 0 0;">' + sec.files.map((f: any) => {
            const label = f.label || f.name || 'View File';
            const url = typeof f.url === 'string' ? f.url : typeof f.downloadURL === 'string' ? f.downloadURL : '';
            const href = url && /^https?:\/\//i.test(url) ? url : url || '#';
            return `<a href="${escapeHtml(href)}" style="margin-right:8px; color:#1976d2;">${escapeHtml(label)}</a>`;
          }).join('') + '</p>';
        }
        sections.push(block);
      }
    }

    // Additional Notes
    if (a.notes && String(a.notes).trim()) {
      sections.push(`<h2 style="margin:16px 0 8px 0; font-size:18px; font-weight:700;">Additional Notes</h2><p style="margin:0 0 12px 0; color:#444; white-space:pre-wrap;">${nl2br(String(a.notes))}</p>`);
    }

    // Metadata
    const createdAt = toDate(a.createdAt);
    const updatedAt = toDate(a.updatedAt);
    if (createdAt || updatedAt) {
      let meta = '<p style="margin:16px 0 0 0; color:#666; font-size:12px;">';
      if (createdAt) meta += `Created: ${formatDateTime(createdAt)}<br>`;
      if (updatedAt) meta += `Last Updated: ${formatDateTime(updatedAt)}`;
      meta += '</p>';
      sections.push(meta);
    }

    // My Recruiter
    let recruiterHtml = '<h2 style="margin:16px 0 8px 0; font-size:18px; font-weight:700;">My Recruiter</h2>';
    if (recruiters.length > 0) {
      recruiterHtml += recruiters.map((r) => {
        let line = `<p style="margin:0 0 4px 0; font-weight:600;">${escapeHtml(r.displayName)}</p>`;
        if (r.phone) line += `<p style="margin:0 0 4px 0;"><a href="sms:${encodeURIComponent((r.phone || '').replace(/[^\d+]/g, ''))}" style="color:#1976d2;">${escapeHtml(r.phone)}</a></p>`;
        if (r.email) line += `<p style="margin:0 0 8px 0;"><a href="mailto:${encodeURIComponent(r.email)}" style="color:#1976d2;">${escapeHtml(r.email)}</a></p>`;
        return `<div style="margin-bottom:12px;">${line}</div>`;
      }).join('');
    } else {
      recruiterHtml += '<p style="margin:0 0 12px 0; color:#666;">No recruiter assigned to this job order. Reach out via Inbox if you need support.</p>';
    }
    sections.push(recruiterHtml);

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.5; color: #333; max-width: 600px; margin: 0 auto; padding: 24px;">
${sections.join('')}
<p style="margin-top:24px; font-size:12px; color:#666;">View this assignment in the app for the latest updates.</p>
</body>
</html>`;
    return { subject, html };
  } catch (err: any) {
    logger.error('buildAssignmentDetailsEmail failed', { tenantId, assignmentId, error: err?.message });
    return null;
  }
}
