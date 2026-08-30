import {
  resolvePrescreenPositionType,
  resolvePrescreenPositionContext,
} from '../positionTypeQuestionPacks';
import type { AiInterviewContext } from '../aiInterviewContextTypes';

const ctx = (title: string): AiInterviewContext =>
  ({ assignment: { jobId: 'j1', title } } as unknown as AiInterviewContext);

describe('resolvePrescreenPositionType', () => {
  it('maps common C1 job titles', () => {
    expect(resolvePrescreenPositionType('Warehouse Operative')).toBe('industrial');
    expect(resolvePrescreenPositionType('Loader / Crew')).toBe('industrial');
    expect(resolvePrescreenPositionType('Event Usher — Oakland Arena')).toBe('events');
    expect(resolvePrescreenPositionType('Banquet Server')).toBe('hospitality');
    expect(resolvePrescreenPositionType('Food Service Worker - KEISER')).toBe('hospitality');
    expect(resolvePrescreenPositionType('Front Desk Receptionist')).toBe('clerical');
    expect(resolvePrescreenPositionType('CNA Caregiver')).toBe('healthcare');
  });

  it('role words beat venue words', () => {
    expect(
      resolvePrescreenPositionType('General Maintenance Worker - SHARP CORONADO HOSPITAL'),
    ).toBe('industrial');
  });

  it('unknown titles resolve to null (no pack, no trim)', () => {
    expect(resolvePrescreenPositionType('Brand Ambassador')).toBeNull();
    expect(resolvePrescreenPositionType('')).toBeNull();
    expect(resolvePrescreenPositionType(undefined)).toBeNull();
  });
});

describe('resolvePrescreenPositionContext', () => {
  it('emits pack steps with i18n keys and trims all opening steps except the matched experience', () => {
    const out = resolvePrescreenPositionContext(ctx('Warehouse Picker'));
    expect(out.positionType).toBe('industrial');
    expect(out.packSteps.length).toBeGreaterThanOrEqual(2);
    for (const step of out.packSteps) {
      expect(step.id.startsWith('dyn_pos_industrial_')).toBe(true);
      expect(step.module).toBe('position_fit');
      expect(step.promptKey).toContain('workerAiPrescreen.dynamic.dyn_pos_industrial_');
      expect(step.options.map((o) => o.value)).toEqual(['yes', 'no', 'not_sure']);
    }
    expect(out.trimmedCoreStepIds).toContain('opening_target_work_types');
    expect(out.trimmedCoreStepIds).toContain('opening_experience_events');
    expect(out.trimmedCoreStepIds).not.toContain('opening_experience_industrial');
  });

  it('null type → empty pack and trim', () => {
    const out = resolvePrescreenPositionContext(ctx('Brand Ambassador'));
    expect(out.positionType).toBeNull();
    expect(out.packSteps).toEqual([]);
    expect(out.trimmedCoreStepIds).toEqual([]);
  });

  it('every pack prompt key exists in both locale files', () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const en = require('../../../../i18n/locales/en.json');
    const es = require('../../../../i18n/locales/es.json');
    const titles: Record<string, string> = {
      industrial: 'Warehouse Operative',
      events: 'Event Usher',
      hospitality: 'Banquet Server',
      clerical: 'Data Entry Clerk',
      healthcare: 'CNA',
    };
    for (const title of Object.values(titles)) {
      const out = resolvePrescreenPositionContext(ctx(title));
      for (const step of out.packSteps) {
        const key = step.promptKey!.replace('workerAiPrescreen.dynamic.', '');
        expect(en.workerAiPrescreen.dynamic[key]).toBeTruthy();
        expect(es.workerAiPrescreen.dynamic[key]).toBeTruthy();
      }
    }
  });
});
