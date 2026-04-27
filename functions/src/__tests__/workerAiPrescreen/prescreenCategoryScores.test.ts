import assert from 'assert';
import { computePrescreenCategoryScores } from '../../workerAiPrescreen/prescreenCategoryScores';
import { scoreWorkerAiPrescreen } from '../../workerAiPrescreen/scoreWorkerAiPrescreen';
import type { WorkerAiPrescreenAnswers } from '../../workerAiPrescreen/scoreWorkerAiPrescreen';

function baseAnswers(): WorkerAiPrescreenAnswers {
  return {
    opening_target_work_types: ['hospitality'],
    opening_schedule_preferences: ['part_time'],
    opening_experience_hospitality: ['server'],
    opening_experience_industrial: [],
    opening_experience_events: [],
    opening_experience_clerical: [],
    opening_experience_healthcare: [],
    opening_gig_types: [],
    motivation: 'I want steady work in food service and to grow into a lead role within six months.',
    experience_details:
      'I worked two years at Cafe North as a line prep and sometimes covered the register during busy shifts.',
    work_confidence: ['food_service', 'customer_facing'],
    pressure_situation:
      'During a holiday rush we were short two people; I stayed calm, prioritized tickets, and asked the manager to call in backup.',
    attendance_issues: 'No',
    attendance_explanation: '',
    transportation_plan: 'own_vehicle',
    backup_transportation: 'Yes',
    physical_comfort: 'Yes',
    drug_screen: 'no',
    background_check: 'no',
    supervisor_feedback:
      'They would say I am dependable on busy nights and that I communicate when I need clarification.',
    additional_notes: '',
  };
}

describe('computePrescreenCategoryScores', () => {
  it('returns versioned scores in 0–100 and evidence keys', () => {
    const answers = baseAnswers();
    const scored = scoreWorkerAiPrescreen(answers);
    const { categoryScores, categoryEvidence, categoryConfidence } = computePrescreenCategoryScores({
      answers,
      scored,
      dynamicAnswers: {},
    });

    assert.strictEqual(categoryScores.version, 1);
    assert.strictEqual(categoryConfidence.version, 1);
    for (const k of ['reliability', 'punctuality', 'workEthic', 'teamFit', 'jobReadiness', 'stability'] as const) {
      assert.strictEqual(typeof categoryScores[k], 'number');
      assert.ok(categoryScores[k] >= 0 && categoryScores[k] <= 100, k);
    }
    assert.ok(categoryEvidence.reliability.length > 0);
    assert.ok(categoryEvidence.jobReadiness.some((t) => t.startsWith('opening:')));
    for (const k of ['reliability', 'punctuality', 'workEthic', 'teamFit', 'jobReadiness', 'stability'] as const) {
      assert.ok(categoryConfidence[k] >= 18 && categoryConfidence[k] <= 92, k);
    }
  });

  it('adjusts punctuality downward when shift dynamic is no', () => {
    const answers = baseAnswers();
    const scored = scoreWorkerAiPrescreen(answers);
    const withoutDyn = computePrescreenCategoryScores({
      answers,
      scored,
      dynamicAnswers: {},
    });
    const withDyn = computePrescreenCategoryScores({
      answers,
      scored,
      dynamicAnswers: { dyn_shift_punctuality: 'no' },
    });
    assert.ok(withDyn.categoryScores.punctuality <= withoutDyn.categoryScores.punctuality);
    assert.ok(withDyn.categoryEvidence.punctuality.some((t) => t.includes('shift_punctuality:no')));
  });
});
