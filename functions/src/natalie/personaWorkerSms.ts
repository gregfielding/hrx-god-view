/**
 * Workers and applicants texting a persona's own number (Greg 2026-09-11: both voice lines now say "please
 * text this number" — "build it for both Marco and Natalie"). The persona whose number was texted answers.
 *
 * Guardrails (the reason this is not the Slack agent):
 *   - No tools for the model. It gets a CONTEXT block of the texter's OWN data only (applications, shifts,
 *     open onboarding items, background-check stage, preferred language) and returns JSON: a reply plus at
 *     most three actions (resend_background_link, resend_everee_invite, escalate).
 *   - Identity: every text starts with a user search (phoneE164 + raw `phone` formats). Personal data only when
 *     that resolves to exactly ONE tenant member. Shared numbers (346 phones are shared): the persona asks for
 *     their full name and identifies the one account on that number whose first AND last name they texted.
 *     Unknown numbers: users are searched by any email they text. Greg 2026-09-11: "have the persona answer
 *     those directly to verify and don't bother slack with that" — an email that matches EXACTLY ONE tenant
 *     member identifies them and they get their own context (accepted risk: someone who knows a worker's
 *     email can ask about that worker's shifts/onboarding by text). Two or more matches stay anonymous.
 *   - Existing flows keep priority (inboundSmsWebhook): STOP/HELP, cadence confirmations, offer YES and
 *     onboarding conversations are handled before a text is queued here. Our own numbers never get a reply.
 *   - At most RATE_MAX replies per phone per hour (loops with auto-responders, abuse).
 *   - Every exchange posts in a daily thread in the persona's Slack channel and on the worker's activity feed.
 *   - Kill switch: tenants/{T}/app_config/natalie.workerSmsConversations === false.
 *
 * Flow: handleInboundSms → enqueueWorkerPersonaSms → persona_worker_sms_inbox/{MessageSid} →
 * drainWorkerPersonaSms (natalieSlackInbox tick) → reply `{prefix}worker_reply` from the persona's number.
 * History: persona_sms_threads/{persona}__{phone}.workerTurns.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import Anthropic from '@anthropic-ai/sdk';
import { NATALIE_MODEL } from './natalieAgent';
import { PERSONAS, smsSignature, tokenFor, workerLanguage, type PersonaId, type PersonaTokens } from './personas';
import { normalizeUsPhone, personaForNumber } from './personaConversations';
import { postAsNatalie } from '../messaging/slackAsNatalie';
import { recordNatalieAction } from './natalieAudit';
import { PUBLIC_APP_ORIGIN } from '../config/appOrigin';

const db = () => admin.firestore();
const TENANT = 'BCiP2bQ9CgVOCTfV6MhD';
const INBOX = 'persona_worker_sms_inbox';
const THREADS = 'persona_sms_threads';
const DAY_THREADS = 'persona_worker_sms_threads';
const C1_MESSAGING_NUMBER = '+18888058650';
export const RATE_MAX = 8;
const HOUR = 3600_000;

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const KEYWORD_RE = /^\s*(stop|stopall|unsubscribe|end|quit|revoke|optout|cancel|help|info|start|unstop)\s*[.!]*\s*$/i;

/** Called by the inbound SMS webhook for texts that no earlier handler claimed. */
export async function enqueueWorkerPersonaSms(input: { from: unknown; to: unknown; body: string; messageSid?: string; techIssueFlagged?: boolean }): Promise<boolean> {
  const persona = personaForNumber(input.to);
  if (!persona) return false;
  const from = normalizeUsPhone(input.from);
  const ownNumbers = [...Object.values(PERSONAS).map((p) => p.fromNumber), C1_MESSAGING_NUMBER];
  if (!from || ownNumbers.includes(from)) return false;
  const body = s(input.body);
  if (!body || KEYWORD_RE.test(body)) return false;
  const cfg = (await db().doc(`tenants/${TENANT}/app_config/natalie`).get()).data() ?? {};
  if (cfg.workerSmsConversations === false) return false;
  const ref = input.messageSid ? db().collection(INBOX).doc(String(input.messageSid)) : db().collection(INBOX).doc();
  await ref.set({
    persona, fromE164: from, text: body.slice(0, 1600), techIssueFlagged: input.techIssueFlagged === true,
    status: 'pending', createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return true;
}

export type SenderMatch =
  | { kind: 'worker'; uid: string; user: Record<string, unknown> }
  | { kind: 'unknown' }
  | { kind: 'ambiguous'; count: number };

/** Pure: who is texting, from the users whose phoneE164 matched. Personal data only for exactly one tenant member. */
export function classifySender(matches: Array<{ id: string; data: Record<string, unknown> }>, tenantId: string): SenderMatch {
  const people = matches.filter((m) => m.data.isAutomationPersona !== true);
  if (people.length === 0) return { kind: 'unknown' };
  if (people.length > 1) return { kind: 'ambiguous', count: people.length };
  const m = people[0];
  const tenants = m.data.tenantIds && typeof m.data.tenantIds === 'object' ? Object.keys(m.data.tenantIds as object) : [];
  if (!tenants.includes(tenantId) && s(m.data.tenantId) !== tenantId && s(m.data.activeTenantId) !== tenantId) return { kind: 'unknown' };
  return { kind: 'worker', uid: m.id, user: m.data };
}

/** Pure: the ways a US number is commonly stored in users.phone (phoneE164 is often missing — Rosa has only "(512) …"). */
export function phoneFormatVariants(e164: string): string[] {
  const d = e164.replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return [];
  const [a, b, c] = [d.slice(0, 3), d.slice(3, 6), d.slice(6)];
  return [...new Set([`+1${d}`, `1${d}`, d, `(${a}) ${b}-${c}`, `(${a})${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`, `${a} ${b} ${c}`, `+1 ${a} ${b} ${c}`, `+1 (${a}) ${b}-${c}`, `1-${a}-${b}-${c}`, `+1-${a}-${b}-${c}`])];
}

/** Every text starts with a user search: phoneE164, plus the raw `phone` formats. */
async function findUsersByPhone(e164: string): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const [byE164, byPhone] = await Promise.all([
    db().collection('users').where('phoneE164', '==', e164).limit(5).get().catch(() => null),
    db().collection('users').where('phone', 'in', phoneFormatVariants(e164)).limit(5).get().catch(() => null),
  ]);
  const seen = new Map<string, Record<string, unknown>>();
  for (const d of [...(byE164?.docs ?? []), ...(byPhone?.docs ?? [])]) seen.set(d.id, d.data() as Record<string, unknown>);
  return [...seen.entries()].map(([id, data]) => ({ id, data }));
}

const fold = (v: string): string => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Pure: on a shared number, the ONE account whose first and last name the texter wrote (else null). */
export function matchNameAmongAccounts(texts: string[], accounts: Array<{ id: string; data: Record<string, unknown> }>): string | null {
  const hay = ` ${fold(texts.join(' '))} `;
  const hits = accounts.filter((a) => {
    const first = fold(s(a.data.firstName));
    const last = fold(s(a.data.lastName));
    return Boolean(first && last) && hay.includes(` ${first} `) && hay.includes(` ${last} `);
  });
  return hits.length === 1 ? hits[0].id : null;
}

/** Pure: email addresses a texter wrote. */
export function emailsInText(text: string): string[] {
  return [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((e) => e.toLowerCase()))].slice(0, 3);
}

