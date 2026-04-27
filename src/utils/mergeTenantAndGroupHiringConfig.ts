/**
 * Builds the effective user-group hiring config for UI when `useTenantDefaults` is true:
 * tenant `aiHiring`, `hiringConfig.interview`, and `hiringConfig.quality` overlay group-only fields
 * (employment, requirements, hiring active, queue flags).
 */
import { DEFAULT_USER_GROUP_HIRING_CONFIG, type UserGroupHiringConfigV1 } from '../types/userGroupHiringConfig';

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return undefined;
}

export function buildEffectiveUserGroupHiringConfig(
  tenantData: Record<string, unknown> | undefined,
  groupCfg: UserGroupHiringConfigV1,
): UserGroupHiringConfigV1 {
  if (!groupCfg.useTenantDefaults) return groupCfg;

  const base: UserGroupHiringConfigV1 = JSON.parse(JSON.stringify(DEFAULT_USER_GROUP_HIRING_CONFIG));
  base.useTenantDefaults = true;

  const aiHiring = tenantData?.aiHiring as Record<string, unknown> | undefined;
  const hc = tenantData?.hiringConfig as Record<string, unknown> | undefined;
  const interview = hc?.interview as Record<string, unknown> | undefined;
  const tQuality = hc?.quality as Record<string, unknown> | undefined;

  if (typeof interview?.workerAiPrescreenRequired === 'boolean') {
    base.interview = { workerAiPrescreenRequired: interview.workerAiPrescreenRequired };
  }

  if (aiHiring && typeof aiHiring === 'object') {
    const a = aiHiring;
    base.automation = {
      ...base.automation!,
      autoAdvanceEnabled:
        typeof a.autoAdvanceEnabled === 'boolean' ? a.autoAdvanceEnabled : base.automation!.autoAdvanceEnabled,
    };
    base.targets = {
      maximumAutoAdvances: num(a.maximumAutoAdvances) ?? base.targets!.maximumAutoAdvances,
      targetOnboardingCount: num(a.targetOnboardingCount) ?? base.targets!.targetOnboardingCount,
      /** Tenant UI stores this on `aiHiring`; if unset, do not imply “stop at target” without a numeric target. */
      stopWhenTargetReached:
        typeof a.stopWhenTargetReached === 'boolean' ? a.stopWhenTargetReached : false,
    };
    base.quality = {
      ...base.quality!,
      interviewMinimumScoreToAdvance:
        num(a.minimumScoreToAdvance) ?? base.quality!.interviewMinimumScoreToAdvance,
      jobFitMinimumScoreToAdvance:
        num(a.minimumJobScoreToAdvance) ?? base.quality!.jobFitMinimumScoreToAdvance,
      minimumJobScoreGateEnabled:
        typeof a.minimumJobScoreGateEnabled === 'boolean'
          ? a.minimumJobScoreGateEnabled
          : base.quality!.minimumJobScoreGateEnabled,
      jobFitFailAction:
        a.jobFitFailAction === 'hold'
          ? 'hold'
          : a.jobFitFailAction === 'review'
            ? 'review'
            : base.quality!.jobFitFailAction,
      maximumNoShowRiskToAdvance:
        num(tQuality?.maximumNoShowRiskToAdvance) ?? base.quality!.maximumNoShowRiskToAdvance,
    };
  } else {
    base.targets = {
      ...base.targets!,
      stopWhenTargetReached: false,
    };
  }

  base.employment = {
    ...base.employment,
    ...groupCfg.employment,
  };
  base.requirements = {
    ...base.requirements,
    ...groupCfg.requirements,
  };

  base.automation = {
    ...base.automation!,
    autoAdvanceEnabled: base.automation!.autoAdvanceEnabled,
    hiringActive: groupCfg.automation?.hiringActive ?? base.automation!.hiringActive,
    autoOnboardEnabled: groupCfg.automation?.autoOnboardEnabled ?? base.automation!.autoOnboardEnabled,
    queueAfterTargetReached:
      groupCfg.automation?.queueAfterTargetReached ?? base.automation!.queueAfterTargetReached,
  };

  return base;
}

