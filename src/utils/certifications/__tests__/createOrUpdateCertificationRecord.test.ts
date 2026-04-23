const mockSetDoc = jest.fn();
const mockUpdateDoc = jest.fn();
const mockDoc = jest.fn();
const mockCollection = jest.fn(() => ({}));

jest.mock('firebase/firestore', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  collection: (...args: any[]) => mockCollection(...args),
  doc: (...args: any[]) => mockDoc(...args),
  serverTimestamp: () => ({ __ts: 'serverTimestamp' }),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
}));

jest.mock('../../../firebase', () => ({
  db: {},
}));

import { createOrUpdateCertificationRecord } from '../createOrUpdateCertificationRecord';

describe('createOrUpdateCertificationRecord', () => {
  beforeEach(() => {
    mockSetDoc.mockResolvedValue(undefined);
    mockUpdateDoc.mockResolvedValue(undefined);
    mockDoc.mockImplementation((...args: unknown[]) => {
      // `doc(collectionRef)` → allocate id for new record
      if (args.length === 1) {
        return { id: 'alloc-generated-id', path: 'alloc' };
      }
      const last = args[args.length - 1];
      return { id: String(last), path: String(last) };
    });
  });

  it('creates new doc with random id when certificationRecordId omitted', async () => {
    const { certificationRecordId } = await createOrUpdateCertificationRecord({
      uid: 'u1',
      catalogEntryId: 'cdl-class-a',
      issuerName: 'DMV',
      expirationDate: '2030-01-01',
      evidenceFiles: [{ storageUrl: 'https://x', fileName: 'a.pdf' }],
      source: 'admin_manual',
      catalogAllowsSelfAttestation: false,
    });
    expect(certificationRecordId).toBe('alloc-generated-id');
    expect(mockSetDoc).toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    const payload = mockSetDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.schemaVersion).toBe(1);
    expect(payload.catalogEntryId).toBe('cdl-class-a');
    expect(payload.review).toEqual({ status: 'approved', rejectionReason: null });
    expect(payload.recordStatus).toBe('active');
  });

  it('updates existing doc when certificationRecordId provided', async () => {
    await createOrUpdateCertificationRecord({
      uid: 'u1',
      certificationRecordId: 'rec-existing',
      catalogEntryId: 'cdl-class-a',
      evidenceFiles: [],
      source: 'worker_attestation',
      catalogAllowsSelfAttestation: true,
    });
    expect(mockUpdateDoc).toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
    const payload = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.review).toEqual({ status: 'not_required', rejectionReason: null });
    expect(payload.recordStatus).toBe('active');
  });
});
