/**
 * Default seed list for the "Languages Required" Autocomplete used on:
 *   - Recruiter Account → Cascading Data → Compliance Defaults
 *     (`AccountOrderDetailsForm.tsx`)
 *   - Job Order → Compliance / Requirements (`JobOrderForm.tsx`)
 *   - Per-position compliance overrides
 *     (`PositionComplianceOverridesDialog.tsx`)
 *
 * Why a static list rather than a Firestore-backed catalogue:
 *   - The Field Registry entry for `languages` declares
 *     `optionsSource: 'companyDefaults'`, but tenants have not been
 *     populating `tenants/{tid}/companyDefaults.languages`. With no
 *     fallback, the Autocomplete renders "No options" — the bug Greg
 *     reported on the Hyatt Hotels Cascading Data tab on 2026-05-05.
 *   - Skills (ONET) and Licenses (`credentialsSeed`) ship the same way:
 *     a static catalogue under `src/data/`, exposed through
 *     `fieldOptions.ts`. Languages now mirrors that pattern.
 *
 * **Curation policy:** keep this list short and US-workforce-relevant.
 * Common world languages by US-workforce frequency (US Census ACS
 * "Language Spoken at Home"), then a handful of additional widely-
 * spoken European / Asian languages. The list is intentionally not
 * exhaustive — the UI is `freeSolo`, so recruiters can still type any
 * language not in the dropdown.
 */
export const COMMON_LANGUAGES: ReadonlyArray<string> = [
  'English',
  'Spanish',
  'Mandarin',
  'Cantonese',
  'Vietnamese',
  'Korean',
  'Tagalog',
  'Filipino',
  'French',
  'French Creole',
  'Haitian Creole',
  'Portuguese',
  'Russian',
  'Polish',
  'Arabic',
  'Urdu',
  'Hindi',
  'Punjabi',
  'Bengali',
  'Persian (Farsi)',
  'Italian',
  'German',
  'Japanese',
  'Greek',
  'Hebrew',
  'Hmong',
  'American Sign Language (ASL)',
];
