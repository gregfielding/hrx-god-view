import { loadLocale, setLanguage, t } from './index';

// Fixture keys live under `__fixture` so scripts/i18n/check-i18n.ts skips them.
const en = {
  __fixture: {
    steps_one: 'Complete {count} step to apply',
    steps_other: 'Complete {count} steps to apply',
    onlyOther_other: '{count} items',
    plain: 'Plain {count}',
  },
};
const es = {
  __fixture: {
    steps_one: 'Completa {count} paso para aplicar',
    steps_other: 'Completa {count} pasos para aplicar',
  },
};

beforeAll(async () => {
  (global as any).fetch = jest.fn((url: string) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(url.endsWith('/es.json') ? es : en) })
  );
  await loadLocale('en');
  await loadLocale('es');
});

afterEach(() => setLanguage('en'));

describe('t() plurals', () => {
  it('picks _one for count 1 and _other otherwise (en)', () => {
    expect(t('__fixture.steps', { count: 1 })).toBe('Complete 1 step to apply');
    expect(t('__fixture.steps', { count: 2 })).toBe('Complete 2 steps to apply');
    expect(t('__fixture.steps', { count: 0 })).toBe('Complete 0 steps to apply');
  });

  it('picks _one for count 1 and _other otherwise (es)', () => {
    setLanguage('es');
    expect(t('__fixture.steps', { count: 1 })).toBe('Completa 1 paso para aplicar');
    expect(t('__fixture.steps', { count: 4 })).toBe('Completa 4 pasos para aplicar');
  });

  it('falls back to _other, then the bare key', () => {
    expect(t('__fixture.onlyOther', { count: 1 })).toBe('1 items');
    expect(t('__fixture.plain', { count: 1 })).toBe('Plain 1');
    setLanguage('es');
    expect(t('__fixture.onlyOther', { count: 3 })).toBe('3 items');
  });
});
