/**
 * Pure rules for the Sodexo contact intro (sodexoContactIntro.ts) — no
 * Firebase imports so they unit-test in isolation.
 */
import { timezoneForState } from '../timesheets/importWorkedShiftComposer';

type Doc = Record<string, unknown>;

/** crm_companies / parent account ids every Sodexo JO carries (verified 2026-09-11 on 131 JOs). */
export const SODEXO_COMPANY_ID = '5VV6w7lFLRxJv3TEeu7M';
export const SODEXO_PARENT_ACCOUNT_ID = 'AKsctgcdwAZ8C7RUkgky';

/** Our own people are never "new Sodexo contacts". */
export const INTERNAL_EMAIL_DOMAINS = ['c1staffing.com', 'hrxone.com'];

/** Send window, contact-local (Greg 2026-09-11: "send in the morning not overnight"). */
export const SEND_WINDOW_START_HOUR = 8;
export const SEND_WINDOW_END_HOUR = 18;
/** Unknown worksite state: 8 AM Pacific is never overnight anywhere in the lower 48. */
export const DEFAULT_CONTACT_TZ = 'America/Los_Angeles';
/** Second email when nobody replied (Greg 2026-09-11). */
export const FOLLOW_UP_DELAY_MS = 48 * 60 * 60 * 1000;
/** A scheduled send this overdue (outage, template shipped days later) is dropped, never sent stale. */
export const MAX_LATE_MS = 24 * 60 * 60 * 1000;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function isSodexoJobOrder(jo: Doc | null | undefined): boolean {
  if (!jo) return false;
  if (str(jo.companyId) === SODEXO_COMPANY_ID) return true;
  if (str(jo.parentAccountId) === SODEXO_PARENT_ACCOUNT_ID) return true;
  // Child account names ("ADP - SAN DIMAS") never say Sodexo — only the
  // company / parent names are trusted here.
  return /\bsodexo\b/i.test(`${str(jo.companyName)} ${str(jo.parentAccountName)}`);
}

/** Every intro waits at least this long so a late fieldglass.candidateInMind stamp is seen before sending. */
export const INTRO_SETTLE_MS = 10 * 60 * 1000;

/** Fieldglass order where the hiring manager already has someone — no intro/follow-up (Greg 2026-09-11). */
export function isCandidateInMind(jo: Doc | null | undefined): boolean {
  return ((jo?.fieldglass ?? {}) as Doc).candidateInMind === true;
}

export function normalizeEmail(v: unknown): string {
  const e = str(v).toLowerCase();
  return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/.test(e) ? e : '';
}

export function isInternalEmail(email: string): boolean {
  const domain = email.split('@')[1] ?? '';
  return INTERNAL_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export interface JoContactRef {
  id: string;
  email: string;
  firstName: string;
  fullName: string;
}

/**
 * Contacts on the JO's Deal Contacts card — `deal.associations.contacts`,
 * written as `{ id, snapshot }` by both the Fieldglass hiring-manager
 * attach and the recruiter UI (RecruiterJobOrderDetail handleContactsChange).
 * Bare id strings are tolerated for legacy rows.
 */
export function jobOrderContacts(jo: Doc | null | undefined): JoContactRef[] {
  const deal = (jo?.deal ?? {}) as Doc;
  const raw = ((deal.associations ?? {}) as Doc).contacts;
  if (!Array.isArray(raw)) return [];
  const out: JoContactRef[] = [];
  for (const c of raw) {
    if (typeof c === 'string') {
      if (c.trim()) out.push({ id: c.trim(), email: '', firstName: '', fullName: '' });
      continue;
    }
    const o = (c ?? {}) as Doc;
    const snap = (o.snapshot ?? {}) as Doc;
    const ref: JoContactRef = {
      id: str(o.id),
      email: normalizeEmail(snap.email ?? o.email),
      firstName: str(snap.firstName ?? o.firstName),
      fullName: str(snap.fullName ?? o.fullName),
    };
    if (ref.id || ref.email) out.push(ref);
  }
  return out;
}

/** Contacts present after the write that weren't there before it. */
export function newlyAddedContacts(before: Doc | null | undefined, after: Doc | null | undefined): JoContactRef[] {
  const prior = jobOrderContacts(before);
  const priorIds = new Set(prior.map((c) => c.id).filter(Boolean));
  const priorEmails = new Set(prior.map((c) => c.email).filter(Boolean));
  const seen = new Set<string>();
  return jobOrderContacts(after).filter((c) => {
    const key = c.id || c.email;
    if (seen.has(key)) return false;
    seen.add(key);
    // Editing an existing contact's snapshot keeps its id — not "new".
    if (c.id) return !priorIds.has(c.id);
    return !priorEmails.has(c.email);
  });
}

/** Why a CRM contact must not get an automated email, or null when clear. */
export function contactBlockReason(contact: Doc | null | undefined): string | null {
  if (!contact) return null;
  if (contact.emailBounced === true) return 'email_bounced';
  if (contact.optedOut === true || contact.unsubscribed === true) return 'opted_out';
  if (contact.doNotContact === true || contact.doNotEmail === true) return 'do_not_contact';
  for (const campaign of ['sodexoOutreach', 'crmReengagement']) {
    if (((contact[campaign] ?? {}) as Doc).optedOut === true) return 'opted_out';
  }
  return null;
}

export function toMillis(v: unknown): number | null {
  if (v == null || v === '') return null;
  const o = v as { toMillis?: () => number; seconds?: number; _seconds?: number };
  if (typeof o.toMillis === 'function') return o.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string' || typeof v === 'number') {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  }
  const secs = o.seconds ?? o._seconds;
  return typeof secs === 'number' ? secs * 1000 : null;
}

// ── Send window ─────────────────────────────────────────────────────────

/** The contact's timezone, from the JO worksite state. */
export function contactTimeZone(jo: Doc): string {
  const addr = (jo.worksiteAddress ?? {}) as Doc;
  return timezoneForState(str(addr.state) || str(jo.worksiteState)) ?? DEFAULT_CONTACT_TZ;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function localParts(ms: number, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute') };
}

/** UTC ms for a wall-clock hour on a local date in `tz` (DST-safe). */
function wallTimeToUtc(year: number, month: number, day: number, hour: number, tz: string): number {
  const target = Date.UTC(year, month - 1, day, hour, 0);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, tz);
    const diff = target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

export function isWithinSendWindow(ms: number, tz: string): boolean {
  const { hour } = localParts(ms, tz);
  return hour >= SEND_WINDOW_START_HOUR && hour < SEND_WINDOW_END_HOUR;
}

/** `ms` itself when inside the window, otherwise the next 8:00 AM contact-local. */
export function nextSendTime(ms: number, tz: string): number {
  const p = localParts(ms, tz);
  if (p.hour >= SEND_WINDOW_START_HOUR && p.hour < SEND_WINDOW_END_HOUR) return ms;
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + (p.hour >= SEND_WINDOW_END_HOUR ? 1 : 0)));
  return wallTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), SEND_WINDOW_START_HOUR, tz);
}

