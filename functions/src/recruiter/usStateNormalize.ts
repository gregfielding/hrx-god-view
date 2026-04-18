/**
 * Same semantics as `src/utils/usStateNormalize.ts` — keep in sync for recruiter table server filters.
 */

export const US_STATE_BY_CODE: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

const US_STATE_CODE_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATE_BY_CODE).map(([code, name]) => [name.toLowerCase(), code]),
);

function stripTrailingPeriod(s: string): string {
  return s.endsWith('.') ? s.slice(0, -1).trim() : s;
}

/** Returns a 2-letter code (e.g. "HI") or null if unknown / empty. */
export function normalizeUsStateCode(raw: string | null | undefined): string | null {
  const v = stripTrailingPeriod((raw || '').toString().trim());
  if (!v) return null;
  const upper = v.toUpperCase();

  if (/^[A-Z]{2}$/.test(upper) && US_STATE_BY_CODE[upper]) return upper;

  const byName = US_STATE_CODE_BY_NAME[v.toLowerCase()];
  if (byName) return byName;

  return null;
}
