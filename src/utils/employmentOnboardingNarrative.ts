/**
 * Human-readable onboarding: **summary** = one-line current state; **events** = ordered timeline.
 *
 * Copy rules by sourceType (admin vs worker) are implemented in the `narrativeFor*` functions below.
 */

import type {
  EmploymentAssignmentSummary,
  EmploymentOnboardingNarrative,
  EmploymentOnboardingNarrativeActor,
  EmploymentOnboardingNarrativeEvent,
  EmploymentOnboardingRow,
  OnboardingInstanceSnapshot,
  OnboardingPathGroup,
  PipelineStepRow,
  WorkerOnboardingPipeline,
} from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { SignatureEnvelopeStatus } from '../types/phase1cOnboarding';
import type { WorkerPayrollAccount } from '../types/payroll';
import type { BackgroundCheckRecord } from '../types/backgroundCheck';
import type { ExternalOnboardingStepRecord } from '../types/externalOnboardingSteps';
import { isExternalOnboardingStepVerifiedComplete, parseExternalOnboardingSteps } from './externalOnboardingSteps';

const FALLBACK_ADMIN = 'Not started yet — no detailed activity recorded.';
const FALLBACK_WORKER = 'Nothing to do here yet.';

export interface EverifyCaseNarrativeBrief {
  caseId: string;
  entityId?: string;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  statusDisplay?: string;
}

/** Subset of tenants/{tid}/onboarding_automation_dispatch for payroll narrative (MVP). */
export interface OnboardingAutomationDispatchBrief {
  id: string;
  createdAt: Date | null;
  eventType: string;
  messageTypeId?: string | null;
  outcome: string;
  hiringEntityId?: string | null;
  assignmentId?: string | null;
  correlationKey?: string | null;
  skipReason?: string | null;
  details?: Record<string, unknown> | null;
}

export interface OnboardingNarrativeContext {
  pipeline: WorkerOnboardingPipeline | null;
  payrollAccount: (WorkerPayrollAccount & { id: string }) | null;
  backgroundChecksForEntity: BackgroundCheckRecord[];
  allTenantWorkerBackgroundChecks: BackgroundCheckRecord[];
  envelopesByAssignmentId: Map<string, Map<string, SignatureEnvelopeStatus>>;
  onboardingByInstanceId: Map<string, OnboardingInstanceSnapshot>;
  assignments: EmploymentAssignmentSummary[];
  /** Select-entity E-Verify cases with timestamps (from everify_cases). */
  everifyCaseBriefs?: EverifyCaseNarrativeBrief[];
  /** Optional display name for worker-facing copy (e.g. profile name). */
  workerDisplayName?: string;
  /** Optional activity lines keyed by `EmploymentOnboardingRow.rowId`. */
  messagingEventsByRowId?: Record<string, EmploymentOnboardingNarrativeEvent[]>;
  /** Admin = recruiter profile UI; worker = My Employment. Default `admin`. */
  narrativeAudience?: 'admin' | 'worker';
  /** Payroll / onboarding automation dispatch rows for this entity (filtered client-side). */
  automationDispatchBriefs?: OnboardingAutomationDispatchBrief[];
}

function aud(ctx: OnboardingNarrativeContext): 'admin' | 'worker' {
  return ctx.narrativeAudience ?? 'admin';
}

function fallbackPhrase(ctx: OnboardingNarrativeContext): string {
  return aud(ctx) === 'worker' ? FALLBACK_WORKER : FALLBACK_ADMIN;
}

/** Third-person worker reference for admin timelines only. */
function workerNameAdmin(ctx: OnboardingNarrativeContext): string {
  const n = String(ctx.workerDisplayName || '').trim();
  return n || 'The worker';
}

function hiringTeam(ctx: OnboardingNarrativeContext): string {
  return aud(ctx) === 'worker' ? 'Your hiring team' : 'The hiring team';
}

function normalizeNarrativeActor(role: EmploymentOnboardingRow['owner']): EmploymentOnboardingNarrativeActor {
  if (role === 'recruiter') return 'hiring_team';
  if (role === 'vendor') return 'screening_partner';
  if (role === 'system') return 'system';
  return 'worker';
}

function isGenericFallbackSummary(summary: string, _ctx: OnboardingNarrativeContext): boolean {
  return summary === FALLBACK_ADMIN || summary === FALLBACK_WORKER;
}

/**
 * Secondary line under timeline entries (admin vs worker).
 * Accepts legacy `recruiter` / `vendor` on stored events.
 */
export function narrativeActorLabelForUi(
  type: EmploymentOnboardingNarrativeEvent['type'] | undefined,
  audience: 'admin' | 'worker'
): string | undefined {
  if (!type) return undefined;
  const t =
    type === 'recruiter'
      ? 'hiring_team'
      : type === 'vendor'
        ? 'screening_partner'
        : (type as EmploymentOnboardingNarrativeActor);

  if (audience === 'worker') {
    const map: Record<string, string> = {
      worker: 'You',
      hiring_team: 'Hiring team',
      screening_partner: 'Screening partner',
      verification_service: 'E-Verify',
      system: 'Automatic update',
    };
    return map[t] ?? undefined;
  }
  const map: Record<string, string> = {
    worker: 'Worker',
    hiring_team: 'Hiring team',
    screening_partner: 'Screening partner',
    verification_service: 'E-Verify / verification service',
    system: 'System',
  };
  return map[t] ?? String(t);
}

/** Status-first summary when we lack rich events (replaces generic fallback when row has signal). */
function narrativeFallbackFromRow(row: EmploymentOnboardingRow, ctx: OnboardingNarrativeContext): EmploymentOnboardingNarrative {
  const a = aud(ctx);
  const sl = String(row.statusLabel || '').trim();
  const st = row.status;

  if (st === 'completed') {
    return {
      summary: a === 'worker' ? 'You’re done with this step.' : 'Step completed.',
      events: [],
    };
  }
  if (st === 'satisfied_by_existing_record') {
    return {
      summary:
        a === 'worker'
          ? 'An earlier record already covers this—no need to redo it.'
          : 'Satisfied from an existing compliance record.',
      events: [],
    };
  }
  if (st === 'not_required') {
    return { summary: a === 'worker' ? 'This doesn’t apply to you.' : 'Not required for this worker/entity.', events: [] };
  }
  if (st === 'error') {
    return {
      summary:
        sl || (a === 'worker' ? 'Something went wrong—ask your hiring team for help.' : 'Error — see status details.'),
      events: [],
    };
  }
  if (st === 'in_progress') {
    if (sl) {
      return {
        summary: a === 'worker' ? `${sl}.` : `${sl}${row.blocking ? ' (blocking).' : '.'}`,
        events: [],
      };
    }
    return {
      summary: a === 'worker' ? 'This step is in progress.' : 'In progress.',
      events: [],
    };
  }
  if (sl && st === 'not_started') {
    return { summary: `${sl}.`, events: [] };
  }
  return { summary: fallbackPhrase(ctx), events: [] };
}

