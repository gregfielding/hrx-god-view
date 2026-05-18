/**
 * Everee pay-codes — list + ensure (create-if-missing).
 *
 * **Standard pay codes** (the full `earningTypes` enum: TIPS, BONUS,
 * REIMBURSEMENT, MILEAGE, CONTRACTOR, etc.) exist on every company
 * instance by default. The Slice 2 wrappers reference them by literal
 * value; they do not need provisioning.
 *
 * **Custom pay codes** (only `MEAL_PREMIUM` + `REST_PREMIUM` for C1 —
 * confirmed by Everee 2026-05-07) DO need per-instance provisioning via
 * POST /api/v2/pay-codes. The `provisionCustomPayCodes.ts` script in
 * the `scripts/` sibling directory is the one-shot runner; this file
 * exposes the underlying helpers it composes.
 *
 * **Why custom codes matter**: CA Labor Code §226.7 requires meal and
 * rest break premiums to be paid as wages (taxable), not bonuses.
 * Everee's default `BONUS` earning type taxes differently — using it
 * for §226.7 premiums would mis-classify on the worker's W-2 and the
 * §226.7 audit trail. The custom codes ARE taxable wage codes with the
 * same tax treatment as hourly wages, plus a dedicated pay-stub line so
 * the premium is auditable.
 *
 * See: `timesheet-build-plan-addendum-phase4.md` §6 (pay code enum) +
 * §6.4 (custom code provisioning).
 */

import { evereeRequest } from './evereeHttp';
import type { EvereeEntityConfig } from './evereeConfig';

/**
 * Earning-type categorization per Everee docs. `TAXABLE_WAGE` is what
 * §226.7 premiums need (same tax treatment as hourly wages). `BONUS`
 * is what tips / discretionary payments use. Other values exist for
 * non-wage categories (reimbursements, mileage, etc.).
 */
export type EvereePayCodeCategory =
  | 'TAXABLE_WAGE'
  | 'BONUS'
  | 'REIMBURSEMENT'
  | 'NON_TAXABLE'
  | 'TIPS'
  | 'OTHER';

/**
 * Subset of the pay-code doc shape we care about. Everee returns more
 * fields than this; the helper preserves them via the `raw` passthrough
 * on the wrapper return.
 */
export interface EvereePayCode {
  id: number;
  code: string;
  label?: string;
  category?: EvereePayCodeCategory;
  active?: boolean;
}

/**
 * POST body for creating a pay code. Mirrors the Everee request schema.
 *
 * `externalId` lets Everee dedup on re-POST — pass the same value as
 * `code` so re-running the provisioning script never creates duplicate
 * codes even if our local idempotency check misses.
 */
export interface CreatePayCodeBody {
  code: string;
  label: string;
  category: EvereePayCodeCategory;
  /** Defaults to true on Everee's side when omitted. */
  active?: boolean;
  /** Used by Everee for server-side dedup. */
  externalId?: string;
}

/**
 * List all pay codes on the company instance. Defensive parsing — the
 * endpoint returns either a flat array or `{ payCodes: [...] }`
 * depending on Everee API version; this helper unwraps both.
 */
export async function listPayCodes(config: EvereeEntityConfig): Promise<EvereePayCode[]> {
  const raw = await evereeRequest<unknown>(config, 'GET', '/api/v2/pay-codes');
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown> | null)?.payCodes)
      ? ((raw as Record<string, unknown>).payCodes as unknown[])
      : Array.isArray((raw as Record<string, unknown> | null)?.results)
        ? ((raw as Record<string, unknown>).results as unknown[])
        : [];
  return list.map((entry) => {
    const o = (entry ?? {}) as Record<string, unknown>;
    return {
      id: typeof o.id === 'number' ? o.id : 0,
      code: typeof o.code === 'string' ? o.code : String(o.name ?? ''),
      label: typeof o.label === 'string' ? o.label : undefined,
      category: typeof o.category === 'string' ? (o.category as EvereePayCodeCategory) : undefined,
      active: typeof o.active === 'boolean' ? o.active : undefined,
    };
  });
}

/**
 * POST a new pay code. Surface for the provisioning script; not
 * called from production runtime paths.
 */
export async function createPayCode(
  config: EvereeEntityConfig,
  body: CreatePayCodeBody,
): Promise<{ id: number; raw: unknown }> {
  const raw = await evereeRequest<Record<string, unknown>>(
    config,
    'POST',
    '/api/v2/pay-codes',
    body,
  );
  const id = typeof raw?.id === 'number' ? raw.id : 0;
  return { id, raw };
}

/**
 * Idempotent provisioner: list pay codes, return the existing one if
 * `code` matches, otherwise create. The provisioning script wraps this
 * over `MEAL_PREMIUM` + `REST_PREMIUM` for each of the 3 C1 instances.
 *
 * Returns `{ payCode, created }` so the script can report add vs. skip
 * counts.
 */
export async function ensureCustomPayCode(
  config: EvereeEntityConfig,
  body: CreatePayCodeBody,
): Promise<{ payCode: EvereePayCode; created: boolean }> {
  const all = await listPayCodes(config);
  const existing = all.find((p) => p.code === body.code);
  if (existing) return { payCode: existing, created: false };

  const { id, raw } = await createPayCode(config, body);
  return {
    payCode: {
      id,
      code: body.code,
      label: body.label,
      category: body.category,
      active: body.active ?? true,
    },
    created: true,
  };
}
