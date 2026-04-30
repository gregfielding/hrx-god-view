/**
 * Everee config: resolve entity → evereeTenantId + baseUrl (HRX Everee Master Plan §4.1).
 * Reads from Firestore entity doc; no API token here (evereeAuth handles secrets).
 */

import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

export type EvereeEnvironment = 'sandbox' | 'production';

export interface EvereeEntityConfig {
  evereeTenantId: string;
  evereeEnvironment: EvereeEnvironment;
  evereeApiBaseUrl?: string;
  evereeEnabled: boolean;
  /**
   * Everee **contractor** onboarding (`POST /api/v2/onboarding/contractor`) may
   * require routing into an approval group configured in the Everee tenant.
   * Optional on the entity doc — thread through when C1 Events (1099) auto-
   * provision ships (Stage 2).
   */
  evereeApprovalGroupId?: number;
  /**
   * Name the Everee embed will look up on the host as `window[name].postMessage`
   * to deliver UI events (V2_0 SDK). The host bridge in
   * `src/utils/everee/hostMessageBridge.ts` registers the matching object —
   * client and server must agree on the value, or the iframe stalls on EMB-102.
   *
   * Resolution order (first **valid** non-empty wins; invalid values are
   * rejected by `sanitizeEvereeEmbedHandlerName` and logged):
   *   1. `entity.evereeEmbedEventHandlerName`
   *   2. `EVEREE_EMBED_EVENT_HANDLER_<evereeTenantId>` env var
   *   3. `EVEREE_EMBED_EVENT_HANDLER` env var (global default)
   *
   * If all three are absent or invalid the embed callable falls back to
   * `'hrx_default'` (also the value the host bridge auto-registers).
   *
   * **Operators**: leave this field unset on the entity unless Everee gives you
   * a specific name to use. Don't paste placeholders like
   * `REPLACE_WITH_NAME_EVEREE_GAVE_YOU` — the validator will reject them, but
   * the field will be visible in admin UIs and confusing.
   */
  evereeEmbedEventHandlerName?: string;
}

// Everee uses a single API host for both environments; the sandbox-vs-prod
// split is enforced by the per-tenant API token (`EVEREE_API_TOKEN_<tid>`),
// not by hostname. Set `EVEREE_BASE_URL` in env to override globally for
// staging/dry-run; per-entity override still wins via `evereeApiBaseUrl` on
// the entity doc.
const DEFAULT_EVEREE_BASE = 'https://api.everee.com';
const DEFAULT_SANDBOX_BASE = process.env.EVEREE_BASE_URL || DEFAULT_EVEREE_BASE;
const DEFAULT_PROD_BASE = process.env.EVEREE_BASE_URL || DEFAULT_EVEREE_BASE;

/**
 * Embed handler-name validation
 * --------------------------------
 * The Everee embed reads `eventHandlerName` from the session-create response and
 * looks it up on the host as `window[eventHandlerName]` to deliver UI events
 * (see `src/utils/everee/hostMessageBridge.ts`). If the value is wrong the
 * iframe stalls on EMB-102 with no recovery — the chip just spins.
 *
 * The most common ways to land a wrong value:
 *   1. An admin pastes an instruction-style placeholder (`REPLACE_WITH_…`,
 *      `PLACEHOLDER_…`, `<your handler>`) into the entity doc.
 *   2. Whitespace, control chars, or accidental quoting.
 *   3. A name the host bridge isn't actually registering (typos).
 *
 * (1) and (2) we can statically reject. (3) is on the operator — we log the
 * resolved name on every session create so it shows up in the function logs.
 *
 * Format constraint: starts with a letter, then `[A-Za-z0-9_-]`, max 64 chars.
 * Lowercase + underscores is the convention (`hrx_default`); the format is a
 * little broader so an operator-friendly name from Everee (`hrxProdHandler`)
 * still passes.
 */

/** Tokens that almost certainly indicate an unfilled placeholder, not a real handler name. */
const HANDLER_NAME_PLACEHOLDER_TOKENS = [
  'replace',
  'placeholder',
  'todo',
  'fixme',
  'tbd',
  'xxx',
  'your_',
  'enter_',
  'insert_',
  'example_',
];

const HANDLER_NAME_FORMAT = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/**
 * `true` when `value` is a non-empty string that matches the format AND does
 * not look like an unfilled placeholder. Use this to validate any operator-
 * provided handler name before sending it to Everee.
 */
export function isValidEvereeEmbedHandlerName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (!HANDLER_NAME_FORMAT.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  for (const token of HANDLER_NAME_PLACEHOLDER_TOKENS) {
    if (lower.includes(token)) return false;
  }
  return true;
}

/**
 * Returns the trimmed handler name when valid, or `undefined` when not. When
 * an invalid value is given AND `source` is provided, emits a `logger.warn`
 * naming the source — this surfaces the bad config in Cloud Logging without
 * breaking the request (caller will fall through to the next resolution
 * source / the stable `hrx_default`).
 */
export function sanitizeEvereeEmbedHandlerName(
  value: unknown,
  source?: { source: string; tenantId?: string; entityId?: string; evereeTenantId?: string },
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  if (isValidEvereeEmbedHandlerName(value)) return value.trim();
  if (source) {
    logger.warn('[everee.embedHandler] rejecting invalid handler name', {
      surface: 'everee.embedHandler' as const,
      reason: 'invalid_format_or_placeholder',
      source: source.source,
      tenantId: source.tenantId,
      entityId: source.entityId,
      evereeTenantId: source.evereeTenantId,
      // Truncate to avoid leaking large pasted blobs into logs.
      offendingValue: typeof value === 'string' ? value.slice(0, 80) : String(value).slice(0, 80),
    });
  }
  return undefined;
}

