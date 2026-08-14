/**
 * Do-not-contact suppression list shared by both outreach campaigns
 * (Greg 2026-08-14, after "Do not contact me or anyone affiliated with
 * Matrix Bottling Group"). tenants/{t}/outreach_suppressions docs:
 *   { kind: 'domain' | 'company', value, reason, sourceEmail, createdAt }
 * Domain rows suppress every address at that (non-generic) domain; company
 * rows match the contact's company/account/campus name. The reply cron
 * writes rows on company-wide DNC replies; both senders' eligibility
 * passes call isSuppressed() so contacts imported LATER stay covered —
 * per-contact optedOut stamps alone can't do that.
 */
import type * as admin from 'firebase-admin';

/** Personal-mail domains — a DNC from one never suppresses the whole domain. */
export const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'me.com', 'msn.com', 'live.com', 'comcast.net', 'att.net',
  'sbcglobal.net', 'verizon.net', 'protonmail.com', 'proton.me', 'mail.com',
]);

export const normCompany = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export interface Suppressions {
  domains: Set<string>;
  companies: string[]; // normalized
}

export async function loadSuppressions(
  db: admin.firestore.Firestore,
  tenantId: string,
): Promise<Suppressions> {
  const out: Suppressions = { domains: new Set(), companies: [] };
  try {
    const snap = await db.collection(`tenants/${tenantId}/outreach_suppressions`).get();
    snap.forEach((d) => {
      const v = d.data() as Record<string, unknown>;
      const value = String(v.value ?? '').toLowerCase().trim();
      if (!value) return;
      if (v.kind === 'domain') out.domains.add(value);
      else if (v.kind === 'company') out.companies.push(normCompany(value));
    });
  } catch {
    // Missing collection reads as empty — never blocks a send pass.
  }
  return out;
}

/**
 * True when the email's domain is suppressed or any of the contact's
 * company/account/campus names matches a suppressed company. Containment
 * runs both directions ("Matrix Bottling" row vs "Matrix Bottling Group
 * Inc" contact) with a 6-char floor so short fragments can't false-match.
 */
export function isSuppressed(
  sup: Suppressions,
  email: string,
  companyNames: Array<string | undefined | null>,
): boolean {
  const domain = email.toLowerCase().split('@')[1] ?? '';
  if (domain && sup.domains.has(domain)) return true;
  if (sup.companies.length === 0) return false;
  for (const raw of companyNames) {
    const name = normCompany(String(raw ?? ''));
    if (name.length < 6) continue;
    for (const c of sup.companies) {
      if (c.length < 6) continue;
      if (name.includes(c) || c.includes(name)) return true;
    }
  }
  return false;
}
