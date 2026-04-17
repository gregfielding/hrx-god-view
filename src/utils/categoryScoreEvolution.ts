/**
 * Read helpers for category score evolution (`categoryScoresCurrent` + `category_score_events`).
 * Applying deltas / recomputing current scores is implemented in a later phase.
 */

import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import type { CategoryScoreEventDoc, CategoryScoreEventSource } from '../types/categoryScoreEvolution';
import { PRESCREEN_CATEGORY_IDS, type PrescreenCategoryId } from '../types/prescreenCategoryScores';
import {
  parsePrescreenCategoryScoresFromFirestore,
} from './parseRecruiterCategoryScores';

export const CATEGORY_SCORE_EVENTS_SUBCOLLECTION = 'category_score_events';

const EVENT_SOURCES: CategoryScoreEventSource[] = [
  'interview',
  'shift_completion',
  'no_show',
  'background_check',
  'activity',
  'recruiter_override',
];

function isEventSource(s: string): s is CategoryScoreEventSource {
  return (EVENT_SOURCES as string[]).includes(s);
}

/**
 * Parses a `users/{uid}/category_score_events/{eventId}` document.
 */
export function parseCategoryScoreEventDoc(data: unknown): CategoryScoreEventDoc | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const catRaw = o.category;
  let category: PrescreenCategoryId | null =
    typeof catRaw === 'string' && PRESCREEN_CATEGORY_IDS.includes(catRaw as PrescreenCategoryId)
      ? (catRaw as PrescreenCategoryId)
      : null;
  const acd = o.appliedCategoryDeltas;
  if (!category && acd && typeof acd === 'object' && !Array.isArray(acd)) {
    const m = acd as Record<string, unknown>;
    const first = PRESCREEN_CATEGORY_IDS.find((k) => typeof m[k] === 'number' && Number.isFinite(m[k] as number));
    if (first) category = first;
  }
  const appliedDelta = o.appliedDelta;
  const legacyDelta = o.delta;
  const appliedTotalAbs = o.appliedTotalAbs;
  const delta =
    typeof appliedDelta === 'number' && Number.isFinite(appliedDelta)
      ? appliedDelta
      : typeof legacyDelta === 'number' && Number.isFinite(legacyDelta)
        ? legacyDelta
        : typeof appliedTotalAbs === 'number' && Number.isFinite(appliedTotalAbs)
          ? appliedTotalAbs
          : null;
  if (delta === null) return null;
  const source = o.source;
  if (typeof source !== 'string' || !isEventSource(source)) return null;
  const refIdRaw = o.referenceId;
  if (refIdRaw !== undefined && refIdRaw !== null && typeof refIdRaw !== 'string') return null;

  const out: CategoryScoreEventDoc = {
    category,
    delta,
    source,
    createdAt: o.createdAt,
  };
  if (typeof o.requestedDelta === 'number' && Number.isFinite(o.requestedDelta)) {
    out.requestedDelta = o.requestedDelta;
  }
  if (typeof o.appliedDelta === 'number' && Number.isFinite(o.appliedDelta)) {
    out.appliedDelta = o.appliedDelta;
  }
  if (typeof o.deltaClamped === 'boolean') out.deltaClamped = o.deltaClamped;
  if (typeof o.idempotencyKeySha256 === 'string') out.idempotencyKeySha256 = o.idempotencyKeySha256;
  if (typeof o.previousValue === 'number') out.previousValue = o.previousValue;
  if (typeof o.newValue === 'number') out.newValue = o.newValue;
  if (typeof o.bootstrappedFromInterview === 'boolean') out.bootstrappedFromInterview = o.bootstrappedFromInterview;
  if (refIdRaw !== undefined) {
    out.referenceId = refIdRaw === null ? null : (refIdRaw as string);
  }
  if (o.categoryDeltas && typeof o.categoryDeltas === 'object' && !Array.isArray(o.categoryDeltas)) {
    out.categoryDeltas = o.categoryDeltas as CategoryScoreEventDoc['categoryDeltas'];
  }
  if (acd && typeof acd === 'object' && !Array.isArray(acd)) {
    out.appliedCategoryDeltas = acd as CategoryScoreEventDoc['appliedCategoryDeltas'];
  }
  if (typeof o.appliedTotalAbs === 'number' && Number.isFinite(o.appliedTotalAbs)) out.appliedTotalAbs = o.appliedTotalAbs;
  if (typeof o.requestedTotalAbs === 'number' && Number.isFinite(o.requestedTotalAbs)) out.requestedTotalAbs = o.requestedTotalAbs;
  if (typeof o.deltaClampedAny === 'boolean') out.deltaClampedAny = o.deltaClampedAny;
  if (typeof o.policyVersion === 'string') out.policyVersion = o.policyVersion;
  if (o.scoreAudit && typeof o.scoreAudit === 'object' && !Array.isArray(o.scoreAudit)) {
    out.scoreAudit = o.scoreAudit as CategoryScoreEventDoc['scoreAudit'];
  }
  return out;
}

/**
 * Latest worker AI pre-screen interview that has parsable `ai.categoryScores` (for profile fallback UI).
 */
export async function fetchLatestWorkerAiPrescreenCategorySnapshot(uid: string): Promise<
  ReturnType<typeof parsePrescreenCategoryScoresFromFirestore>
