/**
 * Nightly WC hygiene (Greg 2026-09-05 "build it all") — rides
 * scheduledScoringDistribution's tenant loop (Cloud Run cap: no new
 * function). Two zero-touch passes per tenant with WC data:
 *
 * 1. ADDITIONS-ONLY Everee sync: for each entity with an Everee config,
 *    build the same plan as the Sync to Everee button and auto-apply ONLY
 *    creates — a new (state, code) landing in the matrix reaches Everee by
 *    the next morning, so payroll never blocks on an unsynced code. Rate
 *    UPDATES and conflicts are never auto-applied; they're logged for the
 *    manual preview→apply flow (rate changes deserve eyes).
 *
 * 2. 8040 "replace now" auto-reclassify: payroll riding the 8040
 *    placeholder where the matrix already has a real code for the
 *    (state, title) gets restamped to that code — the same deterministic
 *    write as the WC report's reclassify control. With the InSource-reply
 *    playbook (new grants → matrix rows), this is what makes placeholders
 *    clear themselves on a regular basis.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
import {
  applyWcSyncEntries,
  buildWcSyncPlan,
  resolveWcPolicyPeriodId,
} from '../integrations/everee/syncWorkersCompRates';

const SYSTEM_ACTOR = 'system:nightly_wc_hygiene';
const trim = (v: unknown): string => String(v ?? '').trim();

export interface NightlyWcResult {
  configured: boolean;
  evereeCreates: number;
  evereeUpdateDrift: number;
  evereeConflicts: number;
  entriesReclassified: number;
  assignmentsReclassified: number;
  success: boolean;
  error?: string;
}

interface MatrixMaps {
  byStateTitle: Map<string, { code: string; rate: number }>;
}

export async function runNightlyWcHygieneForTenant(
  db: admin.firestore.Firestore,
  tenantId: string,
): Promise<NightlyWcResult> {
  const result: NightlyWcResult = {
    configured: false,
    evereeCreates: 0,
    evereeUpdateDrift: 0,
    evereeConflicts: 0,
    entriesReclassified: 0,
    assignmentsReclassified: 0,
    success: true,
  };
  try {
    // Gate: tenants without a rate matrix cost one 1-doc query nightly.
    const anyRate = await db.collection(`tenants/${tenantId}/workers_comp_rates`).limit(1).get();
    if (anyRate.empty) return result;
    result.configured = true;

    // ── Pass 1: additions-only Everee sync per configured entity ──────────
    const entitiesSnap = await db.collection(`tenants/${tenantId}/entities`).get();
    for (const ent of entitiesSnap.docs) {
      // Everee WC is W-2-only — contractor entities (Events/Workforce) report
      // WC on the C1 side and carry NO policy period in Everee; pushing codes
      // there just 422s. Same isContractor test as the coverage report.
      const workerType = trim(ent.data().workerType).toLowerCase();
      if (workerType === 'contractor' || /events|workforce|sandbox/i.test(ent.id)) continue;
      const config = await getEvereeConfigForEntity(tenantId, ent.id).catch(() => null);
      if (!config) continue;
      try {
        const plan = await buildWcSyncPlan(tenantId, ent.id, config, null);
        result.evereeUpdateDrift += plan.updates.length;
        result.evereeConflicts += plan.conflicts.length;
        if (plan.updates.length > 0 || plan.conflicts.length > 0) {
          logger.warn('nightlyWcHygiene: manual attention (not auto-applied)', {
            tenantId,
            entityId: ent.id,
            updateDrift: plan.updates.map((u) => `${u.state} ${u.code}: HRX ${u.rate} vs Everee ${u.evereeRate}`),
            conflicts: plan.conflicts,
          });
        }
        if (plan.creates.length > 0) {
          const policyPeriodId = await resolveWcPolicyPeriodId(config);
          if (!policyPeriodId) {
            logger.warn('nightlyWcHygiene: no Everee policy period — creates skipped', {
              tenantId,
              entityId: ent.id,
              creates: plan.creates.length,
            });
            continue;
          }
          const { applied, errors } = await applyWcSyncEntries(
            tenantId,
            ent.id,
            config,
            plan.creates,
            [],
            [],
            SYSTEM_ACTOR,
            policyPeriodId,
          );
          result.evereeCreates += applied.length;
          if (errors.length > 0) {
            logger.error('nightlyWcHygiene: Everee create errors', { tenantId, entityId: ent.id, errors });
          }
        }
      } catch (e) {
        logger.error('nightlyWcHygiene: sync pass failed for entity', {
          tenantId,
          entityId: ent.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // ── Pass 2: 8040 replace-now reclassify ───────────────────────────────
    // Per-entity title matrix (generic then entity-scoped, scoped wins) —
    // same two-pass semantics as loadWcMatrixForEntity.
    const ratesSnap = await db.collection(`tenants/${tenantId}/workers_comp_rates`).get();
    const generic: Array<Record<string, unknown>> = [];
    const scoped = new Map<string, Array<Record<string, unknown>>>();
    ratesSnap.forEach((d) => {
      const x = d.data() as Record<string, unknown>;
      if (trim(x.modifierAccountId)) return;
      const scope = trim(x.hiringEntityId);
      if (!scope) generic.push(x);
      else {
        if (!scoped.has(scope)) scoped.set(scope, []);
        scoped.get(scope)!.push(x);
      }
    });
    const matrixCache = new Map<string, MatrixMaps>();
    const matrixFor = (entityId: string): MatrixMaps => {
      const hit = matrixCache.get(entityId);
      if (hit) return hit;
      const m: MatrixMaps = { byStateTitle: new Map() };
      const apply = (x: Record<string, unknown>): void => {
        const st = trim(x.state).toUpperCase();
        const code = trim(x.code);
        const rate = Number(x.rate ?? 0);
        if (!st || !code || code === '8040') return;
        const titles = Array.isArray(x.jobTitles) ? (x.jobTitles as unknown[]) : [];
        for (const t of titles) {
          const title = trim(t);
          if (title && title !== '*') m.byStateTitle.set(`${st}_${title.toLowerCase()}`, { code, rate });
        }
      };
      generic.forEach(apply);
      (scoped.get(entityId) ?? []).forEach(apply);
      matrixCache.set(entityId, m);
      return m;
    };

    let batch = db.batch();
    let batchSize = 0;
    const commitIfFull = async (): Promise<void> => {
      if (batchSize >= 400) {
        await batch.commit();
        batch = db.batch();
        batchSize = 0;
      }
    };

    // Entries: trailing 45 days of 8040-stamped payroll rows.
    const cutoff = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
    const entriesSnap = await db
      .collection(`tenants/${tenantId}/timesheet_entries`)
      .where('workDate', '>=', cutoff)
      .get();
    const assignmentIds = new Set<string>();
    const picked: Array<{ ref: FirebaseFirestore.DocumentReference; e: Record<string, unknown> }> = [];
    entriesSnap.forEach((d) => {
      const e = d.data() as Record<string, unknown>;
      if (trim(e.workersCompCode) !== '8040') return;
      picked.push({ ref: d.ref, e });
      const asnId = trim(e.assignmentId);
      if (asnId) assignmentIds.add(asnId);
    });
    const assignments = new Map<string, Record<string, unknown>>();
    const asnIdList = Array.from(assignmentIds);
    for (let i = 0; i < asnIdList.length; i += 100) {
      const chunk = asnIdList.slice(i, i + 100);
      const snaps = await db.getAll(...chunk.map((id) => db.doc(`tenants/${tenantId}/assignments/${id}`)));
      snaps.forEach((s) => {
        if (s.exists) assignments.set(s.id, s.data() as Record<string, unknown>);
      });
    }
    for (const { ref, e } of picked) {
      const entityId = trim(e.hiringEntityId);
      if (!entityId) continue;
      const sidecar = ((e.import ?? {}) as Record<string, unknown>).worksiteAddress as
        | Record<string, unknown>
        | undefined;
      const state =
        trim(e.workState).toUpperCase() ||
        trim((e.worksiteAddress as Record<string, unknown> | undefined)?.state).toUpperCase() ||
        trim(sidecar?.state).toUpperCase();
      const a = assignments.get(trim(e.assignmentId));
      const title = trim(a?.jobTitle);
      if (!state || !title) continue;
      const real = matrixFor(entityId).byStateTitle.get(`${state}_${title.toLowerCase()}`);
      if (!real) continue;
      batch.update(ref, { workersCompCode: real.code, workersCompRate: real.rate });
      batchSize++;
      result.entriesReclassified++;
      await commitIfFull();
    }

    // Assignments stamped 8040 — fixes all future entries at the source.
    const asnSnap = await db
      .collection(`tenants/${tenantId}/assignments`)
      .where('workersCompCode', '==', '8040')
      .get();
    for (const d of asnSnap.docs) {
      const a = d.data() as Record<string, unknown>;
      const entityId = trim(a.hiringEntityId) || trim(a.entityId);
      const state =
        (trim(a.workState) || trim(a.worksiteState)).toUpperCase() ||
        trim((a.worksiteAddress as Record<string, unknown> | undefined)?.state).toUpperCase();
      const title = trim(a.jobTitle);
      if (!entityId || !state || !title) continue;
      const real = matrixFor(entityId).byStateTitle.get(`${state}_${title.toLowerCase()}`);
      if (!real) continue;
      batch.update(d.ref, { workersCompCode: real.code, workersCompRate: real.rate });
      batchSize++;
      result.assignmentsReclassified++;
      await commitIfFull();
    }

    if (batchSize > 0) await batch.commit();
    if (
      result.evereeCreates > 0 ||
      result.entriesReclassified > 0 ||
      result.assignmentsReclassified > 0
    ) {
      logger.info('nightlyWcHygiene: done', { tenantId, ...result });
    }
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('nightlyWcHygiene: failed', { tenantId, error: message });
    return { ...result, success: false, error: message };
  }
}
