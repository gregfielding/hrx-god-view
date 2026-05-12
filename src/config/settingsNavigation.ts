/**
 * Settings (/settings) navigation — grouped IA only. Tab keys must stay stable for behavior and any bookmarks.
 */

import { APIS_AND_SERVICES_CATALOG, apisServiceTabKey } from './apisAndServicesCatalog';

/** Every tab key except dynamic `apis-services__*` integration detail views. */
export type CoreSettingsTab =
  | 'company-setup'
  | 'entities'
  | 'onboarding-library'
  | 'documents'
  | 'messaging'
  | 'messaging-sequences'
  | 'senders'
  | 'slack'
  | 'workforce'
  | 'smart-groups'
  | 'everify-ops'
  | 'compliance-library'
  | 'credential-types'
  | 'screening-types'
  | 'job-titles'
  | 'benefits-programs'
  | 'payroll-providers'
  | 'workers-comp'
  | 'ai-signals';

/** Core settings tabs plus one tab per catalog entry (`apis-services__<id>`). */
export type SettingsTab = CoreSettingsTab | `apis-services__${string}`;

export type SettingsNavGroup = {
  id: string;
  label: string;
  items: Array<{ key: SettingsTab; label: string }>;
};

const APIS_SERVICES_GROUP: SettingsNavGroup = {
  id: 'apis-services',
  label: 'APIs & Services',
  items: APIS_AND_SERVICES_CATALOG.map((e) => ({
    key: apisServiceTabKey(e.id) as SettingsTab,
    label: e.name,
  })),
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
      { key: 'job-titles', label: 'Job Titles' },
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
      { key: 'messaging-sequences', label: 'Messaging Sequences' },
      { key: 'senders', label: 'Sender Management' },
      { key: 'slack', label: 'Slack Integration' },
      { key: 'payroll-providers', label: 'Payroll Providers' },
      { key: 'workers-comp', label: 'Workers Comp' },
    ],
  },
  APIS_SERVICES_GROUP,
];

/** All tab keys (stable for URL ?tab= validation). */
export const SETTINGS_TAB_KEYS: SettingsTab[] = SETTINGS_NAV_GROUPS.flatMap((g) =>
  g.items.map((i) => i.key),
);

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
  return String(tab);
}