/**
 * Canonical fallback narrative for any path row: always returns a non-empty `summary` (admin vs worker wording).
 */
export function defaultNarrativeForRow(
  row: EmploymentOnboardingRow,
  ctx: OnboardingNarrativeContext
): EmploymentOnboardingNarrative {
  const n = narrativeFallbackFromRow(row, ctx);
  const summary = String(n.summary ?? '').trim() || fallbackPhrase(ctx);
  return {
    summary,
    events: n.events?.length ? n.events : undefined,
  };
}

type LoosePipelineStep = PipelineStepRow & {
  orderedAt?: unknown;
  completedAt?: unknown;
  createdAt?: unknown;
  milestones?: Array<{
    label?: string;
    title?: string;
    completed?: boolean;
    completedAt?: unknown;
  }>;
};

export function coerceFirestoreDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const t = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
  if (typeof t.toDate === 'function') {
    try {
      const d = t.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (typeof t.seconds === 'number') {
    const d = new Date(t.seconds * 1000 + (t.nanoseconds ?? 0) / 1e6);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function onboardingAutomationDispatchBriefFromRaw(
  id: string,
  raw: Record<string, unknown>
): OnboardingAutomationDispatchBrief {
  const det = raw.details;
  return {
    id,
    createdAt: coerceFirestoreDate(raw.createdAt),
    eventType: String(raw.eventType ?? ''),
    messageTypeId: raw.messageTypeId != null ? String(raw.messageTypeId) : null,
    outcome: String(raw.outcome ?? ''),
    hiringEntityId: raw.hiringEntityId != null ? String(raw.hiringEntityId) : null,
    assignmentId: raw.assignmentId != null ? String(raw.assignmentId) : null,
    correlationKey: raw.correlationKey != null ? String(raw.correlationKey) : null,
    skipReason: raw.skipReason != null ? String(raw.skipReason) : null,
    details: det != null && typeof det === 'object' && !Array.isArray(det) ? (det as Record<string, unknown>) : null,
  };
}

const SCREENING_AUTO_PREFIX = 'screening_auto_';

export function filterScreeningAutomationDispatchBriefs(
  briefs: OnboardingAutomationDispatchBrief[] | undefined,
  assignmentId: string | null | undefined
): OnboardingAutomationDispatchBrief[] {
  const aid = String(assignmentId || '').trim();
  if (!aid || !briefs?.length) return [];
  return briefs.filter(
    (b) =>
      String(b.assignmentId || '').trim() === aid && String(b.messageTypeId || '').startsWith(SCREENING_AUTO_PREFIX)
  );
}

/**
 * Employment V2: dispatch rows are included only when `assignmentId` is one of this tab’s assignments.
 * Hiring-entity-only matches are intentionally excluded to prevent cross-entity screening leakage.
 */
export function automationDispatchBriefMatchesEntityTab(opts: {
  brief: OnboardingAutomationDispatchBrief;
  entityFirestoreId: string | null | undefined;
  assignmentIdsForTab: readonly string[];
}): boolean {
  const idSet = new Set(
    opts.assignmentIdsForTab.map((x) => String(x || '').trim()).filter(Boolean)
  );
  const aid = String(opts.brief.assignmentId || '').trim();
  return Boolean(aid && idSet.has(aid));
}

export function filterAutomationDispatchBriefsForEntityTab(
  all: OnboardingAutomationDispatchBrief[] | undefined,
  entityFirestoreId: string | null | undefined,
  assignmentIdsForTab: readonly string[]
): OnboardingAutomationDispatchBrief[] {
  if (!all?.length) return [];
  return all.filter((b) =>
    automationDispatchBriefMatchesEntityTab({ brief: b, entityFirestoreId, assignmentIdsForTab })
  );
}

export function isScreeningPackageCheckKey(key: string): boolean {
  const k = String(key || '').toLowerCase();
  if (k === 'background_check' || k === 'drug_screen' || k === 'drug_screening') return true;
  if (k.includes('background_check') || k.includes('drug_screen')) return true;
  return false;
}

/** `already_satisfied` dispatch points at this backgroundChecks id. */
export function isBackgroundCheckReusedByScreeningSkip(
  backgroundCheckId: string,
  briefs: OnboardingAutomationDispatchBrief[]
): boolean {
  return briefs.some(
    (b) =>
      String(b.messageTypeId || '') === 'screening_auto_skipped' &&
      String(b.skipReason || '') === 'already_satisfied' &&
      String(b.details?.backgroundCheckId || '') === backgroundCheckId
  );
}

/**
 * Assignment Requirements → screening orders: Ordered | In progress | Completed | Reused.
 */
export function screeningOrderRequirementStatusLabel(
  r: BackgroundCheckRecord,
  opts: { screeningBriefs: OnboardingAutomationDispatchBrief[]; primaryAssignmentId: string | null }
): string {
  if (isBackgroundCheckReusedByScreeningSkip(r.id, opts.screeningBriefs)) return 'Reused';
  const autoAid = String((r as { automationAssignmentId?: string }).automationAssignmentId || '');
  const forPrimary = Boolean(opts.primaryAssignmentId && autoAid === opts.primaryAssignmentId);
  const autoSrc = String((r as { automationSource?: string }).automationSource || '');
  const st = String(r.hrxStatus || '');
  if (r.orderCompleted || st === 'completed') return 'Completed';
  if (st === 'report_ready' || st === 'drug_report_ready') return 'In progress';
  if (st === 'in_progress' || st === 'queued' || st === 'submitted') return 'In progress';
  if (st === 'awaiting_applicant') {
    if (forPrimary || autoSrc === 'assignment_confirmed') return 'Ordered';
    return 'Awaiting applicant';
  }
  if (st === 'draft' && forPrimary && autoSrc === 'assignment_confirmed') return 'Ordered';
  const map: Record<string, string> = {
    completed: 'Completed',
    report_ready: 'Report ready',
    drug_report_ready: 'Drug report ready',
    in_progress: 'In progress',
    awaiting_applicant: 'Awaiting applicant',
    submitted: 'Submitted',
    queued: 'Queued',
    draft: 'Draft',
    canceled: 'Canceled',
    error: 'Error',
  };
  return map[st] || st.replace(/_/g, ' ');
}

function detailStr(d: OnboardingAutomationDispatchBrief, k: string): string | undefined {
  const v = d.details?.[k];
  return v != null && String(v).trim() ? String(v).trim() : undefined;
}

/** One-line explainer for Active Assignment Requirements (admin/worker). */
export function screeningAutomationExplainerFromBriefs(
  briefs: OnboardingAutomationDispatchBrief[],
  audience: 'admin' | 'worker'
): string | null {
  if (!briefs.length) return null;
  const sorted = [...briefs].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  const parts = sorted.map((b) => screeningBriefOneLine(b, audience)).filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** Synthetic “Required checks” row when there is no package check row but screening dispatch exists. */
export function screeningAutomationSyntheticRowContent(
  briefs: OnboardingAutomationDispatchBrief[],
  bgList: BackgroundCheckRecord[],
  primaryAssignmentId: string | null,
  audience: 'admin' | 'worker'
): { statusLabel: string; inlineExplainer: string } | null {
  if (!briefs.length) return null;
  const sorted = [...briefs].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  const last = sorted[sorted.length - 1];
  const explainer = screeningAutomationExplainerFromBriefs(briefs, audience) || '';
  const opts = { screeningBriefs: briefs, primaryAssignmentId };

  const mid = String(last.messageTypeId || '');
  const sr = String(last.skipReason || '');
  if (mid === 'screening_auto_skipped' && sr === 'already_satisfied') {
    return { statusLabel: 'Reused', inlineExplainer: explainer };
  }
  if (mid === 'screening_auto_failed') {
    return { statusLabel: 'Failed', inlineExplainer: explainer };
  }
  const orderedEvents = sorted.filter((b) => b.messageTypeId === 'screening_auto_ordered');
  const latestOrdered = orderedEvents[orderedEvents.length - 1];
  if (latestOrdered) {
    const bid = latestOrdered.details?.backgroundCheckId;
    const bg = bid != null ? bgList.find((x) => x.id === String(bid)) : undefined;
    const statusLabel = bg ? screeningOrderRequirementStatusLabel(bg, opts) : 'Ordered';
    return { statusLabel, inlineExplainer: explainer };
  }
  return { statusLabel: '—', inlineExplainer: explainer };
}

function screeningBriefOneLine(b: OnboardingAutomationDispatchBrief, audience: 'admin' | 'worker'): string {
  const mid = String(b.messageTypeId || '');
  const when = b.createdAt && !Number.isNaN(b.createdAt.getTime()) ? formatWhen(b.createdAt) : '';
  const bid = detailStr(b, 'backgroundCheckId');
  const pkg = detailStr(b, 'packageSummary');
  const err = detailStr(b, 'error');
  const simulated = b.details?.simulated === true;
  const isWorker = audience === 'worker';

  if (mid === 'screening_auto_ordered') {
    if (isWorker) {
      const base = when
        ? `Your hiring team started a background check for you at ${when}.`
        : 'Your hiring team started a background check for you.';
      const simNote = simulated
        ? ' You may still need to finish steps in your profile or email—your team can confirm.'
        : '';
      return `${base}${simNote}`.trim();
    }
    const base = when
      ? `Screening was ordered automatically at ${when}.`
      : 'Screening was ordered automatically.';
    const simNote = simulated ? ' Simulated order — AccuSource was not called.' : '';
    const idNote = bid ? ` Order id ${bid.slice(0, 8)}…` : '';
    return `${base}${simNote}${idNote}`.trim();
  }
  if (mid === 'screening_auto_failed') {
    if (isWorker) {
      return when
        ? `We couldn’t finish setting up your background check at ${when}. Contact your hiring team for help.`
        : 'We couldn’t finish setting up your background check. Contact your hiring team for help.';
    }
    const e = err ? ` ${err.slice(0, 120)}` : '';
    return when ? `Screening automation failed (${when}).${e}` : `Screening automation failed.${e}`;
  }
  if (mid === 'screening_auto_skipped') {
    const sr = String(b.skipReason || '').trim();
    if (sr === 'already_satisfied') {
      return isWorker
        ? when
          ? `You already have screening on file that covers this job (${when})—no new check was ordered.`
          : 'You already have screening on file that covers this job—no new check was ordered.'
        : when
          ? `Screening skipped due to existing record (${when}).`
          : 'Screening skipped due to existing record.';
    }
    const labelAdmin =
      sr === 'missing_candidate_or_job_order'
        ? 'missing assignment references'
        : sr === 'no_package'
          ? 'no screening package resolved'
          : sr === 'dry_run'
            ? 'dry run only (no order)'
            : sr === 'concurrent_run'
              ? 'another automation run in progress'
              : sr || 'skipped';
    const labelWorker =
      sr === 'missing_candidate_or_job_order'
        ? 'setup issue on the assignment'
        : sr === 'no_package'
          ? 'no screening package was set up for this job'
          : sr === 'dry_run'
            ? 'automation ran in preview mode only'
            : sr === 'concurrent_run'
              ? 'another check was already in progress'
              : sr || 'something prevented a new order';
    if (isWorker) {
      return when
        ? `A new background check wasn’t started: ${labelWorker} (${when}).`
        : `A new background check wasn’t started: ${labelWorker}.`;
    }
    return when ? `Automation skipped: ${labelAdmin} (${when}).` : `Automation skipped: ${labelAdmin}.`;
  }
  if (pkg) return `${mid.replace(SCREENING_AUTO_PREFIX, '')}: ${pkg}`;
  return mid || 'Screening automation update';
}

function screeningAutomationBriefsForAssignment(
  ctx: OnboardingNarrativeContext,
  assignmentId: string
): OnboardingAutomationDispatchBrief[] {
  return filterScreeningAutomationDispatchBriefs(ctx.automationDispatchBriefs, assignmentId);
}

function mergeScreeningAutomationIntoAssignmentNarrative(
  base: EmploymentOnboardingNarrative,
  briefs: OnboardingAutomationDispatchBrief[],
  ctx: OnboardingNarrativeContext
): EmploymentOnboardingNarrative {
  const sortedBriefs = [...briefs].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  const extraEvents: EmploymentOnboardingNarrativeEvent[] = [];
  for (const d of sortedBriefs) {
    const message = screeningBriefOneLine(d, aud(ctx));
    extraEvents.push({
      type: 'system',
      timestamp: d.createdAt ?? undefined,
      message: message.endsWith('.') ? message : `${message}.`,
    });
  }
  const mergedEvents = sortEventsChronologically([...extraEvents, ...(base.events ?? [])]);
  const autoLine = screeningAutomationExplainerFromBriefs(briefs, aud(ctx));
  const summary =
    autoLine && base.summary
      ? `${autoLine} ${base.summary}`
      : autoLine || base.summary;
  return { summary, events: mergedEvents.length ? mergedEvents : undefined };
}

function formatWhen(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString();
  } catch {
    return '';
  }
}

function withWhen(message: string, d: Date | null | undefined): string {
  const w = formatWhen(d);
  return w ? `${message} (${w}).` : `${message}.`;
}

function sortEventsChronologically(events: EmploymentOnboardingNarrativeEvent[]): EmploymentOnboardingNarrativeEvent[] {
  return [...events].sort((a, b) => {
    const ta = a.timestamp?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const tb = b.timestamp?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });
}

function findPipelineStep(
  pipeline: WorkerOnboardingPipeline | null,
  pipelineStepId: string | undefined
): LoosePipelineStep | undefined {
  if (!pipelineStepId || !pipeline?.steps?.length) return undefined;
  const id = String(pipelineStepId);
  return pipeline.steps.find((s) => String(s.id || '') === id) as LoosePipelineStep | undefined;
}

function resolveBackgroundRecord(
  row: EmploymentOnboardingRow,
  ctx: OnboardingNarrativeContext
): BackgroundCheckRecord | undefined {
  const bid = row.sourceRef?.backgroundCheckId;
  if (bid) {
    const hit =
      ctx.backgroundChecksForEntity.find((c) => c.id === bid) ||
      ctx.allTenantWorkerBackgroundChecks.find((c) => c.id === bid);
    if (hit) return hit;
  }
  if (ctx.backgroundChecksForEntity.length === 1) return ctx.backgroundChecksForEntity[0];
  return ctx.backgroundChecksForEntity[0];
}

function resolveEverifyBrief(
  row: EmploymentOnboardingRow,
  ctx: OnboardingNarrativeContext
): EverifyCaseNarrativeBrief | undefined {
  const briefs = ctx.everifyCaseBriefs;
  if (!briefs?.length) return undefined;
  const cid = row.sourceRef?.caseId || row.artifactId;
  if (cid) return briefs.find((b) => b.caseId === cid) ?? briefs.find((b) => b.caseId === String(cid));
  return briefs[0];
}

function parseAssignmentRowMeta(row: EmploymentOnboardingRow): {
  assignmentId: string;
  kind: 'doc' | 'step' | 'check' | 'unknown';
  key: string;
} | null {
  const m = /^assignment__(.+?)__(doc|step|check)__(.+)$/.exec(row.rowId);
  if (!m) return null;
  return { assignmentId: m[1], kind: m[2] as 'doc' | 'step' | 'check', key: m[3] };
}

function backgroundCheckSummary(bg: BackgroundCheckRecord, ctx: OnboardingNarrativeContext): string {
  const a = aud(ctx);
  const st = String(bg.hrxStatus || '').toLowerCase();
  if (st === 'completed' || bg.orderCompleted) {
    return a === 'worker' ? 'Your background check for this step is complete.' : 'Screening order complete.';
  }
  if (st === 'awaiting_applicant' || st === 'draft') {
    return a === 'worker'
      ? 'Your background check is waiting on information from you.'
      : 'Screening awaiting applicant / intake.';
  }
  if (st === 'in_progress' || st === 'submitted' || st === 'queued') {
    return a === 'worker'
      ? 'Your background check is in progress with the screening partner.'
      : 'Screening in progress with partner.';
  }
  if (st === 'report_ready' || st === 'drug_report_ready') {
    return a === 'worker' ? 'Results are in—your hiring team may still be reviewing them.' : 'Report ready — review with partner output.';
  }
  if (st === 'canceled' || st === 'error') {
    return a === 'worker' ? 'This screening hit a problem—ask your hiring team.' : `Screening status: ${st}.`;
  }
  return a === 'worker' ? 'Background check is open for this step.' : 'Screening order active.';
}

function narrativeForBackgroundCheck(row: EmploymentOnboardingRow, ctx: OnboardingNarrativeContext): EmploymentOnboardingNarrative {
  const bg = resolveBackgroundRecord(row, ctx);
  const events: EmploymentOnboardingNarrativeEvent[] = [];

  if (!bg) {
    return narrativeFallbackFromRow(row, ctx);
  }

  const created = coerceFirestoreDate(bg.createdAt);
  if (created) {
    events.push({
      type: 'system',
      timestamp: created,
      message:
        aud(ctx) === 'worker'
          ? withWhen('A background check was started for you', created)
          : withWhen('Screening order created (AccuSource / partner pipeline)', created),
    });
  }

  if (bg.profileCompleted) {
    const t = coerceFirestoreDate(bg.updatedAt) ?? coerceFirestoreDate(bg.lastWebhookAt);
    events.push({
      type: 'worker',
      timestamp: t ?? undefined,
      message:
        aud(ctx) === 'worker'
          ? withWhen('You submitted the information the screening partner asked for', t)
          : withWhen(`${workerNameAdmin(ctx)} submitted applicant information to the screening partner`, t),
    });
  }

  const vendorTs =
    coerceFirestoreDate(bg.lastWebhookAt) ??
    coerceFirestoreDate(bg.lastServiceComponent?.updatedAt ?? null) ??
    coerceFirestoreDate(bg.updatedAt);

  if (vendorTs && (bg.hrxStatus === 'in_progress' || bg.hrxStatus === 'submitted' || bg.hrxStatus === 'awaiting_applicant')) {
    events.push({
      type: 'screening_partner',
      timestamp: vendorTs,
      message:
        aud(ctx) === 'worker'
          ? withWhen('The screening partner last updated this check', vendorTs)
          : withWhen('Screening partner reported progress on this order', vendorTs),
    });
  }

  if (bg.orderCompleted || bg.hrxStatus === 'completed' || bg.hrxStatus === 'report_ready') {
    const resultTs = coerceFirestoreDate(bg.updatedAt) ?? vendorTs;
    events.push({
      type: 'screening_partner',
      timestamp: resultTs ?? undefined,
      message:
        aud(ctx) === 'worker'
          ? withWhen('Screening results are ready for this order', resultTs)
          : withWhen('Partner marked screening results ready / complete', resultTs),
    });
  }

  const sorted = sortEventsChronologically(events);
  const summary = backgroundCheckSummary(bg, ctx);
  return { summary, events: sorted.length ? sorted : undefined };
}

function narrativeForEverify(row: EmploymentOnboardingRow, ctx: OnboardingNarrativeContext): EmploymentOnboardingNarrative {
  const brief = resolveEverifyBrief(row, ctx);
  if (!brief) {
    return narrativeFallbackFromRow(row, ctx);
  }

  const events: EmploymentOnboardingNarrativeEvent[] = [];
  const created = brief.createdAt ?? null;
  if (created) {
    events.push({
      type: 'hiring_team',
      timestamp: created,
      message:
        aud(ctx) === 'worker'
          ? withWhen(`${hiringTeam(ctx)} started your work eligibility check (E-Verify)`, created)
          : withWhen('E-Verify case opened for this worker', created),
    });
  }

  const updated = brief.updatedAt ?? null;
  const status = String(brief.statusDisplay || '').trim() || 'Pending';
  events.push({
    type: 'verification_service',
    timestamp: updated ?? undefined,
    message:
      aud(ctx) === 'worker'
        ? updated
          ? withWhen(`E-Verify result: ${status}`, updated)
          : `Latest from E-Verify: ${status}.`
        : updated
          ? withWhen(`E-Verify case status: ${status}`, updated)
          : `E-Verify status: ${status}.`,
  });

  const sorted = sortEventsChronologically(events);
  const summary =
    aud(ctx) === 'worker'
      ? `Work eligibility check: ${status}.`
      : `E-Verify: ${status}${brief.caseId ? ` (case ${brief.caseId.slice(0, 8)}…)` : ''}.`;

  return { summary, events: sorted };
}

function narrativeForPayroll(row: EmploymentOnboardingRow, ctx: OnboardingNarrativeContext): EmploymentOnboardingNarrative {
  const acct = ctx.payrollAccount;
  if (!acct) {
    return narrativeFallbackFromRow(row, ctx);
  }

  const events: EmploymentOnboardingNarrativeEvent[] = [];
  const inviteAt =
    coerceFirestoreDate(acct.inviteSentAt) ||
    coerceFirestoreDate(acct.payrollInviteSentAt);
  const lastCh = String(acct.lastInviteChannel || '').trim();
  const inviteStatus = String(acct.inviteStatus || '').toLowerCase();

  const entityId = String(acct.entityId || '').trim();
  const briefs = (ctx.automationDispatchBriefs || []).filter(
    (d) => entityId && String(d.hiringEntityId || '').trim() === entityId
  );

  const dispatchOutcomeOk = (o: string) => o === 'sent' || o === 'recorded';
  const primaryCandidates = briefs.filter(
    (d) =>
      String(d.messageTypeId || '') === 'payroll_onboarding_invite_needed' &&
      dispatchOutcomeOk(d.outcome) &&
      d.createdAt
  );
  primaryCandidates.sort((a, b) => (a.createdAt!.getTime() || 0) - (b.createdAt!.getTime() || 0));
  const primaryDispatch = primaryCandidates[0];
  const resendDispatches = briefs
    .filter((d) => {
      const mid = String(d.messageTypeId || '');
      return mid.includes('payroll_onboarding_invite') && mid.includes('resend') && dispatchOutcomeOk(d.outcome) && d.createdAt;
    })
    .sort((a, b) => (a.createdAt!.getTime() || 0) - (b.createdAt!.getTime() || 0));

  if (primaryDispatch?.createdAt) {
    const when = primaryDispatch.createdAt;
    events.push({
      type: 'system',
      timestamp: when,
      message:
        aud(ctx) === 'worker'
          ? `Invite sent at ${formatWhen(when)}.`
          : `Automation: payroll invite dispatched at ${formatWhen(when)}.`,
    });
  } else if (inviteAt) {
    const chSuffix = lastCh ? ` (${lastCh})` : '';
    events.push({
      type: 'hiring_team',
      timestamp: inviteAt,
      message:
        aud(ctx) === 'worker'
          ? withWhen(`${hiringTeam(ctx)} sent you a payroll setup invite${chSuffix}`, inviteAt)
          : withWhen(`${hiringTeam(ctx)} sent payroll setup invite${chSuffix}`, inviteAt),
    });
  }

  resendDispatches.forEach((d) => {
    const when = d.createdAt!;
    events.push({
      type: 'system',
      timestamp: when,
      message:
        aud(ctx) === 'worker'
          ? withWhen('Payroll onboarding invite was resent to you', when)
          : withWhen('Payroll onboarding invite resent (automation)', when),
    });
  });

  const setupAt = coerceFirestoreDate(acct.payrollSetupCompletedAt);
  const createdAt = coerceFirestoreDate(acct.payrollAccountCreatedAt);
  if (setupAt) {
    events.push({
      type: 'worker',
      timestamp: setupAt,
      message:
        aud(ctx) === 'worker'
          ? withWhen('You finished payroll setup', setupAt)
          : withWhen(`${workerNameAdmin(ctx)} completed payroll setup`, setupAt),
    });
  } else if (createdAt && !setupAt) {
    events.push({
      type: 'worker',
      timestamp: createdAt,
      message:
        aud(ctx) === 'worker'
          ? withWhen('You started payroll setup (account created)', createdAt)
          : withWhen(`${workerNameAdmin(ctx)} started payroll onboarding (account created)`, createdAt),
    });
  }

  const sorted = sortEventsChronologically(events);
  const ps = String(acct.payrollStatus || '');
  let summary: string;
  if (setupAt || ps === 'complete') {
    summary = aud(ctx) === 'worker' ? 'Payroll setup is complete.' : 'Payroll setup complete for this account.';
  } else if (inviteAt || inviteStatus === 'sent' || ps === 'invite_sent') {
    summary =
      aud(ctx) === 'worker'
        ? 'Use the invite from your hiring team to finish payroll setup.'
        : 'Invite sent — worker still needs to finish payroll setup.';
  } else if (ps === 'blocked') {
    summary =
      aud(ctx) === 'worker'
        ? 'Payroll setup is blocked—ask your hiring team.'
        : 'Payroll account blocked — see notes / support.';
  } else if (sorted.length) {
    summary = aud(ctx) === 'worker' ? 'Payroll setup is in progress.' : `Payroll status: ${ps || 'in progress'}.`;
  } else {
    summary = narrativeFallbackFromRow(row, ctx).summary;
  }

  return { summary, events: sorted.length ? sorted : undefined };
}

function narrativeForPipelineStep(row: EmploymentOnboardingRow, ctx: OnboardingNarrativeContext): EmploymentOnboardingNarrative {
  const stepId = row.sourceRef?.pipelineStepId;
  const step = findPipelineStep(ctx.pipeline, stepId);
  const events: EmploymentOnboardingNarrativeEvent[] = [];

  if (!step) {
    return narrativeFallbackFromRow(row, ctx);
  }

  const ordered = coerceFirestoreDate((step as LoosePipelineStep).orderedAt ?? (step as LoosePipelineStep).createdAt);
  if (ordered) {
    events.push({
      type: 'system',
      timestamp: ordered,
      message:
        aud(ctx) === 'worker'
          ? withWhen('This step was started', ordered)
          : withWhen(`Pipeline step “${stepId || '—'}” opened`, ordered),
    });
  }

  const milestones = Array.isArray((step as LoosePipelineStep).milestones) ? (step as LoosePipelineStep).milestones! : [];
  milestones.forEach((m) => {
    if (!m?.completed) return;
    const mt = coerceFirestoreDate(m.completedAt);
    const label = String(m.label || m.title || 'Milestone').trim();
    const actor = normalizeNarrativeActor(row.owner);
    events.push({
      type: actor,
      timestamp: mt ?? undefined,
      message:
        aud(ctx) === 'worker'
          ? mt
            ? withWhen(`${label} was completed`, mt)
            : `${label} was completed.`
          : mt
            ? withWhen(`${label} marked complete (shared pipeline step)`, mt)
            : `${label} marked complete.`,
    });
  });

  const completed = coerceFirestoreDate((step as LoosePipelineStep).completedAt);
  const updated = coerceFirestoreDate(step.updatedAt);
  const st = String(step.status || '').toLowerCase();
  if (st === 'complete' || st === 'skipped') {
    const ts = completed ?? updated;
    const actor = normalizeNarrativeActor(row.owner);
    const who =
      aud(ctx) === 'worker'
        ? row.owner === 'recruiter'
          ? hiringTeam(ctx)
          : row.owner === 'system'
            ? 'The process'
            : 'You'
        : row.owner === 'recruiter'
          ? hiringTeam(ctx)
          : row.owner === 'system'
            ? 'System'
            : workerNameAdmin(ctx);
    events.push({
      type: actor,
      timestamp: ts ?? undefined,
      message: ts ? withWhen(`${who} finished this step`, ts) : `${who} finished this step.`,
    });
  } else if (updated && events.length === 0) {
    events.push({
      type: 'system',
      timestamp: updated,
      message:
        aud(ctx) === 'worker'
          ? withWhen('Progress was last updated', updated)
          : withWhen('Pipeline step last synced', updated),
    });
  }

  const sorted = sortEventsChronologically(events);
  const sl = String(row.statusLabel || '').trim();
  let summary: string;
  if (st === 'complete' || st === 'skipped') {
    summary = aud(ctx) === 'worker' ? 'This step is done.' : sl ? `${sl}.` : 'Pipeline step complete.';
  } else if (sl) {
    summary = aud(ctx) === 'worker' ? `${sl}.` : `${sl}${row.blocking ? ' — blocks readiness.' : ''}`;
  } else if (row.lastUpdatedAt) {
    const d = coerceFirestoreDate(row.lastUpdatedAt);
    summary =
      aud(ctx) === 'worker'
        ? d
          ? `In progress — last updated ${formatWhen(d)}.`
          : 'In progress.'
        : d
          ? `In progress — last updated ${formatWhen(d)}.`
          : 'In progress.';
  } else {
    summary = narrativeFallbackFromRow(row, ctx).summary;
  }

  return { summary, events: sorted.length ? sorted : undefined };
}

function narrativeForAssignmentRequirement(row: EmploymentOnboardingRow, ctx: OnboardingNarrativeContext): EmploymentOnboardingNarrative {
  const meta = parseAssignmentRowMeta(row);
  const assignmentId = row.sourceRef?.assignmentId || meta?.assignmentId;
  if (!assignmentId) {
    return narrativeFallbackFromRow(row, ctx);
  }
  if (!meta) {
    return {
      summary:
        row.status === 'completed' || row.status === 'satisfied_by_existing_record'
          ? aud(ctx) === 'worker'
            ? 'You’re done with this job requirement.'
            : 'Assignment package requirement satisfied.'
          : aud(ctx) === 'worker'
            ? 'This job requirement is still open.'
            : 'Assignment requirement still open.',
      events: [],
    };
  }

  const instId = ctx.assignments.find((a) => a.assignmentId === assignmentId)?.onboardingInstanceId;
  const inst = instId ? ctx.onboardingByInstanceId.get(instId) : undefined;
  const env = ctx.envelopesByAssignmentId.get(assignmentId) || new Map<string, SignatureEnvelopeStatus>();

  const events: EmploymentOnboardingNarrativeEvent[] = [];

  if (inst) {
    events.push({
      type: 'system',
      message:
        aud(ctx) === 'worker'
          ? 'This was added to your job onboarding package.'
          : 'Requirement added to assignment onboarding package.',
    });
  }

  if (meta.kind === 'doc') {
    const st = env.get(meta.key);
    if (st === 'signed') {
      events.push({
        type: 'worker',
        message: aud(ctx) === 'worker' ? 'You signed this document.' : `${workerNameAdmin(ctx)} signed the document.`,
      });
    } else if (st === 'declined' || st === 'canceled') {
      events.push({
        type: 'worker',
        message:
          aud(ctx) === 'worker'
            ? 'Signing didn’t finish (declined or canceled).'
            : 'E-sign declined or canceled.',
      });
    } else if (row.status === 'completed') {
      events.push({
        type: 'worker',
        message: aud(ctx) === 'worker' ? 'You completed this document requirement.' : 'Document requirement completed.',
      });
    } else {
      events.push({
        type: 'worker',
        message:
          aud(ctx) === 'worker'
            ? 'You still need to complete this document.'
            : 'Waiting on worker to complete document.',
      });
    }
  } else if (meta.kind === 'check') {
    events.push({
      type: 'screening_partner',
      message:
        row.status === 'completed'
          ? aud(ctx) === 'worker'
            ? 'This screening check is complete.'
            : 'Screening partner requirement complete.'
          : aud(ctx) === 'worker'
            ? 'Screening partner is still working on this check.'
            : 'Screening partner requirement in progress.',
    });
  } else {
    events.push({
      type: 'hiring_team',
      message:
        row.status === 'completed'
          ? aud(ctx) === 'worker'
            ? `${hiringTeam(ctx)} finished this admin step.`
            : 'Hiring team completed admin step.'
          : aud(ctx) === 'worker'
            ? `${hiringTeam(ctx)} still needs to finish this admin step.`
            : 'Hiring team action still pending.',
    });
  }

  const sorted = sortEventsChronologically(events);
  const reqDone = row.status === 'completed' || row.status === 'satisfied_by_existing_record';
  let summary: string;
  if (reqDone) {
    summary = aud(ctx) === 'worker' ? 'Done for this job requirement.' : 'Complete.';
  } else if (meta.kind === 'doc') {
    summary = aud(ctx) === 'worker' ? 'Action needed from you on this document.' : 'Waiting on worker document action.';
  } else if (meta.kind === 'check') {
    summary = aud(ctx) === 'worker' ? 'Screening partner still processing.' : 'Vendor check in progress.';
  } else {
    summary =
      aud(ctx) === 'worker'
        ? `${hiringTeam(ctx)} still has a step to finish here.`
        : 'Team step pending.';
  }

  let out: EmploymentOnboardingNarrative = { summary, events: sorted.length ? sorted : undefined };
  if (meta.kind === 'check' && isScreeningPackageCheckKey(meta.key)) {
    const sBriefs = screeningAutomationBriefsForAssignment(ctx, assignmentId);
    if (sBriefs.length) {
      out = mergeScreeningAutomationIntoAssignmentNarrative(out, sBriefs, ctx);
    }
  }
  return out;
}

function narrativeForPipelineTask(row: EmploymentOnboardingRow, ctx: OnboardingNarrativeContext): EmploymentOnboardingNarrative {
  const step = findPipelineStep(ctx.pipeline, row.sourceRef?.pipelineStepId);
  const updated = step ? coerceFirestoreDate(step.updatedAt) : null;
  const isTeam = row.owner === 'recruiter';
  const events: EmploymentOnboardingNarrativeEvent[] = [];
  if (updated) {
    events.push({
      type: isTeam ? 'hiring_team' : 'worker',
      timestamp: updated,
      message:
        aud(ctx) === 'worker'
          ? isTeam
            ? withWhen(`${hiringTeam(ctx)} last updated an internal task`, updated)
            : withWhen('You last updated this task', updated)
          : withWhen(
              `${isTeam ? 'Hiring team' : workerNameAdmin(ctx)} last updated internal task`,
              updated
            ),
    });
  } else {
    events.push({
      type: isTeam ? 'hiring_team' : 'worker',
      message:
        aud(ctx) === 'worker'
          ? isTeam
            ? `${hiringTeam(ctx)} owns this internal task (${row.statusLabel || row.status}).`
            : `You’re responsible for this task (${row.statusLabel || row.status}).`
          : `Owner: ${isTeam ? 'hiring team' : 'worker'} — ${row.statusLabel || row.status}.`,
    });
  }
  const summary =
    aud(ctx) === 'worker'
      ? row.status === 'completed'
        ? isTeam
          ? `${hiringTeam(ctx)} finished their internal task.`
          : 'You finished this task.'
        : isTeam
          ? `Waiting on ${hiringTeam(ctx)} for an internal task.`
          : 'You still have work on this task.'
      : row.status === 'completed'
        ? 'Internal task complete.'
        : 'Internal task open.';

  return { summary, events };
}

/** Fields from `BuildOnboardingPathArgs` needed to build narrative context (no import cycle). */
export type OnboardingPathArgsNarrativeInput = {
  pipeline: WorkerOnboardingPipeline | null;
  payrollAccount: (WorkerPayrollAccount & { id: string }) | null;
  backgroundChecksForEntity: BackgroundCheckRecord[];
  allTenantWorkerBackgroundChecks: BackgroundCheckRecord[];
  envelopesByAssignmentId: Map<string, Map<string, SignatureEnvelopeStatus>>;
  onboardingByInstanceId: Map<string, OnboardingInstanceSnapshot>;
  assignments: EmploymentAssignmentSummary[];
  everifyCaseBriefs?: EverifyCaseNarrativeBrief[];
  automationDispatchBriefs?: OnboardingAutomationDispatchBrief[];
};

/** Build narrative context from the same args object used for `buildOnboardingPathFromSettings`. */
export function onboardingNarrativeContextFromPathArgs(
  args: OnboardingPathArgsNarrativeInput,
  extras?: {
    workerDisplayName?: string;
    narrativeAudience?: 'admin' | 'worker';
    automationDispatchBriefs?: OnboardingAutomationDispatchBrief[];
  }
): OnboardingNarrativeContext {
  return {
    pipeline: args.pipeline,
    payrollAccount: args.payrollAccount,
    backgroundChecksForEntity: args.backgroundChecksForEntity,
    allTenantWorkerBackgroundChecks: args.allTenantWorkerBackgroundChecks,
    envelopesByAssignmentId: args.envelopesByAssignmentId,
    onboardingByInstanceId: args.onboardingByInstanceId,
    assignments: args.assignments,
    everifyCaseBriefs: args.everifyCaseBriefs,
    automationDispatchBriefs: extras?.automationDispatchBriefs ?? args.automationDispatchBriefs,
    workerDisplayName: extras?.workerDisplayName,
    narrativeAudience: extras?.narrativeAudience ?? 'worker',
  };
}

function mergeMessaging(
  row: EmploymentOnboardingRow,
  base: EmploymentOnboardingNarrative,
  ctx: OnboardingNarrativeContext
): EmploymentOnboardingNarrative {
  const extra = ctx.messagingEventsByRowId?.[row.rowId];
  if (!extra?.length) return base;
  const merged = sortEventsChronologically([...(base.events || []), ...extra]);
  return { ...base, events: merged.length ? merged : base.events };
}

function narrativeForExternalOnboarding(
  row: EmploymentOnboardingRow,
  ctx: OnboardingNarrativeContext
): EmploymentOnboardingNarrative {
  const key = row.sourceRef?.externalStepKey;
  const parsed = parseExternalOnboardingSteps(ctx.pipeline?.externalOnboardingSteps);
  const rec: ExternalOnboardingStepRecord | undefined = key && parsed ? parsed[key] : undefined;
  const a = aud(ctx);

  if (!rec) {
    return narrativeFallbackFromRow(row, ctx);
  }

  const events: EmploymentOnboardingNarrativeEvent[] = [];
  const inviteAt = coerceFirestoreDate(rec.inviteSentAt);
  const workerDone = coerceFirestoreDate(rec.workerMarkedCompleteAt);
  const correctionAt = coerceFirestoreDate(rec.correctionRequestedAt);
  const verifiedAt = coerceFirestoreDate(rec.verifiedAt);
  const updatedAt = coerceFirestoreDate(rec.updatedAt);

  if (inviteAt && rec.status !== 'not_started') {
    events.push({
      type: 'system',
      timestamp: inviteAt,
      message:
        a === 'worker'
          ? withWhen('Payroll activity recorded for this step', inviteAt)
          : withWhen('Payroll / invite activity recorded', inviteAt),
    });
  }
  if (workerDone) {
    events.push({
      type: 'worker',
      timestamp: workerDone,
      message:
        a === 'worker'
          ? withWhen('You completed this step in payroll', workerDone)
          : withWhen(`${workerNameAdmin(ctx)} completed this step in payroll`, workerDone),
    });
  }
  if (correctionAt && rec.correctionRequestedAt != null) {
    events.push({
      type: 'hiring_team',
      timestamp: correctionAt,
      message:
        a === 'worker'
          ? withWhen('Your hiring team requested updates to this step', correctionAt)
          : withWhen('Correction requested by C1 Staffing', correctionAt),
    });
  }
  if (isExternalOnboardingStepVerifiedComplete(rec) && verifiedAt) {
    events.push({
      type: 'hiring_team',
      timestamp: verifiedAt,
      message: withWhen('Verified by C1 Staffing', verifiedAt),
    });
  }
  if (rec.status === 'error' && updatedAt) {
    events.push({
      type: 'hiring_team',
      timestamp: updatedAt,
      message:
        a === 'worker'
          ? withWhen('Your hiring team is reviewing this step', updatedAt)
          : withWhen('Marked for review by C1 Staffing', updatedAt),
    });
  }

  const sorted = sortEventsChronologically(events);
  const note = String(rec.verificationNote || '').trim();

  let summary: string;
  if (rec.status === 'completed' && isExternalOnboardingStepVerifiedComplete(rec) && verifiedAt) {
    summary =
      a === 'worker'
        ? `Verified by C1 Staffing on ${formatWhen(verifiedAt)}.`
        : `Verified by C1 Staffing on ${formatWhen(verifiedAt)}.`;
  } else if (rec.status === 'completed' && !isExternalOnboardingStepVerifiedComplete(rec)) {
    summary =
      a === 'worker'
        ? 'Submitted — waiting on your hiring team.'
        : 'Marked complete in payroll — confirm here when ready.';
  } else if (rec.correctionRequestedAt != null && rec.status === 'invite_sent' && correctionAt) {
    const base =
      a === 'worker'
        ? `Your hiring team sent this back for updates on ${formatWhen(correctionAt)}.`
        : `Returned for correction by C1 Staffing on ${formatWhen(correctionAt)}.`;
    summary = note && a === 'worker' ? `${base} ${note}` : base;
  } else if (rec.status === 'pending_admin_verification' || rec.status === 'worker_completed_external') {
    summary =
      a === 'worker'
        ? 'Submitted — waiting on your hiring team.'
        : 'Completed in payroll — confirm here when ready.';
  } else if (rec.status === 'error') {
    summary =
      a === 'worker'
        ? 'Your hiring team is reviewing this step.'
        : updatedAt
          ? `Marked for review by C1 Staffing on ${formatWhen(updatedAt)}.`
          : 'Marked for review by C1 Staffing.';
  } else if (rec.status === 'invite_sent') {
    summary = a === 'worker' ? 'Complete this step in your payroll system.' : 'Waiting on worker in payroll.';
  } else {
    summary = narrativeFallbackFromRow(row, ctx).summary;
  }

  if (
    note &&
    a === 'admin' &&
    (rec.status === 'error' ||
      rec.status === 'invite_sent' ||
      (rec.status === 'completed' && isExternalOnboardingStepVerifiedComplete(rec)))
  ) {
    summary = `${summary} Note: ${note}`;
  }

  return { summary, events: sorted.length ? sorted : undefined };
}

/**
 * Build narrative for a single path row.
 */
export function buildOnboardingRowNarrative(
  row: EmploymentOnboardingRow,
  context: OnboardingNarrativeContext
): EmploymentOnboardingNarrative {
  let out: EmploymentOnboardingNarrative;

  switch (row.sourceType) {
    case 'background_check':
      out = narrativeForBackgroundCheck(row, context);
      break;
    case 'everify':
      out = narrativeForEverify(row, context);
      break;
    case 'payroll':
      out = narrativeForPayroll(row, context);
      break;
    case 'external_onboarding':
      out = narrativeForExternalOnboarding(row, context);
      break;
    case 'pipeline_step':
      out = narrativeForPipelineStep(row, context);
      break;
    case 'assignment_requirement':
      out = narrativeForAssignmentRequirement(row, context);
      break;
    case 'pipeline_task':
      out = narrativeForPipelineTask(row, context);
      break;
    case 'settings_only':
    case 'derived':
    default: {
      if (row.sourceRef?.pipelineStepId) {
        const pipeN = narrativeForPipelineStep(row, context);
        const rowFb = narrativeFallbackFromRow(row, context);
        if ((pipeN.events?.length ?? 0) > 0 || pipeN.summary !== rowFb.summary) {
          out = pipeN;
          break;
        }
      }
      out = narrativeFallbackFromRow(row, context);
      break;
    }
  }

  if (isGenericFallbackSummary(out.summary, context) && row.lastUpdatedAt) {
    const d = coerceFirestoreDate(row.lastUpdatedAt);
    if (d) {
      out = {
        summary:
          aud(context) === 'worker'
            ? `Last updated ${formatWhen(d)}.`
            : `Last synced ${formatWhen(d)}.`,
        events: [
          {
            type: 'system',
            timestamp: d,
            message:
              aud(context) === 'worker'
                ? withWhen('Your onboarding record was last updated', d)
                : withWhen('Onboarding record last updated', d),
          },
        ],
      };
    }
  }

  let merged = mergeMessaging(row, out, context);
  const trimmed = String(merged.summary ?? '').trim();
  if (!trimmed) {
    merged = { ...merged, ...defaultNarrativeForRow(row, context) };
  } else {
    merged = { ...merged, summary: trimmed };
  }
  return merged;
}

function narrativeContextFromBuildOverview(ctx: {
  workerOnboarding: WorkerOnboardingPipeline | null;
  payrollAccount: (WorkerPayrollAccount & { id: string }) | null;
  backgroundChecksForEntity: BackgroundCheckRecord[];
  allTenantWorkerBackgroundChecks: BackgroundCheckRecord[];
  envelopesByAssignmentId: Map<string, Map<string, SignatureEnvelopeStatus>>;
  onboardingByInstanceId: Map<string, OnboardingInstanceSnapshot>;
  assignments: EmploymentAssignmentSummary[];
  everifyCaseBriefs?: EverifyCaseNarrativeBrief[];
  narrativeAudience?: 'admin' | 'worker';
  automationDispatchBriefs?: OnboardingAutomationDispatchBrief[];
}): OnboardingNarrativeContext {
  return {
    pipeline: ctx.workerOnboarding,
    payrollAccount: ctx.payrollAccount,
    backgroundChecksForEntity: ctx.backgroundChecksForEntity,
    allTenantWorkerBackgroundChecks: ctx.allTenantWorkerBackgroundChecks,
    envelopesByAssignmentId: ctx.envelopesByAssignmentId,
    onboardingByInstanceId: ctx.onboardingByInstanceId,
    assignments: ctx.assignments,
    everifyCaseBriefs: ctx.everifyCaseBriefs,
    narrativeAudience: ctx.narrativeAudience ?? 'admin',
    automationDispatchBriefs: ctx.automationDispatchBriefs,
  };
}

function combineMergedRequirementNarratives(parts: EmploymentOnboardingNarrative[]): EmploymentOnboardingNarrative {
  const summaries = parts.map((p) => p.summary).filter((s) => s && String(s).trim());
  const summary = summaries.length ? summaries.join(' · ') : '—';
  const events = sortEventsChronologically(parts.flatMap((p) => p.events || []));
  return { summary, events: events.length ? events : undefined };
}

/** Attach `narrative` to every row in grouped path output. */
export function enrichOnboardingPathGroupsWithNarratives(
  groups: OnboardingPathGroup[],
  context: OnboardingNarrativeContext
): OnboardingPathGroup[] {
  return groups.map((g) => ({
    ...g,
    rows: g.rows.map((r) => {
      const details = r.requirementDetailRows;
      if (details?.length) {
        const perDetail = details.map((dr) => {
          const base = buildOnboardingRowNarrative({ ...dr, narrative: undefined }, context);
          return mergeMessaging(dr, base, context);
        });
        const combined = combineMergedRequirementNarratives(perDetail);
        const narrative = mergeMessaging(r, combined, context);
        return {
          ...r,
          narrative,
          requirementDetailRows: details.map((dr, i) => ({
            ...dr,
            narrative: perDetail[i],
          })),
        };
      }
      return {
        ...r,
        narrative: mergeMessaging(r, buildOnboardingRowNarrative(r, context), context),
      };
    }),
  }));
}

export function enrichOnboardingPathWithNarrativesFromOverviewDeps(
  groups: OnboardingPathGroup[],
  deps: Parameters<typeof narrativeContextFromBuildOverview>[0]
): OnboardingPathGroup[] {
  return enrichOnboardingPathGroupsWithNarratives(groups, narrativeContextFromBuildOverview(deps));
}

export function buildEverifyCaseBriefsForSelectEntity(
  caseDocs: Array<{ id: string; data: () => Record<string, unknown> }>,
  selectEntityId: string | null
): EverifyCaseNarrativeBrief[] {
  if (!selectEntityId) return [];
  return caseDocs
    .filter((d) => String(d.data().entityId || '') === selectEntityId)
    .map((d) => {
      const raw = d.data();
      const pub = raw.public as { status?: string } | undefined;
      return {
        caseId: d.id,
        entityId: String(raw.entityId || ''),
        createdAt: coerceFirestoreDate(raw.createdAt),
        updatedAt: coerceFirestoreDate(raw.updatedAt),
        statusDisplay: String(pub?.status ?? raw.status ?? ''),
      };
    });
}
