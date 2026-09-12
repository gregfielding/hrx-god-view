/**
 * "Sending your Everee link now" has to be true (Greg 2026-09-11).
 *
 * Pattie S. replied to Marco's 1h text, he answered "sending your Everee link now", and nothing was
 * sent: `runPayrollOnboardingInviteResend` returned `payroll_not_applicable_or_no_url` (logged in
 * `onboarding_automation_dispatch` 23:20:29). Root cause is config — BOTH Everee entities
 * (`c1_events_llc`, `c1_select_llc`) have `payrollSettings: null` and no onboarding URL, so that
 * legacy path can only skip for them; real Everee invites go out at hire time through
 * `runEvereePayrollOnboardingInviteAfterOnCallProvision`, which builds an HRX payroll URL instead.
 *
 * So: try the real resend, and when it can't send, text the worker the HRX payroll page (the same
 * URL the hire-time invite uses) so the promise is kept. The Slack note always names the skip reason.
 *
 * Greg 2026-09-11 ("do option 1"): rather than hand-configuring `payrollSettings.onboardingUrl` on the
 * two Everee entities to switch the legacy path back on, the fallback now sends exactly what the
 * recruiter's own Resend button sends — `resolveWorkerOnboardingLink` for the URL and
 * `buildOnboardingReminderSmsBody` for the copy (see `resendOnboardingPayrollLinkCallable`). That gets
 * a 1099 C1 Events worker the contractor wording with no I-9 mention, and a W-2 worker the
 * "W-4, I-9, and payroll setup" wording, instead of one generic line for both. We reuse those two
 * functions rather than the callable itself, whose `canManageOnboarding` gate is meant for a signed-in
 * recruiter, not a persona. The ad-hoc payroll-page text below stays as the last resort.
 */
import * as admin from 'firebase-admin';

import { buildWorkerPayrollEvereeTenantUrl } from '../utils/workerUrls';
import { PERSONAS, smsSignature, type PersonaId } from './personas';

export interface PayrollInviteFallbackResult {
  /** One line for the Slack thread. */
  note: string;
  /** True when the worker got the payroll link by text (the invite itself did not send). */
  textedLink: boolean;
  /** True when the real Everee invite went out. */
  invited: boolean;
}

/** Pure: the text we send when the invite itself cannot go out. */
export function payrollLinkText(
  firstName: string,
  url: string,
  opts: { persona: PersonaId; lang?: 'en' | 'es' },
): string {
  const lang = opts.lang === 'es' ? 'es' : 'en';
  const name = String(firstName || '').trim();
  if (lang === 'es') {
    return `${name ? `Hola ${name}` : 'Hola'}, aquí está tu enlace para completar la nómina (depósito directo y formulario de impuestos): ${url} ${smsSignature(opts.persona, 'es')}`;
  }
  return `Hi ${name || 'there'}, here's your payroll setup link (direct deposit and tax form): ${url} ${smsSignature(opts.persona)}`;
}

/** The worker-facing payroll page for the entity's Everee tenant, or '' when the entity has none. */
export async function payrollUrlForEntity(
  db: admin.firestore.Firestore,
  tenantId: string,
  hiringEntityId: string,
): Promise<string> {
  const id = String(hiringEntityId || '').trim();
  if (!id) return '';
  const snap = await db.doc(`tenants/${tenantId}/entities/${id}`).get().catch(() => null);
  const evereeTenantId = String((snap?.data() as Record<string, unknown> | undefined)?.evereeTenantId ?? '').trim();
  return evereeTenantId ? buildWorkerPayrollEvereeTenantUrl(evereeTenantId) : '';
}

/** Pure: which reminder copy an entity gets. 1099 events workers must never be told to do an I-9. */
export function reminderVariantForEntityKey(entityKey: string): 'standard' | 'events' {
  return String(entityKey || '').trim().toLowerCase() === 'events' ? 'events' : 'standard';
}

/** Pure: the recruiter's copy, signed by the persona who promised in the thread to send it. */
export function signAsPersona(body: string, persona: PersonaId, lang?: 'en' | 'es'): string {
  const text = String(body || '').trim();
  const sig = smsSignature(persona, lang === 'es' ? 'es' : 'en');
  return !text || text.endsWith(sig) ? text : `${text}\n${sig}`;
}

/**
 * The same SMS the recruiter's Resend button sends, for this worker at this entity.
 * Returns null when the link or the copy can't be built — the caller then falls back to the
 * entity payroll page text below.
 */
