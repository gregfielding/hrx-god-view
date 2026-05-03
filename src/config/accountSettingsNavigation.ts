/**
 * Account-level Settings (`/accounts/:id?tab=settings`) navigation.
 *
 * Historical context: the Settings tab used to host a multi-section sidebar
 * (Roles & Schedulers, Pricing, Order Details, Staff Instructions, File Uploads).
 * On 2026-05-03 the first four sections were retired in favor of the unified
 * Cascading Data tab; the Settings tab itself was renamed to "File Uploads",
 * scoped to the file-uploads card only, and hidden on child accounts.
 *
 * The exports below are kept for two reasons:
 *   1. The redirect effect in `RecruiterAccountDetails.tsx` still consumes
 *      `LEGACY_ACCOUNT_TAB_REDIRECTS` to translate `?tab=pricing` /
 *      `?tab=order-defaults` URLs into something useful.
 *   2. `?section=` URL parsing still uses `isAccountSettingsSection` so deep
 *      links from before the collapse don't 404; non-`files` sections get
 *      normalized away by the redirect effect.
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
 * The previous multi-group sidebar was removed in the 2026-05-03 collapse. We
 * keep the export shape so any consumer that still imports the constant gets
 * an empty navigation rather than a runtime error; the rendering surface itself
 * no longer reads it.
 */
export const ACCOUNT_SETTINGS_NAV_GROUPS: AccountSettingsNavGroup[] = [];

/**
 * All section keys still recognized by `?section=`. Most of them no longer
 * render anything on the Settings tab (post-collapse) — the redirect effect in
 * `RecruiterAccountDetails.tsx` normalizes them to `files` (or sends users to
 * the Cascading Data tab) — but we keep them in the type so legacy URL parsing
 * doesn't throw.
 */
export const ACCOUNT_SETTINGS_SECTION_KEYS: AccountSettingsSection[] = [
  'roles',
  'customer-rules',
  'pricing',
  'billing',
  'order-details',
  'staff-instructions',
  'files',
];

/** Default landing section when `?tab=settings` arrives without a `?section=`. */
export const DEFAULT_ACCOUNT_SETTINGS_SECTION: AccountSettingsSection = 'files';

/**
 * Legacy top-level tab slugs that used to own this content. After the 2026-05-03
 * collapse, both targets live on the Cascading Data tab; the redirect effect in
 * `RecruiterAccountDetails.tsx` reroutes `?tab=settings` requests for non-`files`
 * sections back to `?tab=cascading-data`, so even though we still resolve these
 * legacy keys to a `?section=` value here, the effect catches them next.
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
