/**
 * W.3 — flag util tests. Pure module, so we exercise both code branches
 * (default + env override) by mutating `process.env` between cases.
 *
 * Why this matters: the flag is the rollback hinge for every W.3
 * collection-surface hide. If the env override stops working we lose the
 * dev / e2e ability to render the collection paths without a rebuild.
 */
import {
  isWorkAuthCollectionDisabled,
  isWorkAuthCollectionEnabled,
} from '../workAuthCollectionFlag';

describe('workAuthCollectionFlag — W.3 single source of truth', () => {
  // Snapshot + restore the env var so cross-test pollution doesn't
  // turn this into a flaky suite.
  const ORIGINAL_ENV = process.env.REACT_APP_WORK_AUTH_COLLECTION_DISABLED;
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.REACT_APP_WORK_AUTH_COLLECTION_DISABLED;
    } else {
      process.env.REACT_APP_WORK_AUTH_COLLECTION_DISABLED = ORIGINAL_ENV;
    }
  });

  it('defaults to disabled (true) when env is unset', () => {
    delete process.env.REACT_APP_WORK_AUTH_COLLECTION_DISABLED;
    expect(isWorkAuthCollectionDisabled()).toBe(true);
    expect(isWorkAuthCollectionEnabled()).toBe(false);
  });

  it('returns true when env is the string "true"', () => {
    process.env.REACT_APP_WORK_AUTH_COLLECTION_DISABLED = 'true';
    expect(isWorkAuthCollectionDisabled()).toBe(true);
  });

  it('returns false when env is the string "false" (rollback path)', () => {
    process.env.REACT_APP_WORK_AUTH_COLLECTION_DISABLED = 'false';
    expect(isWorkAuthCollectionDisabled()).toBe(false);
    expect(isWorkAuthCollectionEnabled()).toBe(true);
  });

  it('falls through to the default for an unrecognized env value', () => {
    // Anything other than literal 'true' / 'false' should not silently
    // flip the flag — we'd rather fall back to the sticky default than
    // accept a typo as if it were intentional.
    process.env.REACT_APP_WORK_AUTH_COLLECTION_DISABLED = '1';
    expect(isWorkAuthCollectionDisabled()).toBe(true);

    process.env.REACT_APP_WORK_AUTH_COLLECTION_DISABLED = '';
    expect(isWorkAuthCollectionDisabled()).toBe(true);
  });

  it('isWorkAuthCollectionEnabled is always the inverse of isWorkAuthCollectionDisabled', () => {
    delete process.env.REACT_APP_WORK_AUTH_COLLECTION_DISABLED;
    expect(isWorkAuthCollectionEnabled()).toBe(!isWorkAuthCollectionDisabled());

    process.env.REACT_APP_WORK_AUTH_COLLECTION_DISABLED = 'true';
    expect(isWorkAuthCollectionEnabled()).toBe(!isWorkAuthCollectionDisabled());

    process.env.REACT_APP_WORK_AUTH_COLLECTION_DISABLED = 'false';
    expect(isWorkAuthCollectionEnabled()).toBe(!isWorkAuthCollectionDisabled());
  });
});
