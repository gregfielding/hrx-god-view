/**
 * schedulingTriageNightly — the AI overnight triage (Phase 1's bleeding-
 * edge layer, Greg's directive 2026-07-19: recruiters open Scheduling
 * Health to "I handled N things overnight", not a to-do pile).
 *
 * Runs 11:30 UTC daily, 30 minutes after scheduleDivergenceSweep, and for
 * each tenant with a fresh snapshot:
 *
 *   1. AUTO-COMPLETES stale live assignments — same server re-verification
 *      as the page's "Mark all finished" button (live status + effective
 *      end date in the past), stamped updatedBy 'ai_triage_nightly'.
 *   2. AUTO-APPLIES exact-match Indeed Flex cancellations — the matcher
 *      already resolved WHO on WHICH shift with 'exact' confidence; the
 *      booking is gone at the source, so applying it is truth-sync, not
 *      judgment. Runs through applyShiftRequestCore (same code path as
 *      the recruiter's button — notifications, audit stamp, row applied).
 *      Fuzzy/multiple/none confidence is NEVER auto-applied.
 *   3. Writes a plain-English MORNING BRIEF (OpenAI gpt-5; deterministic
 *      fallback if the call fails) onto the snapshot, which Scheduling
 *      Health renders as the "Handled overnight" card.
 *
 * Everything it does is the same thing a recruiter's one click would have
 * done — just done before they wake up, with the leftovers explained.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import OpenAI from 'openai';
import { applyShiftRequestCore } from '../integrations/indeedFlex/applyShiftRequest';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const ACTOR = 'ai_triage_nightly';
const LIVE_RE = /^(pending|proposed|confirmed|in_progress|active|none|)$/;
const DEAD_RE = /cancel|declined|completed|ended|rejected/;

function todayUtcIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}
function asIso(v: unknown): string | null {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (v && typeof (v as { toDate?: () => Date }).toDate === 'function') {
    const d = (v as { toDate: () => Date }).toDate();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
      d.getUTCDate(),
    ).padStart(2, '0')}`;
  }
  return null;
}

interface TriageOutcome {
  ranAt: FirebaseFirestore.FieldValue;
  autoCompletedStale: number;
  autoAppliedCancels: number;
  autoCancelledAssignments: number;
  remainingNeedsReview: Record<string, number>;
  brief: string;
  briefSource: 'ai' | 'fallback';
}

/** Auto-complete the snapshot's stale live assignments (server re-verified). */
async function completeStale(
  tenantId: string,
  staleRows: Array<{ assignmentId?: string }>,
): Promise<number> {
  const today = todayUtcIso();
  let completed = 0;
  let batch = db.batch();
  let inBatch = 0;
  // Killed-JO stale rows may have future/no end dates — accept both axes,
  // matching the sweep's definition (review fix 2026-07-19).
  const KILLED_JO = new Set(['cancelled', 'canceled', 'completed', 'closed']);
  const joStatusCache = new Map<string, string>();
  const joIsKilled = async (joId: string): Promise<boolean> => {
    if (!joId) return false;
    let st = joStatusCache.get(joId);
    if (st === undefined) {
      const jo = await db.doc(`tenants/${tenantId}/job_orders/${joId}`).get();
      st = jo.exists ? String((jo.data() || {}).status ?? '').toLowerCase() : '';
      joStatusCache.set(joId, st);
    }
    return KILLED_JO.has(st);
  };
  for (const row of staleRows) {
    const id = String(row.assignmentId ?? '').trim();
    if (!id) continue;
    const ref = db.doc(`tenants/${tenantId}/assignments/${id}`);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const a = snap.data() || {};
    const status = String(a.status ?? '').toLowerCase();
    if (DEAD_RE.test(status) || !LIVE_RE.test(status)) continue;
    const start = asIso(a.startDate) ?? asIso(a.start);
    const end = asIso(a.endDate) ?? start;
    const effEnd = end && start && end >= start ? end : start;
    // Ongoing guard (2026-07-20): mirrors the sweep — an open-ended doc with
    // a standing schedule must never be auto-ended on the date axis.
    const isOngoing =
      !asIso(a.endDate) &&
      (String(a.jobOrderType ?? '') === 'career' ||
        a.isOpenShift === true ||
        a.noFixedTimes === true ||
        (a.weeklySchedule && Object.keys(a.weeklySchedule).length > 0));
    const dateStale = !isOngoing && Boolean(effEnd && effEnd < today);
    if (!dateStale && !(await joIsKilled(String(a.jobOrderId ?? '')))) continue;
    batch.update(ref, {
      status: 'completed',
      previousStatus: a.status ?? '',
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      completedReason: dateStale
        ? 'ai-triage: shift ended, auto-completed overnight'
        : 'ai-triage: job order closed, auto-completed overnight',
      notificationsSuppressed: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: ACTOR,
    });
    completed += 1;
    inBatch += 1;
    if (inBatch >= 400) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();
  return completed;
}

/** Auto-apply exact-confidence cancel_booking rows; returns counts. */
async function applyExactCancels(
  tenantId: string,
): Promise<{ rows: number; assignments: number; remaining: Record<string, number> }> {
  const snap = await db
    .collection(`tenants/${tenantId}/external_shift_requests`)
    .where('status', '==', 'needs_review')
    .limit(200)
    .get();
  let rows = 0;
  let assignments = 0;
  const remaining: Record<string, number> = {};
  for (const doc of snap.docs) {
    const r = doc.data() || {};
    const eventType = String(r.eventType ?? 'unknown');
    const autoApplicable =
      eventType === 'cancel_booking' &&
      r.matchConfidence === 'exact' &&
      Array.isArray(r.matchedAssignmentIds) &&
      r.matchedAssignmentIds.length > 0;
    if (!autoApplicable) {
      remaining[eventType] = (remaining[eventType] || 0) + 1;
      continue;
    }
    try {
      // Quiet hours (Greg, 2026-07-19): 4:30am cancellations must not
      // buzz workers' phones — the notice is queued for 8am worksite-local.
      const result = await applyShiftRequestCore(tenantId, doc.id, ACTOR, {
        quietNotifications: true,
      });
      rows += 1;
      assignments += Number(result.cancelled ?? 0);
    } catch (err) {
      // Row stays needs_review for the human — never force it.
      remaining[eventType] = (remaining[eventType] || 0) + 1;
      logger.warn('[triage] exact cancel auto-apply failed; left for review', {
        tenantId,
        requestId: doc.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { rows, assignments, remaining };
}

/** Plain-English morning brief. AI first, deterministic fallback always. */
async function writeBrief(facts: {
  autoCompletedStale: number;
  autoAppliedCancels: number;
  autoCancelledAssignments: number;
  remainingNeedsReview: Record<string, number>;
  coverageGaps: Array<{ date?: string; accountName?: string; jobTitle?: string; gap?: number }>;
  totalGapSeats: number;
}): Promise<{ brief: string; briefSource: 'ai' | 'fallback' }> {
  const remainingTotal = Object.values(facts.remainingNeedsReview).reduce((a, b) => a + b, 0);
  const fallbackParts: string[] = [];
  if (facts.autoCompletedStale > 0) {
    fallbackParts.push(`Overnight, ${facts.autoCompletedStale} finished worker${facts.autoCompletedStale === 1 ? ' was' : 's were'} closed out automatically.`);
  }
  if (facts.autoAppliedCancels > 0) {
    fallbackParts.push(`${facts.autoAppliedCancels} Indeed Flex cancellation${facts.autoAppliedCancels === 1 ? '' : 's'} (${facts.autoCancelledAssignments} worker${facts.autoCancelledAssignments === 1 ? '' : 's'}) were applied for you.`);
  }
  if (remainingTotal > 0) {
    fallbackParts.push(`${remainingTotal} portal update${remainingTotal === 1 ? '' : 's'} still need${remainingTotal === 1 ? 's' : ''} your review.`);
  }
  if (facts.totalGapSeats > 0) {
    fallbackParts.push(`Upcoming shifts still need ${facts.totalGapSeats} people.`);
  }
  const fallback = fallbackParts.join(' ') || 'Nothing needed attention overnight — schedules are clean.';

  if (!process.env.OPENAI_API_KEY) return { brief: fallback, briefSource: 'fallback' };
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-5',
      // gpt-5 is a reasoning model — completion tokens are consumed by
      // reasoning first, so leave generous headroom (same lesson as the
      // Fieldglass extractor).
      max_completion_tokens: 1500,
      messages: [
        {
          role: 'system',
          content:
            'You write a 2-4 sentence morning brief for staffing recruiters who are not technical. ' +
            'Plain everyday English, warm but efficient, no jargon (never say "assignment records", ' +
            '"sync", "portal rows" — say workers, shifts, updates). First: what was handled ' +
            'automatically overnight. Then: the single most important thing to do first today and ' +
            'why. Do not use bullet points or headings. Do not invent facts not in the data.',
        },
        { role: 'user', content: JSON.stringify(facts) },
      ],
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    if (text && text.length > 20) return { brief: text, briefSource: 'ai' };
    return { brief: fallback, briefSource: 'fallback' };
  } catch (err) {
    logger.warn('[triage] AI brief failed; using fallback', {
      err: err instanceof Error ? err.message : String(err),
    });
    return { brief: fallback, briefSource: 'fallback' };
  }
}

export const schedulingTriageNightly = onSchedule(
  {
    schedule: '30 11 * * *', // 11:30 UTC daily — 30 min after the sweep
    timeZone: 'UTC',
    memory: '512MiB',
    timeoutSeconds: 540,
  },
  async () => {
    const tenantsSnap = await db.collection('tenants').get();
    for (const tenant of tenantsSnap.docs) {
      try {
        const latestRef = db.doc(`tenants/${tenant.id}/schedule_divergence/latest`);
        const latest = await latestRef.get();
        if (!latest.exists) continue;
        const runDate = String(latest.data()?.runDate ?? '');
        if (!runDate) continue;
        const snapRef = db.doc(`tenants/${tenant.id}/schedule_divergence/${runDate}`);
        const snap = await snapRef.get();
        if (!snap.exists) continue;
        const data = snap.data() || {};

        const autoCompletedStale = await completeStale(
          tenant.id,
          Array.isArray(data.staleLiveAssignments) ? data.staleLiveAssignments : [],
        );
        const cancels = await applyExactCancels(tenant.id);
        const { brief, briefSource } = await writeBrief({
          autoCompletedStale,
          autoAppliedCancels: cancels.rows,
          autoCancelledAssignments: cancels.assignments,
          remainingNeedsReview: cancels.remaining,
          coverageGaps: (Array.isArray(data.coverageGaps) ? data.coverageGaps : []).slice(0, 5),
          totalGapSeats: Number(data.counts?.totalGapSeats ?? 0),
        });

        const triage: TriageOutcome = {
          ranAt: admin.firestore.FieldValue.serverTimestamp(),
          autoCompletedStale,
          autoAppliedCancels: cancels.rows,
          autoCancelledAssignments: cancels.assignments,
          remainingNeedsReview: cancels.remaining,
          brief,
          briefSource,
        };
        await snapRef.set({ triage }, { merge: true });
        await latestRef.set({ triage }, { merge: true });
        logger.info('[triage] tenant complete', {
          tenantId: tenant.id,
          autoCompletedStale,
          autoAppliedCancels: cancels.rows,
          briefSource,
        });
      } catch (err) {
        logger.error('[triage] tenant failed', {
          tenantId: tenant.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },
);