/**
 * Pure: where a worker finishes payroll setup on the web.
 *
 * ☠️ 2026-09-11 (found by the Claim Shift session): `runPayrollOnboardingInviteResend` is a DEAD path for both
 * Everee entities — c1_events_llc and c1_select_llc have `payrollSettings: null` and no onboarding URL, so it
 * returns ok:false `payroll_not_applicable_or_no_url` every time. A worker was told "sending your Everee link
 * now" and nothing went out. Real Everee invites go out at hire time via
 * runEvereePayrollOnboardingInviteAfterOnCallProvision; when the resend is skipped, send this link instead so the
 * persona's promise is kept. Entity-scoped form matches payrollPaymentIssueSweep / the readiness action items.
 */
export const EVEREE_TENANT_BY_ENTITY: Record<string, string> = { c1_select_llc: '3133', c1_events_llc: '3138' };
export function payrollSetupUrl(origin: string, hiringEntityId?: string | null): string {
  const tid = EVEREE_TENANT_BY_ENTITY[s(hiringEntityId)];
  return `${origin}/c1/workers/earnings${tid ? `/${tid}` : ''}`;
}

/** Pure: the text sent when the Everee resend is skipped, so "I'm sending it now" stays true. */
export function payrollLinkText(persona: PersonaId, firstName: string, url: string, lang: 'en' | 'es'): string {
  const hi = firstName ? ` ${firstName}` : '';
  return lang === 'es'
    ? `Hola${hi}, aquí está tu configuración de pago (depósito directo y formularios): ${url} — inicia sesión con este mismo número. ${smsSignature(persona, 'es')}`
    : `Hi${hi}, here's your payroll setup (direct deposit and tax forms): ${url} — sign in with this same number. ${smsSignature(persona)}`;
}

