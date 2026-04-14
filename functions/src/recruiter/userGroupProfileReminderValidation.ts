/**
 * Guards for user-group bulk profile update SMS (prepare + send).
 * Targets workers who still fail aiPrescreen eligibility (evaluator “needs profile update” bucket).
 */
import { evaluateAiPrescreenEligibility, userDocHasUsablePhone } from '../workerAiPrescreen/evaluateAiPrescreenEligibility';
import { buildWorkerProfileUrl } from '../utils/workerUrls';
import {
  c1EmploymentBlocksInvite,
  isC1SelectEmployment,
  isWithinMs,
  norm,
  phoneE164FromUser,
  prescreenAutomatedSmsCooldownReasons,
} from './userGroupInterviewInviteValidation';

/** Align with evaluator warning window for profileUpdateReminderLastSentAt */
export const PROFILE_REMINDER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const TERMINAL_EXCLUDED = new Set(['rejected', 'withdrawn']);
const BLOCKING_EMPLOYMENT = new Set(['active', 'onboarding', 'hired', 'offer_pending', 'pending', 'in_progress']);
const LIFECYCLE_SUPPRESS = new Set([
  'qualified',
  'review',
  'waitlisted',
  'hired',
  'onboarding',
  'interview_pending',
]);

function getMaxTenantSecurityLevel(userData: Record<string, unknown>, tenantId: string): number {
  const top = Number.parseInt(String(userData.securityLevel ?? '0'), 10);
  const t = userData.tenantIds as Record<string, { securityLevel?: string | number }> | undefined;
  const te = t?.[tenantId]?.securityLevel;
  const tl = Number.parseInt(String(te ?? '0'), 10);
  return Math.max(Number.isFinite(top) ? top : 0, Number.isFinite(tl) ? tl : 0);
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

export function profileUpdateReminderCooldownReason(userData: Record<string, unknown>): string | null {
  if (isWithinMs(userData.profileUpdateReminderLastSentAt, PROFILE_REMINDER_COOLDOWN_MS)) {
    return 'Profile reminder sent within last 7 days (user.profileUpdateReminderLastSentAt)';
  }
  return null;
}

const ELIG_MISSING_FIELD_LABELS: Record<string, string> = {
  phone: 'phone number',
  location: 'location',
  resume_or_skill: 'experience',
  work_authorization: 'work authorization',
};

/** Human-readable labels for UI / SMS (comma-separated phrase for templates). */
export function mapEligibilityMissingFieldsToLabels(missingFields: string[]): string[] {
  return missingFields.map((k) => ELIG_MISSING_FIELD_LABELS[k] || k);
}

/** Comma list for SMS body interpolation. */
export function mapEligibilityMissingFieldsToDisplay(missingFields: string[]): string {
  if (missingFields.length === 0) return 'your profile details';
  return mapEligibilityMissingFieldsToLabels(missingFields).join(', ');
}

/**
 * User-group profile reminder SMS (EN/ES). Spec: include what’s missing + profile link.
 */
export function buildProfileReminderSmsBody(
  firstName: string,
  link: string,
  missingFieldsDisplay: string,
  lang: 'en' | 'es',
): string {
  if (lang === 'es') {
    return `Hola ${firstName}, nos gustaría continuar contigo, pero necesitamos que actualices tu perfil (${missingFieldsDisplay}). Complétalo aquí: ${link}.`;
  }
  return `Hi ${firstName}, we'd like to move forward with you, but need a quick update to your profile (${missingFieldsDisplay}). Please complete it here: ${link}.`;
}

export function buildProfileReminderSmsBodyBilingualTemplate(): string {
  const link = buildWorkerProfileUrl();
  const en = buildProfileReminderSmsBody('{{firstName}}', link, '{{missingFields}}', 'en');
  const es = buildProfileReminderSmsBody('{{firstName}}', link, '{{missingFields}}', 'es');
  return `[EN] ${en}\n[ES] ${es}`;
}

export type ProfileReminderHardCheck = { ok: boolean; blockReasons: string[] };

/**
 * Worker must still need profile (ineligible for prescreen interview), with optional application checks.
 */
export function hardValidateProfileReminderCandidate(args: {
  tenantId: string;
  groupMemberIds: string[];
  userId: string;
  userData: Record<string, unknown> | undefined;
  applicationData: Record<string, unknown> | undefined;
  applicationId: string | null;
  groupId: string;
  allowNonGroupApplication: boolean;
  employments: Array<Record<string, unknown>>;
  c1SelectEntityId: string | null;
  eligOpts: {
    requireResumeOrSkill: boolean;
    requirePhone: boolean;
    requireLocation: boolean;
    requireWorkAuthorization: boolean;
  };
}): ProfileReminderHardCheck {
  const {
    tenantId,
    groupMemberIds,
    userId,
    userData,
    applicationData,
    applicationId,
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

  const elig = evaluateAiPrescreenEligibility(userData, eligOpts);
  if (elig.eligibleForInterview) {
    blockReasons.push('Worker already meets profile eligibility — use “Send interview invites” instead');
    return { ok: false, blockReasons };
  }

  if (applicationId && !applicationData) {
    blockReasons.push('Application not found');
    return { ok: false, blockReasons };
  }

  if (applicationId && applicationData) {
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
    if (stage && LIFECYCLE_SUPPRESS.has(stage)) {
      blockReasons.push(`Hiring lifecycle stage “${stage}” (outreach suppressed)`);
      return { ok: false, blockReasons };
    }

    if (app.workerAiPrescreenInterviewCompletedAt) {
      blockReasons.push('AI prescreen interview already completed on this application');
      return { ok: false, blockReasons };
    }
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

  return { ok: true, blockReasons };
}

export function profileCooldownWarnings(userData: Record<string, unknown>, app: Record<string, unknown> | undefined): string[] {
  const w: string[] = [];
  const pr = profileUpdateReminderCooldownReason(userData);
  if (pr) w.push(pr);
  if (app) w.push(...prescreenAutomatedSmsCooldownReasons(app));
  return w;
}
