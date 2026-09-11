/**
 * Natalie's audit trail + outbox queues (roadmap Phase 1, 2026-09-07).
 *
 * Top-level collections (server-only; the client never reads them, and
 * single-field indexes are automatic so no composite indexes are needed):
 *   natalie_actions      — every action she took and why (who asked, Slack link)
 *   natalie_followups    — portal actions she queued from Slack; the inbox
 *                          tick posts their outcome back into the thread
 *   natalie_escalations  — recruiter DMs to send (no-show, unreachable worker)
 *   natalie_relays       — worker SMS replies to relay into an escalation thread
 * Each action is also mirrored onto the worker's `activityLogs` so it shows
 * in HRX next to everything else that happened to that person.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { PERSONAS, scopePersona, type PersonaId } from './personas';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const NATALIE_HRX_UID = 'sSPyxJiaYsXlHJb5XUOJ3d14PcU2';
export const NATALIE_DISPLAY_NAME = 'Natalie Brooks';

export interface SlackRef {
  channel: string;
  ts?: string;
  threadTs?: string;
}

export function slackPermalink(ref: SlackRef | undefined): string | null {
  if (!ref?.channel || !ref.ts) return null;
  return `https://c1staffing.slack.com/archives/${ref.channel}/p${ref.ts.replace('.', '')}`;
}

export interface NatalieActionInput {
  tenantId: string;
  kind: 'portal_sync' | 'flex_accept' | 'worker_sms' | 'worker_note' | 'task' | 'escalation' | 'flex_team_ask' | 'brief' | 'relay' | string;
  askedBySlackUserId?: string | null;
  askedByName?: string | null;
  slack?: SlackRef;
  input?: Record<string, unknown>;
  result?: Record<string, unknown>;
  /** One line a recruiter can read in the HRX activity feed. */
  summary: string;
  userId?: string | null;
  jobOrderId?: string | null;
  assignmentId?: string | null;
  /** Who acted (personas.ts). Default natalie. */
  persona?: PersonaId;
}