> {
  const ref = collection(db, 'users', uid, 'interviews');
  let snap;
  try {
    snap = await getDocs(query(ref, orderBy('createdAt', 'desc'), limit(40)));
  } catch {
    try {
      snap = await getDocs(query(ref, orderBy('timestamp', 'desc'), limit(40)));
    } catch {
      snap = await getDocs(ref);
    }
  }

  const docs = snap.docs.slice().sort((a, b) => {
    const ad = a.data() as { createdAt?: { toDate?: () => Date }; timestamp?: { toDate?: () => Date } };
    const bd = b.data() as { createdAt?: { toDate?: () => Date }; timestamp?: { toDate?: () => Date } };
    const at = ad.createdAt?.toDate?.()?.getTime() ?? ad.timestamp?.toDate?.()?.getTime() ?? 0;
    const bt = bd.createdAt?.toDate?.()?.getTime() ?? bd.timestamp?.toDate?.()?.getTime() ?? 0;
    return bt - at;
  });

  for (const d of docs) {
    const data = d.data() as Record<string, unknown>;
    if (data.interviewKind !== 'worker_ai_prescreen') continue;
    const parsed = parsePrescreenCategoryScoresFromFirestore(data.ai);
    if (parsed.scores) return parsed;
  }

  return { scores: null, evidence: null };
}

/** Parsed event plus Firestore doc id (for internal debugging). */
export type CategoryScoreEventRow = CategoryScoreEventDoc & { id: string };

/**
 * Recent events, newest first. Prefers `orderBy(createdAt desc) + limit` when the index exists;
 * falls back to full subcollection read + in-memory sort (small subcollections only).
 */
export async function fetchRecentCategoryScoreEvents(uid: string, max = 10): Promise<CategoryScoreEventRow[]> {
  const ref = collection(db, 'users', uid, CATEGORY_SCORE_EVENTS_SUBCOLLECTION);
  let snap;
  try {
    snap = await getDocs(query(ref, orderBy('createdAt', 'desc'), limit(max)));
  } catch {
    snap = await getDocs(ref);
  }
  const out: CategoryScoreEventRow[] = [];
  const toMs = (x: unknown): number => {
    try {
      const t = x as { toDate?: () => Date };
      const dt = t?.toDate?.();
      return dt instanceof Date ? dt.getTime() : 0;
    } catch {
      return 0;
    }
  };
  for (const d of snap.docs) {
    const parsed = parseCategoryScoreEventDoc(d.data());
    if (parsed) out.push({ ...parsed, id: d.id });
  }
  out.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
  return out.slice(0, max);
}

/** Recruiter-facing label for `source` on stored events. */
export function formatCategoryScoreEventSourceLabel(source: CategoryScoreEventSource): string {
  switch (source) {
    case 'interview':
      return 'Interview / AI scoring';
    case 'background_check':
      return 'Background check';
    case 'shift_completion':
      return 'Shift completion';
    case 'no_show':
      return 'No-show';
    case 'activity':
      return 'Activity';
    case 'recruiter_override':
      return 'Recruiter override';
    default:
      return source;
  }
}

const CATEGORY_LABEL: Record<PrescreenCategoryId, string> = {
  reliability: 'Reliability',
  punctuality: 'Punctuality',
  workEthic: 'Work ethic',
  teamFit: 'Team fit',
  jobReadiness: 'Job readiness',
  stability: 'Stability',
};

export function formatPrescreenCategoryLabel(category: PrescreenCategoryId): string {
  return CATEGORY_LABEL[category] ?? category;
}

/**
 * One-line summary of the sum of applied deltas in the shown events, by category.
 */
export function summarizeRecentCategoryScoreEventDeltas(events: CategoryScoreEventRow[]): string | null {
  if (!events.length) return null;
  const sums = new Map<PrescreenCategoryId, number>();
  for (const e of events) {
    const multi = e.appliedCategoryDeltas;
    if (multi && typeof multi === 'object') {
      for (const k of PRESCREEN_CATEGORY_IDS) {
        const v = (multi as Record<string, unknown>)[k];
        if (typeof v === 'number' && Number.isFinite(v)) {
          sums.set(k, (sums.get(k) ?? 0) + v);
        }
      }
      continue;
    }
    const d = typeof e.appliedDelta === 'number' && Number.isFinite(e.appliedDelta) ? e.appliedDelta : e.delta ?? 0;
    if (e.category) sums.set(e.category, (sums.get(e.category) ?? 0) + d);
  }
  const parts: string[] = [];
  for (const k of PRESCREEN_CATEGORY_IDS) {
    const v = sums.get(k);
    if (v == null || v === 0) continue;
    parts.push(`${formatPrescreenCategoryLabel(k)} ${v > 0 ? '+' : ''}${v}`);
  }
  if (!parts.length) return null;
  return `Net change across the updates below: ${parts.join('; ')}.`;
}

/**
 * Single-line, human-readable event for recruiter Score tab (uses only stored category, delta, source).
 */
export function formatCategoryScoreEventSummaryLine(ev: CategoryScoreEventRow): string {
  const multi = ev.appliedCategoryDeltas;
  if (multi && typeof multi === 'object') {
    const parts: string[] = [];
    for (const k of PRESCREEN_CATEGORY_IDS) {
      const v = (multi as Record<string, unknown>)[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) continue;
      const sign = v > 0 ? '+' : '';
      parts.push(`${sign}${v} ${formatPrescreenCategoryLabel(k)}`);
    }
    const src = formatCategoryScoreEventSourceLabel(ev.source);
    if (parts.length) return `${parts.join('; ')} — ${src}`;
  }
  const applied =
    typeof ev.appliedDelta === 'number' && Number.isFinite(ev.appliedDelta) ? ev.appliedDelta : ev.delta ?? 0;
  const sign = applied > 0 ? '+' : '';
  const cat = ev.category ? formatPrescreenCategoryLabel(ev.category) : 'Multiple categories';
  const src = formatCategoryScoreEventSourceLabel(ev.source);
  return `${sign}${applied} ${cat} — ${src}`;
}
