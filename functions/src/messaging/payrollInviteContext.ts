/**
 * Shared resolution for payroll onboarding invite (automation + resend callables).
 */
import * as admin from 'firebase-admin';

const db = admin.firestore();

export type PayrollSettingsShape = {
  provider?: string;
  mode?: string;
  onboardingUrl?: string | null;
  portalUrl?: string | null;
};

/** Fallback when entity doc + entity_employments have no stable key. */
export function deriveEntityKeyFromName(rawName: string): string {
  const v = String(rawName || '').toLowerCase();
  if (v.includes('select')) return 'select';
  if (v.includes('event')) return 'events';
  return 'workforce';
}

/**
 * Prefer: entities/{id}.entityKey → entity_employments (userId + entityId) → name heuristic.
 */
export async function resolveEntityKeyForWorkerPayroll(args: {
  tenantId: string;
  userId: string;
  hiringEntityId: string;
  entityDoc: Record<string, unknown>;
}): Promise<string> {
  const fromDoc = String(args.entityDoc.entityKey || '').trim();
  if (fromDoc) return fromDoc;

  try {
    const q = await db
      .collection(`tenants/${args.tenantId}/entity_employments`)
      .where('userId', '==', args.userId)
      .where('entityId', '==', args.hiringEntityId)
      .limit(1)
      .get();
    if (!q.empty) {
      const ek = String(q.docs[0].data()?.entityKey || '').trim();
      if (ek) return ek;
    }
  } catch {
    /* ignore */
  }

  const name = String(
    args.entityDoc.name || args.entityDoc.legalName || args.entityDoc.title || ''
  );
  return deriveEntityKeyFromName(name);
}

export async function resolveHiringEntityId(
  tenantId: string,
  assignment: Record<string, unknown> | null,
  hiringEntityIdDirect?: string | null
): Promise<string | null> {
  if (hiringEntityIdDirect) return hiringEntityIdDirect;
  if (!assignment) return null;
  const direct = (assignment.hiringEntityId as string) || (assignment.entityId as string) || null;
  if (direct) return direct;
  const jobOrderId = assignment.jobOrderId as string | undefined;
  if (!jobOrderId) return null;
  const joSnap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
  if (!joSnap.exists) return null;
  const jo = joSnap.data() || {};
  return (jo.hiringEntityId as string) || (jo.entityId as string) || null;
}

export function resolvePayrollOnboardingUrl(ps: PayrollSettingsShape | null | undefined): string | null {
  if (!ps) return null;
  const u = (ps.onboardingUrl || ps.portalUrl || '').trim();
  return u || null;
}

/** Distinct entity URLs for messaging and UIs (TempWorks onboarding vs login portal). */
export function payrollEntityUrls(ps: PayrollSettingsShape | null | undefined): {
  signupUrl: string | null;
  portalLoginUrl: string | null;
} {
  if (!ps) return { signupUrl: null, portalLoginUrl: null };
  const signupUrl = String(ps.onboardingUrl || '').trim() || null;
  const portalLoginUrl = String(ps.portalUrl || '').trim() || null;
  return { signupUrl, portalLoginUrl };
}

export function isPayrollAutomationApplicable(ps: PayrollSettingsShape | null | undefined, url: string | null): boolean {
  if (!url) return false;
  if (!ps) return false;
  const provider = String(ps.provider || '').toLowerCase();
  if (provider === 'manual' || provider === 'none') return false;
  const mode = String(ps.mode || '').toLowerCase();
  if (mode === 'manual_tracking') return false;
  return true;
}

export function isWorkerPayrollSatisfied(data: admin.firestore.DocumentData | undefined): boolean {
  if (!data) return false;
  const status = String(data.payrollStatus || '');
  if (status === 'complete') return true;
  if (data.payrollSetupCompletedAt) return true;
  if (status === 'account_created') return true;
  return false;
}

/** True when we should not send another automated payroll invite (complete or invite already in flight). */
export function shouldSkipAutomatedPayrollInvite(data: admin.firestore.DocumentData | undefined): boolean {
  if (isWorkerPayrollSatisfied(data)) return true;
  const status = String(data?.payrollStatus || '').toLowerCase();
  if (status === 'invite_sent' || status === 'in_progress') return true;
  return false;
}

/** Admin manual resend: only block when payroll is already satisfied (completed / account ready). */
export function shouldBlockPayrollInviteResend(data: admin.firestore.DocumentData | undefined): boolean {
  return isWorkerPayrollSatisfied(data);
}

export async function loadEntityPayrollInviteContext(
  tenantId: string,
  hiringEntityId: string,
  userId: string
) {
  const entitySnap = await db.doc(`tenants/${tenantId}/entities/${hiringEntityId}`).get();
  const entity = entitySnap.exists ? entitySnap.data() || {} : {};
  const entityName = String(entity.name || entity.legalName || entity.title || 'your employer');
  const payrollSettings = (entity.payrollSettings || null) as PayrollSettingsShape | null;
  const provider = payrollSettings?.provider ?? (entity.payrollProvider as string | undefined) ?? null;
  const mergedSettings: PayrollSettingsShape = {
    ...payrollSettings,
    provider: payrollSettings?.provider ?? provider ?? undefined,
  };
  const onboardingUrl = resolvePayrollOnboardingUrl(mergedSettings);
  const entityKey = await resolveEntityKeyForWorkerPayroll({
    tenantId,
    userId,
    hiringEntityId,
    entityDoc: entity,
  });
  return { entityName, mergedSettings, onboardingUrl, provider, entityKey, entity };
}
