import { expect } from 'chai';
import { isTranslationOnlyWrite } from '../../translation/isTranslationOnlyWrite';

describe('translation/isTranslationOnlyWrite', () => {
  it('returns false on create (no before)', () => {
    expect(isTranslationOnlyWrite(undefined, { a: 1 })).to.equal(false);
  });

  it('returns true when only ES changes', () => {
    const before = {
      postTitle_i18n: { en: 'Hello', es: 'Hola' },
      translationMeta: { es: { status: 'auto', sourceHash: 'x', model: 'm', updatedAt: {} } },
    };
    const after = {
      postTitle_i18n: { en: 'Hello', es: 'Saludos' },
      translationMeta: { es: { status: 'auto', sourceHash: 'y', model: 'm', updatedAt: {} } },
    };
    expect(isTranslationOnlyWrite(before, after)).to.equal(true);
  });

  it('returns false when EN changes', () => {
    const before = { postTitle_i18n: { en: 'Hello', es: 'Hola' } };
    const after = { postTitle_i18n: { en: 'Hello!!', es: 'Hola' } };
    expect(isTranslationOnlyWrite(before, after)).to.equal(false);
  });

  it('returns true when only translationMeta changes', () => {
    const before = {
      postTitle_i18n: { en: 'Hello', es: 'Hola' },
      translationMeta: { es: { sourceHash: 'a' } },
    };
    const after = {
      postTitle_i18n: { en: 'Hello', es: 'Hola' },
      translationMeta: { es: { sourceHash: 'b' } },
    };
    expect(isTranslationOnlyWrite(before, after)).to.equal(true);
  });

  it('returns true when only ES changes on any *_i18n key (auto-discover)', () => {
    const before = { instructions_i18n: { en: 'Report at 8am', es: 'Antes' } };
    const after = { instructions_i18n: { en: 'Report at 8am', es: 'Después' } };
    expect(isTranslationOnlyWrite(before, after)).to.equal(true);
  });

  it('returns true when only staffInstructions_i18n.*.es changes (.en unchanged)', () => {
    const before = {
      staffInstructions: { firstDay: { text: 'Report at 8am' } },
      staffInstructions_i18n: { firstDay: { en: 'Report at 8am' } },
    };
    const after = {
      staffInstructions: { firstDay: { text: 'Report at 8am' } },
      staffInstructions_i18n: { firstDay: { en: 'Report at 8am', es: 'Presentarse a las 8am' } },
    };
    expect(isTranslationOnlyWrite(before, after)).to.equal(true);
  });

  it('returns false when staffInstructions_i18n.*.en changes', () => {
    const before = { staffInstructions_i18n: { firstDay: { en: 'Old' } } };
    const after = { staffInstructions_i18n: { firstDay: { en: 'New', es: 'Nuevo' } } };
    expect(isTranslationOnlyWrite(before, after)).to.equal(false);
  });
});
