/**
 * One-line worksite line for lists/cards: "City, ST 12345" when zip exists.
 */
export function formatWorksiteCityStateZip(
  worksiteAddress?: {
    city?: string;
    state?: string;
    zipCode?: string;
  } | null
): string {
  if (!worksiteAddress) return '';
  const city = (worksiteAddress.city || '').trim();
  const state = (worksiteAddress.state || '').trim();
  const zip = (worksiteAddress.zipCode || '').trim();
  if (!city && !state) return '';
  const cityState = [city, state].filter(Boolean).join(', ');
  return zip ? `${cityState} ${zip}` : cityState;
}

/**
 * One-line full address for disambiguating multiple worksites that
 * share a parent company name (e.g. several "CORT *" accounts in
 * different cities). Format: "Street, City, ST zip" with each
 * segment included only when present. Returns empty string when
 * neither street nor city/state is available so callers can hide
 * the line cleanly with a truthiness check.
 */
export function formatWorksiteFullAddressLine(
  worksiteAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  } | null
): string {
  if (!worksiteAddress) return '';
  const street = (worksiteAddress.street || '').trim();
  const cityStateZip = formatWorksiteCityStateZip(worksiteAddress);
  if (!street && !cityStateZip) return '';
  return [street, cityStateZip].filter(Boolean).join(', ');
}
