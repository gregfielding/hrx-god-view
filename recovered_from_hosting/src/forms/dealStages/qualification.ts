// Phase 3 scaffold — Qualification stage config
export const qualificationFieldIds: string[] = [
  'experienceLevel',
  'startDate',
  'payRate',
  'workersNeeded',
  'estimatedRevenue',
  'expectedMarkup',
  'backgroundCheckRequired',
  'eVerifyRequired',
];

export const qualificationOverrides: Partial<Record<string, { required?: boolean; hidden?: boolean; helpText?: string }>> = {
  // Optional per-field overrides
};


