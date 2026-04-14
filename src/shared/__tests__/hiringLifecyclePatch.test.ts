import {
  applyHiringLifecycleTimestampMetadata,
  buildHiringLifecyclePatch,
  buildHiringLifecycleOnApplicationCreate,
  buildHiringLifecycleOnInterviewSubmit,
  buildHiringLifecycleOnStageUpdate,
  blockersFromAiReasonCodes,
  mapInterviewSubmitToLifecycleCore,
} from '../hiringLifecyclePatch';

describe('buildHiringLifecyclePatch — application_create', () => {
  it('uses applied + draft for draft status', () => {
    const { hiringLifecycle } = buildHiringLifecycleOnApplicationCreate({
      applicationStatus: 'draft',
      aiPrescreenInterviewRequired: false,
      profileEligible: true,
    });
    expect(hiringLifecycle.stage).toBe('applied');
    expect(hiringLifecycle.subStatus).toBe('draft');
  });

  it('uses profile_incomplete when profile not eligible', () => {
    const { hiringLifecycle } = buildHiringLifecycleOnApplicationCreate({
      applicationStatus: 'submitted',
      aiPrescreenInterviewRequired: true,
      profileEligible: false,
      profileBlockerCodes: ['ELIGIBILITY_RESUME_MISSING'],
    });
    expect(hiringLifecycle.stage).toBe('profile_incomplete');
    expect(hiringLifecycle.blockers).toContain('ELIGIBILITY_RESUME_MISSING');
    expect(hiringLifecycle.nextAction).toBe('worker_complete_prescreen');
  });

  it('uses interview_pending when prescreen required and interview not complete', () => {
    const { hiringLifecycle } = buildHiringLifecycleOnApplicationCreate({
      applicationStatus: 'submitted',
      aiPrescreenInterviewRequired: true,
      profileEligible: true,
      workerAiPrescreenInterviewCompletedAt: null,
    });
    expect(hiringLifecycle.stage).toBe('interview_pending');
    expect(hiringLifecycle.subStatus).toBe('ai_prescreen_not_started');
    expect(hiringLifecycle.blockers).toContain('INTERVIEW_NOT_COMPLETED');
    expect(hiringLifecycle.nextAction).toBe('worker_schedule_interview');
  });

  it('uses applied when prescreen off and profile ok', () => {
    const { hiringLifecycle } = buildHiringLifecycleOnApplicationCreate({
      applicationStatus: 'submitted',
      aiPrescreenInterviewRequired: false,
      profileEligible: true,
    });
    expect(hiringLifecycle.stage).toBe('applied');
    expect(hiringLifecycle.subStatus).toBe('submitted');
  });
});

describe('buildHiringLifecyclePatch — stage_update', () => {
  it('maps waitlisted legacy status', () => {
    const { hiringLifecycle } = buildHiringLifecycleOnStageUpdate({ nextLegacyStatus: 'waitlisted' });
    expect(hiringLifecycle.stage).toBe('waitlisted');
    expect(hiringLifecycle.nextAction).toBe('recruiter_decide_waitlist');
  });

  it('maps rejected to abandoned with subStatus', () => {
    const { hiringLifecycle } = buildHiringLifecycleOnStageUpdate({ nextLegacyStatus: 'rejected' });
    expect(hiringLifecycle.stage).toBe('abandoned');
    expect(hiringLifecycle.subStatus).toBe('rejected_by_recruiter');
  });

  it('respects intent over raw status', () => {
    const { hiringLifecycle } = buildHiringLifecycleOnStageUpdate({
      nextLegacyStatus: 'submitted',
      intent: 'recruiter_reject',
    });
    expect(hiringLifecycle.stage).toBe('abandoned');
    expect(hiringLifecycle.subStatus).toBe('rejected_by_recruiter');
  });
});

