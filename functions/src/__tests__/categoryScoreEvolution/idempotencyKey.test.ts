import { expect } from 'chai';
import { idempotencyKeyHash } from '../../categoryScoreEvolution/applyCategoryScoreEventCore';

describe('categoryScoreEvolution idempotencyKeyHash', () => {
  it('is stable for (uid, key)', () => {
    const a = idempotencyKeyHash('u1', 'k1');
    const b = idempotencyKeyHash('u1', 'k1');
    expect(a).to.equal(b);
    expect(a).to.have.length(64);
  });

  it('differs when uid or key changes', () => {
    const a = idempotencyKeyHash('u1', 'k1');
    const b = idempotencyKeyHash('u2', 'k1');
    const c = idempotencyKeyHash('u1', 'k2');
    expect(a).to.not.equal(b);
    expect(a).to.not.equal(c);
  });
});
