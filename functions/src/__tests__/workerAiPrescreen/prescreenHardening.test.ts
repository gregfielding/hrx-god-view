import assert from 'assert';
import {
  isExplicitComplianceAnswer,
  isShortButOperationallyValidAnswer,
} from '../../workerAiPrescreen/prescreenBlueCollarHelpers';
import { classifyDrugRiskSeverity } from '../../workerAiPrescreen/prescreenRiskSeverity';
import { scoreWorkerAiPrescreen } from '../../workerAiPrescreen/scoreWorkerAiPrescreen';
import type { WorkerAiPrescreenAnswers } from '../../workerAiPrescreen/scoreWorkerAiPrescreen';
import { computeOperationalTrustPromoteDeclineToReview } from '../../workerAiPrescreen/operationalTrustOverride';
import { evaluateAiHiringDecision } from '../../workerAiPrescreen/evaluateAiHiringDecision';

describe('prescreen blue-collar hardening', () => {
  it('treats common compliance tokens as explicit, not vague narrative', () => {
    assert.strictEqual(isExplicitComplianceAnswer('yes'), true);
    assert.strictEqual(isExplicitComplianceAnswer('pass'), true);
    assert.strictEqual(isExplicitComplianceAnswer('not sure'), true);
  });

  it('accepts short operational answers as valid signal', () => {
    assert.strictEqual(isShortButOperationallyValidAnswer('warehouse 3 years'), true);
    assert.strictEqual(isShortButOperationallyValidAnswer('forklift and shipping'), true);
    assert.strictEqual(isShortButOperationallyValidAnswer('show up early'), true);
  });

  it('classifies short pass-style drug detail as low, not default moderate', () => {
    const r = classifyDrugRiskSeverity({ concernLevel: 'concern', detailText: 'yes' });
    assert.strictEqual(r.level, 'low');
  });

  it('applies penalty bucket caps (communication flags do not stack without bound)', () => {
    const answers: WorkerAiPrescreenAnswers = {
      opening_target_work_types: ['industrial'],
      opening_schedule_preferences: ['full_time'],
      opening_experience_industrial: ['warehouse'],
      opening_experience_hospitality: [],
      opening_experience_events: [],
      opening_experience_clerical: [],
      opening_experience_healthcare: [],
      opening_gig_types: [],
      motivation: 'Steady work and overtime when available.',
      experience_details:
        'Three years warehouse picking and packing with RF scanner and pallet jack experience daily.',
      work_confidence: ['warehouse', 'physical'],
      pressure_situation: 'Kept pace during peak season when two callouts happened same day.',
      attendance_issues: 'no',
      attendance_explanation: '',
      transportation_plan: 'own_vehicle',
      backup_transportation: 'yes',
      physical_comfort: 'yes',
      drug_screen: 'no',
      background_check: 'no',
      supervisor_feedback: 'Reliable on second shift and stays until the work is done.',
      additional_notes: '',
    };
    const scored = scoreWorkerAiPrescreen(answers, {
      answerQualityFlags: ['vague_response', 'low_effort_response'],
      scoreAdjustment: 0,
    });
    const raw = scored.scoreBreakdown?.flagPenaltyTotalRaw ?? 0;
    const applied = scored.scoreBreakdown?.flagPenaltyTotalApplied ?? 0;
    assert.ok(raw >= 15, `expected raw penalties stacked (${raw})`);
    assert.strictEqual(applied, 12, 'communication bucket caps vague+low_effort at 12');
  });

  it('promotes borderline decline to review when operational fundamentals are strong', () => {
    const ok = computeOperationalTrustPromoteDeclineToReview({
      recommendation: 'decline',
      overallScore: 55,
      flags: ['drug_risk_moderate'],
      subScores: { experience: 18, reliability: 22, transportation: 18, risk: 6, physical: 10 },
    });
    assert.strictEqual(ok, true);
  });

  it('does not promote when hard-stop flags present', () => {
    const bad = computeOperationalTrustPromoteDeclineToReview({
      recommendation: 'decline',
      overallScore: 55,
      flags: ['drug_risk_high'],
      subScores: { experience: 18, reliability: 22, transportation: 18, risk: 0, physical: 10 },
    });
    assert.strictEqual(bad, false);
  });

  it('evaluateAiHiringDecision respects operationalTrust promoteDeclineToReview', () => {
    const r = evaluateAiHiringDecision({
      interviewResult: {
        overallScore: 85,
        flags: [],
        recommendation: 'decline',
      },
      hiringPolicy: {},
      application: { applicationId: 'a1' },
      operationalTrust: { promoteDeclineToReview: true },
    });
    assert.strictEqual(r.decision, 'review');
    assert.ok(r.reasonCodes.includes('interview_recommendation_review'));
  });

  it('advanceOnReviewRecommendation lifts review → advance when score passes the floor', () => {
    const r = evaluateAiHiringDecision({
      interviewResult: {
        overallScore: 75,
        flags: [],
        recommendation: 'review',
      },
      hiringPolicy: {
        minimumScoreToAdvance: 30,
        advanceOnReviewRecommendation: true,
      },
      application: { applicationId: 'a-review-override' },
    });
    assert.strictEqual(r.decision, 'advance');
    assert.ok(r.reasonCodes.includes('interview_recommendation_review_overridden'));
  });

  it('advanceOnReviewRecommendation still defers to the score floor', () => {
    const r = evaluateAiHiringDecision({
      interviewResult: {
        overallScore: 25,
        flags: [],
        recommendation: 'review',
      },
      hiringPolicy: {
        minimumScoreToAdvance: 30,
        advanceOnReviewRecommendation: true,
      },
      application: { applicationId: 'a-review-override-low' },
    });
    assert.strictEqual(r.decision, 'review');
    assert.ok(r.reasonCodes.includes('below_score_threshold'));
  });

  it('advanceOnReviewRecommendation does not lift decline (only review)', () => {
    const r = evaluateAiHiringDecision({
      interviewResult: {
        overallScore: 75,
        flags: [],
        recommendation: 'decline',
      },
      hiringPolicy: {
        minimumScoreToAdvance: 30,
        advanceOnReviewRecommendation: true,
      },
      application: { applicationId: 'a-review-override-decline' },
    });
    assert.strictEqual(r.decision, 'reject');
    assert.ok(r.reasonCodes.includes('recommendation_decline'));
  });
});
