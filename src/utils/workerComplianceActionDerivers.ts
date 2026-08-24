/**
 * Derives high-signal compliance action flags from Firestore-shaped rows.
 * Only explicit statuses / structured vendor lines — no vague inference.
 */

import type { BackgroundCheckRecord } from '../types/backgroundCheck';
import { shouldShowApplicantPortalCta, resolveApplicantPortalUrl } from './backgroundCheckApplicantPortal';

const EVERIFY_WORKER_ACTION_STATUSES = new Set(['tnc', 'further_action_required']);

/**
 * A background check only drives worker-facing action items while it's
 * current. Months-old error/awaiting records are ops debris (superseded
 * orders, dead AccuSource links) — recruiters have their own queue for
 * those (Greg, 2026-08-23).
 */
export const WORKER_COMPLIANCE_RECENCY_DAYS = 30;

function tsToMillis(v: unknown): number | null {
  if (!v) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  const o = v as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof o.toDate === 'function') {
    try {
      return o.toDate().getTime();
    } catch {
      return null;
    }
  }
  if (typeof o.seconds === 'number') return o.seconds * 1000;
  if (typeof o._seconds === 'number') return o._seconds * 1000;
  return null;
}

/** True unless the record provably went untouched for the recency window —
 *  records without readable timestamps stay current (never hide a live check
 *  on a parsing gap). */
function isRecordCurrent(rec: Record<string, unknown>, nowMs: number): boolean {
  const last = tsToMillis(rec.updatedAt) ?? tsToMillis(rec.createdAt);
  if (last == null) return true;
  return nowMs - last <= WORKER_COMPLIANCE_RECENCY_DAYS * 24 * 60 * 60 * 1000;
}

function serviceLineLooksDrug(name: unknown): boolean {
  const n = String(name || '').toLowerCase();
  return (
    n.includes('drug') ||
    n.includes('urine') ||
    n.includes('9 panel') ||
    n.includes('5 panel') ||
    n.includes('dot drug')
  );
}

function statusSuggestsDrugReschedule(status: unknown): boolean {
  const s = String(status || '').toLowerCase();
  return (
    s.includes('no show') ||
    s.includes('no-show') ||
    s.includes('missed') ||
    s.includes('reschedule') ||
    s.includes('expired appointment')
  );
}

function statusSuggestsDrugScheduleNeeded(status: unknown): boolean {
  const s = String(status || '').toLowerCase();
  if (!s) return false;
  return (
    s.includes('schedule') ||
    s.includes('scheduling') ||
    s.includes('appointment needed') ||
    s.includes('needs appointment')
  );
}

export interface WorkerComplianceSignals {
  backgroundApplicantAction: boolean;
  backgroundIssueAction: boolean;
  drugScheduleRequired: boolean;
  drugRescheduleRequired: boolean;
  everifyWorkerAction: boolean;
  /** AccuSource applicant self-service setup URL, when one is on file —
   *  so the dashboard "Background check" action item can deep-link the
   *  worker straight to the portal instead of just the profile page. */
  applicantPortalLink?: string;
}

/**
 * @param backgroundChecks — docs from `backgroundChecks` for this candidate (newest first recommended)
 * @param everifyCases — docs from `tenants/{tid}/everify_cases` for this user
 */
export function deriveWorkerComplianceSignals(
  backgroundChecks: Array<Record<string, unknown>>,
  everifyCases: Array<Record<string, unknown>>
): WorkerComplianceSignals {
  let backgroundApplicantAction = false;
  let backgroundIssueAction = false;
  let drugScheduleRequired = false;
  let drugRescheduleRequired = false;
  let everifyWorkerAction = false;
  let applicantPortalLink: string | undefined;

  for (const ev of everifyCases) {
    const st = String(ev.status || '').toLowerCase();
    if (EVERIFY_WORKER_ACTION_STATUSES.has(st)) everifyWorkerAction = true;
  }

  const nowMs = Date.now();
  for (const c of backgroundChecks) {
    if (!isRecordCurrent(c, nowMs)) continue;
    const hrx = String(c.hrxStatus || '').toLowerCase();
    if (hrx === 'error') {
      backgroundIssueAction = true;
      // No portal deep-link for error records: an errored order has nothing
      // for the worker to do on AccuSource's site (and the old cross-record
      // link harvest dumped workers on myaccusourcedirect.com's login page).
      // The "Review issue" CTA stays in-app.
      continue;
    }

    const pkg = String(c.requestedPackageName || '').toLowerCase();
    const pkgDrug = serviceLineLooksDrug(pkg);

    const last = (c.lastServiceComponent || null) as Record<string, unknown> | null;
    const lastName = last?.serviceName;
    const lastStatus = last?.status;
    const lineDrug = pkgDrug || serviceLineLooksDrug(lastName);

    if (lineDrug && lastStatus != null && statusSuggestsDrugReschedule(lastStatus)) {
      drugRescheduleRequired = true;
    }
    if (lineDrug && lastStatus != null && statusSuggestsDrugScheduleNeeded(lastStatus)) {
      drugScheduleRequired = true;
    }

    if (hrx === 'awaiting_applicant') {
      if (lineDrug) drugScheduleRequired = true;
      /** Match recruiter portal CTA: hide once applicant finished partial profile / HRX advanced (e.g. profileCompleted, order completed). */
      else if (shouldShowApplicantPortalCta(c as unknown as BackgroundCheckRecord)) {
        backgroundApplicantAction = true;
        const link = resolveApplicantPortalUrl(c as unknown as BackgroundCheckRecord);
        if (link) applicantPortalLink = link;
      }
    }

    const svcMap = (c.providerServiceOrderStatus || null) as Record<string, Record<string, unknown>> | null;
    if (svcMap && typeof svcMap === 'object') {
      for (const entry of Object.values(svcMap)) {
        const sn = entry?.serviceName;
        const st = entry?.status;
        if (!serviceLineLooksDrug(sn)) continue;
        if (statusSuggestsDrugReschedule(st)) drugRescheduleRequired = true;
        if (statusSuggestsDrugScheduleNeeded(st)) drugScheduleRequired = true;
      }
    }
  }

  if (drugRescheduleRequired) drugScheduleRequired = false;

  return {
    backgroundApplicantAction,
    backgroundIssueAction,
    drugScheduleRequired,
    drugRescheduleRequired,
    everifyWorkerAction,
    applicantPortalLink,
  };
}
