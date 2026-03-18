import {
  READINESS_OPPORTUNITY_MAP,
  type DesiredWorkType,
  type OpportunityRequirement,
  type TargetIndustry,
} from './jobReadinessOpportunityMap';
import { buildJobReadinessReadModel, type JobReadinessReadModel } from './jobReadinessReadModel';
import { t as i18nT } from '../i18n';

export type ReadinessLifecycleState =
  | 'unknown'
  | 'missing'
  | 'attested'
  | 'proof_uploaded'
  | 'verified'
  | 'blocked'
  | 'complete';

export type ReadinessCardType =
  | 'question'
  | 'upload_proof'
  | 'preference'
  | 'explanation'
  | 'resource_help';

export interface ReadinessCardAction {
  id: string;
  label: string;
  value?: string;
  variant?: 'contained' | 'outlined' | 'text';
}

export interface ReadinessCard {
  id: string;
  requirementId?: string;
  lifecycleState?: ReadinessLifecycleState;
  type: ReadinessCardType;
  title: string;
  body: string;
  actions: ReadinessCardAction[];
  profileSectionId?: string;
  resourceUrl?: string;
  whyThisMatters?: string;
  whatThisUnlocks?: string;
}

export interface ReadinessEngineInput {
  userDoc: Record<string, unknown> | null;
  desiredWorkType: DesiredWorkType;
  targetIndustries: TargetIndustry[];
  responses: Record<string, string>;
}

export interface ReadinessEngineOutput {
  summary: string;
  eligibilitySummary: string;
  limitingSummary: string;
  readinessScore: number;
  readinessScorePercent: number;
  readinessScoreSummary: string;
  unlockSummary: string;
  topActions: Array<{ requirementId: string; label: string; industry: TargetIndustry }>;
  topLimitingFactors: Array<{
    requirementId: string;
    label: string;
    state: ReadinessLifecycleState;
    industry: TargetIndustry;
    profileSectionId?: string;
  }>;
  requirementStates: Array<{
    requirementId: string;
    label: string;
    state: ReadinessLifecycleState;
    industry: TargetIndustry;
    impact: number;
    profileSectionId?: string;
  }>;
  nextCard: ReadinessCard | null;
}

interface RequirementEvaluation {
  state: ReadinessLifecycleState;
  why: string;
}

export function getLifecycleStatePresentation(state: ReadinessLifecycleState): {
  label: string;
  color: 'default' | 'warning' | 'info' | 'success' | 'error';
} {
  switch (state) {
    case 'unknown':
      return { label: i18nT('jobReadiness.stateNotStarted'), color: 'default' };
    case 'attested':
      return { label: i18nT('jobReadiness.stateSelfReported'), color: 'warning' };
    case 'proof_uploaded':
      return { label: i18nT('jobReadiness.stateUnderReview'), color: 'info' };
    case 'verified':
      return { label: i18nT('jobReadiness.stateVerified'), color: 'success' };
    case 'blocked':
      return { label: i18nT('jobReadiness.stateActionRequired'), color: 'error' };
    case 'missing':
      return { label: i18nT('jobReadiness.stateActionRequired'), color: 'error' };
    case 'complete':
      return { label: i18nT('jobReadiness.stateVerified'), color: 'success' };
    default:
      return { label: i18nT('jobReadiness.stateNotStarted'), color: 'default' };
  }
}

function industryLabel(industry: TargetIndustry): string {
  if (industry === 'industrial') return i18nT('jobReadiness.industrial').toLowerCase();
  return i18nT('jobReadiness.hospitality').toLowerCase();
}

function supportsCategoryLabel(categories: TargetIndustry[]): string {
  const labels = categories.map((c) => industryLabel(c));
  if (labels.length === 0) return i18nT('jobReadiness.moreRoles');
  if (labels.length === 1) return i18nT('jobReadiness.categoryShifts', { category: labels[0] });
  return i18nT('jobReadiness.categoryShiftsPair', {
    categories: labels.slice(0, -1).join(', '),
    last: labels[labels.length - 1],
  });
}

function estimatedUnlockedJobsFromImpact(impact: number): number {
  return Math.max(3, Math.round(impact * 0.25));
}

