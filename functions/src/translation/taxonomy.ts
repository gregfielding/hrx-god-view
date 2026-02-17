/**
 * Tenant taxonomy dictionary: EN → ES for worker-facing chip values (PPE, education, etc.).
 * Used to translate array fields without OpenAI; unknown terms are kept in EN and reported for logging.
 *
 * UI read rule (Web + Flutter): for chip arrays use
 *   doc.field_i18n?.[lang] ?? doc.field_i18n?.en ?? doc.field ?? []
 * For text blocks use
 *   doc.field_i18n?.[lang] ?? doc.field_i18n?.en ?? doc.field ?? ""
 */

export interface TranslateTaxonomyArrayResult {
  translated: string[];
  missingTerms: string[];
}

/**
 * Translates an array of English taxonomy terms to Spanish using the tenant's taxonomy.es map.
 * - If a term is in the map, use the Spanish value.
 * - If not found, keep the English term (safe fallback) and add it to missingTerms for logging.
 * Returns the translated array and the list of terms not found in the dictionary.
 */
export function translateTaxonomyArray(
  items: string[],
  taxonomyEs: Record<string, string> | undefined
): TranslateTaxonomyArrayResult {
  const translated: string[] = [];
  const missingTerms: string[] = [];
  const map = taxonomyEs ?? {};

  for (const item of items) {
    if (typeof item !== 'string') {
      translated.push(String(item));
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed) {
      translated.push(item);
      continue;
    }
    const es = map[trimmed];
    if (es != null && typeof es === 'string') {
      translated.push(es.trim() || trimmed);
    } else {
      translated.push(trimmed);
      if (!missingTerms.includes(trimmed)) {
        missingTerms.push(trimmed);
      }
    }
  }

  return { translated, missingTerms };
}

/** Chip array field names that are translated via taxonomy (not OpenAI). */
export const CHIP_ARRAY_FIELDS = [
  'requiredPpe',
  'uniformRequirements',
  'physicalRequirements',
  'skills',
  'licensesCerts',
  'educationLevels',
  'experienceLevels',
  'languages',
  'shift',
  'backgroundCheckPackages',
  'drugScreeningPanels',
  'additionalScreenings',
] as const;

export type ChipArrayFieldName = (typeof CHIP_ARRAY_FIELDS)[number];

export function isChipArrayField(fieldName: string): fieldName is ChipArrayFieldName {
  return (CHIP_ARRAY_FIELDS as readonly string[]).includes(fieldName);
}

/** Default EN→ES map for tenant taxonomy; can be written to translation_settings/default and customized per tenant. */
export const DEFAULT_TAXONOMY_ES: Record<string, string> = {
  // PPE
  'Hard Hat': 'Casco',
  'Safety Glasses': 'Gafas de seguridad',
  Gloves: 'Guantes',
  'Steel Toe Boots': 'Botas con punta de acero',
  'Ear Protection': 'Protección auditiva',
  'Reflective Vest': 'Chaleco reflectante',
  'Face Shield': 'Careta',
  Respirator: 'Respirador',
  // Education
  GED: 'GED',
  'High School Diploma': 'Diploma de secundaria',
  "Associate Degree": 'Título de asociado',
  "Bachelor's Degree": 'Licenciatura',
  "Master's Degree": 'Maestría',
  // Experience levels
  Entry: 'Nivel inicial',
  'Entry-Level (0–1 year)': 'Nivel inicial (0–1 año)',
  'Entry-Level (0-1 year)': 'Nivel inicial (0–1 año)',
  'Mid-Level (2–4 years)': 'Nivel intermedio (2–4 años)',
  'Senior (5+ years)': 'Senior (5+ años)',
  // Physical requirements
  Standing: 'De pie',
  Walking: 'Caminar',
  Lifting: 'Levantar',
  Bending: 'Agacharse',
  Reaching: 'Alcanzar',
  Climbing: 'Subir',
  Carrying: 'Cargar',
  // Shifts / schedule
  'Full Time': 'Tiempo completo',
  'Part Time': 'Medio tiempo',
  'First Shift': 'Primer turno',
  'Second Shift': 'Segundo turno',
  'Third Shift': 'Tercer turno',
  Overnight: 'Turno nocturno',
  'Some Weekends': 'Algunos fines de semana',
  Weekends: 'Fines de semana',
  // Screening
  None: 'Ninguno',
  'TB Skin Test (PPD)': 'Prueba cutánea de TB (PPD)',
  'Basic National Criminal Check': 'Verificación básica de antecedentes penales (nacional)',
  // Drug panels
  '4-Panel (No THC)': 'Panel de 4 (sin THC)',
  '7-Panel (With THC)': 'Panel de 7 (con THC)',
  // Languages
  English: 'Inglés',
  Spanish: 'Español',
};
