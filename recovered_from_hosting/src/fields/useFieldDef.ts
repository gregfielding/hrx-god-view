import { FieldRegistry } from './registry';

export const getFieldDef = (fieldId: string) => FieldRegistry[fieldId];
// Temporary alias for backward compatibility with existing imports
export const useFieldDef = getFieldDef;


