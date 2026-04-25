/**
 * Account-level Settings (`/accounts/:id?tab=settings`) navigation — grouped IA only.
 * Mirrors the global `/settings` pattern (see ./settingsNavigation.ts) so the two
 * surfaces feel like the same product.
 *
 * Section keys must stay stable: they back the `?section=` URL param and any
 * bookmarks pointing at a specific account-settings sub-section.
 */

export type AccountSettingsSection =
  | 'roles'
  | 'customer-rules'
  | 'pricing'
  | 'billing'
  | 'order-details'
  | 'staff-instructions'
  | 'files';

export type AccountSettingsNavGroup = {
  id: string;
  label: string;
  items: Array<{ key: AccountSettingsSection; label: string }>;
};

/**
 * Visible order. Each group renders as an uppercase subheader in the left
 * sidebar, followed by its items in this order.
 */
export const ACCOUNT_SETTINGS_NAV_GROUPS: AccountSettingsNavGroup[] = [
  {
    id: 'general',
    label: 'General',
    items: [
      { key: 'roles', label: 'Roles & Schedulers' },
      { key: 'customer-rules', label: 'Customer Rules & Policies' },
    ],
  },
  {
    id: 'billing',
    label: 'Billing',
    items: [
      { key: 'pricing', label: 'Pricing' },
      { key: 'billing', label: 'Billing & Invoicing' },
    ],
  },
  {
    id: 'order-defaults',
    label: 'Order Defaults',
    items: [
      { key: 'order-details', label: 'Order Details' },
      { key: 'staff-instructions', label: 'Staff Instructions' },
    ],
  },
  {
    id: 'documents',
    label: 'Documents',
    items: [{ key: 'files', label: 'File Uploads' }],
  },
];

/** All section keys, flat. Used to validate `?section=` and as the type-narrow source of truth. */
export const ACCOUNT_SETTINGS_SECTION_KEYS: AccountSettingsSection[] =
  ACCOUNT_SETTINGS_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.key));

/** Default landing section when `?tab=settings` arrives without a `?section=`. */
export const DEFAULT_ACCOUNT_SETTINGS_SECTION: AccountSettingsSection = 'roles';

/**
 * Legacy top-level tab slugs that used to own this content. We keep their URLs
 * working by redirecting to the equivalent settings section.
 *
 * - `?tab=pricing`        → `?tab=settings&section=pricing`
 * - `?tab=order-defaults` → `?tab=settings&section=order-details` (default sub-view)
 *   (existing `&view=staffInstructions` was internal toggle state and isn't
 *   bookmarked anywhere; we don't bother decoding it.)
 */
export const LEGACY_ACCOUNT_TAB_REDIRECTS: Record<string, AccountSettingsSection> = {
  pricing: 'pricing',
  'order-defaults': 'order-details',
};

export function isAccountSettingsSection(value: string | null | undefined): value is AccountSettingsSection {
  return !!value && (ACCOUNT_SETTINGS_SECTION_KEYS as string[]).includes(value);
}

export function findAccountSettingsGroupForSection(
  section: AccountSettingsSection,
): { id: string; label: string } | undefined {
  for (const g of ACCOUNT_SETTINGS_NAV_GROUPS) {
    if (g.items.some((i) => i.key === section)) return { id: g.id, label: g.label };
  }
  return undefined;
}

export function findAccountSettingsItemLabel(section: AccountSettingsSection): string {
  for (const g of ACCOUNT_SETTINGS_NAV_GROUPS) {
    const item = g.items.find((i) => i.key === section);
    if (item) return item.label;
  }
  return String(section);
}
