/**
 * Worker-type labels by hiring entity, localized.
 * select / workforce → W-2 on-call employee
 * events            → 1099 independent contractor
 */
export type WorkerTypeLanguage = 'en' | 'es';

export function workerTypeLabelForEntityKey(
  entityKey: string,
  language: WorkerTypeLanguage,
): string {
  const key = String(entityKey || '').trim().toLowerCase();
  if (key === 'events') {
    return language === 'es' ? 'Contratista Independiente (1099)' : 'Independent Contractor';
  }
  return language === 'es' ? 'Empleado(a) por Llamada (W-2)' : 'On-Call Employee';
}
