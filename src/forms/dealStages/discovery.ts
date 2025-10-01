// Phase 3 scaffold — Discovery stage config
export const discoveryFieldIds: string[] = [
  'jobTitle',
  'shiftType',
  'onsiteSupervisionRequired',
  'notes',
  'priority',
  'currentStaffCount',
  'currentAgencyCount',
  'employmentType',
  'hasUsedAgenciesBefore',
];

export const discoveryOverrides: Partial<Record<string, { required?: boolean; hidden?: boolean; helpText?: string }>> = {
  // TODO: per-field overrides for discovery
};