/** Pure: replies sent to this phone in the last hour. */
export function recentReplyCount(replyTimes: number[], nowMs: number): number {
  return replyTimes.filter((t) => nowMs - t < HOUR).length;
}

const ENTITY_LABEL: Record<string, string> = { c1_select_llc: 'C1 Select (W-2)', c1_events_llc: 'C1 Events (1099 contractor)', c1_workforce_llc: 'C1 Workforce (W-2)' };
const STATE_TZ: Array<[string[], string]> = [
  [['CA', 'WA', 'OR', 'NV'], 'America/Los_Angeles'],
  [['CO', 'UT', 'AZ', 'NM', 'MT', 'WY', 'ID'], 'America/Denver'],
  [['NY', 'NJ', 'PA', 'MA', 'CT', 'FL', 'GA', 'NC', 'SC', 'VA', 'MD', 'DC', 'OH', 'MI', 'IN', 'KY', 'TN', 'ME', 'NH', 'VT', 'RI', 'DE', 'WV'], 'America/New_York'],
  [['TX', 'IL', 'MN', 'WI', 'IA', 'MO', 'AR', 'LA', 'MS', 'AL', 'OK', 'KS', 'NE', 'SD', 'ND'], 'America/Chicago'],
];
const tzForState = (st: string): string | null => STATE_TZ.find(([states]) => states.includes(st.toUpperCase()))?.[1] ?? null;
const toDate = (v: unknown): Date | null => (v && typeof (v as { toDate?: () => Date }).toDate === 'function' ? (v as { toDate: () => Date }).toDate() : null);

