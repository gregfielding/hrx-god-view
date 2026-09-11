/**
 * Per-sequence SMS copy overrides + tenant SMS branding (Phase B remainder,
 * 2026-08-29 — "message wording still requires a deploy to change").
 *
 * A messagingSequences doc may carry:
 *   copyOverrides: { [stepType]: { en?: string, es?: string } }
 * where each value is an SMS template with {token} placeholders. When a
 * reminder doc carries a `sequenceId`, the dispatcher renders the override
 * instead of the built-in body. Absent/blank override → built-in default,
 * so a half-filled editor can never silence a step.
 *
 * Branding: `tenants/{t}/messagingConfig/branding.smsBrand` replaces the
 * hardcoded "C1 Staffing" prefix everywhere (multi-tenant readiness).
 *
 * Both lookups are cached in-instance for 60s — the dispatcher processes up
 * to 200 reminders per run and must not re-read the same doc 200 times.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const CACHE_TTL_MS = 60 * 1000;
export const DEFAULT_SMS_BRAND = 'C1 Staffing';

const overridesCache = new Map<
  string,
  { at: number; overrides: Record<string, { en?: string; es?: string }> }
>();
const brandCache = new Map<string, { at: number; brand: string }>();

export async function getTenantSmsBrand(tenantId: string): Promise<string> {
  const hit = brandCache.get(tenantId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.brand;
  let brand = DEFAULT_SMS_BRAND;
  try {
    const snap = await db.doc(`tenants/${tenantId}/messagingConfig/branding`).get();
    const raw = String(snap.get('smsBrand') ?? '').trim();
    if (raw) brand = raw.slice(0, 40);
  } catch (err) {
    logger.warn('[sequenceCopy] brand lookup failed; using default', {
      tenantId,
      error: (err as Error)?.message || String(err),
    });
  }
  brandCache.set(tenantId, { at: Date.now(), brand });
  return brand;
}

export async function getSequenceCopyOverride(
  tenantId: string,
  sequenceId: string,
  stepType: string,
  lang: 'en' | 'es',
): Promise<string | null> {
  const key = `${tenantId}__${sequenceId}`;
  let entry = overridesCache.get(key);
  if (!entry || Date.now() - entry.at >= CACHE_TTL_MS) {
    let overrides: Record<string, { en?: string; es?: string }> = {};
    try {
      const snap = await db.doc(`tenants/${tenantId}/messagingSequences/${sequenceId}`).get();
      const raw = snap.get('copyOverrides');
      if (raw && typeof raw === 'object') {
        overrides = raw as Record<string, { en?: string; es?: string }>;
      }
    } catch (err) {
      logger.warn('[sequenceCopy] override lookup failed; using built-in copy', {
        tenantId,
        sequenceId,
        error: (err as Error)?.message || String(err),
      });
    }
    entry = { at: Date.now(), overrides };
    overridesCache.set(key, entry);
  }
  const step = entry.overrides?.[stepType];
  if (!step || typeof step !== 'object') return null;
  // ES falls back to the EN override before falling back to built-in copy —
  // an English-only override should still win over the built-in English.
  const tpl = lang === 'es' ? String(step.es ?? '').trim() || String(step.en ?? '').trim() : String(step.en ?? '').trim();
  return tpl || null;
}

export interface CadenceTemplateContext {
  brand: string;
  jobTitle?: string;
  startLabel?: string;
  locationName?: string;
  address?: string;
  clockInUrl?: string;
  companyName?: string;
  // Day-of logistics (Greg 2026-09-03): recruiter-edited templates can pull
  // the structured fields so overridden sequences don't lose logistics
  // content. {onsiteContact} composes "Name (Role): phone" for convenience.
  onsiteContactName?: string;
  onsiteContactPhone?: string;
  onsiteContactRole?: string;
  parking?: string;
  checkIn?: string;
}

/** Replace {token} placeholders; unknown tokens render as empty string so a
 *  typo'd token can't leak braces into a worker's text. */
export function renderCadenceTemplate(tpl: string, ctx: CadenceTemplateContext): string {
  const name = (ctx.onsiteContactName ?? '').trim();
  const role = (ctx.onsiteContactRole ?? '').trim();
  const phone = (ctx.onsiteContactPhone ?? '').trim();
  const onsiteContact = name
    ? `${name}${role ? ` (${role})` : ''}${phone ? `: ${phone}` : ''}`
    : '';
  const values: Record<string, string> = {
    brand: ctx.brand ?? DEFAULT_SMS_BRAND,
    jobTitle: ctx.jobTitle ?? '',
    startLabel: ctx.startLabel ?? '',
    locationName: ctx.locationName ?? '',
    address: ctx.address ?? '',
    clockInUrl: ctx.clockInUrl ?? '',
    companyName: ctx.companyName ?? '',
    onsiteContactName: name,
    onsiteContactPhone: phone,
    onsiteContactRole: role,
    onsiteContact,
    parking: (ctx.parking ?? '').trim(),
    checkIn: (ctx.checkIn ?? '').trim(),
  };
  return tpl
    .replace(/\{(\w+)\}/g, (_, token: string) => values[token] ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 640);
}