function isRequirementMet(readModel: JobReadinessReadModel, requirementId: string): boolean {
  switch (requirementId) {
    case 'profile_photo':
      return readModel.hasProfilePhoto();
    case 'food_handler_cert':
      return readModel.hasVerifiedCertification(['food handler', 'servsafe']);
    case 'forklift_cert':
      return readModel.hasVerifiedCertification(['forklift']);
    case 'weekend_availability':
      return readModel.hasWeekendAvailability();
    case 'hospitality_experience':
      return readModel.hasExperienceKeywords(['hospitality', 'server', 'banquet', 'food service']);
    case 'steel_toe_boots':
      return readModel.attestation.hasSteelToeBoots;
    case 'shift_flexibility':
      return readModel.durableProfile.preferences.flexibleShifts;
    case 'warehouse_tools':
      return readModel.hasExperienceKeywords(['rf scanner', 'pallet jack', 'warehouse']);
    case 'black_uniform_readiness':
      return readModel.attestation.uniformReady;
    default:
      return false;
  }
}

function evaluateRequirementState(
  readModel: JobReadinessReadModel,
  requirement: OpportunityRequirement,
): RequirementEvaluation {
  switch (requirement.id) {
    case 'profile_photo':
      return readModel.hasProfilePhoto()
        ? { state: 'complete', why: 'Profile photo is set.' }
        : { state: 'missing', why: 'No profile photo found.' };
    case 'food_handler_cert': {
      if (readModel.hasVerifiedCertification(['food handler', 'servsafe'])) {
        return { state: 'verified', why: 'Verified certification found.' };
      }
      if (readModel.hasCertificationProofUploaded(['food handler', 'servsafe'])) {
        return { state: 'proof_uploaded', why: 'Proof uploaded; verification pending.' };
      }
      return { state: 'missing', why: 'No verified certification found.' };
    }
    case 'forklift_cert': {
      if (readModel.hasVerifiedCertification(['forklift'])) {
        return { state: 'verified', why: 'Verified forklift credential found.' };
      }
      if (readModel.hasCertificationProofUploaded(['forklift'])) {
        return { state: 'proof_uploaded', why: 'Proof uploaded; verification pending.' };
      }
      return { state: 'missing', why: 'No verified forklift credential found.' };
    }
    case 'weekend_availability':
      return readModel.hasWeekendAvailability()
        ? { state: 'complete', why: 'Weekend availability is set.' }
        : { state: 'missing', why: 'Weekend availability is not set.' };
    case 'hospitality_experience':
      return readModel.hasExperienceKeywords(['hospitality', 'server', 'banquet', 'food service'])
        ? { state: 'complete', why: 'Relevant hospitality experience found.' }
        : { state: 'missing', why: 'No matching hospitality experience found.' };
    case 'warehouse_tools':
      return readModel.hasExperienceKeywords(['rf scanner', 'pallet jack', 'warehouse'])
        ? { state: 'complete', why: 'Relevant warehouse tools familiarity found.' }
        : { state: 'missing', why: 'No matching warehouse tools familiarity found.' };
    case 'shift_flexibility':
      return readModel.durableProfile.preferences.flexibleShifts
        ? { state: 'complete', why: 'Flexible shifts preference is set.' }
        : { state: 'missing', why: 'Flexible shifts preference not set.' };
    case 'steel_toe_boots': {
      if (readModel.attestation.hasSteelToeBoots) {
        return { state: 'attested', why: 'Worker attested safety gear readiness.' };
      }
      return { state: 'missing', why: 'No safety gear readiness attestation found.' };
    }
    case 'black_uniform_readiness': {
      if (readModel.attestation.uniformReady) {
        return { state: 'attested', why: 'Worker attested uniform readiness.' };
      }
      return { state: 'missing', why: 'No uniform readiness attestation found.' };
    }
    default:
      return { state: isRequirementMet(readModel, requirement.id) ? 'complete' : 'unknown', why: 'Insufficient signal.' };
  }
}

