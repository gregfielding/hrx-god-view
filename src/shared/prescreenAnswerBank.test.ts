import {
  computePrescreenBankDelta,
  freshPrescreenBankAnswers,
  isPrescreenBankAnswerUsable,
  prescreenBankFreshnessMsForQuestionId,
  type PrescreenBankEntryLite,
} from './prescreenAnswerBank';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function bankAt(daysAgo: number, answers: Record<string, string | string[]>): Record<string, PrescreenBankEntryLite> {
  const out: Record<string, PrescreenBankEntryLite> = {};
  for (const [id, answer] of Object.entries(answers)) {
    out[id] = { answer, answeredAtMs: NOW - daysAgo * DAY_MS };
  }
  return out;
}

/** A complete, carriable core answer set (strong experience → no expanded narrative). */
function fullCoreAnswers(): Record<string, string | string[]> {
  return {
    opening_target_work_types: ['industrial'],
    opening_schedule_preferences: ['full_time'],
    opening_experience_industrial: ['warehouse'],
    work_confidence: ['reliability'],
    attendance_issues: 'no',
    transportation_plan: 'own_vehicle',
    backup_transportation: 'yes',
    physical_comfort: 'yes',
    experience_details: 'I worked two years in a busy warehouse loading and picking orders daily.',
    motivation: 'I want steady work near home and I enjoy hands on warehouse jobs.',
    pressure_situation: 'I stay calm and keep working through the rush until the job is done.',
    drug_screen: 'no',
    background_check: 'no',
    supervisor_feedback: 'My supervisor said I was dependable and always on time for shifts.',
    additional_notes: 'Nothing else to add right now.',
  };
}

describe('prescreenBankFreshnessMsForQuestionId', () => {
  it('uses category windows with per-id overrides', () => {
    expect(prescreenBankFreshnessMsForQuestionId('opening_target_work_types')).toBe(90 * DAY_MS);
    expect(prescreenBankFreshnessMsForQuestionId('experience_details')).toBe(180 * DAY_MS);
    expect(prescreenBankFreshnessMsForQuestionId('drug_screen')).toBe(180 * DAY_MS);
    expect(prescreenBankFreshnessMsForQuestionId('dyn_cert__forklift')).toBe(365 * DAY_MS);
    expect(prescreenBankFreshnessMsForQuestionId('dyn_cert_willing__forklift')).toBe(90 * DAY_MS);
    expect(prescreenBankFreshnessMsForQuestionId('additional_notes')).toBe(90 * DAY_MS);
    // Job-specific: never carried.
    expect(prescreenBankFreshnessMsForQuestionId('dyn_shift_punctuality')).toBeNull();
    expect(prescreenBankFreshnessMsForQuestionId('dyn_worksite_commute')).toBeNull();
    expect(prescreenBankFreshnessMsForQuestionId('dyn_uniform_available')).toBeNull();
    expect(prescreenBankFreshnessMsForQuestionId('confirm_legal_first_name')).toBeNull();
  });
});

describe('isPrescreenBankAnswerUsable', () => {
  it('rejects weak carries that are valid live answers', () => {
    expect(isPrescreenBankAnswerUsable('transportation_plan', 'not_sure_yet')).toBe(false);
    expect(isPrescreenBankAnswerUsable('transportation_plan', 'own_vehicle')).toBe(true);
    expect(isPrescreenBankAnswerUsable('drug_screen', 'not_sure')).toBe(false);
    expect(isPrescreenBankAnswerUsable('drug_screen', 'yes')).toBe(true);
    expect(isPrescreenBankAnswerUsable('dyn_cert__forklift', 'not_sure')).toBe(false);
    expect(isPrescreenBankAnswerUsable('dyn_cert__forklift', 'no')).toBe(true);
  });

  it('enforces narrative minimums', () => {
    expect(isPrescreenBankAnswerUsable('motivation', 'short answer here')).toBe(false);
    expect(
      isPrescreenBankAnswerUsable('motivation', 'I want steady work near home and enjoy hands on jobs.'),
    ).toBe(true);
    // Fast-path parity: experience accepts >=3 words.
    expect(isPrescreenBankAnswerUsable('experience_details', 'warehouse two years')).toBe(true);
    expect(isPrescreenBankAnswerUsable('experience_details', 'warehouse')).toBe(false);
    expect(isPrescreenBankAnswerUsable('drug_screen_detail', 'too short')).toBe(false);
    expect(isPrescreenBankAnswerUsable('drug_screen_detail', 'a full explanation of the situation')).toBe(true);
  });

  it('handles multi-selects', () => {
    expect(isPrescreenBankAnswerUsable('opening_target_work_types', [])).toBe(false);
    expect(isPrescreenBankAnswerUsable('opening_target_work_types', ['industrial'])).toBe(true);
    expect(isPrescreenBankAnswerUsable('work_confidence', 'reliability, teamwork')).toBe(true);
  });
});

describe('freshPrescreenBankAnswers', () => {
  it('drops stale and unusable entries and splits core vs dynamic', () => {
    const bank = {
      ...bankAt(30, { opening_target_work_types: ['industrial'], dyn_job_drug_screen: 'yes' }),
      ...bankAt(120, { opening_schedule_preferences: ['full_time'] }), // stale (90d window)
      ...bankAt(30, { transportation_plan: 'not_sure_yet' }), // unusable carry
      ...bankAt(30, { dyn_shift_punctuality: 'yes' }), // job-specific, never carried
    };
    const fresh = freshPrescreenBankAnswers(bank, NOW);
    expect(Object.keys(fresh.coreAnswers)).toEqual(['opening_target_work_types']);
    expect(fresh.dynamicAnswers).toEqual({ dyn_job_drug_screen: 'yes' });
  });
});