/** Pure: one line per shift — times only when they are really known (a wrong time texted to a worker is worse than none). */
export function describeShift(a: Record<string, unknown>): { sortKey: string; line: string } {
  const title = s(a.jobTitle) || s(a.shiftTitle) || s(a.title) || 'shift';
  const addr = (a.worksiteAddress ?? {}) as Record<string, unknown>;
  const site = [s(a.worksiteName) || s(a.locationNickname) || s(a.locationName) || s(a.companyName), [s(addr.city), s(addr.state) || s(a.worksiteState)].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
  let date = s(a.startDate).slice(0, 10);
  let time = '';
  const startTs = toDate(a.startTime);
  if (typeof a.startTime === 'string' && /^\d{1,2}:\d{2}$/.test(a.startTime)) {
    time = `${a.startTime}${typeof a.endTime === 'string' && a.endTime ? `–${a.endTime}` : ''} (local)`;
  } else if (startTs) {
    const tz = s(a.timezone) || tzForState(s(addr.state) || s(a.worksiteState));
    if (!date) date = startTs.toISOString().slice(0, 10);
    if (tz) {
      date = startTs.toLocaleDateString('en-CA', { timeZone: tz });
      time = `${startTs.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })} (local)`;
    }
  }
  const cort = (a.cortConfirmation ?? {}) as Record<string, unknown>;
  const pay = Number(a.payRate) > 0 ? `, pay $${Number(a.payRate).toFixed(2)}/hr` : '';
  const entity = ENTITY_LABEL[s(a.hiringEntityId)] ? `, ${ENTITY_LABEL[s(a.hiringEntityId)]}` : '';
  return {
    sortKey: date || '0000-00-00',
    line: `${date || 'date not set'}${time ? ` ${time}` : ''}: ${title}${site ? ` at ${site}` : ''} — status ${s(a.status) || 'unknown'}${s(cort.state) ? `, confirmation ${s(cort.state)}` : ''}${pay}${entity}`,
  };
}

interface WorkerContext { text: string; snapshot: import('./natalieOnboarding').OnboardingSnapshot | null; firstName: string; lang: 'en' | 'es'; assignmentId: string | null; backgroundFailed: boolean }

async function workerContext(uid: string, user: Record<string, unknown>): Promise<WorkerContext> {
  const firstName = s(user.preferredName) || s(user.firstName);
  const lang = workerLanguage(user);
  const lines: string[] = [
    `Sender: identified HRX worker ${firstName} ${s(user.lastName)} (first name ${firstName || 'unknown'}). Preferred language: ${lang === 'es' ? 'Spanish' : 'English'}.`,
    `Jobs board (open jobs, apply): ${PUBLIC_APP_ORIGIN}/c1/jobs-board`,
  ];
  const apps = await db().collection(`tenants/${TENANT}/applications`).where('userId', '==', uid).limit(15).get().catch(() => null);
  const appLines = (apps?.docs ?? [])
    .map((d) => d.data() as Record<string, unknown>)
    .map((a) => ({ at: toDate(a.createdAt)?.toISOString().slice(0, 10) ?? '', line: `${s(a.jobTitle) || s(a.postTitle) || s(a.jobOrderName) || 'job'} — status ${s(a.status) || 'unknown'}` }))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8).map((x) => `• ${x.at ? `${x.at}: ` : ''}${x.line}`);
  lines.push(appLines.length ? `Applications:\n${appLines.join('\n')}` : 'Applications: none on file.');
  const asg = await db().collection(`tenants/${TENANT}/assignments`).where('userId', '==', uid).limit(80).get().catch(() => null);
  const today = new Date().toISOString().slice(0, 10);
  const shifts = (asg?.docs ?? []).map((d) => ({ id: d.id, data: d.data() as Record<string, unknown>, ...describeShift(d.data() as Record<string, unknown>) }));
  const upcoming = shifts.filter((x) => x.sortKey >= today && !['cancelled', 'canceled', 'declined'].includes(s(x.data.status).toLowerCase())).sort((a, b) => a.sortKey.localeCompare(b.sortKey)).slice(0, 8);
  const recent = shifts.filter((x) => x.sortKey < today).sort((a, b) => b.sortKey.localeCompare(a.sortKey)).slice(0, 5);
  lines.push(upcoming.length ? `Upcoming shifts:\n${upcoming.map((x) => `• ${x.line}`).join('\n')}` : 'Upcoming shifts: none scheduled.');
  if (recent.length) lines.push(`Recent shifts:\n${recent.map((x) => `• ${x.line}`).join('\n')}`);
  const live = shifts.filter((x) => !['cancelled', 'canceled', 'declined', 'completed', 'ended'].includes(s(x.data.status).toLowerCase())).sort((a, b) => b.sortKey.localeCompare(a.sortKey))[0];
  let snapshot: WorkerContext['snapshot'] = null;
  try {
    const { buildOnboardingSnapshot } = await import('./natalieOnboarding');
    snapshot = await buildOnboardingSnapshot(TENANT, uid, live?.id ?? null, { hiringEntityId: s(live?.data.hiringEntityId) || null });
    lines.push(`Onboarding still open for them: ${snapshot.workerTodo.length ? snapshot.workerTodo.join('; ') : 'nothing'}.`);
    lines.push(`Everee payroll (tax form, direct deposit): ${snapshot.everee.complete ? 'complete' : snapshot.everee.inviteSent ? 'invite sent, not finished (invite CAN be resent)' : 'not started (a recruiter sends the invite)'}.`);
    if (snapshot.background) lines.push(`Background check form: ${snapshot.background.formDone ? 'done' : `NOT started${snapshot.background.portalLink ? ' (form link CAN be resent)' : ''}`}.${snapshot.drug.ordered ? ` Drug screen: ${snapshot.drug.status} (instructions come by email from AccuSource/the lab).` : ''}`);
  } catch (err) {
    logger.warn('[persona-worker-sms] onboarding snapshot failed', { err: String(err) });
  }
  let backgroundFailed = false;
  try {
    const { backgroundSummary } = await import('./natalieFill');
    const bg = await backgroundSummary(TENANT, uid);
    backgroundFailed = bg.status === 'failed' || bg.status === 'needs_review';
    lines.push(`Background check stage: ${bg.status === 'failed' || bg.status === 'needs_review' ? 'under review by the team — do NOT discuss results, escalate' : bg.status.replace(/_/g, ' ')}.`);
  } catch {
    /* optional */
  }
  return { text: lines.join('\n'), snapshot, firstName, lang, assignmentId: live?.id ?? null, backgroundFailed };
}

