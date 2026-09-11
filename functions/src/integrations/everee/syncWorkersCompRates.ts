/**
 * HRX → Everee workers' comp class sync (2026-07-16).
 *
 * HRX's master WC list (tenants/{tid}/workers_comp_rates) is the source of
 * truth; codes and rates must ALSO exist on each Everee company instance
 * before a worked shift referencing them will submit ("Invalid workers comp
 * code 8044 for CA" is Everee validating (code, state) against ITS table).
 * Until now that meant entering every rate twice. This callable pushes the
 * HRX list into an Everee entity — one row or all of them — via Everee's
 * undocumented-but-probed WC CRUD (see feedback_everee_wire_gotchas §13):
 *
 *   GET  /api/v2/workers-comp/list        (paginated; list-first is MANDATORY
 *                                          — a duplicate POST is a 500 on the
 *                                          company_state_code unique key)
 *   POST /api/v2/workers-comp             {code, name, rateER, state, rateEE?}
 *   PUT  /api/v2/workers-comp/{id}        full body, not a patch
 *
 * Semantics — deliberately conservative:
 *  - ONE-WAY UPSERT. Rows that exist only in Everee are never touched or
 *    deleted (some are real: KY/OH 8044 live only there today). They're
 *    reported back as `evereeOnly` so a human can decide to add them to HRX.
 *  - HRX rows are collapsed by (state, code): Everee keys on that pair, so
 *    an account-scoped row and an all-accounts row with the same pair must
 *    agree on rate — if they conflict the pair is skipped with an error
 *    (never guess which rate wins in payroll).
 *  - `name` is display-only in Everee; we send the first linked job title.
 *  - dryRun returns the full plan (creates / updates / inSync / conflicts /
 *    evereeOnly) without writing anything — the UI shows this before Apply.
 *  - Live runs stamp each HRX doc with everee.{entityId} = {id, rate, name,
 *    syncedAt} so the UI can show per-row sync state and rate drift.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { getEvereeConfigForEntity } from './evereeConfig';
import { evereeRequest } from './evereeHttp';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

function trim(v: unknown): string {
  return String(v ?? '').trim();
}

/** Tenant security level 7 (or HRX super-admin). WC rates drive payroll
 *  cost — tighter gate than the 5–7 timesheet band. */
async function assertSettingsAdmin(
  uid: string,
  token: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<void> {
  if (token?.hrx === true) return;
  const snap = await db.collection('users').doc(uid).get();
  const data = (snap.data() || {}) as Record<string, any>;
  const nested = data.tenantIds?.[tenantId]?.securityLevel;
  const level = Number.parseInt(String(nested ?? data.securityLevel ?? '0'), 10) || 0;
  if (level === 7) return;
  throw new HttpsError('permission-denied', 'Workers comp sync requires tenant security level 7.');
}

interface HrxRateDoc {
  id: string;
  state: string;
  code: string;
  rate: number;
  jobTitles: string[];
  modifierAccountId: string | null;
}

interface EvereeWcClass {
  id: number;
  code: string;
  state: string;
  rateER: number;
  name: string;
}

interface PlanEntry {
  state: string;
  code: string;
  name: string;
  rate: number;
  /** HRX doc ids that collapse into this (state, code) pair. */
  rateIds: string[];
  /** Present on updates: what Everee holds right now. */
  evereeId?: number;
  evereeRate?: number;
}

function normalizeEvereeList(raw: unknown): EvereeWcClass[] {
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.content)
      ? (raw as any).content
      : Array.isArray((raw as any)?.items)
        ? (raw as any).items
        : [];
  return arr
    .map((w: Record<string, unknown>) => ({
      id: Number(w.workersCompClassId ?? w.id ?? 0),
      code: trim(w.code),
      state: trim(w.state).toUpperCase(),
      rateER: Number(w.rateER ?? w.rate ?? 0),
      name: trim(w.name),
    }))
    .filter((w: EvereeWcClass) => w.id > 0 && w.code);
}

/**
 * Build the HRX→Everee sync plan for one entity (shared by the callable and
 * the nightly additions-only sync). Pure read: no writes, no auth.
 */
