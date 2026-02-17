import { expect } from 'chai';
import { getFieldsNeedingTranslation } from '../../translation/needsTranslation';

describe('translation/getFieldsNeedingTranslation', () => {
  it('returns fields when ES missing', () => {
    const before = { jobTitle_i18n: { en: 'Janitor' } };
    const after = { jobTitle_i18n: { en: 'Janitor' } };
    const fields = getFieldsNeedingTranslation(before, after);
    expect(fields.map((f) => f.fieldPath)).to.include('jobTitle_i18n');
  });

  it('returns fields when EN changed', () => {
    const before = { jobDescription_i18n: { en: 'Clean', es: 'Limpiar' } };
    const after = { jobDescription_i18n: { en: 'Clean floors', es: 'Limpiar' } };
    const fields = getFieldsNeedingTranslation(before, after);
    expect(fields.map((f) => f.fieldPath)).to.include('jobDescription_i18n');
  });

  it('returns empty when manual lock', () => {
    const before = { jobTitle_i18n: { en: 'Janitor' } };
    const after = {
      jobTitle_i18n: { en: 'Janitor' },
      translationMeta: { es: { status: 'manual' } },
    };
    const fields = getFieldsNeedingTranslation(before, after);
    expect(fields.length).to.equal(0);
  });

  it('excludes only manualFields when per-field lock is set', () => {
    const before = {
      jobTitle_i18n: { en: 'Janitor' },
      jobDescription_i18n: { en: 'Clean', es: 'Limpiar' },
    };
    const after = {
      jobTitle_i18n: { en: 'Janitor' },
      jobDescription_i18n: { en: 'Clean floors', es: 'Limpiar' },
      translationMeta: { es: { status: 'auto', manualFields: ['jobDescription_i18n'] } },
    };
    const fields = getFieldsNeedingTranslation(before, after);
    expect(fields.map((f) => f.fieldPath)).to.not.include('jobDescription_i18n');
    expect(fields.map((f) => f.fieldPath)).to.include('jobTitle_i18n');
  });

  it('auto-discover: returns any *_i18n with non-empty .en needing translation', () => {
    const before = {};
    const after = {
      instructions_i18n: { en: 'Report at 8am' },
      parkingInstructions_i18n: { en: 'Park in lot B' },
    };
    const fields = getFieldsNeedingTranslation(before, after, { autoDiscover: true });
    expect(fields.map((f) => f.fieldPath)).to.have.members(['instructions_i18n', 'parkingInstructions_i18n']);
    expect(fields.every((f) => f.sourceText.length > 0)).to.equal(true);
  });

  it('legacy mode (autoDiscover: false) only considers Phase 1 fields', () => {
    const before = {};
    const after = {
      instructions_i18n: { en: 'Report at 8am' },
      jobTitle_i18n: { en: 'Janitor' },
    };
    const fields = getFieldsNeedingTranslation(before, after, { autoDiscover: false });
    expect(fields.map((f) => f.fieldPath)).to.include('jobTitle_i18n');
    expect(fields.map((f) => f.fieldPath)).to.not.include('instructions_i18n');
  });
});
