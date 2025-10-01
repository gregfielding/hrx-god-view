// Phase 3 scaffold — Scoping stage config (light set to start)
export const scopingFieldIds: string[] = [
  'priority',
  'notes',
  'shiftType',
];

export const scopingOverrides: Partial<Record<string, { required?: boolean; hidden?: boolean; helpText?: string }>> = {
  // Optional per-field overrides for scoping
};


