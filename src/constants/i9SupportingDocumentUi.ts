/**
 * Internal documentType values for I-9 supporting uploads (worker_i9_supporting_documents).
 * Align with product / USCIS list context where applicable.
 */
export const I9_SUPPORTING_DOCUMENT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'list_a_us_passport', label: 'List A — U.S. passport or passport card' },
  { value: 'list_a_pr_card', label: 'List A — Permanent resident card (Form I-551)' },
  { value: 'list_a_ead', label: 'List A — Employment authorization (Form I-766)' },
  { value: 'list_b_drivers_license', label: "List B — Driver's license or state ID" },
  { value: 'list_b_gov_id', label: 'List B — Government-issued ID' },
  { value: 'list_c_ssn_card', label: 'List C — Social Security card' },
  { value: 'list_c_birth_certificate', label: 'List C — Birth certificate' },
  { value: 'other_supporting', label: 'Other supporting document' },
];

export function labelForI9SupportingDocumentType(value: string): string {
  const v = String(value || '').trim();
  const row = I9_SUPPORTING_DOCUMENT_TYPE_OPTIONS.find((o) => o.value === v);
  return (row?.label ?? v) || '—';
}
