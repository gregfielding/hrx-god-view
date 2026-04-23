const mockGetDocs = jest.fn();

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((...args: unknown[]) => ({ _path: args })),
  getDocs: (q: unknown) => mockGetDocs(q),
  orderBy: jest.fn((f: string, d: string) => ({ f, d })),
  query: jest.fn((...args: unknown[]) => ({ args })),
}));

jest.mock('../../../firebase', () => ({
  db: {},
}));

import { getCanonicalCertificationRecords } from '../getCanonicalCertificationRecords';

describe('getCanonicalCertificationRecords', () => {
  it('returns records sorted by query (newest first)', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: 'b',
          data: () => ({
            schemaVersion: 1,
            catalogEntryId: 'b',
            review: { status: 'approved', rejectionReason: null },
            recordStatus: 'active',
            source: 'admin_manual',
            updatedAt: { seconds: 2 },
          }),
        },
        {
          id: 'a',
          data: () => ({
            schemaVersion: 1,
            catalogEntryId: 'a',
            review: { status: 'approved', rejectionReason: null },
            recordStatus: 'active',
            source: 'admin_manual',
            updatedAt: { seconds: 1 },
          }),
        },
      ],
    });
    const rows = await getCanonicalCertificationRecords('uid1');
    expect(rows).toHaveLength(2);
    expect(rows[0].catalogEntryId).toBe('b');
    expect(rows[1].catalogEntryId).toBe('a');
    expect(mockGetDocs).toHaveBeenCalled();
  });
});