describe('buildHiringLifecyclePatch — interview_submit', () => {
  it('reject → abandoned + subStatus', () => {
    const { hiringLifecycle } = buildHiringLifecycleOnInterviewSubmit({
      hiringResult: {
        decision: 'reject',
        eligibleForAutoAdvance: false,
        reasonCodes: ['recommendation_decline'],
      },
      phase6AutomationQueued: false,
    });
    expect(hiringLifecycle.stage).toBe('abandoned');
    expect(hiringLifecycle.subStatus).toBe('rejected_by_policy');
    expect(hiringLifecycle.nextAction).toBe('none');
  });

  it('review → review + ai_prescreen_complete', () => {
    const { hiringLifecycle } = buildHiringLifecyclePatch({
      kind: 'interview_submit',
      hiringResult: {
        decision: 'review',
        eligibleForAutoAdvance: false,
        reasonCodes: ['no_show_overlay_review'],
      },
      phase6AutomationQueued: false,
    });
    expect(hiringLifecycle.stage).toBe('review');
    expect(hiringLifecycle.subStatus).toBe('ai_prescreen_complete');
    expect(hiringLifecycle.nextAction).toBe('recruiter_review');
  });

  it('hold + capacity → waitlisted', () => {
    const core = mapInterviewSubmitToLifecycleCore({
      hiringResult: {
        decision: 'hold',
        eligibleForAutoAdvance: false,
        reasonCodes: ['capacity_reached'],
      },
      phase6AutomationQueued: false,
    });
    expect(core.stage).toBe('waitlisted');
    expect(core.subStatus).toBe('target_reached_queue');
  });

  it('advance + phase6 queue → waitlisted + phase6_queue_pending', () => {
    const core = mapInterviewSubmitToLifecycleCore({
      hiringResult: {
        decision: 'advance',
        eligibleForAutoAdvance: true,
        reasonCodes: ['passed_all_checks'],
      },
      phase6AutomationQueued: true,
    });
    expect(core.stage).toBe('waitlisted');
    expect(core.subStatus).toBe('phase6_queue_pending');
    expect(core.nextAction).toBe('system_wait');
  });

  it('advance + no queue → qualified', () => {
    const core = mapInterviewSubmitToLifecycleCore({
      hiringResult: {
        decision: 'advance',
        eligibleForAutoAdvance: true,
        reasonCodes: ['passed_all_checks'],
      },
      phase6AutomationQueued: false,
    });
    expect(core.stage).toBe('qualified');
    expect(core.subStatus).toBe('ai_prescreen_complete');
  });
});

describe('blockersFromAiReasonCodes', () => {
  it('maps known reason codes to blockers deterministically', () => {
    const b = blockersFromAiReasonCodes(['below_score_threshold', 'below_score_threshold']);
    expect(b).toEqual(['SCORE_BELOW_MINIMUM']);
  });
});

describe('applyHiringLifecycleTimestampMetadata', () => {
  it('sets updatedAt and stageEnteredAt on stage change', () => {
    const out = applyHiringLifecycleTimestampMetadata({
      core: { stage: 'qualified', subStatus: 'ai_prescreen_complete', nextAction: 'none' },
      previous: { stage: 'interview_pending', subStatus: 'ai_prescreen_not_started' },
      nowIso: '2026-04-02T12:00:00.000Z',
    });
    expect(out.updatedAt).toBe('2026-04-02T12:00:00.000Z');
    expect(out.stageEnteredAt?.qualified).toBe('2026-04-02T12:00:00.000Z');
  });

  it('does not duplicate stageEnteredAt when stage unchanged', () => {
    const out = applyHiringLifecycleTimestampMetadata({
      core: { stage: 'qualified', subStatus: 'updated', nextAction: 'none' },
      previous: { stage: 'qualified', subStatus: 'old' },
      nowIso: '2026-04-02T13:00:00.000Z',
    });
    expect(out.stageEnteredAt?.qualified).toBeUndefined();
    expect(out.updatedAt).toBe('2026-04-02T13:00:00.000Z');
  });
});
