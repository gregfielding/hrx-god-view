/**
 * QBO merchant rules (Greg 2026-09-02: "can you create rules in QBO?").
 * Intuit's API exposes no bank-rule endpoints and Expensify rules are
 * per-member UI, so the rules live HERE — a Firestore table applied by
 * the daily Expensify cron AFTER the write-back has had its chance:
 *
 *   tenants/{t}/qbo_merchant_rules/{id}:
 *     { pattern: string,        // lowercase substring of the parsed merchant
 *       account: string,        // QBO expense account Name or FQN
 *       class?: string,         // optional class FQN
 *       minAgeDays?: number }   // default 7 — give Expensify flow first shot
 *
 * Guards: only lines still on Uncategorized Expense are touched (a human's
 * or the write-back's categorization always wins); purchases younger than
 * minAgeDays are skipped so a worker's explicit Expensify category isn't
 * pre-empted. Rules seeded from ≥80%-consistent categorization history.
 */
import * as admin from 'firebase-admin';

import { qboQuery, qboEntityUpdate } from './qboAuth';
import { parsePurchase } from '../expensify/expensifyPush';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const trim = (v: unknown): string => String(v ?? '').trim();

export async function applyQboMerchantRules(
  tenantId: string,
  dryRun: boolean,
): Promise<Record<string, unknown>> {
  const rulesSnap = await db.collection(`tenants/${tenantId}/qbo_merchant_rules`).get();
  const rules = rulesSnap.docs
    .map((d) => ({ ...(d.data() as Record<string, any>), id: d.id }) as Record<string, any>)
    .filter((r) => trim(r.pattern) && trim(r.account));
  if (rules.length === 0) return { ok: true, dryRun, applied: 0, rules: 0 };

  const acctRes = (await qboQuery(tenantId, "SELECT Id, Name, FullyQualifiedName, AccountType FROM Account WHERE Active = true MAXRESULTS 1000")) as Record<string, any>;
  const accounts = ((acctRes.Account ?? []) as Array<Record<string, any>>);
  const byName = new Map<string, { id: string; name: string }>();
  for (const a of accounts) {
    const entry = { id: trim(a.Id), name: trim(a.FullyQualifiedName) || trim(a.Name) };
    byName.set(trim(a.Name).toLowerCase(), entry);
    byName.set((trim(a.FullyQualifiedName) || trim(a.Name)).toLowerCase(), entry);
  }
  const unc = accounts.find((a) => trim(a.Name) === 'Uncategorized Expense');
  if (!unc) return { ok: false, error: 'Uncategorized Expense account not found' };
  const UNC = trim(unc.Id);
  const clsRes = (await qboQuery(tenantId, 'SELECT Id, Name, FullyQualifiedName FROM Class WHERE Active = true MAXRESULTS 1000')) as Record<string, any>;
  const classByFqn = new Map<string, { id: string; name: string }>(
    ((clsRes.Class ?? clsRes.QueryResponse?.Class ?? []) as Array<Record<string, any>>).map((c) => [
      (trim(c.FullyQualifiedName) || trim(c.Name)).toLowerCase(),
      { id: trim(c.Id), name: trim(c.FullyQualifiedName) || trim(c.Name) },
    ]),
  );

  const since = new Date(Date.now() - 150 * 86400000).toISOString().slice(0, 10);
  let start = 1;
  let applied = 0;
  const appliedRows: Array<Record<string, unknown>> = [];
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const r = (await qboQuery(tenantId, `SELECT * FROM Purchase WHERE TxnDate >= '${since}' STARTPOSITION ${start} MAXRESULTS 1000`)) as Record<string, any>;
    const rows: Array<Record<string, any>> = r.QueryResponse?.Purchase ?? r.Purchase ?? [];
    for (const p of rows) {
      const hasUnc = ((p.Line ?? []) as Array<Record<string, any>>).some(
        (l) => trim(l.AccountBasedExpenseLineDetail?.AccountRef?.value) === UNC,
      );
      if (!hasUnc) continue;
      const parsed = parsePurchase(p) as Record<string, any>;
      const merchant = trim(parsed?.merchant).toLowerCase();
      // Word-boundary match on the MERCHANT only — plain substring matched
      // "apple" against Applebee's, and descriptors mention "Apple Pay"
      // (caught in the first dry run, 2026-09-02).
      const rule = rules.find((ru) => {
        const pat = trim(ru.pattern).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^a-z0-9])${pat}([^a-z0-9]|$)`).test(merchant);
      });
      if (!rule) continue;
      const minAge = Number(rule.minAgeDays ?? 7);
      const ageDays = (Date.now() - Date.parse(String(p.TxnDate))) / 86400000;
      if (ageDays < minAge) continue;
      const acct = byName.get(trim(rule.account).toLowerCase());
      if (!acct || acct.id === UNC) continue;
      const cls = trim(rule.class) ? classByFqn.get(trim(rule.class).toLowerCase()) : undefined;
      let changed = 0;
      for (const l of (p.Line ?? []) as Array<Record<string, any>>) {
        const d = l.AccountBasedExpenseLineDetail;
        if (!d || trim(d.AccountRef?.value) !== UNC) continue;
        d.AccountRef = { value: acct.id, name: acct.name };
        if (cls && !d.ClassRef) d.ClassRef = { value: cls.id, name: cls.name };
        changed += 1;
      }
      if (!changed) continue;
      applied += 1;
      appliedRows.push({ date: p.TxnDate, merchant: parsed?.merchant, amount: p.TotalAmt, account: acct.name, rule: rule.id });
      if (dryRun) continue;
      // eslint-disable-next-line no-await-in-loop
      await qboEntityUpdate(tenantId, 'Purchase', { ...p, sparse: false });
    }
    if (rows.length < 1000) break;
    start += 1000;
  }
  return { ok: true, dryRun, rules: rules.length, applied, appliedRows: appliedRows.slice(0, 60) };
}