export async function buildOnboardingResendSms(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  userId: string;
  hiringEntityId: string;
  firstName: string;
  persona: PersonaId;
  lang?: 'en' | 'es';
}): Promise<{ link: string; variant: 'standard' | 'events'; body: string } | null> {
  const entityId = String(args.hiringEntityId || '').trim();
  if (!entityId) return null;
  try {
    const [{ resolveWorkerOnboardingLink }, { buildOnboardingReminderSmsBody }, { deriveEntityKeyFromName }] =
      await Promise.all([
        import('../integrations/everee/resolveWorkerOnboardingLink'),
        import('../onboarding/processWorkerOnboardingReminders'),
        import('../onboarding/workerOnboardingPipeline'),
      ]);
    const snap = await args.db.doc(`tenants/${args.tenantId}/entities/${entityId}`).get();
    const data = (snap?.data() ?? {}) as Record<string, unknown>;
    // Entity docs predating the entityKey migration only have a name (same reconstruction the
    // callable does, minus its backfill write — a persona reply is not the place to repair data).
    const entityKey = String(data.entityKey || '').trim() || deriveEntityKeyFromName(String(data.name || ''));
    const variant = reminderVariantForEntityKey(entityKey);
    const { link } = await resolveWorkerOnboardingLink({
      tenantId: args.tenantId,
      entityId,
      pipelineId: `${args.userId}__${entityKey}`,
      context: 'personaPayrollInviteFallback',
    });
    if (!link) return null;
    const lang = args.lang === 'es' ? 'es' : 'en';
    const body = buildOnboardingReminderSmsBody(args.firstName, link, lang, variant);
    return { link, variant, body: signAsPersona(body, args.persona, lang) };
  } catch {
    return null;
  }
}

/**
 * Resend the payroll onboarding invite; if it skips or throws, text the worker the payroll link.
 * `sendSms` is the caller's sender (keeps Twilio out of here and makes this testable).
 */
export async function resendPayrollInviteOrTextLink(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  userId: string;
  hiringEntityId: string;
  assignmentId?: string | null;
  firstName: string;
  persona: PersonaId;
  lang?: 'en' | 'es';
  /** False when the message that just went out already carries the payroll link (C1 Events checkpoints). */
  textLinkWhenSkipped?: boolean;
  sendSms: (text: string, messageTypeId: string) => Promise<{ success: boolean; error?: string }>;
}): Promise<PayrollInviteFallbackResult> {
  let skipReason = '';
  try {
    const { runPayrollOnboardingInviteResend } = await import('../messaging/payrollInviteResend');
    const r = await runPayrollOnboardingInviteResend({
      tenantId: args.tenantId,
      userId: args.userId,
      hiringEntityId: args.hiringEntityId,
      initiatedByUid: args.persona,
      assignmentId: args.assignmentId ?? null,
    });
    if (r.ok) return { note: 'resent the Everee onboarding invite', textedLink: false, invited: true };
    skipReason = String((r as { skipReason?: string }).skipReason || 'not ok');
  } catch (e) {
    skipReason = `failed: ${String(e).slice(0, 100)}`;
  }

  if (args.textLinkWhenSkipped === false) {
    return {
      note: `the Everee invite couldn't send (${skipReason}) — the text they just got already carries the payroll link`,
      textedLink: false,
      invited: false,
    };
  }

  // What the recruiter's Resend button would have sent — right copy for W-2 vs 1099, right link.
  const resend = await buildOnboardingResendSms({
    db: args.db,
    tenantId: args.tenantId,
    userId: args.userId,
    hiringEntityId: args.hiringEntityId,
    firstName: args.firstName,
    persona: args.persona,
    lang: args.lang,
  });
  if (resend) {
    const sentResend = await args.sendSms(resend.body, `${PERSONAS[args.persona].smsPrefix}payroll_link`);
    return {
      note: sentResend.success
        ? `the Everee invite couldn't send (${skipReason}) — texted them the onboarding link instead (${resend.variant} copy): ${resend.link}`
        : `:warning: the Everee invite couldn't send (${skipReason}) and the onboarding link text failed (${sentResend.error || 'unknown'})`,
      textedLink: sentResend.success,
      invited: false,
    };
  }

  const url = await payrollUrlForEntity(args.db, args.tenantId, args.hiringEntityId);
  if (!url) {
    return {
      note: `:warning: couldn't resend the Everee invite (${skipReason}) and ${args.hiringEntityId} has no payroll URL on file — a recruiter has to send it`,
      textedLink: false,
      invited: false,
    };
  }
  const sent = await args.sendSms(
    payrollLinkText(args.firstName, url, { persona: args.persona, lang: args.lang }),
    `${PERSONAS[args.persona].smsPrefix}payroll_link`,
  );
  return {
    note: sent.success
      ? `the Everee invite couldn't send (${skipReason}) — texted them the payroll link instead: ${url}`
      : `:warning: the Everee invite couldn't send (${skipReason}) and the payroll link text failed (${sent.error || 'unknown'})`,
    textedLink: sent.success,
    invited: false,
  };
}
