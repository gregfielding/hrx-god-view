/**
 * One-click: scan hire-passed eligible applications for a user group + start on-call onboarding per eligible user.
 */
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

const REGION = 'us-central1';

export type UserGroupHirePassedExecuteResult = {
  groupId: string;
  tenantId: string;
  mode: string;
  /** Default `current_policy`: re-run orchestrator with saved interview scores + **today’s** tenant/group policy. */
  eligibilityMode?: 'stored' | 'current_policy';
  groupMemberCount: number;
  applicationsScanned: number;
  /**
   * Members of the group who have no application linked. Surfaced as synthetic
   * scan rows; under the `hire_everyone` quality preset they count toward
   * `eligibleCount` (catchall-group invite pattern), otherwise toward
   * `excludedCount`.
   */
  membersWithoutApplicationCount?: number;
  eligibleCount: number;
  excludedCount: number;
  /**
   * Per-reason histogram for excluded rows. Sorted by `count` desc on the
   * server. Rendered in the dialog so recruiters can immediately see whether
   * eligibility is held back by missing prescreens, terminal applications,
   * blocking C1 Select employment, etc. — instead of just a single total.
   */
  exclusionBreakdown?: Array<{ category: string; label: string; count: number }>;
  auditId: string | null;
  onboardingStarted?: number;
  onboardingFailed?: Array<{ userId: string; message: string }>;
};

const userGroupHirePassedCandidates = httpsCallable<
  { tenantId: string; groupId: string; mode?: 'preview' | 'commit' | 'execute' },
  UserGroupHirePassedExecuteResult
>(getFunctions(app, REGION), 'userGroupHirePassedCandidates');

/** Same eligibility rules as **Hire Passed Candidates** (interview completed + orchestrator advance + C1 checks). */
export async function runUserGroupHirePassedPreview(params: {
  tenantId: string;
  groupId: string;
}): Promise<UserGroupHirePassedExecuteResult> {
  const { data } = await userGroupHirePassedCandidates({
    tenantId: params.tenantId,
    groupId: params.groupId,
    mode: 'preview',
  });
  return data as UserGroupHirePassedExecuteResult;
}

export async function runUserGroupHirePassedExecute(params: {
  tenantId: string;
  groupId: string;
}): Promise<UserGroupHirePassedExecuteResult> {
  const { data } = await userGroupHirePassedCandidates({
    tenantId: params.tenantId,
    groupId: params.groupId,
    mode: 'execute',
  });
  return data as UserGroupHirePassedExecuteResult;
}

export function formatUserGroupHirePassedSuccess(r: UserGroupHirePassedExecuteResult): string {
  const lines: string[] = [];
  lines.push('Hire passed — on-call onboarding run finished.');
  const modeLine =
    r.eligibilityMode === 'stored'
      ? 'Eligibility mode: stored Firestore decisions only.'
      : 'Eligibility mode: current tenant + group policy (re-evaluated per application).';
  lines.push(modeLine);
  const noAppCount = r.membersWithoutApplicationCount ?? 0;
  const noAppFragment = noAppCount > 0 ? ` · ${noAppCount} member(s) without an application` : '';
  lines.push(
    `Scanned ${r.applicationsScanned} application(s) (${r.groupMemberCount} group members${noAppFragment}). Eligible: ${r.eligibleCount}, excluded: ${r.excludedCount}.`,
  );
  if ((r.exclusionBreakdown?.length ?? 0) > 0) {
    lines.push('Exclusion breakdown:');
    for (const b of r.exclusionBreakdown!) {
      lines.push(`  • ${b.count} · ${b.label}`);
    }
  }
  if (r.auditId) {
    lines.push(`Audit log: ${r.auditId}`);
  }
  const started = r.onboardingStarted ?? 0;
  const failed = r.onboardingFailed ?? [];
  lines.push(`On-call onboarding started: ${started}.`);
  if (failed.length > 0) {
    lines.push(`Failed (${failed.length}):`);
    for (const f of failed.slice(0, 20)) {
      lines.push(`  • ${f.userId}: ${f.message}`);
    }
    if (failed.length > 20) {
      lines.push(`  … and ${failed.length - 20} more`);
    }
  }
  if (r.eligibleCount === 0) {
    lines.push(
      'No eligible rows: prescreen completed, current-policy orchestrator advance, and no blocking C1 employment. If many lack prescreen completion, finish interviews first.',
    );
  }
  return lines.join('\n');
}