/**
 * Resolve Everee config for an entity. Returns null if entity has no Everee or not enabled.
 */
export async function getEvereeConfigForEntity(
  tenantId: string,
  entityId: string
): Promise<EvereeEntityConfig | null> {
  const db = getFirestore();
  const entityRef = db.doc(`tenants/${tenantId}/entities/${entityId}`);
  const snap = await entityRef.get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown> | undefined;
  const provider = data?.payrollProvider as string | undefined;
  const enabled = data?.evereeEnabled === true && provider === 'everee';
  const evereeTenantId = data?.evereeTenantId as string | undefined;
  if (!enabled || !evereeTenantId?.trim()) return null;
  const env = (data?.evereeEnvironment as EvereeEnvironment) || 'sandbox';
  const baseUrl =
    (data?.evereeApiBaseUrl as string)?.trim() ||
    (env === 'production' ? DEFAULT_PROD_BASE : DEFAULT_SANDBOX_BASE);
  const rawApproval = data?.evereeApprovalGroupId ?? data?.approvalGroupId;
  let evereeApprovalGroupId: number | undefined;
  if (typeof rawApproval === 'number' && Number.isFinite(rawApproval)) {
    evereeApprovalGroupId = rawApproval;
  } else if (typeof rawApproval === 'string' && /^\d+$/.test(rawApproval.trim())) {
    evereeApprovalGroupId = parseInt(rawApproval.trim(), 10);
  }
  // Validate at every source: an admin can paste a placeholder onto the entity
  // doc, an env var can be misconfigured, etc. We sanitize each candidate
  // separately so a bad upstream value doesn't shadow a good downstream one
  // (entity → tenant-specific env → global env). Anything rejected is logged
  // via `sanitizeEvereeEmbedHandlerName` so ops can spot it in Cloud Logging.
  const handlerFromEntity = sanitizeEvereeEmbedHandlerName(data?.evereeEmbedEventHandlerName, {
    source: 'entity.evereeEmbedEventHandlerName',
    tenantId,
    entityId,
    evereeTenantId: evereeTenantId.trim(),
  });
  const handlerEnvSpecific = sanitizeEvereeEmbedHandlerName(
    process.env[`EVEREE_EMBED_EVENT_HANDLER_${evereeTenantId.trim()}`],
    {
      source: `env.EVEREE_EMBED_EVENT_HANDLER_${evereeTenantId.trim()}`,
      tenantId,
      entityId,
      evereeTenantId: evereeTenantId.trim(),
    },
  );
  const handlerEnvGlobal = sanitizeEvereeEmbedHandlerName(
    process.env.EVEREE_EMBED_EVENT_HANDLER,
    {
      source: 'env.EVEREE_EMBED_EVENT_HANDLER',
      tenantId,
      entityId,
      evereeTenantId: evereeTenantId.trim(),
    },
  );
  const evereeEmbedEventHandlerName =
    handlerFromEntity || handlerEnvSpecific || handlerEnvGlobal || undefined;

  return {
    evereeTenantId: evereeTenantId.trim(),
    evereeEnvironment: env,
    evereeApiBaseUrl: baseUrl,
    evereeEnabled: true,
    ...(evereeApprovalGroupId !== undefined ? { evereeApprovalGroupId } : {}),
    ...(evereeEmbedEventHandlerName ? { evereeEmbedEventHandlerName } : {}),
  };
}

/**
 * Callable gate helper — AND of env-var and per-entity flag.
 *
 * Used at the top of every Everee callable so rollout can be staged per entity
 * (e.g. turn on C1 Workforce before C1 Events) without flipping the env-wide
 * switch. The env-var `EVEREE_ENABLED=true` is required at the process level
 * (evereeGate.ts); this adds the second AND: the entity must opt in via its
 * `evereeEnabled=true` + `payrollProvider='everee'` settings.
 *
 * Throws HttpsError('failed-precondition') so the error surfaces uniformly on
 * the client regardless of which callable blocked. Returns the resolved config
 * so callers don't need a second round-trip.
 */
export async function requireEvereeEnabledEntity(
  tenantId: string,
  entityId: string,
): Promise<EvereeEntityConfig> {
  if (process.env.EVEREE_ENABLED !== 'true') {
    throw new HttpsError(
      'failed-precondition',
      'Everee is disabled at the process level (EVEREE_ENABLED !== "true").',
    );
  }
  const config = await getEvereeConfigForEntity(tenantId, entityId);
  if (!config) {
    throw new HttpsError(
      'failed-precondition',
      `Everee is not enabled for entity ${entityId}. Set entity.evereeEnabled=true and payrollProvider="everee".`,
    );
  }
  return config;
}

/** Path helpers for Everee collections (functions-side). */
export const evereePaths = {
  workers: (tid: string) => `tenants/${tid}/everee_workers`,
  worker: (tid: string, entityId: string, userId: string) =>
    `tenants/${tid}/everee_workers/${entityId}__${userId}`,
  embedSessions: (tid: string) => `tenants/${tid}/everee_embed_sessions`,
  webhookEvents: (tid: string) => `tenants/${tid}/everee_webhook_events`,
  payHistoryCache: (tid: string) => `tenants/${tid}/everee_pay_history_cache`,
};
