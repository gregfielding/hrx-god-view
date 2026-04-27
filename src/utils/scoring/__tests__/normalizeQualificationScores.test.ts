import {
  normalizeQualificationScores,
  qualificationBarDisplayPercent,
  rawQualificationPointsToPercentages,
} from '../normalizeQualificationScores';
import { QUALIFICATION_DISPLAY_ORDER } from '../qualificationDisplayOrder';

describe('normalizeQualificationScores', () => {
  it('caps physical display percent at 85 without changing other fields', () => {
    const raw = {
      experience: 60,
      reliability: 50,
      transport: 40,
      risk: 30,
      physical: 100,
    };
    expect(normalizeQualificationScores(raw)).toEqual({
      experience: 60,
      reliability: 50,
      transport: 40,
      risk: 30,
      physical: 85,
    });
  });

  it('rawQualificationPointsToPercentages — physical 10/10 maps to 100 then caps to 85 in normalize', () => {
    const pts = rawQualificationPointsToPercentages({
      experience: 0,
      reliability: 0,
      transportation: 0,
      risk: 0,
      physical: 10,
    });
    expect(pts.physical).toBe(100);
    expect(normalizeQualificationScores(pts).physical).toBe(85);
  });

  it('never allows physical to exceed display cap', () => {
    const result = normalizeQualificationScores({
      physical: 10,
      experience: 25,
      reliability: 22,
      transport: 20,
      risk: 60,
    });
    expect(result.physical).toBeLessThanOrEqual(85);
  });

  it('never allows physical to exceed display cap when input is maxed on 0–100 scale', () => {
    expect(
      normalizeQualificationScores({
        physical: 100,
        experience: 80,
        reliability: 80,
        transport: 80,
        risk: 80,
      }).physical,
    ).toBe(85);
  });
});

describe('qualification display order', () => {
  it('orders categories risk-first', () => {
    expect(QUALIFICATION_DISPLAY_ORDER[0]).toBe('risk');
  });
});

describe('qualificationBarDisplayPercent', () => {
  it('caps bar width at 85', () => {
    expect(qualificationBarDisplayPercent(100)).toBe(85);
    expect(qualificationBarDisplayPercent(40)).toBe(40);
  });
});
