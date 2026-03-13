/**
 * Invoicing access control: two tiers.
 *
 * - Account Invoicing tab (on Account Details): security levels 5, 6, 7.
 * - Global Invoicing (sidebar menu, /invoicing): security level 7 only (all accounts, reporting, create invoices).
 *
 * Auth may return security level as string ('7') or number (7). We normalize once
 * and use a single string-based convention for comparison.
 */

export type SecurityLevelValue = string | number | null | undefined;

/** Normalize to string for consistent comparison. Auth can return '7' or 7. */
export function normalizeSecurityLevel(value: SecurityLevelValue): string {
  if (value == null) return '';
  if (typeof value === 'number') return String(value);
  return String(value).trim();
}

/**
 * True when the user can see the Invoicing tab on an Account Details page.
 * Allowed: security levels 5, 6, and 7.
 */
export function canAccessAccountInvoicingTab(securityLevel: SecurityLevelValue): boolean {
  const normalized = normalizeSecurityLevel(securityLevel);
  return normalized === '5' || normalized === '6' || normalized === '7';
}

/**
 * True only when the user has security level 7 (Admin).
 * Use for: sidebar "Invoicing" menu item and /invoicing route (all accounts, reporting, create invoices).
 */
export function canAccessGlobalInvoicing(securityLevel: SecurityLevelValue): boolean {
  const normalized = normalizeSecurityLevel(securityLevel);
  return normalized === '7';
}

/** @deprecated Use canAccessAccountInvoicingTab or canAccessGlobalInvoicing. Kept for compatibility. */
export function canAccessInvoicing(securityLevel: SecurityLevelValue): boolean {
  return canAccessGlobalInvoicing(securityLevel);
}