describe('computePrescreenBankDelta', () => {
  const noDedupe = { dedupeCoveredDynamicIds: [] as string[], needsLegalNameConfirm: false };

  it('is zero-delta when everything is fresh and no job-specific dynamics exist', () => {
    const fresh = freshPrescreenBankAnswers(bankAt(10, fullCoreAnswers()), NOW);
    const delta = computePrescreenBankDelta({ fresh, dynamicStepIds: [], ...noDedupe });
    expect(delta.zeroDelta).toBe(true);
    expect(delta.neededCoreStepIds).toEqual([]);
    expect(delta.neededDynamicStepIds).toEqual([]);
  });

  it('never blocks zero-delta on additional_notes alone', () => {
    const answers = fullCoreAnswers();
    delete (answers as Record<string, unknown>).additional_notes;
    const fresh = freshPrescreenBankAnswers(bankAt(10, answers), NOW);
    const delta = computePrescreenBankDelta({ fresh, dynamicStepIds: [], ...noDedupe });
    expect(delta.zeroDelta).toBe(true);
  });

  it('requires job-specific dynamics unless deduped from core answers', () => {
    const fresh = freshPrescreenBankAnswers(bankAt(10, fullCoreAnswers()), NOW);
    const dynamicStepIds = ['dyn_worksite_commute', 'dyn_uniform_available'];
    const noCover = computePrescreenBankDelta({ fresh, dynamicStepIds, ...noDedupe });
    expect(noCover.zeroDelta).toBe(false);
    expect(noCover.neededDynamicStepIds).toEqual(dynamicStepIds);

    const withDedupe = computePrescreenBankDelta({
      fresh,
      dynamicStepIds,
      dedupeCoveredDynamicIds: ['dyn_worksite_commute'],
      needsLegalNameConfirm: false,
    });
    expect(withDedupe.neededDynamicStepIds).toEqual(['dyn_uniform_available']);
  });

  it('covers bankable dynamics (certs, job drug/bg) when fresh', () => {
    const bank = {
      ...bankAt(10, fullCoreAnswers()),
      ...bankAt(200, { dyn_cert__forklift: 'yes' }), // 365d window → fresh
      ...bankAt(200, { dyn_job_drug_screen: 'yes' }), // 180d window → stale
    };
    const fresh = freshPrescreenBankAnswers(bank, NOW);
    const delta = computePrescreenBankDelta({
      fresh,
      dynamicStepIds: ['dyn_cert__forklift', 'dyn_job_drug_screen'],
      ...noDedupe,
    });
    expect(delta.coveredDynamicStepIds).toEqual(['dyn_cert__forklift']);
    expect(delta.neededDynamicStepIds).toEqual(['dyn_job_drug_screen']);
    // Core drug_screen suppressed because the job asks its own drug question.
    expect(delta.neededCoreStepIds).not.toContain('drug_screen');
  });

  it('asks compliance details when the gate answer is yes', () => {
    const answers = fullCoreAnswers();
    answers.drug_screen = 'yes'; // no detail in bank
    const fresh = freshPrescreenBankAnswers(bankAt(10, answers), NOW);
    const delta = computePrescreenBankDelta({ fresh, dynamicStepIds: [], ...noDedupe });
    expect(delta.zeroDelta).toBe(false);
    expect(delta.neededCoreStepIds).toContain('drug_screen_detail');
  });

  it('asks attendance explanation when attendance_issues is yes', () => {
    const answers = fullCoreAnswers();
    answers.attendance_issues = 'yes';
    const fresh = freshPrescreenBankAnswers(bankAt(10, answers), NOW);
    const delta = computePrescreenBankDelta({ fresh, dynamicStepIds: [], ...noDedupe });
    expect(delta.zeroDelta).toBe(false);
    expect(delta.neededCoreStepIds).toContain('attendance_explanation');
  });

  it('requires expanded narrative when fresh experience is weak', () => {
    const answers = fullCoreAnswers();
    answers.experience_details = 'warehouse work experience'; // 3 words: carriable but weak (<8)
    delete (answers as Record<string, unknown>).motivation;
    delete (answers as Record<string, unknown>).pressure_situation;
    const fresh = freshPrescreenBankAnswers(bankAt(10, answers), NOW);
    const delta = computePrescreenBankDelta({ fresh, dynamicStepIds: [], ...noDedupe });
    expect(delta.neededCoreStepIds).toEqual(expect.arrayContaining(['motivation', 'pressure_situation']));
  });

  it('blocks zero-delta when the legal name confirm is pending', () => {
    const fresh = freshPrescreenBankAnswers(bankAt(10, fullCoreAnswers()), NOW);
    const delta = computePrescreenBankDelta({
      fresh,
      dynamicStepIds: [],
      dedupeCoveredDynamicIds: [],
      needsLegalNameConfirm: true,
    });
    expect(delta.zeroDelta).toBe(false);
  });

  it('re-asks stale preference categories while keeping fresh ones covered', () => {
    const bank = {
      ...bankAt(120, { opening_target_work_types: ['industrial'] }), // stale
      ...bankAt(10, fullCoreAnswers()),
    };
    // Later spread overwrites — emulate stale opening by re-stamping:
    bank.opening_target_work_types = { answer: ['industrial'], answeredAtMs: NOW - 120 * DAY_MS };
    const fresh = freshPrescreenBankAnswers(bank, NOW);
    const delta = computePrescreenBankDelta({ fresh, dynamicStepIds: [], ...noDedupe });
    expect(delta.zeroDelta).toBe(false);
    expect(delta.neededCoreStepIds).toContain('opening_target_work_types');
    expect(delta.coveredCoreStepIds).toContain('transportation_plan');
  });
});
