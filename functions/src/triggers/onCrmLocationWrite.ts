/**
 * Firestore trigger: on write to crm_companies/.../locations.
 * Location documents are NOT translated: they contain only location name, address, and contact
 * info (identifiers). If worker assignment details show labels like "Phone number" or "Address",
 * translate those via UI labels / taxonomy, not by translating location document fields.
 * Path: tenants/{tenantId}/crm_companies/{companyId}/locations/{locationId}
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

export const onCrmLocationWrite = onDocumentWritten(
  'tenants/{tenantId}/crm_companies/{companyId}/locations/{locationId}',
  async () => {
    // Intentionally no-op: locations are not translated (name, address, contact info only).
    // Worker-facing labels (e.g. "Phone number") can be translated in the UI when we add them.
  }
);
