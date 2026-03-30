/**
 * Start E-Verify modal — List A / List B+C presets for `i9_case_flat` document fields.
 *
 * **These `code` values must match your signed E-Verify ICA.** Stage/prod return
 * `ATTRIBUTE_INVALID_ENUM` if a code is wrong — update this file when USCIS confirms enums.
 */

export type EverifyCitizenshipApiValue =
  | 'US_CITIZEN'
  | 'NONCITIZEN'
  | 'LAWFUL_PERMANENT_RESIDENT'
  | 'ALIEN_AUTHORIZED_TO_WORK'
  | 'NONCITIZEN_AUTHORIZED_TO_WORK';

export type EverifyListANumberField =
  | 'us_passport_number'
  | 'i551_number'
  | 'i766_number'
  | 'foreign_passport_number';

export interface EverifyListAPresetRow {
  label: string;
  /** Sent as `document_a_type_code` */
  code: string;
  forCitizenship: readonly EverifyCitizenshipApiValue[] | '*';
  numberField: EverifyListANumberField;
}

export const EVERIFY_LIST_A_PRESETS: EverifyListAPresetRow[] = [
  {
    label: 'U.S. Passport',
    code: 'US_PASSPORT',
    forCitizenship: ['US_CITIZEN', 'NONCITIZEN'],
    numberField: 'us_passport_number',
  },
  {
    label: 'U.S. Passport Card',
    code: 'US_PASSPORT_CARD',
    forCitizenship: ['US_CITIZEN', 'NONCITIZEN'],
    numberField: 'us_passport_number',
  },
  {
    label: 'Permanent Resident Card (Form I-551)',
    code: 'PERMANENT_RESIDENT_CARD',
    forCitizenship: ['LAWFUL_PERMANENT_RESIDENT'],
    numberField: 'i551_number',
  },
  {
    label: 'Employment Authorization Document (Form I-766)',
    code: 'EMPLOYMENT_AUTHORIZATION_DOCUMENT',
    forCitizenship: ['ALIEN_AUTHORIZED_TO_WORK', 'NONCITIZEN_AUTHORIZED_TO_WORK'],
    numberField: 'i766_number',
  },
];

export interface EverifyListBCPresetRow {
  label: string;
  code: string;
  forCitizenship: readonly EverifyCitizenshipApiValue[] | '*';
}

export const EVERIFY_LIST_B_PRESETS: EverifyListBCPresetRow[] = [
  {
    label: "Driver's license or state-issued ID (List B)",
    code: 'DRIVERS_LICENSE',
    forCitizenship: '*',
  },
  {
    label: 'Government-issued ID card (List B)',
    code: 'GOVERNMENT_ID_CARD',
    forCitizenship: '*',
  },
];

export const EVERIFY_LIST_C_PRESETS: EverifyListBCPresetRow[] = [
  {
    label: 'U.S. Social Security card (List C)',
    code: 'SOCIAL_SECURITY_CARD',
    forCitizenship: '*',
  },
  {
    label: 'Birth certificate (List C)',
    code: 'BIRTH_CERTIFICATE',
    forCitizenship: '*',
  },
];

export const EVERIFY_DOC_CUSTOM = 'CUSTOM';

export const EVERIFY_LIST_A_NUMBER_FIELD_LABELS: Record<EverifyListANumberField, string> = {
  us_passport_number: 'U.S. / passport card number',
  i551_number: 'Permanent Resident Card (I-551) number',
  i766_number: 'EAD / I-766 number',
  foreign_passport_number: 'Foreign passport number',
};

export function filterDocPresetsByCitizenship<T extends { forCitizenship: readonly string[] | '*' }>(
  rows: T[],
  citizenship: string
): T[] {
  if (!citizenship.trim()) return rows;
  return rows.filter((r) => r.forCitizenship === '*' || (r.forCitizenship as readonly string[]).includes(citizenship));
}