/** Record what Natalie (or Marco) did and mirror it on the worker's activity feed. Never throws. */
export async function recordNatalieAction(a: NatalieActionInput): Promise<string | null> {
  try {
    const now = admin.firestore.FieldValue.serverTimestamp();
    const persona: PersonaId = a.persona ?? 'natalie';
    const ref = await db.collection('natalie_actions').add({
      tenantId: a.tenantId,
      persona,
      kind: a.kind,
      askedBySlackUserId: a.askedBySlackUserId ?? null,
      askedByName: a.askedByName ?? null,
      slack: a.slack ?? null,
      slackPermalink: slackPermalink(a.slack),
      input: a.input ?? null,
      result: a.result ?? null,
      summary: a.summary,
      userId: a.userId ?? null,
      jobOrderId: a.jobOrderId ?? null,
      assignmentId: a.assignmentId ?? null,
      createdAt: now,
    });
    if (a.userId) {
      await db.collection('users').doc(a.userId).collection('activityLogs').add({
        action: PERSONAS[persona].firstName,
        actionType: 'natalie_action',
        description: a.askedByName ? `${a.summary} (asked by ${a.askedByName} in Slack)` : a.summary,
        severity: 'low',
        source: 'slack',
        metadata: { natalieActionId: ref.id, persona, kind: a.kind, slackPermalink: slackPermalink(a.slack), assignmentId: a.assignmentId ?? null, jobOrderId: a.jobOrderId ?? null },
        userId: a.userId,
        tenantId: a.tenantId,
        timestamp: now,
        createdAt: now,
      });
    }
    return ref.id;
  } catch (err) {
    logger.warn('[natalie] recordNatalieAction failed (non-fatal)', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Ask the inbox tick to report a portal action's outcome back into a Slack thread. */
export async function registerFollowup(input: { tenantId: string; portalActionId: string; slack: SlackRef; askedByName?: string | null; description: string; persona?: PersonaId }): Promise<void> {
  try {
    await db.collection('natalie_followups').doc(input.portalActionId).set(
      {
        tenantId: input.tenantId,
        persona: input.persona ?? 'natalie',
        portalActionId: input.portalActionId,
        slack: input.slack,
        askedByName: input.askedByName ?? null,
        description: input.description,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 12 * 3600_000),
      },
      { merge: true },
    );
  } catch (err) {
    logger.warn('[natalie] registerFollowup failed (non-fatal)', { err: err instanceof Error ? err.message : String(err) });
  }
}

export interface EscalationInput {
  tenantId: string;
  assignmentId: string;
  assignment: Record<string, unknown>;
  kind: 'no_show' | 'unreachable' | 'cancelled';
  detail?: string;
  /** Daily-confirm crews (2026-09-11): one escalation per (kind, assignment, workday). */
  workDate?: string;
  /** That workday's start (Timestamp) — the DM's "when", instead of the assignment's first day. */
  startAt?: unknown;
}

/** Queue a recruiter DM (drained by the inbox tick). Idempotent per (kind, assignment[, workDate]). */
export async function enqueueRecruiterEscalation(input: EscalationInput): Promise<boolean> {
  try {
    const cfg = await db.doc('app_config/natalie').get();
    if (cfg.get('escalationsEnabled') === false) return false;
    const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const a = input.assignment;
    const id = input.workDate
      ? `${input.kind}__${input.assignmentId}__${input.workDate}`
      : `${input.kind}__${input.assignmentId}`;
    const ref = db.collection('natalie_escalations').doc(id);
    if ((await ref.get()).exists) return false;
    await ref.set({
      tenantId: input.tenantId,
      assignmentId: input.assignmentId,
      // Scope owner (Marco = C1 Events minus Oakland Arena); the drain downgrades to Natalie while Marco is off.
      persona: scopePersona(a),
      hiringEntityId: s(a.hiringEntityId) || s(a.entityId) || null,
      accountId: s(a.accountId) || null,
      locationId: s(a.locationId) || null,
      kind: input.kind,
      detail: input.detail ?? null,
      userId: s(a.userId) || s(a.candidateId) || null,
      jobOrderId: s(a.jobOrderId) || null,
      workerName: `${s(a.workerFirstName) || s(a.firstName)} ${s(a.workerLastName) || s(a.lastName)}`.trim() || s(a.workerName) || null,
      jobTitle: s(a.jobTitle) || s(a.title) || s(a.jobOrderName) || null,
      site: s(a.locationName) || s(a.worksiteName) || s(a.companyName) || null,
      startTime: input.startAt ?? a.startTime ?? a.startDate ?? a.shiftDate ?? null,
      workDate: input.workDate ?? null,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  } catch (err) {
    logger.warn('[natalie] enqueueRecruiterEscalation failed (non-fatal)', { err: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** Relay a worker's SMS reply into the escalation thread for that assignment. */
export async function enqueueWorkerReplyRelay(input: { tenantId: string; assignmentId: string; userId?: string | null; workerName?: string | null; text: string; intent?: string | null }): Promise<boolean> {
  try {
    const asg = await db.doc(`tenants/${input.tenantId}/assignments/${input.assignmentId}`).get();
    const esc = asg.get('natalieEscalation') as { channel?: string; ts?: string; persona?: PersonaId } | undefined;
    const flexAsk = asg.get('natalieFlexAsk') as { channel?: string; ts?: string } | undefined;
    if (!esc?.channel && !flexAsk?.channel) return false;
    await db.collection('natalie_relays').add({
      tenantId: input.tenantId,
      assignmentId: input.assignmentId,
      userId: input.userId ?? null,
      workerName: input.workerName ?? null,
      text: input.text.slice(0, 500),
      intent: input.intent ?? null,
      // Post with the token of whoever opened the escalation thread (a Flex ask is always Natalie's).
      persona: esc?.channel ? esc.persona ?? 'natalie' : 'natalie',
      targets: [esc, flexAsk].filter((t): t is { channel: string; ts?: string } => Boolean(t?.channel)).map((t) => ({ channel: t.channel, ts: t.ts })),
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  } catch (err) {
    logger.warn('[natalie] enqueueWorkerReplyRelay failed (non-fatal)', { err: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
