/**
 * Recruiting personas (2026-09-11). Natalie Brooks was the only one; Marco Gomez works for Rosa and
 * owns C1 Events accounts except Oakland Arena (docs/claude/project_marco_gomez_persona.md).
 *
 * Both run inside the same Cloud Functions (Cloud Run service cap): every piece of work is stamped
 * with the persona that owns it, and the tick posts / texts with that persona's Slack token and
 * number. Ownership is a pure function of where the work is (hiring entity, account, location), so
 * a worker never hears from both.
 */
import * as admin from 'firebase-admin';

export type PersonaId = 'natalie' | 'marco';

export interface Persona {
  id: PersonaId;
  displayName: string;
  firstName: string;
  title: string;
  /** HRX users/{uid} — null until the persona has an HRX account (authorship falls back to the id). */
  hrxUid: string | null;
  slackUserId: string;
  email: string;
  /** messageTypeId prefix; twilio.ts pins these messages to `fromNumber`. */
  smsPrefix: string;
  fromNumber: string;
  /** Slack channel for posts with no better thread (config can override). */
  defaultChannel: string;
  /** The recruiter the persona works for (escalation fallback, prompt framing). */
  bossName: string;
}

export const C1_EVENTS_ENTITY_ID = 'c1_events_llc';
/** Oakland Arena (Danny's) — excluded from Marco. The JOs carry Legends Global, the cadence
 * sequences carry Legends National; the location id is the one both agree on. */
export const OAKLAND_ARENA_LOCATION_IDS = ['QGNUkDRD4jMej6RArOO4'];
export const LEGENDS_ACCOUNT_IDS = ['pioetKgJXPu19zk2K7Y6', 'uhb5hq4ddyLWtSeJP9Te'];

export const PERSONAS: Record<PersonaId, Persona> = {
  natalie: {
    id: 'natalie',
    displayName: 'Natalie Brooks',
    firstName: 'Natalie',
    title: 'Recruiting Assistant',
    hrxUid: 'sSPyxJiaYsXlHJb5XUOJ3d14PcU2',
    slackUserId: 'U0BV79X65R9',
    email: 'n.brooks@c1staffing.com',
    smsPrefix: 'natalie_',
    fromNumber: '+13126638247',
    defaultChannel: 'C0BF02MEKUP', // #recruiting
    bossName: 'Greg',
  },
  marco: {
    id: 'marco',
    displayName: 'Marco Gomez',
    firstName: 'Marco',
    title: 'Recruiting Assistant',
    hrxUid: null,
    slackUserId: 'U0C14BDAX2P',
    email: 'm.gomez@c1staffing.com',
    smsPrefix: 'marco_',
    fromNumber: '+17372646753',
    defaultChannel: 'C0BF02MEKUP', // until app_config/marco.homeChannelId points at #events-recruiting
    bossName: 'Rosa',
  },
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export interface ScopeFields {
  hiringEntityId?: unknown;
  entityId?: unknown;
  accountId?: unknown;
  recruiterAccountId?: unknown;
  companyId?: unknown;
  parentAccountId?: unknown;
  locationId?: unknown;
  worksiteId?: unknown;
  locationIds?: unknown;
}

/** Pure: which persona owns work on a job order / assignment with these fields. */
export function scopePersona(x: ScopeFields | null | undefined): PersonaId {
  if (!x) return 'natalie';
  const entity = str(x.hiringEntityId) || str(x.entityId);
  if (entity !== C1_EVENTS_ENTITY_ID) return 'natalie';
  const locations = [str(x.locationId), str(x.worksiteId), ...(Array.isArray(x.locationIds) ? x.locationIds.map(str) : [])];
  if (locations.some((l) => l && OAKLAND_ARENA_LOCATION_IDS.includes(l))) return 'natalie';
  const accounts = [str(x.accountId), str(x.recruiterAccountId), str(x.companyId), str(x.parentAccountId)];
  if (accounts.some((a) => a && LEGENDS_ACCOUNT_IDS.includes(a))) return 'natalie';
  return 'marco';
}

/** Pure: the persona whose prefix a messageTypeId carries, or null for ordinary system SMS. */
export function personaForMessageType(messageTypeId: unknown): PersonaId | null {
  const id = str(messageTypeId);
  for (const p of Object.values(PERSONAS)) if (id.startsWith(p.smsPrefix)) return p.id;
  return null;
}

/** Pure: "— Marco, C1 Staffing" in the worker's language. */
export function smsSignature(persona: PersonaId, lang: 'en' | 'es' = 'en'): string {
  return lang === 'es' ? `— ${PERSONAS[persona].firstName}, C1 Staffing` : `— ${PERSONAS[persona].firstName}, C1 Staffing`;
}

/** Pure: 'es' when the worker's profile says Spanish; everything else is English. */
export function workerLanguage(user: Record<string, unknown> | null | undefined): 'en' | 'es' {
  const v = str(user?.preferredLanguage).toLowerCase() || str(user?.languagePreference).toLowerCase();
  return v === 'es' || v.startsWith('spanish') || v.startsWith('español') || v.startsWith('espanol') ? 'es' : 'en';
}

export interface PersonaRuntime {
  /** Marco is live only when switched on AND his Slack token is bound; otherwise Natalie keeps his scope. */
  marcoEnabled: boolean;
  marcoChannel: string;
}

/** tenants/{T}/app_config/marco { enabled, homeChannelId }. */
export async function loadPersonaRuntime(tenantId: string, marcoTokenBound: boolean): Promise<PersonaRuntime> {
  const cfg = (await admin.firestore().doc(`tenants/${tenantId}/app_config/marco`).get()).data() ?? {};
  return {
    marcoEnabled: marcoTokenBound && cfg.enabled === true,
    marcoChannel: str(cfg.homeChannelId) || PERSONAS.marco.defaultChannel,
  };
}

/** Pure: scope owner, downgraded to Natalie while Marco is off. */
export function effectivePersona(scope: PersonaId, runtime: Pick<PersonaRuntime, 'marcoEnabled'>): PersonaId {
  return scope === 'marco' && runtime.marcoEnabled ? 'marco' : 'natalie';
}