export function followUpDueAt(introSentMs: number, tz: string): number {
  return nextSendTime(introSentMs + FOLLOW_UP_DELAY_MS, tz);
}

// ── Reply detection ─────────────────────────────────────────────────────

export interface MailSummary {
  id: string;
  from: string;
  to: string;
  internalDateMs: number;
  /** Auto-Submitted / out-of-office — not a human reply. */
  autoReply: boolean;
}

export type ReplyState = 'replied' | 'bounced' | 'deborah_engaged' | 'none';

/**
 * What happened since the intro went out, from Deborah's mailbox (the
 * intro's thread + anything from/to the contact outside it). A human reply
 * wins; then a bounce; then Deborah having written them again herself.
 * Out-of-office auto-replies don't count — the follow-up still goes.
 */
export function classifyReplyState(
  messages: MailSummary[],
  p: { selfEmail: string; ourMessageIds: string[]; sinceMs: number },
): ReplyState {
  const self = p.selfEmail.toLowerCase();
  let replied = false;
  let bounced = false;
  let engaged = false;
  for (const m of messages) {
    if (!m.id || p.ourMessageIds.includes(m.id)) continue;
    if (m.internalDateMs && m.internalDateMs < p.sinceMs - 60_000) continue;
    const from = m.from.toLowerCase();
    if (/mailer-daemon|postmaster/.test(from)) bounced = true;
    else if (from.includes(self)) engaged = true;
    else if (!m.autoReply) replied = true;
  }
  if (replied) return 'replied';
  if (bounced) return 'bounced';
  if (engaged) return 'deborah_engaged';
  return 'none';
}

// ── Template ────────────────────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-09-15" → "September 15" (parsed by parts — no timezone drift). */
export function formatStartDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : '';
}

/** Merge fields available to the templates as {{name}}. */
export function introTemplateVars(jo: Doc, contact: { firstName?: string; fullName?: string }): Record<string, string> {
  const addr = (jo.worksiteAddress ?? {}) as Doc;
  const fullName = str(contact.fullName);
  const firstName = str(contact.firstName) || fullName.split(/\s+/)[0] || '';
  return {
    firstName: firstName || 'there',
    fullName,
    jobTitle: str(jo.jobTitle),
    siteName: str(jo.worksiteName) || str(jo.locationName) || str(jo.accountName),
    city: str(addr.city),
    state: str(addr.state),
    startDate: formatStartDate(str(jo.startDate)),
    poNumber: str(jo.poNumber),
    jobOrderNumber: jo.jobOrderNumber != null ? String(jo.jobOrderNumber) : '',
    headcount: jo.workersNeeded != null ? String(jo.workersNeeded) : '',
  };
}

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? '');
}

/** Merge fields the template uses that would render blank for these vars. */
export function emptyPlaceholders(tpl: string, vars: Record<string, string>): string[] {
  const out = new Set<string>();
  const re = /\{\{\s*(\w+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl))) if (!vars[m[1]]) out.add(m[1]);
  return [...out];
}

/** Follow-up subject: an explicit one, else "Re: <intro subject>" (keeps the recipient's thread intact). */
export function followUpSubject(introSubject: string, override?: string): string {
  if (override && override.trim()) return override.trim();
  return /^re:/i.test(introSubject.trim()) ? introSubject.trim() : `Re: ${introSubject.trim()}`;
}

/** Firestore doc id for the per-email ledger row. */
export function introLedgerId(email: string): string {
  return email.replace(/\//g, '_');
}