/**
 * Short bullets for tenant-level AI prescreen + gig fallback (shown when a group uses tenant defaults).
 */
export function getTenantHiringPolicySummaryLines(tenantData: Record<string, unknown> | undefined): string[] {
  if (!tenantData) return [];
  const lines: string[] = [];
  const ap = tenantData.aiPrescreen as Record<string, unknown> | undefined;
  if (ap && typeof ap === 'object') {
    if (typeof ap.enabled === 'boolean') {
      lines.push(`Worker AI prescreen: ${ap.enabled ? 'on' : 'off'}`);
    }
    const elig = ap.eligibility as Record<string, unknown> | undefined;
    if (elig && typeof elig === 'object') {
      if (elig.requireResumeOrSkill === true || elig.requireResumeOrWorkHistory === true) {
        lines.push('Requires resume or at least one skill');
      }
      if (elig.requirePhone === true) lines.push('Requires phone');
      if (elig.requireLocation === true) lines.push('Requires location');
      if (elig.requireWorkAuthorization === true) lines.push('Requires work authorization');
    }
    const q = ap.questions as Record<string, unknown> | undefined;
    if (q && typeof q === 'object') {
      const labels: Array<[string, string]> = [
        ['askShiftConfirmation', 'Shift confirmation'],
        ['askLocationConfirmation', 'Location confirmation'],
        ['askDrugScreenConfirmation', 'Drug screen confirmation'],
        ['askBackgroundConfirmation', 'Background confirmation'],
        ['askCertificationConfirmation', 'Certification confirmation'],
        ['askUniformConfirmation', 'Uniform confirmation'],
        ['allowGigFallbackQuestion', 'Gig-path fallback question'],
      ];
      for (const [k, label] of labels) {
        if (q[k] === true) lines.push(`${label}: on`);
      }
    }
  }
  const ah = tenantData.aiHiring as Record<string, unknown> | undefined;
  if (ah && typeof ah.allowGigFallback === 'boolean') {
    lines.push(`Allow gig-path fallback (hiring): ${ah.allowGigFallback ? 'yes' : 'no'}`);
  }
  return lines;
}

/** Extra detail lines for collapsed threshold UI (tenant-defaults mode). */
export function getEffectiveHiringThresholdSummaryLines(cfg: UserGroupHiringConfigV1): string[] {
  const q = cfg.quality ?? {};
  const t = cfg.targets ?? {};
  const lines: string[] = [];
  if (q.interviewMinimumScoreToAdvance != null && Number.isFinite(q.interviewMinimumScoreToAdvance)) {
    lines.push(`Interview score threshold: ${q.interviewMinimumScoreToAdvance}`);
  }
  if (q.jobFitMinimumScoreToAdvance != null && Number.isFinite(q.jobFitMinimumScoreToAdvance)) {
    lines.push(`Job-fit threshold: ${q.jobFitMinimumScoreToAdvance}`);
  }
  if (q.minimumJobScoreGateEnabled === true) {
    lines.push('Job-fit score gate: on');
  }
  if (q.jobFitFailAction === 'hold' || q.jobFitFailAction === 'review') {
    lines.push(`On job-fit fail: ${q.jobFitFailAction}`);
  }
  if (q.maximumNoShowRiskToAdvance != null && Number.isFinite(q.maximumNoShowRiskToAdvance)) {
    lines.push(`Max no-show risk to advance: ${q.maximumNoShowRiskToAdvance}`);
  }
  if (t.targetOnboardingCount != null && Number.isFinite(t.targetOnboardingCount)) {
    lines.push(`Target onboarding count: ${t.targetOnboardingCount}`);
  }
  if (t.maximumAutoAdvances != null && Number.isFinite(t.maximumAutoAdvances)) {
    lines.push(`Max auto-advances: ${t.maximumAutoAdvances}`);
  }
  if (t.stopWhenTargetReached === true) {
    lines.push('Stop when onboarding target is reached');
  }
  return lines;
}
