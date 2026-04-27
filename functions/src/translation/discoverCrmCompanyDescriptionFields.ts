/**
 * CRM company translation: only the company description (AI-enriched or manual).
 * Company name, address, contacts, and other identifiers are NEVER translated.
 */

/** Only these fields on crm_companies are translated; companyName, name, etc. are excluded. */
export const CRM_COMPANY_DESCRIPTION_FIELDS = ['description'] as const;

/**
 * Returns _i18n field paths for company description only.
 * Source: description_i18n.en ?? description (legacy). Writes to description_i18n.es.
 */
export function discoverCrmCompanyDescriptionI18nCandidates(
  afterData: Record<string, unknown>,
  manualFields: string[] = []
): string[] {
  const manualSet = new Set(manualFields);
  const out: string[] = [];

  for (const field of CRM_COMPANY_DESCRIPTION_FIELDS) {
    const i18nKey = `${field}_i18n`;
    if (manualSet.has(i18nKey)) continue;

    const legacy = afterData[field];
    const i18n = afterData[i18nKey] as { en?: string; es?: string } | undefined;
    const source = (i18n?.en ?? (typeof legacy === 'string' ? legacy : undefined))?.trim();
    if (!source) continue;

    out.push(i18nKey);
  }

  return out;
}
