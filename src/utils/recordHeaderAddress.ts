/**
 * Two-line home address for recruiter record header (aligned with ProfileOverview `addressInfo`).
 */
export function buildRecordHeaderAddressLines(data: Record<string, unknown>): { line1: string; line2: string } | null {
  const ai = (data.addressInfo as Record<string, unknown> | undefined) || {};
  const ad = (data.address as Record<string, unknown> | undefined) || {};
  const street = String(ai.streetAddress ?? ad.street ?? '').trim();
  const unit = String(ai.unitNumber ?? ad.unit ?? '').trim();
  const streetLine = [street, unit].filter(Boolean).join(', ');
  const cityVal = String(data.city ?? ai.city ?? ad.city ?? '').trim();
  const stateVal = String(data.state ?? ai.state ?? ad.state ?? '').trim();
  const zip = String(ai.zip ?? ai.zipCode ?? ad.zipCode ?? ad.zip ?? '').trim();
  const cityStateZip = [cityVal, stateVal, zip].filter(Boolean).join(', ');

  if (streetLine && cityStateZip) {
    return { line1: streetLine, line2: cityStateZip };
  }
  if (streetLine) {
    return { line1: streetLine, line2: cityStateZip };
  }
  if (cityVal && stateVal) {
    return {
      line1: cityVal,
      line2: zip ? `${stateVal} ${zip}` : stateVal,
    };
  }
  const single = [cityVal, stateVal, zip].filter(Boolean).join(', ');
  if (single) {
    return { line1: single, line2: '' };
  }
  return null;
}

export function googleMapsSearchUrl(fullAddress: string): string {
  const q = fullAddress.trim();
  if (!q) return 'https://www.google.com/maps';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
