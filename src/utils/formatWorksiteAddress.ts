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