function buildQuestionCard(req: OpportunityRequirement): ReadinessCard {
  if (req.id === 'profile_photo') {
    return {
      id: `question__${req.id}`,
      requirementId: req.id,
      type: 'question',
      title: i18nT('jobReadiness.addProfilePhoto'),
      body: i18nT('jobReadiness.photoHelps'),
      actions: [
        { id: 'upload_photo', label: i18nT('apply.uploadPhoto'), value: 'upload_photo', variant: 'contained' },
        { id: 'webcam_capture', label: i18nT('apply.takePhoto'), value: 'webcam_capture', variant: 'outlined' },
        { id: 'open_profile', label: i18nT('jobReadiness.openProfile'), value: 'open_profile', variant: 'text' },
      ],
      profileSectionId: req.uploadSectionId,
      whyThisMatters: req.explanation,
      whatThisUnlocks: i18nT('jobReadiness.photoUnlocks'),
    };
  }

  const jobsUnlocked = estimatedUnlockedJobsFromImpact(req.impact);
  const categoryAccess = supportsCategoryLabel(req.supportsCategories);
  return {
    id: `question__${req.id}`,
    requirementId: req.id,
    type: 'question',
    title: req.cardTitle,
    body: req.cardQuestion,
    actions: [
      { id: 'yes', label: i18nT('common.yes'), value: 'yes', variant: 'contained' },
      { id: 'no', label: i18nT('common.no'), value: 'no', variant: 'outlined' },
    ],
    profileSectionId: req.uploadSectionId,
    whyThisMatters: req.explanation,
    whatThisUnlocks: i18nT('jobReadiness.unlocksAboutMatches', { count: jobsUnlocked, categories: categoryAccess }),
  };
}

function buildFollowUpCard(req: OpportunityRequirement, answer: string): ReadinessCard {
  const jobsUnlocked = estimatedUnlockedJobsFromImpact(req.impact);
  const categoryAccess = supportsCategoryLabel(req.supportsCategories);
  if (answer === 'yes') {
    return {
      id: `upload__${req.id}`,
      requirementId: req.id,
      type: 'upload_proof',
      title: i18nT('jobReadiness.followUpUploadTitle'),
      body: i18nT('jobReadiness.followUpUploadBody'),
      actions: [
        { id: 'open_profile', label: i18nT('jobReadiness.openProfileSection'), value: 'open_profile', variant: 'contained' },
        { id: 'done', label: i18nT('jobReadiness.iWillDoLater'), value: 'done', variant: 'text' },
      ],
      profileSectionId: req.uploadSectionId,
      whyThisMatters: req.explanation,
      whatThisUnlocks: i18nT('jobReadiness.unlocksAboutMatches', { count: jobsUnlocked, categories: categoryAccess }),
    };
  }

  return {
    id: `resource__${req.id}`,
    requirementId: req.id,
    type: 'resource_help',
    title: i18nT('jobReadiness.resourceHelpTitle'),
    body: `${req.explanation} ${req.resourceText}.`,
    actions: [
      { id: 'open_resource', label: i18nT('jobReadiness.seeGuidance'), value: 'open_resource', variant: 'outlined' },
      { id: 'continue', label: i18nT('common.next'), value: 'continue', variant: 'contained' },
    ],
    resourceUrl: req.resourceUrl,
    profileSectionId: req.uploadSectionId,
    whyThisMatters: req.explanation,
    whatThisUnlocks: i18nT('jobReadiness.unlocksAboutMatches', { count: jobsUnlocked, categories: categoryAccess }),
  };
}

