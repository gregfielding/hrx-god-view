import type { CertificationRecordV1 } from '../../../types/certifications/certificationRecord';
import { isCertificationRecordV1 } from '../isCertificationRecordV1';

describe('isCertificationRecordV1', () => {
  it('accepts minimal valid Phase 1 doc', () => {
    const o: unknown = {
      schemaVersion: 1,
      catalogEntryId: 'abc',
    };
    expect(isCertificationRecordV1(o)).toBe(true);
    if (isCertificationRecordV1(o)) {
      const r: CertificationRecordV1 = o;
      expect(r.catalogEntryId).toBe('abc');
    }
  });

  it('rejects missing schemaVersion or catalogEntryId', () => {
    expect(isCertificationRecordV1({ catalogEntryId: 'x' })).toBe(false);
    expect(isCertificationRecordV1({ schemaVersion: 1 })).toBe(false);
    expect(isCertificationRecordV1(null)).toBe(false);
  });
});
