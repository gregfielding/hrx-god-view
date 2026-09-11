/**
 * Certification scan verdict rules (2026-09-08). Pure.
 */
import { expect } from 'chai';
import {
  decideCertificationVerdict,
  namesCompatible,
  addYearsISO,
  type VerdictInput,
} from '../../certifications/certificationVerdict';
import type { CertificationAiExtractionV1 } from '../../shared/certifications/certificationAiVerification';

const FOOD_HANDLER = { displayName: 'Food Handler Card', hasExpiration: true, validityPeriodYears: 2 };

function extraction(over: Partial<CertificationAiExtractionV1> = {}): CertificationAiExtractionV1 {
  return {
    documentReadable: true,
    isCertificateOrCard: true,
    documentDescription: 'California Food Handler Card',
    matchesClaimedCredential: 'yes',
    holderName: 'Greg Fielding',
    holderNameMatchesWorker: 'yes',
    issuer: 'StateFoodSafety',
    issuingJurisdiction: 'California',
    accreditation: 'ANSI',
    certificateNumber: '12345',
    issueDate: '2026-01-10',
    expirationDate: '2029-01-10',
    tamperingSignals: [],
    confidence: 'high',
    reviewerNotes: '',
    ...over,
  };
}

function input(over: Partial<VerdictInput> = {}, x: Partial<CertificationAiExtractionV1> = {}): VerdictInput {
  return {
    extraction: extraction(x),
    catalog: FOOD_HANDLER,
    claimed: { issuer: null, expirationDate: null },
    workerName: 'Greg Fielding',
    todayISO: '2026-09-08',
    ...over,
  };
}

describe('namesCompatible', () => {
  it('matches full name, accents and case ignored', () => {
    expect(namesCompatible('José Álvarez', 'JOSE ALVAREZ')).to.equal('yes');
  });
  it('accepts a first initial', () => {
    expect(namesCompatible('Greg Fielding', 'G. Fielding')).to.equal('yes');
  });
  it('rejects a different last name', () => {
    expect(namesCompatible('Greg Fielding', 'Maria Lopez')).to.equal('no');
  });
  it('is unsure when the first name differs but the last matches', () => {
    expect(namesCompatible('Gregory Fielding', 'Greg Fielding')).to.equal('unsure');
  });
  it('is unsure with no holder name', () => {
    expect(namesCompatible('Greg Fielding', null)).to.equal('unsure');
  });
  it('handles compound last names', () => {
    expect(namesCompatible('Ana Garcia Lopez', 'Ana Garcia')).to.equal('yes');
  });
});

