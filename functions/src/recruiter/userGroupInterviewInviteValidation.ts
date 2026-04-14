/**
 * Shared guards for user-group interview invite (prepare + send revalidation).
 */
import { evaluateAiPrescreenEligibility, userDocHasUsablePhone } from '../workerAiPrescreen/evaluateAiPrescreenEligibility';
import { resolveAiPrescreenTenantPolicy } from '../workerAiPrescreen/aiPrescreenJobSlice';

export const INTERVIEW_INVITE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const PRESCREEN_AUTOMATED_SMS_COOLDOWN_MS = 72 * 60 * 60 * 1000;

export function norm(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase();
}

export function tsMillis(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'object' && v !== null && 'toMillis' in v && typeof (v as { toMillis: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

export function isWithinMs(v: unknown, ms: number): boolean {
  const t = tsMillis(v);
  if (t == null) return false;
  return Date.now() - t < ms;
}

const TERMINAL_EXCLUDED = new Set(['rejected', 'withdrawn']);
const BLOCKING_EMPLOYMENT = new Set(['active', 'onboarding', 'hired', 'offer_pending', 'pending', 'in_progress']);

const LIFECYCLE_SUPPRESS_INVITE = new Set([
  'qualified',
  'review',
  'waitlisted',
  'hired',
  'onboarding',
  'interview_pending',
]);

const BLOCKING_C1_STATUSES = new Set(['active', 'onboarding', 'hired', 'offer_pending', 'pending', 'in_progress']);

export function resolveC1SelectEntityId(
  entities: Array<{ id: string; name: string; entityCode?: string }>,
): string | null {
  const byCode = entities.find((e) => (e.entityCode || '').trim().toUpperCase() === 'C1SL');
  if (byCode) return byCode.id;
  const found =
    entities.find((e) => {
      const n = e.name.trim().toLowerCase();
      return n === 'c1 select llc' || /^c1\s+select\b/i.test(e.name.trim());
    }) ?? null;
  return found?.id ?? null;
}

export function isC1SelectEmployment(rec: Record<string, unknown>, c1EntityId: string | null): boolean {
  const ek = norm(rec.entityKey);
  if (ek === 'select') return true;
  const eid = String(rec.entityId || '').trim();
  if (c1EntityId && eid && eid === c1EntityId) return true;
  return false;
}

export function c1EmploymentBlocksInvite(rec: Record<string, unknown>): { blocks: boolean; detail: string } {
  const st = norm(rec.status || rec.employmentState);
  if (st && BLOCKING_C1_STATUSES.has(st)) {
    return { blocks: true, detail: `C1 Select employment status “${st}”` };
  }
  return { blocks: false, detail: '' };
}

function anyEmploymentBlocks(records: Array<Record<string, unknown>>): { blocks: boolean; detail: string } {
  for (const rec of records) {
    const st = norm(rec.status || rec.employmentState);
    if (st && BLOCKING_EMPLOYMENT.has(st)) {
      return { blocks: true, detail: `Entity employment status “${st}” (${String(rec.entityKey || rec.entityId || '')})` };
    }
  }
  return { blocks: false, detail: '' };
}

/** Prescreen automation SMS timestamps — any within 72h triggers cooldown skip/warning. */
const PRESCREEN_SMS_FIELDS: Array<keyof Record<string, unknown>> = [
  'workerAiPrescreenReminderSentAt',
  'workerAiPrescreenChase1SentAt',
  'workerAiPrescreenChase2SentAt',
  'workerAiPrescreenFollowUpInviteSentAt',
];

export function prescreenAutomatedSmsCooldownReasons(app: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of PRESCREEN_SMS_FIELDS) {
    const v = app[k];
    if (isWithinMs(v, PRESCREEN_AUTOMATED_SMS_COOLDOWN_MS)) {
      out.push(`Automated prescreen SMS field “${String(k)}” within last 72 hours`);
    }
  }
  return out;
}

export function interviewInviteCooldownReason(app: Record<string, unknown>): string | null {
  if (isWithinMs(app.userGroupInterviewInviteLastSentAt, INTERVIEW_INVITE_COOLDOWN_MS)) {
    return 'Interview invite sent within last 7 days (application.userGroupInterviewInviteLastSentAt)';
  }
  return null;
}

export function phoneE164FromUser(data: Record<string, unknown>): string {
  const e = String(data.phoneE164 || '').trim();
  if (/^\+[1-9]\d{7,14}$/.test(e)) return e;
  const digits = String(data.phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

export type InterviewInviteHardCheck = {
  ok: boolean;
  blockReasons: string[];
};

function getMaxTenantSecurityLevel(userData: Record<string, unknown>, tenantId: string): number {
  const top = Number.parseInt(String(userData.securityLevel ?? '0'), 10);
  const t = userData.tenantIds as Record<string, { securityLevel?: string | number }> | undefined;
  const te = t?.[tenantId]?.securityLevel;
  const tl = Number.parseInt(String(te ?? '0'), 10);
  return Math.max(Number.isFinite(top) ? top : 0, Number.isFinite(tl) ? tl : 0);
}

/**
 * Structural + eligibility checks (no cooldowns). Used before selecting recipients.
 */
export function hardValidateInterviewInviteCandidate(args: {
  tenantId: string;
  groupMemberIds: string[];
  userId: string;
  userData: Record<string, unknown> | undefined;
  applicationData: Record<string, unknown> | undefined;
  groupId: string;
  /** When true, application docs do not need `groupId === groupId` (membership-only groups may use latest tenant application). */
  allowNonGroupApplication?: boolean;
  employments: Array<Record<string, unknown>>;
  c1SelectEntityId: string | null;
  eligOpts: {
    requireResumeOrSkill: boolean;
    requirePhone: boolean;
    requireLocation: boolean;
    requireWorkAuthorization: boolean;
  };
}): InterviewInviteHardCheck {
  const {
    tenantId,
    groupMemberIds,
    userId,
    userData,
    applicationData,
    groupId,
    allowNonGroupApplication,
    employments,
    c1SelectEntityId,
    eligOpts,
  } = args;
  const blockReasons: string[] = [];

  if (!groupMemberIds.includes(userId)) {
    blockReasons.push('User is no longer a member of this group');
    return { ok: false, blockReasons };
  }

  if (!userData) {
    blockReasons.push('User document not found');
    return { ok: false, blockReasons };
  }

  if (getMaxTenantSecurityLevel(userData, tenantId) >= 5) {
    blockReasons.push('Internal / staff-level user (security level ≥ 5)');
    return { ok: false, blockReasons };
  }

  if (!applicationData) {
    blockReasons.push('Application not found');
    return { ok: false, blockReasons };
  }

  const app = applicationData;
  if (!allowNonGroupApplication && String(app.groupId || '').trim() !== groupId) {
    blockReasons.push('Application is not linked to this groupId');
    return { ok: false, blockReasons };
  }

  const uidOnApp = String(app.userId || app.candidateId || '').trim();
  if (uidOnApp !== userId) {
    blockReasons.push('Application userId does not match member');
    return { ok: false, blockReasons };
  }

  const appStatus = norm(app.status);
  if (TERMINAL_EXCLUDED.has(appStatus)) {
    blockReasons.push(`Application status excluded (${appStatus})`);
    return { ok: false, blockReasons };
  }

  if (appStatus === 'accepted') {
    blockReasons.push('Application already accepted');
    return { ok: false, blockReasons };
  }

  const hl = app.hiringLifecycle as { stage?: string } | undefined;
  const stage = norm(hl?.stage);
  if (stage && LIFECYCLE_SUPPRESS_INVITE.has(stage)) {
    blockReasons.push(`Hiring lifecycle stage “${stage}” (outreach suppressed)`);
    return { ok: false, blockReasons };
  }

  if (app.workerAiPrescreenInterviewCompletedAt) {
    blockReasons.push('AI prescreen interview already completed');
    return { ok: false, blockReasons };
  }

  const emBlock = anyEmploymentBlocks(employments);
  if (emBlock.blocks) {
    blockReasons.push(emBlock.detail);
    return { ok: false, blockReasons };
  }

  for (const rec of employments) {
    if (!isC1SelectEmployment(rec, c1SelectEntityId)) continue;
    const c1b = c1EmploymentBlocksInvite(rec);
    if (c1b.blocks) {
      blockReasons.push(`Already in C1 Select flow: ${c1b.detail}`);
      return { ok: false, blockReasons };
    }
  }

  const elig = evaluateAiPrescreenEligibility(userData, eligOpts);
  if (!elig.eligibleForInterview) {
    blockReasons.push(`Profile eligibility: ${elig.reason}`);
    return { ok: false, blockReasons };
  }

  if (!userDocHasUsablePhone(userData)) {
    blockReasons.push('No valid SMS target (phone missing or unusable)');
    return { ok: false, blockReasons };
  }

  const phone = phoneE164FromUser(userData);
  if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) {
    blockReasons.push('Phone is not a valid E.164 SMS target');
    return { ok: false, blockReasons };
  }

  if (userData.smsOptIn === false) {
    blockReasons.push('User opted out of SMS (smsOptIn=false)');
    return { ok: false, blockReasons };
  }

  if (userData.smsBlockedSystem === true) {
    blockReasons.push('SMS blocked (STOP / system opt-out)');
    return { ok: false, blockReasons };
  }

  return { ok: true, blockReasons };
}

export function tenantEligOpts(tenantData: Record<string, unknown>) {
  const prescreenPolicy = resolveAiPrescreenTenantPolicy(tenantData);
  return {
    requireResumeOrSkill: prescreenPolicy.eligibility.requireResumeOrSkill,
    requirePhone: prescreenPolicy.eligibility.requirePhone,
    requireLocation: prescreenPolicy.eligibility.requireLocation,
    requireWorkAuthorization: prescreenPolicy.eligibility.requireWorkAuthorization,
  };
}

export function firstNameFromUser(ud: Record<string, unknown>): string {
  return (
    String(ud.firstName || (String(ud.displayName || '').trim().split(/\s+/)[0] || '') || 'there').trim() || 'there'
  );
}

/** Matches prescreen / worker SMS: `users.preferredLanguage` es → Spanish. */
export function workerInterviewInviteLang(ud: Record<string, unknown> | null | undefined): 'en' | 'es' {
  return String(ud?.preferredLanguage || 'en').toLowerCase() === 'es' ? 'es' : 'en';
}

/**
 * Interview invite SMS (user-group flow). English default; Spanish when `lang === 'es'`.
 */
export function buildInterviewInviteSmsBody(
  firstName: string,
  applicationId: string,
  link: string,
  lang: 'en' | 'es' = 'en',
): string {
  void applicationId;
  if (lang === 'es') {
    return `Hola ${firstName}, nos gustaría seguir adelante contigo para próximas oportunidades de trabajo. Completa tu breve entrevista aquí: ${link}. Responde si necesitas ayuda.`;
  }
  return `Hi ${firstName}, we'd like to move forward with you for upcoming work opportunities. Please complete your short interview here: ${link}. Reply if you need help.`;
}

/** Placeholder preview for UI/audit (both languages). */
export function buildInterviewInviteSmsBodyBilingualTemplate(): string {
  const en = buildInterviewInviteSmsBody('{{firstName}}', '{{applicationId}}', '{{link}}', 'en');
  const es = buildInterviewInviteSmsBody('{{firstName}}', '{{applicationId}}', '{{link}}', 'es');
  return `[EN] ${en}\n[ES] ${es}`;
}
