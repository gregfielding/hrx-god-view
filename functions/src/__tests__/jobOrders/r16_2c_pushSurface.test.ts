/**
 * **R.16.2c Phase 2** — Push-to-Active surface tests for the 5 new
 * snapshot-policy fields.
 *
 * Verifies:
 *   1. `PUSH_TOP_LEVEL_FIELDS` includes each new key (so the field-key
 *      gate in `validatePushArgs` accepts them).
 *   2. `validatePushArgs` accepts shape-correct `newValue` for each
 *      new field and rejects malformed shapes with a useful message.
 *   3. `null` is a legal `newValue` for each new field (preserves the
 *      §L9 "deliberate clear" semantic).
 *   4. Each new field is treated as top-level (positionId must be
 *      omitted) — none are per-position fields.
 *
 * Why these tests live in a separate file:
 *   - The R.16.1 `pushToActive.test.ts` is structured around the §L9
 *     locked surface. Threading R.16.2c assertions inline would
 *     muddle that file's per-case framing. A dedicated R.16.2c file
 *     keeps the per-PR review window clean.
 *
 * Mocha + Chai. Run via:
 *   ./node_modules/mocha/bin/mocha.js -r ts-node/register -r src/__tests__/setup.ts \
 *     'src/__tests__/jobOrders/r16_2c_pushSurface.test.ts'
 *
 * @see docs/CASCADE_R16.2c_HANDOFF.md Phase 2
 */

import { expect } from 'chai';

import {
  PUSH_TOP_LEVEL_FIELDS,
  isPushTopLevelField,
  validatePushArgs,
} from '../../jobOrders/pushToActive';

const TENANT = 'tenant_test';
const ACCOUNT = 'acct_test';

