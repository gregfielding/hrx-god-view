/**
 * Settings (/settings) navigation — grouped IA only. Tab keys must stay stable for behavior and any bookmarks.
 */

export type SettingsTab =
  | 'company-setup'
  | 'entities'
  | 'onboarding-library'
  | 'documents'
  | 'messaging'
  | 'senders'
  | 'slack'
  | 'workforce'
  | 'smart-groups'
  | 'everify-ops'
  | 'compliance-library'
  | 'credential-types'
  | 'screening-types'
  | 'benefits-programs'
  | 'payroll-providers'
  | 'ai-signals';

export type SettingsNavGroup = {
  id: string;
  label: string;
  items: Array<{ key: SettingsTab; label: string }>;
};

/**
 * Grouped pillars — order within each group is the visible order in the nav.
 */
export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    id: 'company',
    label: 'Company',
    items: [
      { key: 'company-setup', label: 'Company Setup' },
      { key: 'entities', label: 'Entities' },
    ],
  },
  {
    id: 'hiring-ai',
    label: 'Hiring & AI',
    items: [
      { key: 'ai-signals', label: 'AI Interview & Hiring' },
      { key: 'screening-types', label: 'Screening Types' },
      { key: 'credential-types', label: 'Credential Types' },
      { key: 'compliance-library', label: 'Compliance Library' },
      { key: 'everify-ops', label: 'E-Verify Ops' },
    ],
  },
  {
    id: 'workforce',
    label: 'Workforce',
    items: [
      { key: 'workforce', label: 'Workforce Management' },
      { key: 'smart-groups', label: 'Smart Groups' },
      { key: 'benefits-programs', label: 'Benefits Programs' },
    ],
  },
  {
    id: 'onboarding',
    label: 'Onboarding',
    items: [
      { key: 'onboarding-library', label: 'Onboarding Library' },
      { key: 'documents', label: 'Documents & Signatures' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { key: 'messaging', label: 'Messaging' },
      { key: 'senders', label: 'Sender Management' },
      { key: 'slack', label: 'Slack Integration' },
      { key: 'payroll-providers', label: 'Payroll Providers' },
    ],
  },
];

export function findGroupForTab(tab: SettingsTab): { id: string; label: string } | undefined {
  for (const g of SETTINGS_NAV_GROUPS) {
    if (g.items.some((i) => i.key === tab)) return { id: g.id, label: g.label };
  }
  return undefined;
}

export function findNavItemLabel(tab: SettingsTab): string {
  for (const g of SETTINGS_NAV_GROUPS) {
    const item = g.items.find((i) => i.key === tab);
    if (item) return item.label;
  }
  return tab;
}