export async function buildWcSyncPlan(
  tenantId: string,
  entityId: string,
  config: Parameters<typeof evereeRequest>[0],
  onlyRateIds: string[] | null,
): Promise<{
  creates: PlanEntry[];
  updates: PlanEntry[];
  inSync: PlanEntry[];
  conflicts: Array<{ state: string; code: string; rates: number[]; rateIds: string[] }>;
  evereeOnly: Array<{ state: string; code: string; rate: number; name: string }>;
}> {
  const snap = await db.collection(`tenants/${tenantId}/workers_comp_rates`).get();
  const all: HrxRateDoc[] = snap.docs.map((d) => {
    const x = d.data() as Record<string, any>;
    return {
      id: d.id,
      state: trim(x.state).toUpperCase(),
      code: trim(x.code),
      rate: Number(x.rate ?? 0),
      jobTitles: Array.isArray(x.jobTitles) ? x.jobTitles.map(trim).filter(Boolean) : [],
      modifierAccountId: trim(x.modifierAccountId) || null,
    };
  });
  const scoped = onlyRateIds ? all.filter((r) => onlyRateIds.includes(r.id)) : all;
  if (scoped.length === 0) {
    throw new HttpsError('not-found', 'No matching workers comp rows found.');
  }

  // Collapse by (state, code). Everee keys on the pair, so all HRX rows
  // sharing it must agree on rate. When a single-row sync collapses with
  // rows OUTSIDE the selection, the full set still participates in the
  // conflict check — a partial view must not mask a real disagreement.
  const conflicts: Array<{ state: string; code: string; rates: number[]; rateIds: string[] }> = [];
  const targets = new Map<string, PlanEntry>();
  for (const row of scoped) {
    if (!row.state || !row.code || !(row.rate > 0)) {
      conflicts.push({ state: row.state, code: row.code, rates: [row.rate], rateIds: [row.id] });
      continue;
    }
    const key = `${row.state}/${row.code}`;
    const siblings = all.filter((r) => `${r.state}/${r.code}` === key);
    const rates = [...new Set(siblings.map((r) => r.rate))];
    if (rates.length > 1) {
      if (!conflicts.some((c) => `${c.state}/${c.code}` === key)) {
        conflicts.push({ state: row.state, code: row.code, rates, rateIds: siblings.map((r) => r.id) });
      }
      continue;
    }
    if (targets.has(key)) {
      targets.get(key)!.rateIds.push(row.id);
      continue;
    }
    // Prefer an unscoped sibling's first job title for the display name.
    const nameSource =
      siblings.find((r) => !r.modifierAccountId && r.jobTitles.length) ??
      siblings.find((r) => r.jobTitles.length);
    targets.set(key, {
      state: row.state,
      code: row.code,
      rate: row.rate,
      name: nameSource?.jobTitles[0] ?? `Class ${row.code}`,
      rateIds: [row.id],
    });
  }

  // ── Everee side (list-first, always; PAGINATED — the server caps
  // pageSize, and an unpaginated read misclassifies later pages as
  // missing → duplicate-key 500s on create; found 2026-09-05) ──────────
  // Everee's paging param is `page` (NOT pageNumber) and the server hard-caps
  // 20 rows/page regardless of pageSize (probed 2026-09-05: 108 items over 6
  // pages for Select).
  const evereeRows: EvereeWcClass[] = [];
  for (let page = 0; page < 50; page++) {
    const rawList = await evereeRequest<unknown>(config, 'GET', `/api/v2/workers-comp/list?page=${page}`);
    const chunk = normalizeEvereeList(rawList);
    evereeRows.push(...chunk);
    const totalPages = Number((rawList as Record<string, unknown>)?.totalPages ?? 1);
    if (chunk.length === 0 || page + 1 >= totalPages) break;
  }
  const evereeByKey = new Map(evereeRows.map((w) => [`${w.state}/${w.code}`, w]));

  const creates: PlanEntry[] = [];
  const updates: PlanEntry[] = [];
  const inSync: PlanEntry[] = [];
  for (const t of targets.values()) {
    const existing = evereeByKey.get(`${t.state}/${t.code}`);
    if (!existing) {
      creates.push(t);
    } else if (Math.abs(existing.rateER - t.rate) > 0.0001) {
      updates.push({ ...t, evereeId: existing.id, evereeRate: existing.rateER });
    } else {
      inSync.push({ ...t, evereeId: existing.id, evereeRate: existing.rateER });
    }
  }
  // Informational: Everee rows with no HRX counterpart (full-list runs only
  // — a single-row sync would misreport everything else as Everee-only).
  const evereeOnly = onlyRateIds
    ? []
    : evereeRows.filter((w) => ![...targets.keys()].includes(`${w.state}/${w.code}`));

  return {
    creates,
    updates,
    inSync,
    conflicts,
    evereeOnly: evereeOnly.map((w) => ({ state: w.state, code: w.code, rate: w.rateER, name: w.name })),
  };
}

/**
 * Everee requires `workersCompPolicyPeriodId` on WC class creates
 * (discovered 2026-09-05 — POSTs 422 without it). Latest period wins; null
 * when the Everee tenant has none (e.g. contractor entities — no WC there).
 */
