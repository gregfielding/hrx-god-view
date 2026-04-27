import { expect } from 'chai';
import { discoverI18nFields } from '../../translation/discoverI18nFields';

describe('translation/discoverI18nFields', () => {
  it('finds all *_i18n keys with non-empty .en', () => {
    const data = {
      jobTitle_i18n: { en: 'Janitor', es: 'Conserje' },
      instructions_i18n: { en: 'Report at 8am' },
      notI18n: 'hello',
      ppe_i18n: { en: 'Safety shoes' },
    };
    const fields = discoverI18nFields(data);
    expect(fields).to.have.members(['jobTitle_i18n', 'instructions_i18n', 'ppe_i18n']);
    expect(fields).to.not.include('notI18n');
  });

  it('skips keys with missing or empty .en', () => {
    const data = {
      a_i18n: { es: 'Solo ES' },
      b_i18n: { en: '' },
      c_i18n: { en: '  \t  ' },
    };
    const fields = discoverI18nFields(data);
    expect(fields.length).to.equal(0);
  });

  it('skips fields present in manualFields', () => {
    const data = {
      jobTitle_i18n: { en: 'Janitor' },
      instructions_i18n: { en: 'Report at 8am' },
    };
    const fields = discoverI18nFields(data, ['instructions_i18n']);
    expect(fields).to.deep.equal(['jobTitle_i18n']);
  });

  it('returns empty array for empty data', () => {
    expect(discoverI18nFields({})).to.deep.equal([]);
  });
});
