/**
 * Worker profile: when to show one-line cross-links between Employment and Backgrounds
 * (screening vs payroll / I-9 ownership — no duplicated checklists).
 */

import type { EmploymentEntityOverview } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { isOnboardingPathRowDone } from './employmentOnboardingPath';

const SCREENING_TEXT_RE = /screen|background|drug|idv|identity|veriff/i;
const TERMINAL_EMPLOYMENT_STATUS_RE = /complete|pass|clear|cleared|waived|not_required|satisfied|negative|authorized/i;

function employmentPolicyScreeningIncomplete(ee: EmploymentEntityOverview['entityEmployment']): boolean {
  if (!ee) return false;
  if (ee.backgroundRequired) {
    const st = String(ee.backgroundStatus || '').trim();
    if (!st || !TERMINAL_EMPLOYMENT_STATUS_RE.test(st)) return true;
  }
  if (ee.drugScreenRequired) {
    const st = String(ee.drugScreenStatus || '').trim();
    if (!st || !TERMINAL_EMPLOYMENT_STATUS_RE.test(st)) return true;
  }
  return false;
}

function screeningRowLooksOpen(statusLabel: string): boolean {
  return !/completed|report_ready|drug_report_ready|canceled|cancelled/i.test(String(statusLabel || ''));
}

/**
 * Employment tab → pointer to Backgrounds when screening applies and something is still open for the worker.
 */
export function workerEmploymentShouldShowScreeningPointerAlert(overview: EmploymentEntityOverview): boolean {
  const ee = overview.entityEmployment;
  const vm = overview.assignmentRequirementsViewModel;

  const hasIdvOrScreeningCheck = vm.requiredChecks.some((c) => {
    const row = c.pathRow;
    if (!row) return false;
    return SCREENING_TEXT_RE.test(`${c.title} ${row.stepKey || ''} ${row.label || ''}`);
  });

  const hasScreeningSurface =
    Boolean(ee?.backgroundRequired || ee?.drugScreenRequired) ||
    vm.entityScreeningMilestones.length > 0 ||
    vm.backgroundOrdersLinked.length > 0 ||
    hasIdvOrScreeningCheck;

  if (!hasScreeningSurface) return false;

  if (employmentPolicyScreeningIncomplete(ee)) return true;

  for (const m of vm.entityScreeningMilestones) {
    const row = m.pathRow;
    if (row && !isOnboardingPathRowDone(row.status)) return true;
  }

  for (const o of vm.backgroundOrdersLinked) {
    if (screeningRowLooksOpen(o.statusLabel)) return true;
  }

  for (const c of vm.requiredChecks) {
    const row = c.pathRow;
    if (!row) continue;
    if (!SCREENING_TEXT_RE.test(`${c.title} ${row.stepKey || ''} ${row.label || ''}`)) continue;
    if (!isOnboardingPathRowDone(row.status)) return true;
  }

  return false;
}
