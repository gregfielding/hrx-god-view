import { buildCanonicalHomeAddressFromWizardPersonal } from '../buildCanonicalHomeAddress';

describe('buildCanonicalHomeAddressFromWizardPersonal', () => {
  const completePersonal = {
    street: '123 Main St',
    city: 'Anytown',
    state: 'CA',
    zip: '94105',
    placeId: 'PLACE_ID_123',
    formattedAddress: '123 Main St, Anytown, CA 94105, USA',
    country: 'US',
    homeLat: 37.78,
    homeLng: -122.4,
    addressGeocodedAt: '2026-04-29T20:00:00.000Z',
  };

  it('returns the canonical shape for a verified Place selection', () => {
    const result = buildCanonicalHomeAddressFromWizardPersonal(completePersonal);
    expect(result).toEqual({
      formattedAddress: '123 Main St, Anytown, CA 94105, USA',
      street: '123 Main St',
      city: 'Anytown',
      state: 'CA',
      postalCode: '94105',
      country: 'US',
      coordinates: { lat: 37.78, lng: -122.4 },
      placeId: 'PLACE_ID_123',
      geocodedAt: '2026-04-29T20:00:00.000Z',
    });
  });

  it('falls back to a synthesized formattedAddress when Place did not return one', () => {
    const result = buildCanonicalHomeAddressFromWizardPersonal({
      ...completePersonal,
      formattedAddress: undefined,
    });
    expect(result?.formattedAddress).toBe('123 Main St, Anytown, CA, 94105');
  });

  it('returns null when the user typed an address but never picked a Place', () => {
    const result = buildCanonicalHomeAddressFromWizardPersonal({
      ...completePersonal,
      placeId: undefined,
    });
    expect(result).toBeNull();
  });

  it('returns null when coordinates are missing or out-of-range', () => {
    expect(
      buildCanonicalHomeAddressFromWizardPersonal({
        ...completePersonal,
        homeLat: undefined,
      }),
    ).toBeNull();
    expect(
      buildCanonicalHomeAddressFromWizardPersonal({
        ...completePersonal,
        homeLat: 200,
      }),
    ).toBeNull();
  });

  it('returns null when any structural field is missing', () => {
    expect(
      buildCanonicalHomeAddressFromWizardPersonal({
        ...completePersonal,
        zip: '',
      }),
    ).toBeNull();
    expect(
      buildCanonicalHomeAddressFromWizardPersonal({
        ...completePersonal,
        city: '',
      }),
    ).toBeNull();
  });

  it('returns null on null / non-object input', () => {
    expect(buildCanonicalHomeAddressFromWizardPersonal(null)).toBeNull();
    expect(buildCanonicalHomeAddressFromWizardPersonal(undefined)).toBeNull();
  });

  it('accepts `postalCode` as a synonym for `zip`', () => {
    const result = buildCanonicalHomeAddressFromWizardPersonal({
      ...completePersonal,
      zip: undefined,
      postalCode: '94110',
    });
    expect(result?.postalCode).toBe('94110');
  });
});
