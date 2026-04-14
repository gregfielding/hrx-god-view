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
  groupMemberCount: number;
  applicationsScanned: number;
  eligibleCount: number;
  excludedCount: number;
  auditId: string | null;
  onboardingStarted?: number;
  onboardingFailed?: Array<{ userId: string; message: string }>;
};

const userGroupHirePassedCandidates = httpsCallable<
  { tenantId: string; groupId: string; mode: 'execute' },
  UserGroupHirePassedExecuteResult
>(getFunctions(app, REGION), 'userGroupHirePassedCandidates');

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
  lines.push(
    `Scanned ${r.applicationsScanned} application(s) (${r.groupMemberCount} group members). Eligible: ${r.eligibleCount}, excluded: ${r.excludedCount}.`,
  );
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
      'No eligible rows (interview completed + orchestrator advance + no blocking C1 employment). If everyone shows “interview not completed”, complete AI prescreens first.',
    );
  }
  return lines.join('\n');
}