describe('decideCertificationVerdict', () => {
  it('clean card → auto_approve with document fields filled', () => {
    const r = decideCertificationVerdict(input({ claimed: { issuer: 'typed', expirationDate: '2028-01-01' } }));
    expect(r.verdict).to.equal('auto_approve');
    expect(r.reasonCode).to.equal('looks_valid');
    expect(r.fill).to.deep.equal({ issuer: 'StateFoodSafety', expirationDate: '2029-01-10', certificateNumber: '12345' });
    expect(r.notes.join(' ')).to.contain('document kept');
  });
  it('derives expiration from issue date + catalog validity when the card omits it', () => {
    const r = decideCertificationVerdict(input({}, { expirationDate: null }));
    expect(r.verdict).to.equal('auto_approve');
    expect(r.effectiveExpiration).to.equal('2028-01-10');
  });
  it('unreadable but the worker typed issuer + expiration or a number → needs_review, never auto_reject', () => {
    const a = decideCertificationVerdict(input({ claimed: { issuer: 'StateFoodSafety', expirationDate: '2029-01-10' } }, { documentReadable: false }));
    expect(a.verdict).to.equal('needs_review');
    expect(a.reasonCode).to.equal('unreadable');
    const b = decideCertificationVerdict(input({ claimed: { certificateNumber: 'CA-1' } }, { documentReadable: false }));
    expect(b.verdict).to.equal('needs_review');
    const c = decideCertificationVerdict(input({ claimed: { issuer: 'only issuer' } }, { documentReadable: false }));
    expect(c.verdict).to.equal('auto_reject');
  });
  it('approve fills the certificate number from the card, else from the worker', () => {
    expect(decideCertificationVerdict(input()).fill.certificateNumber).to.equal('12345');
    expect(decideCertificationVerdict(input({ claimed: { certificateNumber: 'typed-9' } }, { certificateNumber: null })).fill.certificateNumber).to.equal('typed-9');
  });
  it('unreadable with high confidence → auto_reject; medium → needs_review', () => {
    expect(decideCertificationVerdict(input({}, { documentReadable: false })).verdict).to.equal('auto_reject');
    const r = decideCertificationVerdict(input({}, { documentReadable: false, confidence: 'medium' }));
    expect(r.verdict).to.equal('needs_review');
    expect(r.reasonCode).to.equal('unreadable');
  });
  it('receipt instead of the card → auto_reject not_a_certificate', () => {
    const r = decideCertificationVerdict(input({}, { isCertificateOrCard: false, documentDescription: 'Course purchase receipt' }));
    expect(r.verdict).to.equal('auto_reject');
    expect(r.reasonCode).to.equal('not_a_certificate');
  });
  it('different credential → auto_reject; unsure → needs_review', () => {
    expect(decideCertificationVerdict(input({}, { matchesClaimedCredential: 'no' })).verdict).to.equal('auto_reject');
    const r = decideCertificationVerdict(input({}, { matchesClaimedCredential: 'unsure' }));
    expect(r.verdict).to.equal('needs_review');
    expect(r.reasonCode).to.equal('wrong_credential');
  });
  it('tampering is never auto-rejected', () => {
    const r = decideCertificationVerdict(input({}, { tamperingSignals: ['font mismatch on expiry'] }));
    expect(r.verdict).to.equal('needs_review');
    expect(r.reasonCode).to.equal('tampering_suspected');
  });
  it('name mismatch goes to a human even when the model says yes', () => {
    const r = decideCertificationVerdict(input({}, { holderName: 'Maria Lopez', holderNameMatchesWorker: 'yes' }));
    expect(r.verdict).to.equal('needs_review');
    expect(r.reasonCode).to.equal('name_mismatch');
  });
  it('expired card → auto_reject with the date', () => {
    const r = decideCertificationVerdict(input({}, { expirationDate: '2026-09-01' }));
    expect(r.verdict).to.equal('auto_reject');
    expect(r.reasonCode).to.equal('expired');
    expect(r.effectiveExpiration).to.equal('2026-09-01');
  });
  it('no expiration anywhere on an expiring credential → needs_review', () => {
    const r = decideCertificationVerdict(input({}, { expirationDate: null, issueDate: null }));
    expect(r.verdict).to.equal('needs_review');
    expect(r.reasonCode).to.equal('expiration_missing');
  });
  it('non-expiring credential approves without a date', () => {
    const r = decideCertificationVerdict(
      input({ catalog: { displayName: 'OSHA 10', hasExpiration: false } }, { expirationDate: null, issueDate: null }),
    );
    expect(r.verdict).to.equal('auto_approve');
    expect(r.fill.expirationDate).to.equal(null);
  });
  it('medium confidence on an otherwise clean card → needs_review low_confidence', () => {
    const r = decideCertificationVerdict(input({}, { confidence: 'medium' }));
    expect(r.verdict).to.equal('needs_review');
    expect(r.reasonCode).to.equal('low_confidence');
  });
  it('scan failure → needs_review with the failure code', () => {
    const r = decideCertificationVerdict(input({ extraction: null, scanFailed: { code: 'file_unsupported' } }));
    expect(r.verdict).to.equal('needs_review');
    expect(r.reasonCode).to.equal('file_unsupported');
  });
  it('addYearsISO keeps month/day', () => {
    expect(addYearsISO('2026-02-28', 3)).to.equal('2029-02-28');
    expect(addYearsISO('bad', 1)).to.equal(null);
  });
});