export function buildJobReadinessEngine(input: ReadinessEngineInput): ReadinessEngineOutput {
  const userDoc = input.userDoc || {};
  const readModel = buildJobReadinessReadModel(userDoc);
  const industries: TargetIndustry[] = input.targetIndustries.length
    ? input.targetIndustries
    : (readModel.durableProfile.targetIndustries?.length
      ? readModel.durableProfile.targetIndustries
      : (['hospitality', 'industrial'] as TargetIndustry[]));
  const desiredWorkType = input.desiredWorkType === 'any'
    ? (readModel.durableProfile.desiredWorkType || 'any')
    : input.desiredWorkType;

  const requirementRows = industries.flatMap((industry) => {
    const map = READINESS_OPPORTUNITY_MAP[industry];
    return map.requirements.map((req) => ({
      industry,
      req,
      evaluation: evaluateRequirementState(readModel, req),
    }));
  });

  const uniqueRequirementRows = Array.from(
    new Map(requirementRows.map((row) => [row.req.id, row])).values()
  );

  const missing = uniqueRequirementRows
    .filter((r) => !['verified', 'complete'].includes(r.evaluation.state))
    .sort((a, b) => b.req.impact - a.req.impact);

  const topActions = missing.slice(0, 3).map((m) => ({
    requirementId: m.req.id,
    label: m.req.label,
    industry: m.industry,
  }));
  const requirementStates = uniqueRequirementRows.map((r) => ({
    requirementId: r.req.id,
    label: r.req.label,
    state: r.evaluation.state,
    industry: r.industry,
    impact: r.req.impact,
    profileSectionId: r.req.uploadSectionId,
  }));
  const topLimitingFactors = missing.slice(0, 3).map((m) => ({
    requirementId: m.req.id,
    label: m.req.label,
    state: m.evaluation.state,
    industry: m.industry,
    profileSectionId: m.req.uploadSectionId,
  }));

  const eligibleIndustries: TargetIndustry[] = industries.filter((industry): industry is TargetIndustry => {
    const rows = requirementRows.filter((r) => r.industry === industry);
    const metCount = rows.filter((r) => ['verified', 'complete'].includes(r.evaluation.state)).length;
    return rows.length > 0 && metCount >= Math.max(1, Math.floor(rows.length / 2));
  });

  const eligibilitySummary =
    eligibleIndustries.length > 0
      ? i18nT('jobReadiness.eligibleStrongerMatches', {
          categories: eligibleIndustries.map((i) => industryLabel(i)).join(` ${i18nT('jobReadiness.andWord')} `),
        })
      : i18nT('jobReadiness.bestMatchedEntryLevel');

  const topLimiting = missing.slice(0, 2).map((m) => m.req.label.toLowerCase());
  const limitingSummary = topLimiting.length
    ? i18nT('jobReadiness.mainLimitingFactors', { factors: topLimiting.join(` ${i18nT('jobReadiness.andWord')} `) })
    : i18nT('jobReadiness.noMajorBlockers');

  const totalImpact = uniqueRequirementRows.reduce((sum, r) => sum + r.req.impact, 0);
  const metImpact = uniqueRequirementRows
    .filter((r) => ['verified', 'complete'].includes(r.evaluation.state))
    .reduce((sum, r) => sum + r.req.impact, 0);
  const readinessScore = totalImpact > 0 ? metImpact / totalImpact : 0;
  const readinessScorePercent = Math.max(0, Math.min(100, Math.round(readinessScore * 100)));
  const headlineIndustry = industryLabel(industries[0] || 'hospitality');
  const readinessScoreSummary = i18nT('jobReadiness.scoreSummaryForIndustry', {
    percent: readinessScorePercent,
    industry: headlineIndustry,
  });
  const unlockSummary = topLimitingFactors.length
    ? i18nT('jobReadiness.unlockSummaryDetailed', {
        count: topLimitingFactors.reduce((sum, r) => sum + estimatedUnlockedJobsFromImpact(uniqueRequirementRows.find((x) => x.req.id === r.requirementId)?.req.impact || 0), 0),
        industry: headlineIndustry,
      })
    : i18nT('jobReadiness.profileStrongShape');

  const summary = i18nT('jobReadiness.summaryWrapper', {
    eligibilitySummary,
    limitingSummary,
  });

  let nextCard: ReadinessCard | null = null;
  if (desiredWorkType === 'any') {
    nextCard = {
      id: 'preference__desired_work_type',
      type: 'preference',
      title: i18nT('jobReadiness.refineWorkIntent'),
      body: i18nT('jobReadiness.refineWorkIntentBody'),
      actions: [{ id: 'done', label: i18nT('jobReadiness.gotIt'), value: 'done', variant: 'contained' }],
    };
  }

  const topMissing = missing[0];
  if (!nextCard && topMissing) {
    const answer = input.responses[topMissing.req.id];
    if (!answer) {
      nextCard = buildQuestionCard(topMissing.req);
      nextCard.lifecycleState = topMissing.evaluation.state;
    } else if (!['completed', 'skipped'].includes(answer)) {
      nextCard = buildFollowUpCard(topMissing.req, answer);
      nextCard.lifecycleState = topMissing.evaluation.state;
    }
  } else if (!nextCard) {
    nextCard = {
      id: 'all_ready',
      lifecycleState: 'complete',
      type: 'explanation',
      title: i18nT('jobReadiness.strongMomentumTitle'),
      body: i18nT('jobReadiness.strongMomentumBody'),
      actions: [{ id: 'done', label: i18nT('jobReadiness.done'), value: 'done', variant: 'contained' }],
    };
  }

  return {
    summary,
    eligibilitySummary,
    limitingSummary,
    readinessScore,
    readinessScorePercent,
    readinessScoreSummary,
    unlockSummary,
    topActions,
    topLimitingFactors,
    requirementStates,
    nextCard,
  };
}

