/** Single-line display for city / state / ZIP (forms + Places). */
export function formatCityStateZipInput(city: string, state: string, zipCode: string): string {
  const c = (city || '').trim();
  const s = (state || '').trim();
  const z = (zipCode || '').trim();
  if (!c && !s) return '';
  const core = [c, s].filter(Boolean).join(', ');
  return z ? `${core} ${z}`.trim() : core;
}

/**
 * Parse manual "City, ST" or "City, ST 12345" input into structured fields.
 * Keeps partial state while typing (e.g. "Orlando, F" → state "F").
 */
export function parseCityStateZipInput(raw: string): { city: string; state: string; zipCode: string } {
  const value = raw.trim();
  if (!value) return { city: '', state: '', zipCode: '' };
  const idx = value.indexOf(',');
  if (idx === -1) {
    return { city: value, state: '', zipCode: '' };
  }
  const city = value.slice(0, idx).trim();
  const after = value.slice(idx + 1).trim().replace(/\s+/g, ' ');
  if (!after) return { city, state: '', zipCode: '' };
  const stateZip = after.match(/^([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/);
  if (stateZip) {
    return {
      city,
      state: stateZip[1].toUpperCase(),
      zipCode: stateZip[2] || '',
    };
  }
  const stPartialZip = after.match(/^([A-Za-z]{2})(?:\s+(.*))?$/);
  if (stPartialZip) {
    const st = stPartialZip[1].toUpperCase();
    const zipPart = (stPartialZip[2] || '').trim().replace(/\s+/g, '');
    if (!zipPart) {
      return { city, state: st, zipCode: '' };
    }
    if (/^\d{1,5}$/.test(zipPart)) {
      return { city, state: st, zipCode: zipPart };
    }
    if (/^\d{5}-\d{0,4}$/.test(zipPart)) {
      return { city, state: st, zipCode: zipPart };
    }
  }
  const partialState = after.match(/^([A-Za-z]{1,2})$/);
  if (partialState) {
    return { city, state: partialState[1].toUpperCase(), zipCode: '' };
  }
  return { city, state: '', zipCode: '' };
}

/** e.g. "Philadelphia, PA, USA" or "Dallas, TX 75201" from display strings */
export function parseCityStateZipFromWorksiteName(name: string): {
  city: string;
  state: string;
  zipCode: string;
} {
  const s = (name || '').trim();
  if (!s) return { city: '', state: '', zipCode: '' };
  const noCountry = s.replace(/,?\s*USA\s*$/i, '').trim();
  const m = noCountry.match(/^([^,]+),\s*([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?\s*$/);
  if (m) {
    return {
      city: m[1].trim(),
      state: m[2].toUpperCase(),
      zipCode: m[3] || '',
    };
  }
  return { city: '', state: '', zipCode: '' };
}