function anonymousContext(sender: SenderMatch, possibleMatch: boolean): string {
  const who = sender.kind === 'ambiguous'
    ? `Sender: this phone number is shared by ${sender.count} accounts, so the texter could NOT be identified yet. Ask them to reply with their full first and last name so you can find their account.`
    : `Sender: this phone number is not on file, so the texter could NOT be identified. ${possibleMatch ? 'The email they wrote matches more than one account, so nothing can be confirmed — say a recruiter will follow up.' : 'If they say they already work with us or applied, ask for the email they applied with (that identifies them) or their full name, and say a recruiter can help.'}`;
  return `${who} Do not reveal or confirm any account, application, shift or personal details.\nJobs board (open jobs, apply): ${PUBLIC_APP_ORIGIN}/c1/jobs-board`;
}

/** Pure: the system prompt for a persona answering a worker's text. */
export function workerSmsSystemPrompt(persona: PersonaId): string {
  const P = PERSONAS[persona];
  const team = persona === 'marco' ? "Rosa's team" : 'a recruiter';
  const scope = persona === 'marco'
    ? 'C1 Staffing events work (festivals, concerts, stadium and catering events; C1 Events workers are 1099 independent contractors)'
    : 'C1 Staffing jobs (warehouse, logistics, facilities, food service and similar roles)';
  return `You are ${P.displayName}, recruiting assistant at C1 Staffing, answering a text message from a worker or job applicant. You help with ${scope}.

You only know what is in the CONTEXT block: the texter's own applications, shifts, onboarding steps and background-check stage. Never invent jobs, dates, times, pay, addresses, links or policies. If the answer isn't in CONTEXT, say ${team} will follow up, and escalate.

Rules:
- One SMS, plain text, under 320 characters, warm and direct, first name only. End with "— ${P.firstName}, C1 Staffing".
- Reply in the language the person wrote in; if unclear, use their preferred language from CONTEXT.
- Only discuss the texter's own information. Never share anything about other workers, other people's schedules or contact details, or clients' internal information.
- If CONTEXT says the sender could not be identified, do not reveal or confirm any account, application, shift or personal detail — follow CONTEXT's instruction (ask for their full name, or name and email). New applicants: share the jobs board link. People who already work with us: say ${team} will confirm their account, and escalate.
- Pay: you may repeat a pay rate shown in CONTEXT for their own shift. Missing pay, pay disputes, payroll or tax problems: say you're passing it to ${team} and escalate. Never promise amounts or dates.
- Never make or promise hiring decisions, placements or schedule changes. To confirm or cancel a shift, tell them to reply to the confirmation text they received, or that ${team} will help, and escalate.
- If they need their background-check form link or their Everee invite (tax forms, direct deposit) and CONTEXT says it can be resent, say you're sending it now and add the matching action.
- If CONTEXT says their background check is under review, don't discuss it — say ${team} will reach out, and escalate.
- Injuries, safety or harassment: tell them to contact their on-site supervisor right away (911 for emergencies), and escalate.
- Don't bring up that you are an automated assistant, but if they sincerely ask whether they're texting a real person, don't deny it — say you're C1's automated recruiting assistant and ${team} can call them.

Return ONLY JSON: {"reply": string, "intent": "question" | "schedule" | "onboarding" | "pay" | "apply" | "cancel_or_change" | "tech_problem" | "safety" | "thanks" | "other", "actions": string[], "note": string}
actions may include: "resend_background_link", "resend_everee_invite", "escalate". note = one line for the recruiter (always set when escalating), or "".`;
}

export interface WorkerDecision { reply: string; intent: string; actions: string[]; note: string }

/** Pure: model output → a safe decision (signature enforced, language-aware fallback, whitelisted actions). */
export function parseWorkerDecision(raw: string, persona: PersonaId, lang: 'en' | 'es', firstName: string): WorkerDecision {
  const P = PERSONAS[persona];
  const m = raw.match(/\{[\s\S]*\}/);
  let parsed: Partial<WorkerDecision> = {};
  try { parsed = JSON.parse(m ? m[0] : raw) as Partial<WorkerDecision>; } catch { parsed = {}; }
  const hi = firstName ? ` ${firstName}` : '';
  const fallback = lang === 'es'
    ? `Gracias${hi}, recibí tu mensaje. Alguien del equipo te contactará pronto. ${smsSignature(persona, 'es')}`
    : `Thanks${hi}, got your message. Someone on the team will follow up soon. ${smsSignature(persona)}`;
  const text = s(parsed.reply).slice(0, 480) || fallback;
  const allowed = new Set(['resend_background_link', 'resend_everee_invite', 'escalate']);
  const actions = (Array.isArray(parsed.actions) ? parsed.actions.map(String) : []).filter((a) => allowed.has(a));
  const failedParse = !s(parsed.reply);
  return {
    reply: new RegExp(P.firstName, 'i').test(text) ? text : `${text} ${smsSignature(persona, lang)}`,
    intent: s(parsed.intent) || 'other',
    actions: failedParse && !actions.includes('escalate') ? [...actions, 'escalate'] : actions,
    note: s(parsed.note) || (failedParse ? 'could not work out a reply — please look at their text' : ''),
  };
}

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY unset');
    cachedClient = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  }
  return cachedClient;
}