export async function resolveWcPolicyPeriodId(
  config: Parameters<typeof evereeRequest>[0],
): Promise<number | null> {
  try {
    const pp = await evereeRequest<Record<string, unknown>>(config, 'GET', '/api/v2/workers-comp/policy-periods');
    const items = Array.isArray((pp as any)?.items) ? ((pp as any).items as Array<Record<string, unknown>>) : [];
    if (items.length === 0) return null;
    items.sort((a, b) => String(b.startDate ?? '').localeCompare(String(a.startDate ?? '')));
    const id = Number(items[0].id);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

/** Apply plan entries to Everee (POST creates, PUT updates) + stamp HRX docs. */
export async function applyWcSyncEntries(
  tenantId: string,
  entityId: string,
  config: Parameters<typeof evereeRequest>[0],
  creates: PlanEntry[],
  updates: PlanEntry[],
  inSync: PlanEntry[],
  actorUid: string,
  policyPeriodId: number | null,
): Promise<{
  applied: Array<{ state: string; code: string; action: 'created' | 'updated'; evereeId: number }>;
  errors: Array<{ state: string; code: string; error: string }>;
}> {
  const applied: Array<{ state: string; code: string; action: 'created' | 'updated'; evereeId: number }> = [];
  const errors: Array<{ state: string; code: string; error: string }> = [];
  const stampDocs = async (entry: PlanEntry, evereeId: number) => {
    const stamp = {
      [`everee.${entityId}`]: {
        evereeId,
        rate: entry.rate,
        name: entry.name,
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
        syncedBy: actorUid,
      },
    };
    for (const id of entry.rateIds) {
      await db.doc(`tenants/${tenantId}/workers_comp_rates/${id}`).update(stamp).catch(() => undefined);
    }
  };

  for (const c of creates) {
    try {
      const res = await evereeRequest<Record<string, unknown>>(config, 'POST', '/api/v2/workers-comp', {
        code: c.code,
        name: c.name,
        state: c.state,
        rateER: c.rate,
        ...(policyPeriodId ? { workersCompPolicyPeriodId: policyPeriodId } : {}),
      });
      const evereeId = Number((res as any)?.workersCompClassId ?? (res as any)?.id ?? 0);
      applied.push({ state: c.state, code: c.code, action: 'created', evereeId });
      await stampDocs(c, evereeId);
    } catch (e) {
      errors.push({ state: c.state, code: c.code, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    }
  }
  for (const u of updates) {
    try {
      await evereeRequest<unknown>(config, 'PUT', `/api/v2/workers-comp/${u.evereeId}`, {
        code: u.code,
        name: u.name,
        state: u.state,
        rateER: u.rate,
      });
      applied.push({ state: u.state, code: u.code, action: 'updated', evereeId: u.evereeId! });
      await stampDocs(u, u.evereeId!);
    } catch (e) {
      errors.push({ state: u.state, code: u.code, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    }
  }
  // Already-in-sync rows still get stamped so the UI can show them synced.
  for (const s of inSync) {
    await stampDocs(s, s.evereeId!);
  }
  return { applied, errors };
}

export const syncWorkersCompToEveree = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required.');
    const tenantId = trim(request.data?.tenantId);
    const entityId = trim(request.data?.entityId);
    const dryRun = request.data?.dryRun !== false; // default DRY RUN
    const onlyRateIds: string[] | null = Array.isArray(request.data?.rateIds)
      ? (request.data.rateIds as unknown[]).map(trim).filter(Boolean)
      : null;
    if (!tenantId || !entityId) {
      throw new HttpsError('invalid-argument', 'tenantId and entityId are required.');
    }
    await assertSettingsAdmin(request.auth.uid, request.auth.token as Record<string, unknown>, tenantId);

    const config = await getEvereeConfigForEntity(tenantId, entityId);
    if (!config) {
      throw new HttpsError('failed-precondition', `Entity ${entityId} has no Everee configuration.`);
    }

    const planCore = await buildWcSyncPlan(tenantId, entityId, config, onlyRateIds);
    const plan = { entityId, dryRun, ...planCore };
    if (dryRun) return plan;

    const policyPeriodId = await resolveWcPolicyPeriodId(config);
    const { applied, errors } = await applyWcSyncEntries(
      tenantId,
      entityId,
      config,
      planCore.creates,
      planCore.updates,
      planCore.inSync,
      request.auth.uid,
      policyPeriodId,
    );
    logger.info('[wc-sync] applied', { tenantId, entityId, applied: applied.length, errors: errors.length });
    return { ...plan, applied, errors };
  },
);
