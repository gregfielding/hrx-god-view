/**
 * E.7 — pure-helper tests for the I-9 Section 2 dialog.
 *
 * Pins the canonical `documentTypes` encoding the callable persists on
 * `entity_employments.i9Section2DocumentTypes`. The dialog is the
 * primary writer of this list — if encoding drifts, the audit trail
 * silently corrupts.
 */

import {
  computeDocumentTypes,
  validateDocumentSelection,
  type ComputeDocumentTypesArgs,
} from '../I9Section2CompleteDialog';

const EMPTY_ARGS: ComputeDocumentTypesArgs = {
  listChoice: 'list_b_c',
  listA: {
    passport: false,
    permanentResident: false,
    employmentAuth: false,
    otherChecked: false,
    otherText: '',
  },
  listB: {
    driversLicense: false,
    stateId: false,
    otherChecked: false,
    otherText: '',
  },
  listC: {
    ssnCard: false,
    birthCertificate: false,
    otherChecked: false,
    otherText: '',
  },
};

describe('E.7 — I-9 Section 2 dialog: computeDocumentTypes', () => {
  it('encodes List A passport selection', () => {
    const out = computeDocumentTypes({
      ...EMPTY_ARGS,
      listChoice: 'list_a',
      listA: { ...EMPTY_ARGS.listA, passport: true },
    });
    expect(out).toEqual(['list_a_us_passport']);
  });

  it('encodes List A "Other" with description suffix', () => {
    const out = computeDocumentTypes({
      ...EMPTY_ARGS,
      listChoice: 'list_a',
      listA: { ...EMPTY_ARGS.listA, otherChecked: true, otherText: 'Trusted-traveler card' },
    });
    expect(out).toEqual(['list_a_other:Trusted-traveler card']);
  });

  it('encodes List B + List C combination', () => {
    const out = computeDocumentTypes({
      ...EMPTY_ARGS,
      listChoice: 'list_b_c',
      listB: { ...EMPTY_ARGS.listB, driversLicense: true },
      listC: { ...EMPTY_ARGS.listC, ssnCard: true },
    });
    expect(out).toEqual(['list_b_drivers_license', 'list_c_social_security_card']);
  });

  it('drops the description suffix when "Other" is checked but text is empty', () => {
    const out = computeDocumentTypes({
      ...EMPTY_ARGS,
      listChoice: 'list_a',
      listA: { ...EMPTY_ARGS.listA, otherChecked: true, otherText: '   ' },
    });
    expect(out).toEqual(['list_a_other']);
  });

  it('does not mix List A and List B+C — listChoice is exclusive', () => {
    const out = computeDocumentTypes({
      ...EMPTY_ARGS,
      listChoice: 'list_a',
      listA: { ...EMPTY_ARGS.listA, passport: true },
      // These would be ignored when listChoice='list_a'.
      listB: { ...EMPTY_ARGS.listB, driversLicense: true },
      listC: { ...EMPTY_ARGS.listC, ssnCard: true },
    });
    expect(out).toEqual(['list_a_us_passport']);
  });
});

describe('E.7 — I-9 Section 2 dialog: validateDocumentSelection', () => {
  it('rejects empty List A selection', () => {
    expect(
      validateDocumentSelection({ ...EMPTY_ARGS, listChoice: 'list_a' }),
    ).toMatch(/List A/);
  });

  it('rejects List A "Other" without a description', () => {
    expect(
      validateDocumentSelection({
        ...EMPTY_ARGS,
        listChoice: 'list_a',
        listA: { ...EMPTY_ARGS.listA, otherChecked: true, otherText: '   ' },
      }),
    ).toMatch(/Describe.*"Other".*List A/);
  });

  it('rejects when only List B is checked (List C is required too)', () => {
    expect(
      validateDocumentSelection({
        ...EMPTY_ARGS,
        listChoice: 'list_b_c',
        listB: { ...EMPTY_ARGS.listB, driversLicense: true },
      }),
    ).toMatch(/List C/);
  });

  it('rejects when only List C is checked', () => {
    expect(
      validateDocumentSelection({
        ...EMPTY_ARGS,
        listChoice: 'list_b_c',
        listC: { ...EMPTY_ARGS.listC, ssnCard: true },
      }),
    ).toMatch(/List B/);
  });

  it('accepts a valid List B + List C selection', () => {
    expect(
      validateDocumentSelection({
        ...EMPTY_ARGS,
        listChoice: 'list_b_c',
        listB: { ...EMPTY_ARGS.listB, driversLicense: true },
        listC: { ...EMPTY_ARGS.listC, ssnCard: true },
      }),
    ).toBeNull();
  });

  it('accepts a valid List A passport selection', () => {
    expect(
      validateDocumentSelection({
        ...EMPTY_ARGS,
        listChoice: 'list_a',
        listA: { ...EMPTY_ARGS.listA, passport: true },
      }),
    ).toBeNull();
  });
});
