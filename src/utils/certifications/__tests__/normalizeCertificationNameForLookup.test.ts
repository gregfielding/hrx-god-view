import { normalizeCertificationNameForLookup } from '../../../shared/certifications/normalizeCertificationNameForLookup';

describe('normalizeCertificationNameForLookup', () => {
  const foodHandlerKey = 'food handler card';

  it('normalizes Food Handler Card variants to the same lookup key', () => {
    expect(normalizeCertificationNameForLookup('Food Handler Card')).toBe(foodHandlerKey);
    expect(normalizeCertificationNameForLookup('food-handler card')).toBe(foodHandlerKey);
    expect(normalizeCertificationNameForLookup('Food  Handler  Card')).toBe(foodHandlerKey);
    expect(normalizeCertificationNameForLookup('Food Handler (Card)')).toBe(foodHandlerKey);
  });

  it('normalizes ampersand to "and"', () => {
    expect(normalizeCertificationNameForLookup('CPR & First Aid')).toBe(
      normalizeCertificationNameForLookup('CPR and First Aid'),
    );
  });
});