function baseInput<T>(fieldKey: string, newValue: T): {
  tenantId: string;
  accountId: string;
  fieldKey: string;
  positionId: null;
  newValue: T;
  isWrite: false;
} {
  return {
    tenantId: TENANT,
    accountId: ACCOUNT,
    fieldKey,
    positionId: null,
    newValue,
    isWrite: false,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 1. Top-level surface — registry membership
// ─────────────────────────────────────────────────────────────────────

describe('R.16.2c — PUSH_TOP_LEVEL_FIELDS includes the 5 new keys', () => {
  const newKeys = [
    'scheduler',
    'pricingFlatMarkupPercent',
    'physicalRequirements',
    'customUniformRequirements',
    'attachments',
  ] as const;

  newKeys.forEach((key) => {
    it(`exposes "${key}" as a top-level push field`, () => {
      expect((PUSH_TOP_LEVEL_FIELDS as readonly string[]).includes(key)).to.equal(true);
      expect(isPushTopLevelField(key)).to.equal(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. validatePushArgs — positive cases (shape-correct newValue)
// ─────────────────────────────────────────────────────────────────────

describe('R.16.2c — validatePushArgs accepts shape-correct newValue', () => {
  it('scheduler: string array', () => {
    const out = validatePushArgs(baseInput('scheduler', ['uid_1', 'uid_2']));
    expect(out.fieldKey).to.equal('scheduler');
    expect(out.positionId).to.equal(null);
  });

  it('scheduler: empty array (deliberate clear of all stamps)', () => {
    expect(() => validatePushArgs(baseInput('scheduler', []))).to.not.throw();
  });

  it('pricingFlatMarkupPercent: finite number', () => {
    const out = validatePushArgs(baseInput('pricingFlatMarkupPercent', 38));
    expect(out.fieldKey).to.equal('pricingFlatMarkupPercent');
  });

  it('pricingFlatMarkupPercent: zero is valid (sub-account-managed mode passing through)', () => {
    expect(() => validatePushArgs(baseInput('pricingFlatMarkupPercent', 0))).to.not.throw();
  });

  it('physicalRequirements: string array', () => {
    expect(() =>
      validatePushArgs(baseInput('physicalRequirements', ['lifting_50_lbs', 'standing'])),
    ).to.not.throw();
  });

  it('customUniformRequirements: freeform string', () => {
    expect(() =>
      validatePushArgs(baseInput('customUniformRequirements', 'Black slacks, white shirt')),
    ).to.not.throw();
  });

  it('customUniformRequirements: empty string is valid (cleared text)', () => {
    expect(() => validatePushArgs(baseInput('customUniformRequirements', ''))).to.not.throw();
  });

  it('attachments: array of metadata objects with all fields populated', () => {
    expect(() =>
      validatePushArgs(
        baseInput('attachments', [
          { label: 'FAQ', name: 'faq.pdf', url: 'gs://x/y.pdf', uploadedAt: 'iso-string' },
        ]),
      ),
    ).to.not.throw();
  });

  it('attachments: array of partial metadata objects (only some fields populated)', () => {
    expect(() =>
      validatePushArgs(
        baseInput('attachments', [{ label: 'FAQ' }, { name: 'safety.pdf' }]),
      ),
    ).to.not.throw();
  });

  it('attachments: empty array (cleared file list)', () => {
    expect(() => validatePushArgs(baseInput('attachments', []))).to.not.throw();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. validatePushArgs — negative cases (malformed shapes rejected)
// ─────────────────────────────────────────────────────────────────────

describe('R.16.2c — validatePushArgs rejects malformed shapes', () => {
  it('scheduler: string (not array) is rejected', () => {
    expect(() => validatePushArgs(baseInput('scheduler', 'uid_donna'))).to.throw(
      /must be a string array or null/,
    );
  });

  it('scheduler: array of non-strings is rejected', () => {
    expect(() => validatePushArgs(baseInput('scheduler', [1, 2, 3]))).to.throw(
      /must be a string array or null/,
    );
  });

  it('pricingFlatMarkupPercent: string is rejected', () => {
    expect(() => validatePushArgs(baseInput('pricingFlatMarkupPercent', '38'))).to.throw(
      /must be a finite number or null/,
    );
  });

  it('pricingFlatMarkupPercent: NaN is rejected', () => {
    expect(() =>
      validatePushArgs(baseInput('pricingFlatMarkupPercent', Number.NaN)),
    ).to.throw(/must be a finite number or null/);
  });

  it('physicalRequirements: object is rejected', () => {
    expect(() =>
      validatePushArgs(baseInput('physicalRequirements', { code: 'lifting' })),
    ).to.throw(/must be a string array or null/);
  });

  it('customUniformRequirements: array is rejected', () => {
    expect(() =>
      validatePushArgs(baseInput('customUniformRequirements', ['black', 'white'])),
    ).to.throw(/must be a string or null/);
  });

  it('attachments: array of strings is rejected (must be objects)', () => {
    expect(() =>
      validatePushArgs(baseInput('attachments', ['file1.pdf', 'file2.pdf'])),
    ).to.throw(/must be an object array or null/);
  });

  it('attachments: bare object (not wrapped in array) is rejected', () => {
    expect(() =>
      validatePushArgs(baseInput('attachments', { label: 'FAQ' })),
    ).to.throw(/must be an object array or null/);
  });

  it('attachments: array containing null is rejected', () => {
    expect(() =>
      validatePushArgs(baseInput('attachments', [{ label: 'FAQ' }, null])),
    ).to.throw(/must be an object array or null/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. null + positionId semantics for new fields
// ─────────────────────────────────────────────────────────────────────

describe('R.16.2c — null + positionId semantics for new fields', () => {
  const newTopLevelKeys = [
    'scheduler',
    'pricingFlatMarkupPercent',
    'physicalRequirements',
    'customUniformRequirements',
    'attachments',
  ] as const;

  newTopLevelKeys.forEach((key) => {
    it(`accepts null newValue for "${key}" (deliberate clear)`, () => {
      expect(() => validatePushArgs(baseInput(key, null))).to.not.throw();
    });

    it(`rejects positionId for "${key}" (top-level only)`, () => {
      expect(() =>
        validatePushArgs({
          tenantId: TENANT,
          accountId: ACCOUNT,
          fieldKey: key,
          positionId: 'pos_warehouse',
          newValue: null,
          isWrite: false,
        }),
      ).to.throw(/must be omitted/);
    });
  });
});
