import assert from 'assert';
import { applyRecruiterOperationalOverrides, mergeOperationalBlocksIntoHiringResult } from '../applyRecruiterOperationalOverrides';
import { evaluateOperationalOverrideRules } from '../operationalOverrideRules';
import type { WorkerAiPrescreenAnswers } from '../scoreWorkerAiPrescreen';

const baseAnswers = (): WorkerAiPrescreenAnswers => ({
  motivation: 'I want steady warehouse work',
  experience_details: 'five years forklift and loading dock',
  work_confidence: ['reliable'],
  pressure_situation: 'stay calm and focus on safety',
  attendance_issues: 'no',
  attendance_explanation: '',
  transportation_plan: 'own_vehicle',
  backup_transportation: 'yes',
  physical_comfort: 'yes',
  drug_screen: 'no',
  background_check: 'no',
  supervisor_feedback: 'They said I am on time and careful with equipment on the floor.',
  additional_notes: '',
});

describe('applyRecruiterOperationalOverrides', () => {
  it('is deterministic for the same input', () => {
    const answers = baseAnswers();
    const a = applyRecruiterOperationalOverrides({
      baseInterviewScore: 72,
      flags: ['attendance_risk'],
      subScores: { experience: 18, reliability: 14, transportation: 18, risk: 20, physical: 10 },
      answers,
      dynamicAnswers: {},
      categoryScores: {
        version: 1,
        reliability: 75,
        punctuality: 74,
        workEthic: 76,
        teamFit: 73,
        jobReadiness: 74,
        stability: 75,
      },
      assignmentReadiness: { status: 'ready', reasons: [] },
      userDoc: { workEligibility: true, skillsData: { certifications: [] } },
      certificationsCount: 0,
      certificationsLoaded: true,
    });
    const b = applyRecruiterOperationalOverrides({
      baseInterviewScore: 72,
      flags: ['attendance_risk'],
      subScores: { experience: 18, reliability: 14, transportation: 18, risk: 20, physical: 10 },
      answers,
      dynamicAnswers: {},
      categoryScores: {
        version: 1,
        reliability: 75,
        punctuality: 74,
        workEthic: 76,
        teamFit: 73,
        jobReadiness: 74,
        stability: 75,
      },
      assignmentReadiness: { status: 'ready', reasons: [] },
      userDoc: { workEligibility: true, skillsData: { certifications: [] } },
      certificationsCount: 0,
      certificationsLoaded: true,
    });
    assert.strictEqual(a.overrideInputSignature, b.overrideInputSignature);
    assert.strictEqual(a.adjustedScore, b.adjustedScore);
  });

  it('clamps adjusted score to 0–100', () => {
    const r = applyRecruiterOperationalOverrides({
      baseInterviewScore: 5,
      flags: [],
      subScores: { experience: 18, reliability: 14, transportation: 18, risk: 20, physical: 10 },
      answers: baseAnswers(),
      dynamicAnswers: {},
      categoryScores: null,
      assignmentReadiness: { status: 'ready', reasons: [] },
      userDoc: { workEligibility: true },
      certificationsCount: 0,
      certificationsLoaded: false,
    });
    assert(r.adjustedScore >= 0 && r.adjustedScore <= 100);
  });

  it('hard blocks disable autoAdvanceEligible in merge', () => {
    const merged = mergeOperationalBlocksIntoHiringResult(
      { decision: 'advance', eligibleForAutoAdvance: true, reasonCodes: ['passed_all_checks'] },
      [],
      ['work_authorization_not_verified'],
    );
    assert.strictEqual(merged.eligibleForAutoAdvance, false);
    assert.strictEqual(merged.decision, 'reject');
    assert(merged.reasonCodes.includes('operational_hard_block'));
  });

  it('soft blocks force review and disable auto-advance without necessarily lowering score', () => {
    const merged = mergeOperationalBlocksIntoHiringResult(
      { decision: 'advance', eligibleForAutoAdvance: true, reasonCodes: ['passed_all_checks'] },
      ['assignment_readiness_blocked'],
      [],
    );
    assert.strictEqual(merged.decision, 'review');
    assert.strictEqual(merged.eligibleForAutoAdvance, false);
  });
});

describe('evaluateOperationalOverrideRules', () => {
  it('treats short structured yes answers as valid (no penalty from rules)', () => {
    const { items, softBlocks, hardBlocks } = evaluateOperationalOverrideRules({
      baseInterviewScore: 82,
      flags: [],
      answers: baseAnswers(),
      dynamicAnswers: {
        dyn_shift_punctuality: 'yes',
        dyn_worksite_commute: 'yes',
        dyn_gig_path_willing: 'yes',
        dyn_extra_confirm: 'yes',
      },
      categoryScores: {
        version: 1,
        reliability: 80,
        punctuality: 80,
        workEthic: 80,
        teamFit: 80,
        jobReadiness: 80,
        stability: 80,
      },
      assignmentReadiness: { status: 'ready', reasons: [] },
      workAuthorized: true,
      certificationsLoaded: true,
      certificationsCount: 1,
    });
    assert(hardBlocks.length === 0);
    assert(softBlocks.length === 0);
    assert(items.some((i) => i.code === 'up_dynamic_job_yes'));
  });
});
