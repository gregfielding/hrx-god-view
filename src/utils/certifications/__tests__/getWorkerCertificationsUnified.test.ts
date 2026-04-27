const mockGetDoc = jest.fn();
const mockGetCanonicalCertificationRecordsWithIds = jest.fn();

jest.mock('firebase/firestore', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: jest.fn((...args: any[]) => ({ path: args.map(String).join('/') })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDoc: (...args: any[]) => mockGetDoc(...args),
}));

jest.mock('../../../firebase', () => ({
  db: {},
}));

jest.mock('../getCanonicalCertificationRecords', () => ({
  getCanonicalCertificationRecordsWithIds: (uid: string) => mockGetCanonicalCertificationRecordsWithIds(uid),
}));

jest.mock('../../../shared/certifications/certificationsLogging', () => ({
  warnCertifications: jest.fn(),
}));

import type { CertificationRecordV1 } from '../../../shared/certifications/certificationRecord';
import { getWorkerCertificationsUnified } from '../getWorkerCertificationsUnified';

function baseRecord(partial: Partial<CertificationRecordV1>): CertificationRecordV1 {
  return {
    schemaVersion: 1,
    catalogEntryId: 'cdl-class-a',
    review: { status: 'approved', rejectionReason: null },
    recordStatus: 'active',
    source: 'admin_manual',
    issuer: 'Issuer',
    expirationDate: '2030-06-01',
    updatedAt: { toMillis: () => 1000 },
    ...partial,
  } as CertificationRecordV1;
}

describe('getWorkerCertificationsUnified', () => {
  const uid = 'user-1';

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDoc.mockResolvedValue({
      data: () => ({ certifications: [] }),
    });
    mockGetCanonicalCertificationRecordsWithIds.mockResolvedValue([]);
  });

  it('canonical only: emits canonical items and counts', async () => {
    mockGetCanonicalCertificationRecordsWithIds.mockResolvedValue([
      {
        certificationRecordId: 'c1',
        record: baseRecord({ catalogEntryId: 'cdl-class-a' }),
      },
    ]);
    const r = await getWorkerCertificationsUnified(uid);
    expect(r.canonicalCount).toBe(1);
    expect(r.legacyOnlyCount).toBe(0);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].provenance).toBe('canonical');
    expect(r.items[0].certificationRecordId).toBe('c1');
    expect(r.items[0].catalogEntryId).toBe('cdl-class-a');
  });

  it('legacy only (unmapped): legacy_only, isUnmapped, null catalogEntryId', async () => {
    mockGetDoc.mockResolvedValue({
      data: () => ({
        certifications: [{ name: 'Completely Unknown Credential XYZ' }],
      }),
    });
    const r = await getWorkerCertificationsUnified(uid);
    expect(r.canonicalCount).toBe(0);
    expect(r.legacyOnlyCount).toBe(1);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].provenance).toBe('legacy_only');
    expect(r.items[0].isUnmapped).toBe(true);
    expect(r.items[0].catalogEntryId).toBeNull();
    expect(r.warnings.some((w) => w.startsWith('unmapped_legacy:'))).toBe(true);
  });

  it('legacy only (mapped, no canonical): merged with canonical_record_absent', async () => {
    mockGetDoc.mockResolvedValue({
      data: () => ({
        certifications: [{ name: 'CDL Class A', issuer: 'DMV' }],
      }),
    });
    const r = await getWorkerCertificationsUnified(uid);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].catalogEntryId).toBe('cdl-class-a');
    expect(r.items[0].provenance).toBe('merged');
    expect(r.items[0].mergeWarnings).toContain('canonical_record_absent');
  });

  it('merges by certificationRecordId when legacy id matches canonical doc id', async () => {
    mockGetDoc.mockResolvedValue({
      data: () => ({
        certifications: [
          {
            name: 'CDL Class A',
            certificationRecordId: 'rec-match',
            expirationDate: '2030-01-01',
          },
        ],
      }),
    });
    mockGetCanonicalCertificationRecordsWithIds.mockResolvedValue([
      {
        certificationRecordId: 'rec-match',
        record: baseRecord({
          catalogEntryId: 'cdl-class-a',
          expirationDate: '2030-01-01',
        }),
      },
    ]);
    const r = await getWorkerCertificationsUnified(uid);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].unifiedId).toBe('merged-id-rec-match');
    expect(r.items[0].provenance).toBe('merged');
    expect(r.items[0].certificationRecordId).toBe('rec-match');
  });

  it('merges by catalogEntryId when legacy has no matching cert id but names map', async () => {
    mockGetDoc.mockResolvedValue({
      data: () => ({
        certifications: [{ name: 'CDL Class A' }],
      }),
    });
    mockGetCanonicalCertificationRecordsWithIds.mockResolvedValue([
      {
        certificationRecordId: 'canon-999',
        record: baseRecord({ catalogEntryId: 'cdl-class-a' }),
      },
    ]);
    const r = await getWorkerCertificationsUnified(uid);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].unifiedId).toBe('merged-cat-cdl-class-a');
    expect(r.items[0].provenance).toBe('merged');
    expect(r.items[0].certificationRecordId).toBe('canon-999');
  });

  it('duplicate canonical rows for same catalogEntryId: single output + duplicate_canon warning', async () => {
    mockGetCanonicalCertificationRecordsWithIds.mockResolvedValue([
      {
        certificationRecordId: 'older',
        record: baseRecord({
          expirationDate: '2030-01-01',
          updatedAt: { toMillis: () => 10 },
        }),
      },
      {
        certificationRecordId: 'newer',
        record: baseRecord({
          expirationDate: '2030-01-01',
          updatedAt: { toMillis: () => 5000 },
        }),
      },
    ]);
    const r = await getWorkerCertificationsUnified(uid);
    expect(r.warnings.some((w) => w === 'duplicate_canon:cdl-class-a')).toBe(true);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].mergeWarnings).toContain('duplicate_catalog_entry_ignored');
    expect(r.items[0].certificationRecordId).toBe('newer');
  });

  it('duplicate legacy rows for same catalogEntryId: single output + duplicate_legacy warning', async () => {
    mockGetDoc.mockResolvedValue({
      data: () => ({
        certifications: [
          { name: 'CDL Class A', issuer: 'A' },
          { name: 'CDL Class A', issuer: 'B' },
        ],
      }),
    });
    const r = await getWorkerCertificationsUnified(uid);
    expect(r.warnings.some((w) => w === 'duplicate_legacy:cdl-class-a')).toBe(true);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].mergeWarnings?.some((m) => m.includes('duplicate_legacy_rows'))).toBe(true);
  });

  it('picks valid canonical over expired when duplicates share catalogEntryId', async () => {
    mockGetCanonicalCertificationRecordsWithIds.mockResolvedValue([
      {
        certificationRecordId: 'exp',
        record: baseRecord({
          expirationDate: '2010-01-01',
          updatedAt: { toMillis: () => 9999 },
        }),
      },
      {
        certificationRecordId: 'ok',
        record: baseRecord({
          expirationDate: '2032-01-01',
          updatedAt: { toMillis: () => 1 },
        }),
      },
    ]);
    const r = await getWorkerCertificationsUnified(uid);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].certificationRecordId).toBe('ok');
    expect(r.items[0].expirationDate).toBe('2032-01-01');
  });
});
