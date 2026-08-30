/**
 * INT-1 interview funnel aggregation (2026-08-30) — serves
 * /reports/interview-metrics via the `mode: 'interviewMetrics'` branch on
 * backfillPrescreenCategoryScores (mode-flag convention: no new functions at
 * the Cloud Run cap).
 *
 * Stages and sources:
 *   invited   tenants/{t}/messageLogs by interview messageTypeId (complete
 *             across all 7 senders; first-invites vs chases separable)
 *   started   collectionGroup('prescreen') on planFetchedAt — the session
 *             docs stampPlanFetch writes; tracking begins 2026-08-30
 *   completed collectionGroup('interviews') interviewKind == worker_ai_prescreen
 *             (index pre-existing); bank auto-completes bucketed separately
 *   passed    ai.recommendation buckets on the interview doc (proceed =
 *             engine pass; orchestrator 'advance' is a stricter gate that
 *             lives on the application doc — label, don't conflate)
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const FIRST_INVITE_TYPE_IDS = [
  'auto_new_user_interview_invite',
  'profile_first_interview_invite',
] as const;
const CHASE_TYPE_IDS = ['worker_ai_prescreen_chase_1', 'worker_ai_prescreen_chase_2'] as const;

const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export interface InterviewMetricsPayload {
  range: { startMs: number; endMs: number };
  invites: {
    firstInvites: number;
    chase1: number;
    chase2: number;
    uniqueUsersInvited: number;
    byDay: Record<string, number>;
    error?: string;
  };
  started: {
    sessions: number;
    byDay: Record<string, number>;
    trackingSince: string;
    error?: string;
  };
  completed: {
    total: number;
    humanCompleted: number;
    autoCompletedFromBank: number;
    avgScore10: number | null;
    byDay: Record<string, number>;
  };
  passed: { proceed: number; review: number; decline: number; other: number };
  dropOff: Array<{ stepId: string; count: number }>;
  byJobOrder: Array<{
    jobOrderId: string;
    jobOrderName: string | null;
    completed: number;
    proceed: number;
    avgScore10: number | null;
  }>;
  byEntry: Array<{ entry: string; completed: number; proceed: number }>;
}

export async function buildInterviewMetrics(args: {
  tenantId: string;
  startMs: number;
  endMs: number;
}): Promise<InterviewMetricsPayload> {
  const { tenantId, startMs, endMs } = args;
  const startTs = admin.firestore.Timestamp.fromMillis(startMs);
  const endTs = admin.firestore.Timestamp.fromMillis(endMs);

  // ---- invites (messageLogs; per-type queries share one composite index) ----
  const invites: InterviewMetricsPayload['invites'] = {
    firstInvites: 0,
    chase1: 0,
    chase2: 0,
    uniqueUsersInvited: 0,
    byDay: {},
  };
  try {
    const users = new Set<string>();
    for (const typeId of [...FIRST_INVITE_TYPE_IDS, ...CHASE_TYPE_IDS]) {
      const snap = await db
        .collection(`tenants/${tenantId}/messageLogs`)
        .where('messageTypeId', '==', typeId)
        .where('createdAt', '>=', startTs)
        .where('createdAt', '<=', endTs)
        .get();
      for (const doc of snap.docs) {
        const d = doc.data();
        if (d.direction && d.direction !== 'outbound') continue;
        const ms = d.createdAt?.toMillis?.() ?? 0;
        if (typeId === 'worker_ai_prescreen_chase_1') invites.chase1++;
        else if (typeId === 'worker_ai_prescreen_chase_2') invites.chase2++;
        else {
          invites.firstInvites++;
          invites.byDay[dayKey(ms)] = (invites.byDay[dayKey(ms)] ?? 0) + 1;
        }
        const uid = String(d.userId ?? '');
        if (uid) users.add(uid);
      }
    }
    invites.uniqueUsersInvited = users.size;
  } catch (e) {
    invites.error = e instanceof Error ? e.message.slice(0, 200) : String(e);
  }

  // ---- started (session docs) + drop-off cursors ----
  const started: InterviewMetricsPayload['started'] = {
    sessions: 0,
    byDay: {},
    trackingSince: '2026-08-30',
  };
  const dropCounts = new Map<string, number>();
  try {
    const snap = await db
      .collectionGroup('prescreen')
      .where('planFetchedAt', '>=', startTs)
      .where('planFetchedAt', '<=', endTs)
      .get();
    for (const doc of snap.docs) {
      if (doc.id !== 'session') continue;
      const d = doc.data();
      started.sessions++;
      const ms = d.planFetchedAt?.toMillis?.() ?? 0;
      started.byDay[dayKey(ms)] = (started.byDay[dayKey(ms)] ?? 0) + 1;
      if (!d.completedAt && d.lastStepId) {
        const k = String(d.lastStepId);
        dropCounts.set(k, (dropCounts.get(k) ?? 0) + 1);
      }
    }
  } catch (e) {
    started.error = e instanceof Error ? e.message.slice(0, 200) : String(e);
  }

  // ---- completed + passed + splits (interviews CG; index pre-existing) ----
  const completed: InterviewMetricsPayload['completed'] = {
    total: 0,
    humanCompleted: 0,
    autoCompletedFromBank: 0,
    avgScore10: null,
    byDay: {},
  };
  const passed = { proceed: 0, review: 0, decline: 0, other: 0 };
  const byJobOrder = new Map<
    string,
    { completed: number; proceed: number; scoreSum: number; scoreN: number }
  >();
  const byEntry = new Map<string, { completed: number; proceed: number }>();
  let scoreSum = 0;
  let scoreN = 0;

  const interviewsSnap = await db
    .collectionGroup('interviews')
    .where('interviewKind', '==', 'worker_ai_prescreen')
    .where('createdAt', '>=', startTs)
    .where('createdAt', '<=', endTs)
    .get();

  for (const doc of interviewsSnap.docs) {
    const d = doc.data();
    completed.total++;
    const auto = d.autoCompletedFromBank === true;
    if (auto) completed.autoCompletedFromBank++;
    else completed.humanCompleted++;
    const ms = d.createdAt?.toMillis?.() ?? 0;
    completed.byDay[dayKey(ms)] = (completed.byDay[dayKey(ms)] ?? 0) + 1;

    const score10 = Number(d.score10 ?? d.score ?? NaN);
    if (Number.isFinite(score10)) {
      scoreSum += score10;
      scoreN++;
    }
    const rec = String(d.ai?.recommendation ?? '');
    if (rec === 'proceed') passed.proceed++;
    else if (rec.startsWith('review')) passed.review++;
    else if (rec === 'decline') passed.decline++;
    else passed.other++;

    const jo = String(d.jobOrderId ?? '').trim();
    if (jo) {
      const row = byJobOrder.get(jo) ?? { completed: 0, proceed: 0, scoreSum: 0, scoreN: 0 };
      row.completed++;
      if (rec === 'proceed') row.proceed++;
      if (Number.isFinite(score10)) {
        row.scoreSum += score10;
        row.scoreN++;
      }
      byJobOrder.set(jo, row);
    }
    const entry = String(d.entry ?? 'unknown').trim() || 'unknown';
    const er = byEntry.get(entry) ?? { completed: 0, proceed: 0 };
    er.completed++;
    if (rec === 'proceed') er.proceed++;
    byEntry.set(entry, er);
  }
  completed.avgScore10 = scoreN > 0 ? Math.round((scoreSum / scoreN) * 10) / 10 : null;

  // Job-order names (best-effort, capped)
  const joIds = [...byJobOrder.keys()].slice(0, 100);
  const joNames = new Map<string, string>();
  for (let i = 0; i < joIds.length; i += 20) {
    await Promise.all(
      joIds.slice(i, i + 20).map(async (id) => {
        try {
          const jo = await db.doc(`tenants/${tenantId}/job_orders/${id}`).get();
          const name = String(jo.data()?.jobOrderName ?? jo.data()?.title ?? '').trim();
          if (name) joNames.set(id, name);
        } catch {
          /* name stays null */
        }
      }),
    );
  }

  return {
    range: { startMs, endMs },
    invites,
    started,
    completed,
    passed,
    dropOff: [...dropCounts.entries()]
      .map(([stepId, count]) => ({ stepId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 40),
    byJobOrder: [...byJobOrder.entries()]
      .map(([jobOrderId, r]) => ({
        jobOrderId,
        jobOrderName: joNames.get(jobOrderId) ?? null,
        completed: r.completed,
        proceed: r.proceed,
        avgScore10: r.scoreN > 0 ? Math.round((r.scoreSum / r.scoreN) * 10) / 10 : null,
      }))
      .sort((a, b) => b.completed - a.completed),
    byEntry: [...byEntry.entries()]
      .map(([entry, r]) => ({ entry, ...r }))
      .sort((a, b) => b.completed - a.completed),
  };
}