async function slackChannelFor(persona: PersonaId, tokens: PersonaTokens): Promise<string> {
  if (persona === 'marco') return tokens.runtime?.marcoChannel || PERSONAS.marco.defaultChannel;
  const cfg = (await db().doc(`tenants/${TENANT}/app_config/natalie`).get()).data() ?? {};
  return s(cfg.recruitingChannelId) || PERSONAS.natalie.defaultChannel;
}

/** One Slack thread per persona per day (Mountain time day, like the onboarding threads). */
async function dayThread(persona: PersonaId, tokens: PersonaTokens): Promise<{ channel: string; ts?: string; token: string }> {
  const { token } = tokenFor(tokens, persona);
  const channel = await slackChannelFor(persona, tokens);
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  const ref = db().collection(DAY_THREADS).doc(`${persona}__${day}`);
  const cur = (await ref.get()).data() as { channel?: string; ts?: string } | undefined;
  if (cur?.ts) return { channel: cur.channel || channel, ts: cur.ts, token };
  const res = await postAsNatalie(token, { channel, text: `Texts from workers and applicants to ${PERSONAS[persona].firstName}'s number today (${day}). Each one is answered by text and logged here — :rotating_light: means a person needs to follow up.` });
  const out = { channel, ts: res.ok ? res.ts : undefined, token };
  if (res.ok) await ref.set({ channel, ts: res.ts, persona, day, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  return out;
}

export async function drainWorkerPersonaSms(tokens: PersonaTokens): Promise<number> {
  const snap = await db().collection(INBOX).where('status', '==', 'pending').limit(5).get();
  const docs = [...snap.docs].sort((a, b) => (a.get('createdAt')?.toMillis?.() ?? 0) - (b.get('createdAt')?.toMillis?.() ?? 0));
  let answered = 0;
  for (const d of docs) {
    const claimed = await db().runTransaction(async (tx) => {
      const cur = await tx.get(d.ref);
      if (cur.get('status') !== 'pending') return false;
      tx.update(d.ref, { status: 'answering', claimedAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    }).catch(() => false);
    if (!claimed) continue;
    const x = d.data();
    const persona: PersonaId = x.persona === 'marco' ? 'marco' : 'natalie';
    const P = PERSONAS[persona];
    const phone = s(x.fromE164);
    const inbound = s(x.text).slice(0, 1600);
    const threadRef = db().collection(THREADS).doc(`${persona}__${phone}`);
    const thread = (await threadRef.get()).data() ?? {};
    const turns = (thread.workerTurns as Array<{ at: string; dir: 'in' | 'out'; text: string }> | undefined) ?? [];
    const replyTimes = (thread.replyTimes as number[] | undefined) ?? [];
    try {
      if (recentReplyCount(replyTimes, Date.now()) >= RATE_MAX) {
        await d.ref.update({ status: 'rate_limited', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        await threadRef.set({ workerTurns: [...turns, { at: new Date().toISOString(), dir: 'in', text: inbound }].slice(-30), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        continue;
      }
      // Who is this? Search users by the number (phoneE164 + raw phone formats) before anything else.
      const matches = await findUsersByPhone(phone);
      let sender: SenderMatch = classifySender(matches, TENANT);
      let identifiedBy = sender.kind === 'worker' ? 'phone' : '';
      if (sender.kind === 'ambiguous') {
        // Shared number: the texter's full name (this text or their last few) picks the one account among those sharing it.
        const accounts = matches.filter((m) => classifySender([m], TENANT).kind === 'worker');
        const hit = matchNameAmongAccounts([...turns.filter((t) => t.dir === 'in').slice(-5).map((t) => t.text), inbound], accounts);
        const account = hit ? accounts.find((m) => m.id === hit) : undefined;
        if (account) { sender = { kind: 'worker', uid: account.id, user: account.data }; identifiedBy = 'name_on_shared_number'; }
      }
      // Unknown number: search users by any email they wrote. Exactly one tenant member → that's who they are
      // (Greg 2026-09-11). Two or more → stay anonymous.
      const possibleMatches: Array<{ id: string; name: string; data: Record<string, unknown> }> = [];
      if (sender.kind === 'unknown') {
        for (const email of emailsInText(inbound)) {
          const q = await db().collection('users').where('email', '==', email).limit(3).get().catch(() => null);
          for (const u of q?.docs ?? []) {
            const data = u.data() as Record<string, unknown>;
            if (classifySender([{ id: u.id, data }], TENANT).kind === 'worker' && !possibleMatches.some((m) => m.id === u.id)) {
              possibleMatches.push({ id: u.id, name: `${s(data.firstName)} ${s(data.lastName)}`.trim() || email, data });
            }
          }
        }
        if (possibleMatches.length === 1) {
          sender = { kind: 'worker', uid: possibleMatches[0].id, user: possibleMatches[0].data };
          identifiedBy = 'email_in_text';
        }
      }
      const ctx: WorkerContext = sender.kind === 'worker'
        ? await workerContext(sender.uid, sender.user)
        : { text: anonymousContext(sender, possibleMatches.length > 1), snapshot: null, firstName: '', lang: 'en', assignmentId: null, backgroundFailed: false };
      if (identifiedBy === 'name_on_shared_number') ctx.text = `${ctx.text}\n(Identified by the full name they texted — this phone number is shared with other accounts.)`;
      if (identifiedBy === 'email_in_text') ctx.text = `${ctx.text}\n(Identified by the email address they texted; this phone number is not the one on their profile — mention that a recruiter can update their number if it changed.)`;
      const uid = sender.kind === 'worker' ? sender.uid : null;
      const context = [
        ctx.text,
        x.techIssueFlagged ? 'Note: this text looked like a technical problem and was flagged to the tech team automatically — tell them it has been flagged and that they will get a text when it is fixed.' : '',
        `Recent texts with them (oldest first):\n${turns.slice(-10).map((t) => `${t.dir === 'out' ? P.firstName : 'Them'}: ${t.text}`).join('\n') || '(none)'}`,
      ].filter(Boolean).join('\n\n');
      const res = await client().messages.create({
        model: NATALIE_MODEL,
        max_tokens: 700,
        system: workerSmsSystemPrompt(persona),
        messages: [{ role: 'user', content: `CONTEXT:\n${context}\n\nNEW TEXT FROM THEM: "${inbound}"` }],
      });
      const raw = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('').trim();
      const decision = parseWorkerDecision(raw, persona, ctx.lang, ctx.firstName);
      // Still unidentified (no phone, name or email match) → a person should look at it.
      if (sender.kind !== 'worker' && !decision.actions.includes('escalate')) decision.actions.push('escalate');
      if (ctx.backgroundFailed && ['onboarding', 'question'].includes(decision.intent) && !decision.actions.includes('escalate')) decision.actions.push('escalate');
      const { sendWorkerMessageInternal } = await import('../twilio');
      const sent = await sendWorkerMessageInternal(phone, decision.reply, { tenantId: TENANT, ...(uid ? { userId: uid } : {}), source: 'system', messageTypeId: `${P.smsPrefix}worker_reply`, systemContext: true } as never);
      const notes: string[] = [];
      if (uid) {
        for (const a of decision.actions) {
          if (a === 'resend_background_link' && ctx.snapshot?.background?.portalLink && !ctx.snapshot.background.formDone) {
            const { portalLinkText } = await import('./natalieFill');
            const r = await sendWorkerMessageInternal(phone, portalLinkText(ctx.firstName, ctx.snapshot.background.portalLink, ctx.snapshot.background.packageName, false, { persona, lang: ctx.lang }), { tenantId: TENANT, userId: uid, source: 'system', messageTypeId: `${P.smsPrefix}bg_portal_link`, systemContext: true } as never);
            notes.push(r.success ? 'resent their background-check form link' : 'background link resend failed');
          } else if (a === 'resend_everee_invite' && ctx.snapshot?.everee.inviteSent && !ctx.snapshot.everee.complete && ctx.snapshot.hiringEntityId) {
            let resent = false;
            let skipReason = '';
            try {
              const { runPayrollOnboardingInviteResend } = await import('../messaging/payrollInviteResend');
              const r = await runPayrollOnboardingInviteResend({ tenantId: TENANT, userId: uid, hiringEntityId: ctx.snapshot.hiringEntityId, initiatedByUid: persona, assignmentId: ctx.assignmentId });
              resent = r.ok === true;
              skipReason = s((r as { skipReason?: string }).skipReason);
            } catch (e) { skipReason = String(e).slice(0, 100); }
            if (resent) {
              notes.push('resent their Everee invite');
            } else {
              // Never leave "I'm sending it now" unfulfilled: the Everee resend is a dead path for both entities,
              // so send the web payroll page instead and put the reason in the thread.
              const url = payrollSetupUrl(PUBLIC_APP_ORIGIN, ctx.snapshot.hiringEntityId);
              const r2 = await sendWorkerMessageInternal(phone, payrollLinkText(persona, ctx.firstName, url, ctx.lang), { tenantId: TENANT, userId: uid, source: 'system', messageTypeId: `${P.smsPrefix}payroll_link`, systemContext: true } as never);
              notes.push(r2.success
                ? `Everee resend is a dead path (${skipReason || 'not ok'}) — texted them ${url} instead`
                : `:warning: Everee resend skipped (${skipReason || 'not ok'}) AND the payroll link text failed (${r2.error ?? r2.errorCode}) — they were promised a link and got nothing`);
            }
          }
        }
      }
      const escalate = decision.actions.includes('escalate');
      const now = new Date().toISOString();
      await threadRef.set({
        persona, phoneE164: phone, userId: uid,
        workerTurns: [...turns, { at: now, dir: 'in', text: inbound }, { at: now, dir: 'out', text: decision.reply }].slice(-30),
        replyTimes: [...replyTimes, Date.now()].slice(-20),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await d.ref.update({ status: sent.success ? 'answered' : 'send_failed', userId: uid, senderKind: sender.kind, identifiedBy: identifiedBy || null, possibleMatches: possibleMatches.map((m) => ({ id: m.id, name: m.name })), reply: decision.reply, intent: decision.intent, actions: decision.actions, note: decision.note || null, sendError: sent.success ? null : sent.error ?? sent.errorCode ?? 'unknown', answeredAt: admin.firestore.FieldValue.serverTimestamp() });
      try {
        const t = await dayThread(persona, tokens);
        const who = uid
          ? `<${PUBLIC_APP_ORIGIN}/users/${uid}|${`${s(sender.kind === 'worker' ? sender.user.firstName : '')} ${s(sender.kind === 'worker' ? sender.user.lastName : '')}`.trim() || 'worker'}>`
          : sender.kind === 'ambiguous' ? `shared number …${phone.slice(-4)} (${sender.count} accounts — asked for their full name)` : `unknown number …${phone.slice(-4)}${possibleMatches.length > 1 ? ` — ${possibleMatches.length} accounts share the email they texted, so no details were shared` : ''}`;
        const how = identifiedBy === 'name_on_shared_number' ? ' _(identified by name on a shared number)_' : identifiedBy === 'email_in_text' ? ` _(identified by the email they texted — number …${phone.slice(-4)} is not on their profile)_` : '';
        const line = `${escalate ? ':rotating_light: ' : ''}*${who}*${how} (${decision.intent.replace(/_/g, ' ')}): "${inbound.slice(0, 300)}"\nMe: "${decision.reply}"${sent.success ? '' : ` _(send failed: ${sent.error ?? sent.errorCode})_`}${decision.note ? `\n• ${decision.note}` : ''}${notes.length ? `\n${notes.map((n) => `• ${n}`).join('\n')}` : ''}`;
        await postAsNatalie(t.token, { channel: t.channel, text: line, threadTs: t.ts });
      } catch (err) {
        logger.warn('[persona-worker-sms] slack log failed', { err: String(err) });
      }
      if (uid) await recordNatalieAction({ tenantId: TENANT, persona, kind: 'worker_sms_reply', summary: `Answered a text (${decision.intent}): "${decision.reply.slice(0, 100)}"${escalate ? ' — flagged for a recruiter' : ''}`, userId: uid, assignmentId: ctx.assignmentId, input: { inbound: inbound.slice(0, 300) }, result: { intent: decision.intent, actions: decision.actions } });
      if (sent.success) answered += 1;
      logger.info('[persona-worker-sms] answered', { persona, senderKind: sender.kind, intent: decision.intent, actions: decision.actions, sent: sent.success });
    } catch (err) {
      logger.error('[persona-worker-sms] failed', { persona, err: err instanceof Error ? err.message : String(err) });
      await d.ref.update({ status: 'failed', lastError: String(err).slice(0, 300) }).catch(() => undefined);
    }
  }
  return answered;
}
