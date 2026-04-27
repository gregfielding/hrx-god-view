import { expect } from 'chai';
import { FieldValue } from 'firebase-admin/firestore';
import { sanitizeForFirestoreWrite } from '../../firestore/sanitizeForFirestoreWrite';

describe('sanitizeForFirestoreWrite', () => {
  it('drops undefined object keys', () => {
    expect(sanitizeForFirestoreWrite({ a: 1, b: undefined })).to.deep.equal({ a: 1 });
  });

  it('converts NaN to null', () => {
    expect(sanitizeForFirestoreWrite({ x: NaN })).to.deep.equal({ x: null });
  });

  it('preserves FieldValue', () => {
    const ts = FieldValue.serverTimestamp();
    expect(sanitizeForFirestoreWrite({ t: ts })).to.deep.equal({ t: ts });
  });
});
