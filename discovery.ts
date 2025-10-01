// src/forms/dealStages/discovery.ts
// Phase 3 stage config stub: define which registry fieldIds appear in the Discovery accordion
// Keep this list small at first and expand gradually.

export const discoveryFieldIds = [
  'jobTitle',
  'notes',
  // Add more discovery-stage fields here, in the order they should render
] as const;

// Optional per-stage UI overrides (purely presentational; do not mutate the registry)
export const discoveryOverrides: Partial<Record<string, { required?: boolean; hidden?: boolean; helpText?: string }>> = {
  // example:
  // notes: { helpText: 'Add any context shared during the first call.' },
};
