/**
 * Load tenant translation_settings/default (glossary, doNotTranslate, tone).
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { TranslationSettings } from './types';

export async function loadTranslationSettings(
  db: Firestore,
  tenantId: string
): Promise<TranslationSettings> {
  const ref = db.doc(`tenants/${tenantId}/translation_settings/default`);
  const snap = await ref.get();
  if (!snap.exists) return {};
  const data = snap.data() ?? {};
  return {
    glossary: (data.glossary as Record<string, string>) ?? {},
    doNotTranslate: (data.doNotTranslate as string[]) ?? [],
    tone: (data.tone as string) ?? 'neutral',
    taxonomy: data.taxonomy as { es?: Record<string, string> } | undefined,
  };
}
