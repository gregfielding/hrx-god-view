/**
 * Payroll cost attribution report (Greg 2026-07-28).
 *
 * Answers "what did FIFA Dallas cost us in payroll?" — the accounting gap
 * where money flowed HRX → Everee with no per-job attribution. Aggregates
 * SUBMITTED/PAID timesheet entries over a date range and groups dollars by
 * account → job order → worksite, plus a per-batch section that gives the
 * bookkeeper the split for each Everee funding wire ("$10,000 on 7/18 =
 * $2,000 Lollapalooza + $3,100 FIFA Dallas …") with percentages she can
 * apply to the burdened wire total (pro-rata, per Greg's decision).
 *
 * Source of truth is HRX's own entries (attribution resolved
 * entry → assignment → job order, same chain the submit orchestrator
 * uses); the Everee-side note/label tags are a convenience layer on top.
 * June-era entries that can't resolve a job order land in an explicit
 * "Unattributed" bucket rather than being silently dropped.
 *
 * Gate: books-level access (hrx claim, admin role, or securityLevel ≥ 6)
 * — same bar as the QBO connection management.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { qboQuery, qboEntityCreate, qboEntityUpdate } from '../integrations/quickbooks/qboAuth';
import { evereeRequest } from '../integrations/everee/evereeHttp';
import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
import { buildWcCoverageReport } from '../workersComp/coverageGaps';
import { buildDataHealthReport } from './dataHealthReport';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** 366 (was 92) — job costing needs job-to-date ranges (2026-08-19). */
const MAX_RANGE_DAYS = 366;
const MAX_ROWS = 12000;

function trim(v: unknown): string {
  return String(v ?? '').trim();
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Venue-label → job-order mappings (learn-once, per Greg 2026-07-28):
 * unattributed rows carry a venue label ("FIFA WC Dallas") from the CSV
 * import; an admin maps that label to the right JO once and every entry
 * with that label — past and future — reports under the JO. Applied at
 * READ time (no entry mutation), stored at
 * tenants/{t}/payroll_venue_mappings/{venueKey}.
 */
function normalizeVenueKey(label: string): string {
  return label.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Firestore doc ids cannot contain '/'; keep the key readable otherwise. */
function venueMappingDocId(label: string): string {
  return normalizeVenueKey(label).replace(/\//g, '_').slice(0, 400) || '_';
}

/**
 * Notes-text lookup: a mapped venue name appearing anywhere in free-text
 * notes links the payment ("Minnesota Yacht Club" in a note → its JO).
 * Keys shorter than 5 chars are skipped — too collision-prone as
 * substrings. Longest key wins when several match.
 */
function findMappingInText(
  mappings: Map<string, VenueMapping>,
  text: string,
): VenueMapping | undefined {
  const t = normalizeVenueKey(text);
  if (t.length < 5) return undefined;
  let best: { key: string; m: VenueMapping } | undefined;
  for (const [key, m] of mappings) {
    if (key.length >= 5 && t.includes(key) && (!best || key.length > best.key.length)) {
      best = { key, m };
    }
  }
  return best?.m;
}

interface VenueMapping {
  venueLabel: string;
  jobOrderId: string;
  jobOrderName: string | null;
  jobOrderNumber: string | null;
  poNumber: string | null;
  accountId: string | null;
  accountName: string | null;
}

// 540s/1GiB: the pushWireAllocations action rebuilds the wire journal
// (~2 min of Everee pagination) then creates ~80 QBO JEs — 60s killed it
// mid-build ("internal" in the UI, incident 2026-08-31).
export const savePayrollVenueMapping = onCall(
  { region: 'us-central1', memory: '1GiB', timeoutSeconds: 540 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const action = trim(request.data?.action);

    // ── E-Verify date stamp (OnTrac attestations, Greg 2026-08-20):
    //    one manual lookup in WorkBright per new hire, stored on the
    //    users doc so attestations auto-fill forever after. Level 6. ──
    if (action === 'setEverifyDate') {
      if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
      await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId);
      const workerId = trim(request.data?.workerId);
      const date = trim(request.data?.date);
      if (!workerId) throw new HttpsError('invalid-argument', 'workerId is required.');
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new HttpsError('invalid-argument', 'date must be YYYY-MM-DD (or empty to clear).');
      }
      await db.doc(`users/${workerId}`).set(
        {
          everifyCompletedAt: date || admin.firestore.FieldValue.delete(),
          everifySetBy: request.auth?.uid ?? null,
          everifySetAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return { ok: true, workerId, date: date || null };
    }

    // ── Indeed Flex invoice mirror (Greg 2026-08-31): the Flex portal's
    //    agency-invoices CSV is the source of truth for SBUS billing.
    //    Mirror each FINALIZED row into QBO so payments have an invoice
    //    to land on and A/R is accurate — the Fieldglass/Sodexo pattern.
    //    Existing invoices are verified (amount) and class-fixed; missing
    //    ones are created: customer "Indeed Flex Inc", item "Staffing",
    //    venue as description, class = Indeed Flex:{client} (subclass
    //    auto-created for new clients). Idempotent by DocNumber. Level 7.
    if (action === 'mirrorFlexInvoices') {
      if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
      await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId, 7);
      const dryRun = request.data?.dryRun === true;
      const rows = Array.isArray(request.data?.rows) ? (request.data.rows as Array<Record<string, unknown>>) : [];
      if (rows.length === 0 || rows.length > 400) {
        throw new HttpsError('invalid-argument', 'rows required (1–400 per call).');
      }

      const custRes = (await qboQuery(tenantId, "SELECT Id, DisplayName FROM Customer WHERE DisplayName = 'Indeed Flex Inc'")) as Record<string, any>;
      const customer = (custRes.QueryResponse?.Customer ?? custRes.Customer ?? [])[0];
      if (!customer) throw new HttpsError('failed-precondition', 'QBO customer "Indeed Flex Inc" not found.');
      const itemRes = (await qboQuery(tenantId, "SELECT Id, Name FROM Item WHERE Name = 'Staffing'")) as Record<string, any>;
      const item = (itemRes.QueryResponse?.Item ?? itemRes.Item ?? [])[0];
      if (!item) throw new HttpsError('failed-precondition', 'QBO item "Staffing" not found.');

      const clsRes = (await qboQuery(tenantId, 'SELECT Id, Name, FullyQualifiedName FROM Class MAXRESULTS 1000')) as Record<string, any>;
      const classes: Array<Record<string, any>> = clsRes.QueryResponse?.Class ?? clsRes.Class ?? [];
      const flexParent = classes.find((c) => c.FullyQualifiedName === 'Indeed Flex');
      if (!flexParent) throw new HttpsError('failed-precondition', 'Class "Indeed Flex" not found.');
      const subByName = new Map<string, Record<string, any>>(
        classes
          .filter((c) => String(c.FullyQualifiedName).startsWith('Indeed Flex:'))
          .map((c) => [String(c.Name).toLowerCase(), c]),
      );
      const classForClient = async (client: string): Promise<Record<string, any>> => {
        // Known naming drift: portal "CORT" ↔ class "Cort".
        const key = client.toLowerCase() === 'cort' ? 'cort' : client.toLowerCase();
        const hit = subByName.get(key);
        if (hit) return hit;
        const created = (await qboEntityCreate(tenantId, 'Class', {
          Name: client,
          ParentRef: { value: String(flexParent.Id) },
        })) as Record<string, any>;
        const c = created.Class ?? created;
        subByName.set(key, c);
        await db.doc(`tenants/${tenantId}/qbo_class_mappings/${String(c.Id)}`).set({
          classId: String(c.Id), className: client,
          fqn: String(c.FullyQualifiedName ?? `Indeed Flex:${client}`),
          targetKind: 'account', jobOrderId: null, jobOrderName: null, jobOrderIds: [], jobOrderNames: [],
          accountId: null, accountName: null,
          source: 'flex_invoice_mirror', mappedBy: request.auth?.uid ?? null,
          mappedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return c;
      };

      const created: string[] = []; const fixedClass: string[] = []; const verified: string[] = [];
      const skipped: string[] = []; const mismatched: string[] = [];
      for (const raw of rows) {
        const doc = trim(raw.invoice);
        const client = trim(raw.client);
        const venue = trim(raw.venue);
        const status = trim(raw.status).toUpperCase();
        const date = trim(raw.date);
        const amount = Number(String(raw.amount ?? '').replace(/[$,]/g, ''));
        if (!doc || !client || !Number.isFinite(amount)) { skipped.push(`${doc || '(no #)'}: bad row`); continue; }
        if (status === 'UPCOMING') { skipped.push(`${doc}: UPCOMING — not finalized yet`); continue; }
        if (date && date < '2026-01-01') { skipped.push(`${doc}: pre-2026`); continue; }

        const q = (await qboQuery(tenantId, `SELECT * FROM Invoice WHERE DocNumber = '${doc.replace(/'/g, '')}'`)) as Record<string, any>;
        const existing = (q.QueryResponse?.Invoice ?? q.Invoice ?? [])[0];
        const cls = await classForClient(client);

        if (existing) {
          if (Math.abs(Number(existing.TotalAmt) - amount) > 0.01) {
            mismatched.push(`${doc}: QBO $${existing.TotalAmt} vs portal $${amount.toFixed(2)}`);
            continue;
          }
          let changed = 0;
          for (const line of existing.Line ?? []) {
            const d = line.SalesItemLineDetail;
            if (d && (!d.ClassRef || String(d.ClassRef.value) === String(flexParent.Id))) {
              d.ClassRef = { value: String(cls.Id), name: String(cls.FullyQualifiedName) };
              changed++;
            }
          }
          if (changed && !dryRun) {
            await qboEntityUpdate(tenantId, 'Invoice', { ...existing, sparse: false });
            fixedClass.push(doc);
          } else verified.push(doc);
          continue;
        }

        if (dryRun) { created.push(`${doc} (would create) $${amount.toFixed(2)} → ${client}`); continue; }
        await qboEntityCreate(tenantId, 'Invoice', {
          CustomerRef: { value: String(customer.Id) },
          DocNumber: doc,
          TxnDate: date || undefined,
          Line: [{
            DetailType: 'SalesItemLineDetail',
            Amount: amount,
            Description: venue,
            SalesItemLineDetail: {
              ItemRef: { value: String(item.Id) },
              ClassRef: { value: String(cls.Id), name: String(cls.FullyQualifiedName) },
            },
          }],
        });
        created.push(`${doc} $${amount.toFixed(2)} → ${client}`);
      }
      return { ok: true, dryRun, created, fixedClass, verified: verified.length, skipped, mismatched };
    }

    // ── Phase 4: push wire allocations to QBO (Greg 2026-08-31). Everee
    //    wires land as UNCLASSED bank-feed Purchases on 5010 Direct Labor;
    //    this posts a reclass JE per wire — credit 5010 unclassed, debit
    //    5010 per class from buildWireJournal's penny-exact splits —
    //    mirroring Tabitha's own manual "EV Pay Alloc" July entries. A
    //    wire is skipped when an allocation JE already exists (hers or
    //    ours), matched by DocNumber or by an existing 5010-unclassed
    //    credit within $1 of the wire. Unattributed remainder stays
    //    honestly unclassed. Level 7; dryRun first. ──
    if (action === 'pushWireAllocations') {
      if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
      await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId, 7);
      const dryRun = request.data?.dryRun !== false;
      const startDate = trim(request.data?.startDate);
      const endDate = trim(request.data?.endDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        throw new HttpsError('invalid-argument', 'startDate/endDate (YYYY-MM-DD) required.');
      }

      const journal = (await buildWireJournal(tenantId, startDate, endDate, trim(request.data?.hiringEntityId) || null)) as {
        wires: Array<{ fundingId: string; fundingDate: string; entityName: string; amount: number; splits: Array<{ class: string; qboClass: string | null; qboClassExists: boolean; amount: number }> }>;
      };

      // QBO context: the 5010 account, class ids, existing allocation JEs.
      // (AcctNum is not queryable in the v3 API — fetch and filter locally.)
      const acctRes = (await qboQuery(tenantId, "SELECT * FROM Account WHERE AccountType = 'Cost of Goods Sold' MAXRESULTS 1000")) as Record<string, any>;
      const acct5010 = ((acctRes.QueryResponse?.Account ?? acctRes.Account ?? []) as Array<Record<string, any>>).find(
        (a) => String(a.AcctNum ?? '') === '5010' || /^5010\b/.test(String(a.Name ?? '')),
      );
      if (!acct5010) throw new HttpsError('failed-precondition', 'Account 5010 (Direct Labor) not found.');
      const ACCT = String(acct5010.Id);
      const clsRes = (await qboQuery(tenantId, 'SELECT Id, Name, FullyQualifiedName FROM Class MAXRESULTS 1000')) as Record<string, any>;
      const classIdByFqn = new Map<string, string>(
        ((clsRes.QueryResponse?.Class ?? clsRes.Class ?? []) as Array<Record<string, any>>).map((c) => [
          String(c.FullyQualifiedName), String(c.Id),
        ]),
      );
      // Idempotency (rewritten after the 2026-08-31 incident: DocNumber was
      // only unique per day+entity, and the any-date $1 credit heuristic
      // false-matched — together they silently skipped 26 wires / $525K).
      //  1. Exact: a JE whose PrivateNote carries [wire:{fundingId}] owns
      //     that wire forever.
      //  2. Heuristic (pre-tag JEs, incl. Tabitha's month-end "EV Pay
      //     Alloc" batches dated up to 30d after their wires): an
      //     unclassed 5010 credit within $1 dated −5..+35 days of the
      //     wire — and each credit vouches for at most ONE wire.
      const existingDocs = new Set<string>();
      const existingWireTags = new Set<string>();
      const creditByTag = new Map<string, number>();
      const existingCredits: Array<{ date: string; amt: number; used: boolean }> = [];
      let jstart = 1;
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const jr = (await qboQuery(tenantId, `SELECT * FROM JournalEntry WHERE TxnDate >= '2026-01-01' STARTPOSITION ${jstart} MAXRESULTS 1000`)) as Record<string, any>;
        const jrows: Array<Record<string, any>> = jr.QueryResponse?.JournalEntry ?? jr.JournalEntry ?? [];
        for (const je of jrows) {
          existingDocs.add(trim(je.DocNumber));
          let jeCredit = 0;
          for (const line of (je.Line ?? []) as Array<Record<string, any>>) {
            const d = line.JournalEntryLineDetail;
            if (d?.PostingType === 'Credit' && String(d.AccountRef?.value) === ACCT && !d.ClassRef) {
              jeCredit += Number(line.Amount) || 0;
              existingCredits.push({ date: trim(je.TxnDate), amt: Number(line.Amount) || 0, used: false });
            }
          }
          for (const m of trim(je.PrivateNote).matchAll(/\[wire:([^\]]+)\]/g)) {
            existingWireTags.add(trim(m[1]));
            creditByTag.set(trim(m[1]), (creditByTag.get(trim(m[1])) ?? 0) + jeCredit);
          }
        }
        if (jrows.length < 1000) break;
        jstart += 1000;
      }

      const dayNum = (d: string): number => Math.floor(Date.parse(d) / 86400000);
      const claimCredit = (w: { fundingDate: string; amount: number }): boolean => {
        const wd = dayNum(w.fundingDate);
        const c = existingCredits.find((x) => {
          if (x.used || Math.abs(x.amt - w.amount) > 1) return false;
          const off = dayNum(x.date) - wd;
          return off >= -5 && off <= 35;
        });
        if (c) c.used = true;
        return Boolean(c);
      };
      const docCounter = new Map<string, number>();
      const results: Array<Record<string, unknown>> = [];
      for (const w of journal.wires) {
        const mmdd = w.fundingDate.slice(5).replace('-', '');
        const ent = /events/i.test(w.entityName) ? 'EVT' : /select/i.test(w.entityName) ? 'SEL' : /workforce/i.test(w.entityName) ? 'WF' : 'C1';
        const base = `EV Alloc ${mmdd} ${ent}`; // QBO caps DocNumber at 21 chars
        let nth = (docCounter.get(base) ?? 0) + 1;
        let docNumber = nth === 1 ? base : `${base}${nth}`;
        while (existingDocs.has(docNumber)) {
          nth += 1;
          docNumber = `${base}${nth}`;
        }
        docCounter.set(base, nth);
        // Tag key: fundingId alone collides for the no-funding-id aggregate
        // group ('none' exists per entity) — suffix with the entity code.
        const wireTag = `${trim(w.fundingId)}@${ent}`;
        if (existingWireTags.has(wireTag)) {
          // Report drift instead of hiding it: the wire total in Everee has
          // moved since its JE was posted (late voids/corrections, or a
          // grown no-funding-id aggregate). Tabitha trues up at bank rec.
          const posted = creditByTag.get(wireTag) ?? 0;
          const drift = Math.round((w.amount - posted) * 100) / 100;
          results.push({
            fundingDate: w.fundingDate, entity: w.entityName, amount: w.amount,
            status: Math.abs(drift) > 1 ? 'allocated_amount_drift' : 'already_allocated',
            ...(Math.abs(drift) > 1 ? { postedAmount: posted, drift } : {}),
          });
          continue;
        }
        if (claimCredit(w)) {
          results.push({ fundingDate: w.fundingDate, entity: w.entityName, amount: w.amount, status: 'already_allocated' });
          continue;
        }
        const lines: Array<Record<string, unknown>> = [];
        let unresolved = 0;
        for (const s of w.splits) {
          const cid = s.qboClass ? classIdByFqn.get(s.qboClass) : undefined;
          if (s.class === 'Unattributed' || !s.qboClassExists || !cid) { unresolved += s.amount; continue; }
          lines.push({
            DetailType: 'JournalEntryLineDetail',
            Amount: Math.round(s.amount * 100) / 100,
            Description: `Everee wire ${w.fundingDate} ${w.entityName} — ${s.class}`,
            JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: ACCT }, ClassRef: { value: cid, name: s.qboClass } },
          });
        }
        if (unresolved > 0.005) {
          lines.push({
            DetailType: 'JournalEntryLineDetail',
            Amount: Math.round(unresolved * 100) / 100,
            Description: `Everee wire ${w.fundingDate} — unattributed remainder`,
            JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: ACCT } },
          });
        }
        lines.push({
          DetailType: 'JournalEntryLineDetail',
          Amount: Math.round(w.amount * 100) / 100,
          Description: `Everee wire ${w.fundingDate} ${w.entityName} — reallocation`,
          JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { value: ACCT } },
        });
        if (dryRun) {
          results.push({
            fundingDate: w.fundingDate, entity: w.entityName, amount: w.amount, status: 'would_create', docNumber,
            splits: w.splits.map((s) => ({ class: s.qboClass ?? s.class, amount: s.amount, resolves: s.qboClassExists })),
          });
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await qboEntityCreate(tenantId, 'JournalEntry', {
          DocNumber: docNumber,
          TxnDate: w.fundingDate,
          PrivateNote: `Auto allocation from /payroll-costs wire worksheet (Phase 4). Wire $${w.amount.toFixed(2)} ${w.entityName}. [wire:${wireTag}]`,
          Line: lines,
        });
        existingDocs.add(docNumber);
        existingWireTags.add(wireTag);
        results.push({ fundingDate: w.fundingDate, entity: w.entityName, amount: w.amount, status: 'created', docNumber });
      }
      return { ok: true, dryRun, wires: results };
    }

    // ── QBO class mapping/creation branches (Greg 2026-08-19). Rides
    //    this callable to stay under the Cloud Run service cap. Level 7
    //    — these shape the books. Mark's email-driven VenueSmart class
    //    automation calls the SAME branches. ──
    if (action === 'mapQboClass' || action === 'createQboClass') {
      if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
      await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId, 7);

      if (action === 'createQboClass') {
        const name = trim(request.data?.name);
        const parentClassId = trim(request.data?.parentClassId);
        if (!name) throw new HttpsError('invalid-argument', 'name is required.');
        const body: Record<string, unknown> = { Name: name };
        if (parentClassId) body.ParentRef = { value: parentClassId };
        const created = (await qboEntityCreate(tenantId, 'Class', body)) as Record<string, any>;
        const cls = (created.Class ?? created) as Record<string, any>;
        const classId = trim(cls.Id);
        const fqn = trim(cls.FullyQualifiedName) || name;
        return { ok: true, classId, name: trim(cls.Name) || name, fqn };
      }

      // mapQboClass — write (or remove) the authoritative class↔HRX link.
      const classId = trim(request.data?.classId);
      const className = trim(request.data?.className);
      if (!classId || !className) throw new HttpsError('invalid-argument', 'classId and className are required.');
      const ref = db.doc(`tenants/${tenantId}/qbo_class_mappings/${classId}`);
      if (request.data?.remove === true) {
        await ref.delete();
        return { ok: true, removed: true, classId };
      }
      // Level-aware mapping (Greg 2026-08-27): a class points to ONE node
      // in the HRX hierarchy — 'overhead' (non-client, excluded from
      // client margins), 'account' (parent/child/standalone — dollars
      // attach at the account, never guessed down to JOs), or
      // 'job_order' (one or MORE JOs — the MN Yacht + Country Club
      // shape). Legacy docs without targetKind keep working: jobOrderName
      // ⇒ job_order, else accountId ⇒ account.
      const targetKind = trim(request.data?.targetKind); // '', 'overhead', 'account', 'job_order'
      const jobOrderIds = Array.isArray(request.data?.jobOrderIds)
        ? (request.data.jobOrderIds as unknown[]).map((x) => trim(x)).filter(Boolean)
        : [trim(request.data?.jobOrderId)].filter(Boolean);
      const accountId = trim(request.data?.accountId);
      if (targetKind !== 'overhead' && jobOrderIds.length === 0 && !accountId) {
        throw new HttpsError('invalid-argument', 'jobOrderId(s), accountId, or targetKind=overhead is required to map.');
      }
      const jobOrderNames: string[] = [];
      let mappedAccountId: string | null = accountId || null;
      let accountName: string | null = null;
      if (targetKind !== 'overhead' && targetKind !== 'account') {
        for (const joId of jobOrderIds.slice(0, 10)) {
          for (const coll of ['job_orders', 'jobOrders', 'recruiter_jobOrders']) {
            // eslint-disable-next-line no-await-in-loop
            const s = await db.doc(`tenants/${tenantId}/${coll}/${joId}`).get();
            if (s.exists) {
              const n = trim(s.data()?.jobOrderName) || trim(s.data()?.title);
              if (n) jobOrderNames.push(n);
              if (!mappedAccountId) mappedAccountId = trim(s.data()?.recruiterAccountId) || null;
              break;
            }
          }
        }
        if (jobOrderIds.length > 0 && jobOrderNames.length === 0) {
          throw new HttpsError('not-found', 'Job order(s) not found.');
        }
      }
      if (mappedAccountId) {
        const acct = await db.doc(`tenants/${tenantId}/accounts/${mappedAccountId}`).get();
        accountName = acct.exists ? trim(acct.data()?.name) || null : null;
      }
      const resolvedKind =
        targetKind === 'overhead'
          ? 'overhead'
          : targetKind === 'account' || jobOrderNames.length === 0
            ? 'account'
            : 'job_order';
      await ref.set({
        classId,
        className,
        fqn: trim(request.data?.fqn) || className,
        targetKind: resolvedKind,
        jobOrderId: resolvedKind === 'job_order' ? jobOrderIds[0] : null,
        jobOrderName: resolvedKind === 'job_order' ? jobOrderNames[0] : null,
        jobOrderIds: resolvedKind === 'job_order' ? jobOrderIds : [],
        jobOrderNames: resolvedKind === 'job_order' ? jobOrderNames : [],
        accountId: resolvedKind === 'overhead' ? null : mappedAccountId,
        accountName: resolvedKind === 'overhead' ? null : accountName,
        source: trim(request.data?.source) || 'manual',
        mappedBy: request.auth?.uid ?? null,
        mappedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { ok: true, classId, targetKind: resolvedKind, jobOrderNames, accountId: mappedAccountId, accountName };
    }

    const venueLabel = trim(request.data?.venueLabel);
    const jobOrderId = trim(request.data?.jobOrderId);
    if (!tenantId || !venueLabel) {
      throw new HttpsError('invalid-argument', 'tenantId and venueLabel are required.');
    }
    await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId);

    const ref = db.doc(`tenants/${tenantId}/payroll_venue_mappings/${venueMappingDocId(venueLabel)}`);
    if (!jobOrderId) {
      await ref.delete();
      return { deleted: true, venueLabel };
    }

    let jo: Record<string, unknown> | null = null;
    for (const coll of ['job_orders', 'jobOrders', 'recruiter_jobOrders']) {
      const s = await db.doc(`tenants/${tenantId}/${coll}/${jobOrderId}`).get();
      if (s.exists) {
        jo = s.data() as Record<string, unknown>;
        break;
      }
    }
    if (!jo) throw new HttpsError('not-found', `Job order ${jobOrderId} not found.`);
    const accountId = trim(jo.recruiterAccountId) || null;
    let accountName: string | null = null;
    if (accountId) {
      const acct = await db.doc(`tenants/${tenantId}/accounts/${accountId}`).get();
      accountName = acct.exists ? trim(acct.data()?.name) || null : null;
    }
    const mapping: VenueMapping = {
      venueLabel,
      jobOrderId,
      jobOrderName: trim(jo.jobOrderName) || null,
      jobOrderNumber: trim(jo.jobOrderNumber) || null,
      poNumber: trim(jo.poNumber) || null,
      accountId,
      accountName,
    };
    await ref.set({
      ...mapping,
      venueKey: normalizeVenueKey(venueLabel),
      updatedByUid: request.auth?.uid ?? null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { deleted: false, ...mapping };
  },
);

/**
 * Books access: hrx staff, admin role, or securityLevel >= minLevel
 * (default 6). Shared with offCyclePayments. Billing/gross-margin data
 * (includeBilling) passes 7 — same bar as Global Invoicing.
 */
export async function ensureBooksAccess(uid: string | undefined, token: Record<string, unknown> | undefined, tenantId: string, minLevel = 6): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  if (token?.hrx === true) return;
  const data = ((await db.collection('users').doc(uid).get()).data() ?? {}) as Record<string, unknown>;
  const role = String(data.role ?? '').toLowerCase();
  const level = Number.parseInt(String(data.securityLevel ?? '0'), 10) || 0;
  const tenantLevel = Number.parseInt(
    String((data.tenantIds as Record<string, Record<string, unknown>> | undefined)?.[tenantId]?.securityLevel ?? '0'),
    10,
  ) || 0;
  if (role === 'admin' || role === 'super_admin' || level >= minLevel || tenantLevel >= minLevel) return;
  throw new HttpsError('permission-denied', 'Payroll cost reporting requires admin access.');
}

/* -------------------------------------------------------------------------
 * Gross-margin billing block (Greg 2026-08-19): QBO invoices for the same
 * date range, aggregated by line-level class (class name = "Account:Job
 * order", the same convention the byBatch labels use) and by customer.
 * Queried live — the per-account invoice caches store headers only, no
 * Line/ClassRef.
 * ------------------------------------------------------------------------- */

interface BilledClassAgg {
  className: string;
  billed: number;
  lineCount: number;
  /** Per-invoice-line refs for job-costing drill-down (capped). */
  invoiceRefs: Array<{ docNumber: string | null; txnDate: string | null; amount: number; customerName: string | null }>;
}

interface BilledCustomerAgg {
  customerId: string;
  customerName: string | null;
  accountId: string | null;
  accountName: string | null;
  billed: number;
  invoiceCount: number;
  openBalance: number;
  /** Class keys billed on this customer's invoices — lets the by-client
   *  join follow a class→JO match to the PAY-side account when the QBO
   *  customer maps to a different HRX account (AEG Management Oakland →
   *  "Oakland Arena" account, payroll under "Legends National Account"). */
  classKeys: Set<string>;
}

interface BillingAggregates {
  invoiceCount: number;
  totalBilled: number;
  /** Sales-line dollars with no class on line or invoice. */
  unclassifiedBilled: number;
  classAggs: Map<string, BilledClassAgg>;
  customerAggs: Map<string, BilledCustomerAgg>;
  /** customerId → HRX account (sub-customers resolved to their nearest
   *  mapped ancestor) — reused by the cash-flow collections rollup. */
  acctByCustomerId: Map<string, { accountId: string; accountName: string | null }>;
}

async function buildBillingAggregates(
  tenantId: string,
  startDate: string,
  endDate: string,
): Promise<BillingAggregates> {
  // Dates are regex-validated (YYYY-MM-DD) before this runs — safe to inline.
  const invoices: Array<Record<string, any>> = [];
  const pageSize = 1000;
  for (let page = 0; page < 20; page++) {
    const start = page * pageSize + 1;
    // eslint-disable-next-line no-await-in-loop
    const resp = await qboQuery(
      tenantId,
      `SELECT * FROM Invoice WHERE TxnDate >= '${startDate}' AND TxnDate <= '${endDate}' STARTPOSITION ${start} MAXRESULTS ${pageSize}`,
    );
    const items = (resp.Invoice ?? []) as Array<Record<string, any>>;
    invoices.push(...items);
    if (items.length < pageSize) break;
  }

  // HRX account ↔ QBO customer mapping (same field the invoicing sync uses).
  const acctSnap = await db.collection(`tenants/${tenantId}/accounts`).get();
  const acctByCustomerId = new Map<string, { accountId: string; accountName: string | null }>();
  acctSnap.forEach((d) => {
    const cid = trim(
      ((d.data().integrations as Record<string, any> | undefined)?.quickbooks as Record<string, any> | undefined)
        ?.customerId,
    );
    if (cid) acctByCustomerId.set(cid, { accountId: d.id, accountName: trim(d.data().name) || null });
  });
  // QBO sub-customers inherit their nearest mapped ancestor's account
  // (parent/sub-customer hierarchy — RS3=Proof, 2026-08-19). Reads the
  // qbo_customers cache's parentCustomerId links.
  const qboCustSnap = await db.collection(`tenants/${tenantId}/qbo_customers`).limit(2000).get();
  const parentOf = new Map<string, string>();
  qboCustSnap.forEach((d) => {
    const c = d.data();
    if (c.customerId && c.parentCustomerId) parentOf.set(String(c.customerId), String(c.parentCustomerId));
  });
  qboCustSnap.forEach((d) => {
    const id = trim(d.data().customerId);
    if (!id || acctByCustomerId.has(id)) return;
    let ancestor = parentOf.get(id);
    for (let hops = 0; ancestor && hops < 10; hops++) {
      const hit = acctByCustomerId.get(ancestor);
      if (hit) {
        acctByCustomerId.set(id, hit);
        return;
      }
      ancestor = parentOf.get(ancestor);
    }
  });

  const classAggs = new Map<string, BilledClassAgg>();
  const customerAggs = new Map<string, BilledCustomerAgg>();
  let totalBilled = 0;
  let unclassifiedBilled = 0;

  for (const inv of invoices) {
    const cid = trim((inv.CustomerRef as Record<string, any> | undefined)?.value);
    const cname = trim((inv.CustomerRef as Record<string, any> | undefined)?.name) || null;
    const headerTotal = num(inv.TotalAmt);
    totalBilled = round2(totalBilled + headerTotal);
    const acct = acctByCustomerId.get(cid);
    const cust = customerAggs.get(cid) ?? {
      customerId: cid,
      customerName: cname,
      accountId: acct?.accountId ?? null,
      accountName: acct?.accountName ?? null,
      billed: 0,
      invoiceCount: 0,
      openBalance: 0,
      classKeys: new Set<string>(),
    };
    cust.billed = round2(cust.billed + headerTotal);
    cust.invoiceCount += 1;
    cust.openBalance = round2(cust.openBalance + num(inv.Balance));
    if (!cust.customerName && cname) cust.customerName = cname;
    customerAggs.set(cid, cust);

    // Line-level class attribution. Class can live on the sales line
    // (per-line class tracking, C1's setting) or on the whole invoice.
    // Line amounts are pre-tax — per-class dollars won't sum to header
    // totals when invoices carry tax/discounts; customer totals stay
    // header-based (authoritative).
    const invClass = trim((inv.ClassRef as Record<string, any> | undefined)?.name);
    const lines = Array.isArray(inv.Line) ? (inv.Line as Array<Record<string, any>>) : [];
    for (const line of lines) {
      if (trim(line.DetailType) !== 'SalesItemLineDetail') continue;
      const amount = num(line.Amount);
      if (!amount) continue;
      const cls =
        trim((line.SalesItemLineDetail as Record<string, any> | undefined)?.ClassRef?.name) || invClass;
      if (!cls) {
        unclassifiedBilled = round2(unclassifiedBilled + amount);
        continue;
      }
      const key = cls.toLowerCase();
      const agg = classAggs.get(key) ?? { className: cls, billed: 0, lineCount: 0, invoiceRefs: [] };
      agg.billed = round2(agg.billed + amount);
      agg.lineCount += 1;
      if (agg.invoiceRefs.length < 200) {
        agg.invoiceRefs.push({
          docNumber: trim(inv.DocNumber) || null,
          txnDate: trim(inv.TxnDate) || null,
          amount,
          customerName: cname,
        });
      }
      classAggs.set(key, agg);
      cust.classKeys.add(key);
    }
  }

  return { invoiceCount: invoices.length, totalBilled, unclassifiedBilled, classAggs, customerAggs, acctByCustomerId };
}

/* -------------------------------------------------------------------------
 * Job-costing expenses (Greg 2026-08-19): QBO Purchase lines by class —
 * the Expensify write-back (EXP-6/7) stamps card expenses with the same
 * "Account:Job order" classes, so a JO's non-payroll costs live here.
 * ☠️ Everee-vendor purchases are EXCLUDED: those are the payroll wires
 * (and Everee service fees) — the wire class splits would double-count
 * payroll that the report already carries from timesheet entries.
 * ------------------------------------------------------------------------- */

interface ExpenseClassAgg {
  className: string;
  total: number;
  lineCount: number;
  lines: Array<{ txnDate: string | null; vendor: string | null; memo: string | null; amount: number }>;
}

interface ExpenseAggregates {
  purchaseCount: number;
  totalExpenses: number;
  /** Classed-line dollars skipped because the vendor is Everee (payroll wires). */
  excludedEvereeTotal: number;
  unclassifiedExpenses: number;
  classAggs: Map<string, ExpenseClassAgg>;
}

async function buildExpenseAggregates(
  tenantId: string,
  startDate: string,
  endDate: string,
): Promise<ExpenseAggregates> {
  const purchases: Array<Record<string, any>> = [];
  const pageSize = 1000;
  for (let page = 0; page < 20; page++) {
    const start = page * pageSize + 1;
    // eslint-disable-next-line no-await-in-loop
    const resp = await qboQuery(
      tenantId,
      `SELECT * FROM Purchase WHERE TxnDate >= '${startDate}' AND TxnDate <= '${endDate}' STARTPOSITION ${start} MAXRESULTS ${pageSize}`,
    );
    const items = (resp.Purchase ?? []) as Array<Record<string, any>>;
    purchases.push(...items);
    if (items.length < pageSize) break;
  }

  const classAggs = new Map<string, ExpenseClassAgg>();
  let totalExpenses = 0;
  let excludedEvereeTotal = 0;
  let unclassifiedExpenses = 0;

  for (const p of purchases) {
    const vendor = trim((p.EntityRef as Record<string, any> | undefined)?.name) || null;
    const isEveree = /everee/i.test(vendor ?? '');
    const sign = p.Credit === true ? -1 : 1;
    const purchaseClass = trim((p.ClassRef as Record<string, any> | undefined)?.name);
    const memo = trim(p.PrivateNote) || null;
    const lines = Array.isArray(p.Line) ? (p.Line as Array<Record<string, any>>) : [];
    for (const line of lines) {
      const dt = trim(line.DetailType);
      let lineClass = '';
      if (dt === 'AccountBasedExpenseLineDetail') {
        lineClass = trim((line.AccountBasedExpenseLineDetail as Record<string, any> | undefined)?.ClassRef?.name);
      } else if (dt === 'ItemBasedExpenseLineDetail') {
        lineClass = trim((line.ItemBasedExpenseLineDetail as Record<string, any> | undefined)?.ClassRef?.name);
      } else {
        continue;
      }
      const amount = sign * num(line.Amount);
      if (!amount) continue;
      const cls = lineClass || purchaseClass;
      if (isEveree) {
        excludedEvereeTotal = round2(excludedEvereeTotal + amount);
        continue;
      }
      totalExpenses = round2(totalExpenses + amount);
      if (!cls) {
        unclassifiedExpenses = round2(unclassifiedExpenses + amount);
        continue;
      }
      const key = cls.toLowerCase();
      const agg = classAggs.get(key) ?? { className: cls, total: 0, lineCount: 0, lines: [] };
      agg.total = round2(agg.total + amount);
      agg.lineCount += 1;
      if (agg.lines.length < 300) {
        agg.lines.push({
          txnDate: trim(p.TxnDate) || null,
          vendor,
          memo: trim(line.Description) || memo,
          amount,
        });
      }
      classAggs.set(key, agg);
    }
  }

  return { purchaseCount: purchases.length, totalExpenses, excludedEvereeTotal, unclassifiedExpenses, classAggs };
}

interface ReportRow {
  entryId: string;
  workDate: string;
  hiringEntityId: string;
  batchId: string | null;
  workerId: string;
  workerName: string | null;
  accountId: string | null;
  accountName: string | null;
  jobOrderId: string | null;
  jobOrderName: string | null;
  jobOrderNumber: string | null;
  /** Customer PO on the JO (VenueSmart's real "job order id"). */
  poNumber: string | null;
  worksiteName: string | null;
  hours: number;
  gross: number;
  tips: number;
  bonus: number;
  premiums: number;
  total: number;
  status: string;
  source: string;
  /** Full-fields export additions (Greg 2026-08-05). */
  payRate: number | null;
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  workState: string | null;
  workersCompCode: string | null;
  workersCompRate: number | null;
}

interface GroupTotals {
  key: string;
  label: string;
  entries: number;
  workers: number;
  hours: number;
  total: number;
  pct: number;
}

/* -------------------------------------------------------------------------
 * Payroll Register (Greg 2026-08-19): the settled truth from Everee's
 * /api/v2/payments — one row per worker × pay run with gross, net, and
 * the funding (employer cash) that grouped into each ACH wire. This is
 * the audit surface HRX's own entry-based numbers reconcile against.
 * ☠️ Real paging params are page/size (page-number/page-size silently
 * ignored) — dedupe by id, stop at totalPages (see docs/claude).
 * ------------------------------------------------------------------------- */

interface RegisterRow {
  entityId: string;
  entityName: string;
  paymentId: string;
  payDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  workerUid: string;
  workerName: string | null;
  gross: number;
  net: number;
  funding: number;
  status: string | null;
  depositStatus: string | null;
}

export async function buildEvereeRegister(
  tenantId: string,
  startDate: string,
  endDate: string,
  hiringEntityId: string | null,
): Promise<Record<string, unknown>> {
  const money = (v: unknown): number => {
    const o = v as { amount?: unknown } | null | undefined;
    const n = Number((o && typeof o === 'object' ? o.amount : v) ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  const entitiesSnap = await db.collection(`tenants/${tenantId}/entities`).get();
  const rows: RegisterRow[] = [];
  interface Wire {
    fundingId: string;
    entityId: string;
    entityName: string;
    fundingDate: string | null;
    amount: number;
    payments: number;
  }
  const wireMap = new Map<string, Wire>();

  for (const entityDoc of entitiesSnap.docs) {
    const entityId = entityDoc.id;
    const entityName = trim(entityDoc.data().name) || entityId;
    if (/sandbox/i.test(entityId) || /sandbox/i.test(entityName)) continue;
    if (hiringEntityId && entityId !== hiringEntityId) continue;
    const config = await getEvereeConfigForEntity(tenantId, entityId);
    if (!config) continue;

    const seen = new Set<string>();
    for (let page = 0; page < 40; page++) {
      // eslint-disable-next-line no-await-in-loop
      const res = (await evereeRequest(
        config,
        'GET',
        `/api/v2/payments?page=${page}&size=500&include-workers-on-regular-pay-cycle=true`,
      )) as Record<string, any>;
      const items = (res.items ?? []) as Array<Record<string, any>>;
      let fresh = 0;
      for (const p of items) {
        const id = trim(p.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        fresh += 1;
        const payDate = trim(p.payDate) || trim(p.forDate) || null;
        if (!payDate || payDate < startDate || payDate > endDate) continue;

        const fundings = (p.fundingList ?? []) as Array<Record<string, any>>;
        let funding = 0;
        for (const f of fundings) {
          const amt = money(f.amount);
          funding = round2(funding + amt);
          const fid = trim(f.companyFundingId);
          if (!fid) continue;
          const w = wireMap.get(fid) ?? {
            fundingId: fid,
            entityId,
            entityName,
            fundingDate: trim(f.fundingDate) || null,
            amount: 0,
            payments: 0,
          };
          w.amount = round2(w.amount + amt);
          w.payments += 1;
          wireMap.set(fid, w);
        }

        const emp = (p.employee ?? {}) as Record<string, any>;
        const nameFromPayment =
          `${trim(emp.firstName)} ${trim(emp.lastName)}`.trim() || trim(emp.displayName) || null;
        rows.push({
          entityId,
          entityName,
          paymentId: id,
          payDate,
          periodStart: trim(p.payPeriodStartDate) || null,
          periodEnd: trim(p.payPeriodEndDate) || null,
          workerUid: trim(emp.externalWorkerId),
          workerName: nameFromPayment,
          gross: money(p.grossEarnings),
          net: money(p.netEarnings),
          funding,
          status: trim(p.status) || null,
          depositStatus: trim(p.depositStatus) || null,
        });
      }
      // Walk every page — a fresh-less page mid-sync drops payments (see
      // buildWireJournal pagination note, 2026-08-31).
      const totalPages = Number(res.totalPages ?? 1);
      if (page >= totalPages - 1) break;
    }
  }

  // Name fill: externalWorkerId is an HRX uid for most workers, an
  // Everee UUID for the drifted waves — the everee_workers linkage docs
  // reverse-map those (established two-key convention).
  const unnamed = rows.filter((r) => !r.workerName && r.workerUid);
  if (unnamed.length > 0) {
    const linkSnap = await db.collection(`tenants/${tenantId}/everee_workers`).get();
    const uidByEvereeId = new Map<string, string>();
    linkSnap.forEach((d) => {
      const v = d.data();
      const evId = trim(v.evereeWorkerId);
      const uid = d.id.includes('__') ? d.id.split('__').pop()! : trim(v.uid);
      if (evId && uid) uidByEvereeId.set(evId, uid);
    });
    const uidOf = (key: string): string => uidByEvereeId.get(key) ?? key;
    const uids = Array.from(new Set(unnamed.map((r) => uidOf(r.workerUid)))).filter(Boolean);
    const names = new Map<string, string>();
    for (let i = 0; i < uids.length; i += 100) {
      const chunk = uids.slice(i, i + 100);
      // eslint-disable-next-line no-await-in-loop
      const snaps = await db.getAll(...chunk.map((id) => db.doc(`users/${id}`)));
      snaps.forEach((s) => {
        if (!s.exists) return;
        const u = s.data() as Record<string, unknown>;
        const n = `${trim(u.firstName)} ${trim(u.lastName)}`.trim() || trim(u.displayName);
        if (n) names.set(s.id, n);
      });
    }
    rows.forEach((r) => {
      if (!r.workerName && r.workerUid) r.workerName = names.get(uidOf(r.workerUid)) ?? null;
    });
  }

  rows.sort((a, b) => String(b.payDate).localeCompare(String(a.payDate)) || (a.workerName ?? '').localeCompare(b.workerName ?? ''));

  // Pay-run rollup: (entity, pay date) — Everee funds per pay run, so
  // this is the wire-shaped grouping the bookkeeper reconciles.
  interface PayRun {
    entityId: string;
    entityName: string;
    payDate: string | null;
    payments: number;
    workers: number;
    gross: number;
    net: number;
    funding: number;
  }
  const runMap = new Map<string, PayRun & { workerSet: Set<string> }>();
  for (const r of rows) {
    const key = `${r.entityId}|${r.payDate}`;
    const g = runMap.get(key) ?? {
      entityId: r.entityId,
      entityName: r.entityName,
      payDate: r.payDate,
      payments: 0,
      workers: 0,
      gross: 0,
      net: 0,
      funding: 0,
      workerSet: new Set<string>(),
    };
    g.payments += 1;
    g.gross = round2(g.gross + r.gross);
    g.net = round2(g.net + r.net);
    g.funding = round2(g.funding + r.funding);
    if (r.workerUid) g.workerSet.add(r.workerUid);
    runMap.set(key, g);
  }
  const byPayRun = Array.from(runMap.values())
    .map(({ workerSet, ...g }) => ({ ...g, workers: workerSet.size }))
    .sort((a, b) => String(b.payDate).localeCompare(String(a.payDate)));

  const byWire = Array.from(wireMap.values()).sort((a, b) =>
    String(b.fundingDate).localeCompare(String(a.fundingDate)),
  );

  const MAX_REGISTER_ROWS = 15000;
  return {
    totals: {
      gross: round2(rows.reduce((s, r) => s + r.gross, 0)),
      net: round2(rows.reduce((s, r) => s + r.net, 0)),
      funding: round2(rows.reduce((s, r) => s + r.funding, 0)),
      payments: rows.length,
      workers: new Set(rows.map((r) => r.workerUid).filter(Boolean)).size,
    },
    truncated: rows.length > MAX_REGISTER_ROWS,
    rows: rows.slice(0, MAX_REGISTER_ROWS),
    byPayRun,
    byWire,
  };
}

/* -------------------------------------------------------------------------
 * Real employer burden per entity (FIN-2, Greg 2026-08-26): Everee's
 * /integration/v1/expenses/by-date-range returns, per entity, actual
 * wages + employer taxes + employer contributions for the earning-date
 * range — the REAL burden rate that replaces the 12% slider in Gross
 * Margin / Job Costing. 1099 entities correctly come back at 0% (no
 * employer taxes on contractor pay). Buckets are per-dimension; we never
 * stamped dimensions so today it's one bucket per entity — the totals
 * are what matter here. Fail-soft per entity: an entity with no config
 * or an API error is simply omitted (caller falls back to an estimate).
 * ------------------------------------------------------------------------- */

export interface EntityBurden {
  wages: number;
  employerTax: number;
  contributions: number;
  /** (employerTax + contributions) / wages, as a percent. */
  ratePct: number;
}

export async function buildEvereeBurdenRates(
  tenantId: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, EntityBurden>> {
  const money = (v: unknown): number => {
    const o = v as { amount?: unknown } | null | undefined;
    const n = Number((o && typeof o === 'object' ? o.amount : v) ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  const out: Record<string, EntityBurden> = {};
  const entitiesSnap = await db.collection(`tenants/${tenantId}/entities`).get();
  for (const entityDoc of entitiesSnap.docs) {
    const entityId = entityDoc.id;
    const entityName = trim(entityDoc.data().name) || entityId;
    if (/sandbox/i.test(entityId) || /sandbox/i.test(entityName)) continue;
    // eslint-disable-next-line no-await-in-loop
    const config = await getEvereeConfigForEntity(tenantId, entityId);
    if (!config) continue;
    try {
      let wages = 0;
      let tax = 0;
      let contrib = 0;
      // ☠️ The endpoint rejects ranges longer than ~31 days — chunk into
      // 30-day windows and sum (totals are additive across disjoint
      // ranges, so chunking is exact). size also caps at 100.
      let winStart = startDate;
      for (let guard = 0; guard < 40 && winStart <= endDate; guard++) {
        const ws = new Date(`${winStart}T00:00:00Z`);
        ws.setUTCDate(ws.getUTCDate() + 29);
        const winEndIso = ws.toISOString().slice(0, 10);
        const winEnd = winEndIso < endDate ? winEndIso : endDate;
        for (let page = 0; page < 10; page++) {
          // eslint-disable-next-line no-await-in-loop
          const res = (await evereeRequest(
            config,
            'GET',
            `/integration/v1/expenses/by-date-range?min-earning-date=${winStart}&max-earning-date=${winEnd}&page=${page}&size=100`,
          )) as Record<string, any>;
          const items = (res.items ?? []) as Array<Record<string, any>>;
          for (const it of items) {
            wages += money(it.totalWageAmount);
            tax += money(it.totalEmployerTaxAmount);
            contrib += money(it.totalEmployerContributionAmount);
          }
          const totalPages = Number(res.totalPages ?? 1) || 1;
          if (items.length === 0 || page + 1 >= totalPages) break;
        }
        const next = new Date(`${winEnd}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        winStart = next.toISOString().slice(0, 10);
      }
      out[entityId] = {
        wages: round2(wages),
        employerTax: round2(tax),
        contributions: round2(contrib),
        ratePct: wages > 0 ? round2(((tax + contrib) / wages) * 100) : 0,
      };
    } catch {
      // omitted — caller treats missing entity as burden-unknown
    }
  }
  return out;
}

/* -------------------------------------------------------------------------
 * Payroll Journal by QBO class (Greg 2026-08-19): the July wire-recon
 * engine (functions/.scratch/build-everee-wire-class-report.ts) as a
 * standing report — every Everee funding wire in range split across QBO
 * classes, exactly what the bookkeeper types when classing the wire.
 * Resolution per earning line: Greg's payroll_class_overrides beat
 * everything → JO#<n> note tag → note dates × entry index → venue-token
 * resolver → pay-period fallback. Largest-remainder rounding so splits
 * sum to each wire to the penny. Class names resolve against QBO's live
 * Class list (FQN + exists flag) — the stepping stone to auto-writing
 * the splits into QBO.
 * ------------------------------------------------------------------------- */

export async function buildWireJournal(
  tenantId: string,
  startDate: string,
  endDate: string,
  hiringEntityId: string | null,
): Promise<Record<string, unknown>> {
  const money = (v: unknown): number => {
    const o = v as { amount?: unknown } | null | undefined;
    const n = Number((o && typeof o === 'object' ? o.amount : v) ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  // ── JO name maps ──
  // Indeed Flex channel JOs have role-y names ("Warehouse Associate",
  // "Loader/Crew") that resolve to the parent class; the END CLIENT is the
  // JO's account (Greg 2026-08-31) — label those by account so labor lands
  // on Indeed Flex:{client}. Anchored so only Flex-family accounts qualify.
  const FLEX_CLIENT_ACCT = /^(cort|domino|ors\s*nasco|carrier|continental|purolator|hyatt|mattress|ontrac)/i;
  const joNameById = new Map<string, string>();
  const joNameByNumber = new Map<string, string>();
  for (const coll of ['job_orders', 'jobOrders', 'recruiter_jobOrders']) {
    const snap = await db.collection(`tenants/${tenantId}/${coll}`).get().catch(() => null);
    if (!snap) continue;
    snap.forEach((d) => {
      const j = d.data();
      const acct = trim(j.accountName);
      const name = FLEX_CLIENT_ACCT.test(acct) ? acct : trim(j.jobOrderName) || trim(j.title);
      if (!name) return;
      if (!joNameById.has(d.id)) joNameById.set(d.id, name);
      const num = trim(j.jobOrderNumber);
      if (num && !joNameByNumber.has(num)) joNameByNumber.set(num, name);
    });
  }

  // ── Entry index: uid|workDate → JO name. Work precedes funding, so
  //    index a wide window behind the wire range. ──
  const idxStart = new Date(Date.parse(startDate) - 60 * 86400000).toISOString().slice(0, 10);
  const entriesSnap = await db
    .collection(`tenants/${tenantId}/timesheet_entries`)
    .where('workDate', '>=', idxStart)
    .where('workDate', '<=', endDate)
    .get();
  const classByWorkerDate = new Map<string, string>();
  const needAssignment: Array<{ key: string; assignmentId: string }> = [];
  entriesSnap.forEach((d) => {
    const e = d.data();
    if (!['sent_to_everee', 'submitted', 'paid'].includes(trim(e.status))) return;
    const uid = trim(e.workerId) || trim(e.userId);
    const wd = trim(e.workDate);
    if (!uid || !wd) return;
    const key = `${uid}|${wd}`;
    const joId = trim(e.jobOrderId);
    if (joId && joNameById.has(joId)) classByWorkerDate.set(key, joNameById.get(joId)!);
    else if (trim(e.assignmentId)) needAssignment.push({ key, assignmentId: trim(e.assignmentId) });
  });
  const asnIds = Array.from(new Set(needAssignment.map((n) => n.assignmentId)));
  const joByAsn = new Map<string, string>();
  for (let i = 0; i < asnIds.length; i += 100) {
    // eslint-disable-next-line no-await-in-loop
    const snaps = await db.getAll(...asnIds.slice(i, i + 100).map((id) => db.doc(`tenants/${tenantId}/assignments/${id}`)));
    snaps.forEach((s) => {
      if (!s.exists) return;
      const joId = trim(s.data()?.jobOrderId);
      if (joId && joNameById.has(joId)) joByAsn.set(s.id, joNameById.get(joId)!);
    });
  }
  for (const n of needAssignment) {
    if (!classByWorkerDate.has(n.key) && joByAsn.has(n.assignmentId)) {
      classByWorkerDate.set(n.key, joByAsn.get(n.assignmentId)!);
    }
  }

  // ── Venue-token resolver (unique ≥5-char tokens; STOP applies to note
  //    tokens too — the "Contractor pay"→"Contra Costa" lesson). ──
  const STOP = new Set(['2026', '2025', 'staffing', 'national', 'account', 'the', 'and', 'week', 'ending', 'hours', 'payment', 'contractor', 'people', 'referral', 'tips', 'plus', 'hourly', 'lead', 'crew', 'event', 'events', 'staff', 'festival', 'worker', 'associate', 'warehouse', 'loader', 'shift', 'payroll', 'select', 'c1', 'llc', 'venue', 'smart', 'venuesmart']);
  const normText = (x: string): string => x.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const tokenOwner = new Map<string, { cls: string; pri: number } | null>();
  const addTokens = (label: string, cls: string, pri: number): void => {
    for (const t of normText(label).split(' ')) {
      if (t.length < 5 || STOP.has(t)) continue;
      const cur = tokenOwner.get(t);
      if (cur === undefined) tokenOwner.set(t, { cls, pri });
      else if (cur && cur.cls !== cls && cur.pri <= pri) tokenOwner.set(t, null);
    }
  };
  joNameById.forEach((name) => addTokens(name, name, 2));
  const acctSnap2 = await db.collection(`tenants/${tenantId}/accounts`).get().catch(() => null);
  if (acctSnap2) {
    acctSnap2.forEach((d) => {
      const nm = trim(d.data().accountName) || trim(d.data().name);
      if (nm) addTokens(nm, nm, 1);
    });
  }
  const vmSnap = await db.collection(`tenants/${tenantId}/payroll_venue_mappings`).get().catch(() => null);
  if (vmSnap) {
    vmSnap.forEach((d) => {
      const m = d.data();
      const joName = joNameById.get(trim(m.jobOrderId));
      if (joName && trim(m.venueLabel)) addTokens(trim(m.venueLabel), joName, 3);
    });
  }
  const stemOwner = new Map<string, { cls: string; pri: number } | null>();
  for (const [t, own] of tokenOwner) {
    if (!own) continue;
    const st = t.slice(0, 6);
    const cur = stemOwner.get(st);
    if (cur === undefined) stemOwner.set(st, own);
    else if (cur && cur.cls !== own.cls) stemOwner.set(st, null);
  }
  const resolveVenueText = (note: string): string | null => {
    let best: { cls: string; pri: number; len: number } | null = null;
    for (const t of normText(note).split(' ')) {
      if (t.length < 5 || STOP.has(t)) continue;
      const own = tokenOwner.get(t) ?? stemOwner.get(t.slice(0, 6));
      if (!own) continue;
      if (!best || own.pri > best.pri || (own.pri === best.pri && t.length > best.len)) {
        best = { cls: own.cls, pri: own.pri, len: t.length };
      }
    }
    return best ? best.cls : null;
  };

  // Wire labels come from Everee earning notes and legacy account names;
  // after the 2026-08-31 class restructure the generic matcher missed
  // ~$536K of splits. These aliases encode that day's rulings (RS3 family
  // = Proof of the Pudding; NASCAR/F1 own classes; FIFA fan-fest naming;
  // role-only Flex labels roll to the channel) — checked FIRST in
  // resolveClassFqn, then punctuation-insensitive exact, then containment.
  // Also applied to raw earning notes when resolveVenueText misses
  // ("LIV Golf VA - 35 Hours", "Dallas Fifa W/E 5.31", "7 Hours G6").
  const WIRE_LABEL_ALIASES: Array<{ re: RegExp; leaf: string }> = [
    { re: /governors?\s*ball/i, leaf: "Governor's Ball" },
    { re: /fifa.*kansas\s*city|fifa\s*kc/i, leaf: 'FIFA KC' },
    { re: /fifa.*dallas|dallas.*fifa/i, leaf: 'FIFA Dallas' },
    { re: /fifa.*(ny|new\s*york)|adi\s*ny/i, leaf: 'FIFA NY' },
    { re: /dell\s*diamond|kizer|slammers|legends\s*stadium|h-?e-?b\s*center/i, leaf: 'Proof of Pudding' },
    { re: /pga|lpga|lgpa/i, leaf: 'LGPA PP' },
    { re: /us\s*wom[ea]n'?s?\s*open|usga/i, leaf: "26 USGA Women's Open" },
    { re: /suenos|sueños/i, leaf: 'Suenos Music Festival' },
    { re: /^legends\s*national\s*account$/i, leaf: 'Legends' },
    { re: /nascar.*san\s*diego|san\s*diego.*nascar/i, leaf: 'Nascar SanDiego' },
    { re: /nascar/i, leaf: 'Nascar' },
    // Plain COTA (after NASCAR above) = the year-round smaller-events class.
    { re: /\bcota\b/i, leaf: 'COTA' },
    { re: /liv\s*golf\s*(va|virginia)/i, leaf: 'LIV Golf VA' },
    { re: /liv\s*golf\s*indy/i, leaf: '2026 LIV Golf Indy' },
    { re: /cort\b|hazeltine|wbi|woodridge/i, leaf: 'Cort' },
    { re: /\bunc\b/i, leaf: 'Sodexo' },
    { re: /minnesota\s*yacht|mn\s*yacht/i, leaf: 'MN Yacht Club' },
    { re: /minnesota\s*country|mn\s*country/i, leaf: 'MN Country Club' },
    { re: /g6\s*catering|\bg6\b/i, leaf: 'G6' },
    { re: /crystal\s*falls|roy\s*kizer/i, leaf: 'Proof of Pudding' },
    { re: /carrier\b/i, leaf: 'Carrier Enterprise' },
    { re: /obama/i, leaf: 'Obama Presidential Viewing' },
    // BTS concert was at the Oakland venue (Greg 2026-08-31).
    { re: /\bbts\b/i, leaf: 'Oakland' },
    // Sodexo campus dining roles carry the university name, never "Sodexo".
    { re: /prairie\s*view|nc\s*a&t|carthage|stanford|\buniversity\b/i, leaf: 'Sodexo' },
    { re: /sips\s*and\s*sounds/i, leaf: 'Black Caviar' },
    // Role-only Flex labels — no client attribution available; roll to the
    // channel parent rather than guessing a client.
    { re: /^(warehouse (associate|worker|operator|ops).*|loader\s*\/\s*crew.*|production associate.*|forklift driver.*|\d{1,2}:\d{2}.*shift)$/i, leaf: 'Indeed Flex' },
  ];

  // ── Greg's persisted overrides (payroll_class_overrides) ──
  const paymentOverrides = new Map<string, string>();
  const workerOverrides = new Map<string, string>();
  const ovSnap = await db.collection(`tenants/${tenantId}/payroll_class_overrides`).get().catch(() => null);
  if (ovSnap) {
    ovSnap.forEach((d) => {
      const o = d.data();
      const cls = trim(o.class);
      if (!cls) return;
      if (trim(o.kind) === 'payment' && trim(o.paymentId)) paymentOverrides.set(trim(o.paymentId), cls);
      if (trim(o.kind) === 'worker' && trim(o.workerName)) {
        workerOverrides.set(trim(o.workerName).toLowerCase().replace(/\s+/g, ' '), cls);
      }
    });
  }

  // ── Everee payments → funding wires with class shares ──
  interface WireGroup {
    key: string;
    entityId: string;
    entityName: string;
    fundingDate: string;
    total: number;
    payments: number;
    classGross: Map<string, number>;
    unresolvedGross: number;
  }
  const groups = new Map<string, WireGroup>();
  const unattributedDetail: Array<{ paymentId: string; worker: string; fundingDate: string; entityName: string; amount: number; notes: string }> = [];
  const entitiesSnap2 = await db.collection(`tenants/${tenantId}/entities`).get();
  for (const entityDoc of entitiesSnap2.docs) {
    const entityId = entityDoc.id;
    const entityName = trim(entityDoc.data().name) || entityId;
    if (/sandbox/i.test(entityId) || /sandbox/i.test(entityName)) continue;
    if (hiringEntityId && entityId !== hiringEntityId) continue;
    const config = await getEvereeConfigForEntity(tenantId, entityId);
    if (!config) continue;

    const seenIds = new Set<string>();
    for (let page = 0; page < 40; page++) {
      // eslint-disable-next-line no-await-in-loop
      const res = (await evereeRequest(
        config,
        'GET',
        `/api/v2/payments?page=${page}&size=500&include-workers-on-regular-pay-cycle=true`,
      )) as Record<string, any>;
      const items = (res.items ?? []) as Array<Record<string, any>>;
      let fresh = 0;
      for (const p of items) {
        const id = trim(p.id);
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        fresh += 1;
        if (trim(p.status) !== 'PAID') continue;
        const fundings = ((p.fundingList ?? []) as Array<Record<string, any>>).filter((f) => {
          const fd = trim(f.fundingDate);
          return fd >= startDate && fd <= endDate;
        });
        if (fundings.length === 0) continue;
        const uid = trim(p.employee?.externalWorkerId);

        const shares = new Map<string, number>();
        let resolved = 0;
        let unresolved = 0;
        const addShare = (cls: string, amt: number): void => {
          if (amt <= 0) return;
          shares.set(cls, (shares.get(cls) ?? 0) + amt);
          resolved += amt;
        };
        for (const el of (p.earningList ?? []) as Array<Record<string, any>>) {
          const amt = money(el.currentPeriodAmount) || money(el.amounts?.amount);
          if (amt <= 0) continue;
          const note = trim(el.note);
          const joTag = note.match(/JO#(\d+)/);
          if (joTag && joNameByNumber.has(joTag[1])) {
            addShare(joNameByNumber.get(joTag[1])!, amt);
            continue;
          }
          const dates = note.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
          const classes = dates
            .map((dt) => classByWorkerDate.get(`${uid}|${dt}`))
            .filter((c): c is string => Boolean(c));
          if (classes.length > 0) {
            const per = amt / classes.length;
            classes.forEach((c) => addShare(c, per));
            continue;
          }
          const venueCls = resolveVenueText(note);
          if (venueCls) addShare(venueCls, amt);
          else {
            // Last resort: the class-rename rulings apply to raw notes too.
            const alias = WIRE_LABEL_ALIASES.find((a) => a.re.test(note));
            if (alias) addShare(alias.leaf, amt);
            else unresolved += amt;
          }
        }
        // Pay-period fallback (AD_HOC often has no period → ±10d window).
        if (unresolved > 0) {
          let ps = trim(p.payPeriodStartDate);
          let pe = trim(p.payPeriodEndDate);
          if (!ps || !pe) {
            const anchor = trim(p.payDate) || trim(p.forDate);
            if (anchor) {
              const t0 = Date.parse(anchor);
              ps = new Date(t0 - 10 * 86400000).toISOString().slice(0, 10);
              pe = new Date(t0 + 2 * 86400000).toISOString().slice(0, 10);
            }
          }
          const periodClasses = new Map<string, number>();
          if (uid && ps && pe) {
            for (const [key, cls] of classByWorkerDate) {
              const [kUid, kDate] = key.split('|');
              if (kUid === uid && kDate >= ps && kDate <= pe) {
                periodClasses.set(cls, (periodClasses.get(cls) ?? 0) + 1);
              }
            }
          }
          if (periodClasses.size > 0) {
            const totalN = Array.from(periodClasses.values()).reduce((s, n) => s + n, 0);
            for (const [cls, n] of periodClasses) addShare(cls, (unresolved * n) / totalN);
            unresolved = 0;
          }
        }
        // Greg's explicit answer beats every heuristic.
        const ov =
          paymentOverrides.get(id) ??
          workerOverrides.get(trim(p.payeeDisplayFullName).toLowerCase().replace(/\s+/g, ' '));
        if (ov) {
          shares.clear();
          shares.set(ov, 1);
          resolved = 1;
          unresolved = 0;
        }

        for (const f of fundings) {
          const key = `${entityId}__${trim(f.companyFundingId) || 'none'}`;
          let g = groups.get(key);
          if (!g) {
            g = {
              key,
              entityId,
              entityName,
              fundingDate: trim(f.fundingDate),
              total: 0,
              payments: 0,
              classGross: new Map(),
              unresolvedGross: 0,
            };
            groups.set(key, g);
          }
          const fAmt = money(f.amount);
          g.total = round2(g.total + fAmt);
          g.payments += 1;
          const denom = resolved + unresolved;
          const unresolvedShare = denom <= 0 ? fAmt : (fAmt * unresolved) / denom;
          if (denom <= 0) g.unresolvedGross += fAmt;
          else {
            for (const [cls, sAmt] of shares) {
              g.classGross.set(cls, (g.classGross.get(cls) ?? 0) + (fAmt * sAmt) / denom);
            }
            g.unresolvedGross += unresolvedShare;
          }
          // Surface WHO makes up "Unattributed" so it can be overridden
          // (payroll_class_overrides kind:payment/worker) instead of
          // staying a mystery number (Greg 2026-08-31).
          if (unresolvedShare > 0.005) {
            unattributedDetail.push({
              paymentId: id,
              worker: trim(p.payeeDisplayFullName),
              fundingDate: trim(f.fundingDate),
              entityName,
              amount: round2(unresolvedShare),
              notes: ((p.earningList ?? []) as Array<Record<string, any>>)
                .map((el) => trim(el.note)).filter(Boolean).slice(0, 3).join(' | ').slice(0, 120),
            });
          }
        }
      }
      // Walk EVERY page: breaking on a fresh-less page drops payments when
      // Everee is actively syncing (items shift across page boundaries
      // mid-pagination) and made wire totals nondeterministic between runs
      // (2026-08-31 incident — run-to-run drift of ±$300 per wire).
      const totalPages = Number(res.totalPages ?? 1);
      if (page >= totalPages - 1) break;
    }
  }

  // ── QBO class resolution (leaf/FQN + exists flag) ──
  let qboClasses: Array<{ leaf: string; fqn: string }> = [];
  try {
    const classRes = await qboQuery(tenantId, 'SELECT Id, Name, FullyQualifiedName FROM Class WHERE Active = true MAXRESULTS 1000');
    qboClasses = ((classRes.Class ?? []) as Array<Record<string, any>>).map((c) => ({
      leaf: trim(c.Name).toLowerCase(),
      fqn: trim(c.FullyQualifiedName) || trim(c.Name),
    }));
  } catch {
    // QBO down/unconnected — journal still works, classes just unresolved.
  }
  const squashLbl = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const resolveClassFqn = (name: string): { fqn: string; exists: boolean } => {
    for (const a of WIRE_LABEL_ALIASES) {
      if (a.re.test(name)) {
        const hit = qboClasses.find((c) => squashLbl(c.leaf) === squashLbl(a.leaf));
        if (hit) return { fqn: hit.fqn, exists: true };
      }
    }
    const n = name.toLowerCase();
    const nsq = squashLbl(name);
    const exact = qboClasses.filter((c) => c.leaf === n || c.fqn.toLowerCase() === n || squashLbl(c.leaf) === nsq || squashLbl(c.fqn) === nsq);
    if (exact.length >= 1) return { fqn: exact[0].fqn, exists: true };
    const partial = qboClasses.filter((c) => {
      const k = squashLbl(c.leaf);
      return k.length >= 4 && nsq.length >= 4 && (k.includes(nsq) || nsq.includes(k));
    });
    if (partial.length === 1) return { fqn: partial[0].fqn, exists: true };
    return { fqn: name, exists: false };
  };

  // ── Wires out, largest-remainder rounding so splits == wire total ──
  const wires = Array.from(groups.values())
    .sort((a, b) => b.fundingDate.localeCompare(a.fundingDate))
    .map((g) => {
      const rawSplits: Array<{ label: string; raw: number }> = Array.from(g.classGross.entries()).map(
        ([label, raw]) => ({ label, raw }),
      );
      if (g.unresolvedGross > 0.005) rawSplits.push({ label: 'Unattributed', raw: g.unresolvedGross });
      const floored = rawSplits.map((s) => ({ ...s, cents: Math.floor(s.raw * 100) }));
      let remainder = Math.round(g.total * 100) - floored.reduce((s, x) => s + x.cents, 0);
      const byFrac = [...floored].sort((a, b) => (b.raw * 100 - b.cents) - (a.raw * 100 - a.cents));
      for (const s of byFrac) {
        if (remainder <= 0) break;
        s.cents += 1;
        remainder -= 1;
      }
      const splits = floored
        .map((s) => {
          const q = resolveClassFqn(s.label);
          return {
            class: s.label,
            qboClass: s.label === 'Unattributed' ? null : q.fqn,
            qboClassExists: s.label === 'Unattributed' ? false : q.exists,
            amount: s.cents / 100,
            pct: g.total > 0 ? round2((s.cents / 100 / g.total) * 100) : 0,
          };
        })
        .sort((a, b) => b.amount - a.amount);
      return {
        fundingId: g.key.split('__').pop(),
        entityId: g.entityId,
        entityName: g.entityName,
        fundingDate: g.fundingDate,
        amount: g.total,
        payments: g.payments,
        unattributed: round2(splits.find((s) => s.class === 'Unattributed')?.amount ?? 0),
        splits,
      };
    });

  const classTotals = new Map<string, number>();
  for (const w of wires) {
    for (const s of w.splits) classTotals.set(s.class, round2((classTotals.get(s.class) ?? 0) + s.amount));
  }
  const byClass = Array.from(classTotals.entries())
    .map(([cls, amount]) => {
      const q = resolveClassFqn(cls);
      return {
        class: cls,
        qboClass: cls === 'Unattributed' ? null : q.fqn,
        qboClassExists: cls === 'Unattributed' ? false : q.exists,
        amount,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const totalWired = round2(wires.reduce((s, w) => s + w.amount, 0));
  const totalUnattributed = round2(wires.reduce((s, w) => s + w.unattributed, 0));
  unattributedDetail.sort((a, b) => b.amount - a.amount);
  return {
    totals: {
      wired: totalWired,
      wires: wires.length,
      unattributed: totalUnattributed,
      attributedPct: totalWired > 0 ? round2(((totalWired - totalUnattributed) / totalWired) * 100) : 0,
    },
    wires,
    byClass,
    unattributedDetail: unattributedDetail.slice(0, 500),
  };
}

/* -------------------------------------------------------------------------
 * I-9 / Onboarding Completion Status (Compliance reports, Greg
 * 2026-08-19): reads the readiness mirror on everee_workers linkage
 * docs (i9SignedAt = Section 1 / worker side, employerI9SignedAt or
 * documentsVerifiedByCompany = Section 2 / employer side,
 * hasWorkbrightDocs = WorkBright pipeline docs present). NOTE: E-Verify
 * case status is NOT available — HRX E-Verify processing disabled
 * 2026-06-30 and the web-services vendor connection is pending.
 * ------------------------------------------------------------------------- */

async function buildI9Status(
  tenantId: string,
  hiringEntityId: string | null,
): Promise<Record<string, unknown>> {
  // 1099 contractor entities never have I-9s — exclude them entirely
  // (the per-doc i9Applicable flag is absent on never-reconciled docs,
  // which made 3,652 Events contractors render as "not started").
  const entSnap = await db.collection(`tenants/${tenantId}/entities`).get();
  const contractorEntities = new Set(
    entSnap.docs
      .filter(
        (d) => trim(d.data().workerType).toLowerCase() === 'contractor' || /events|workforce/i.test(d.id),
      )
      .map((d) => d.id),
  );
  const linkSnap = await db.collection(`tenants/${tenantId}/everee_workers`).get();
  // Section-2 truth: the reconciler stamps entity_employments.i9Section2CompletedAt
  // (the readinessMirror block itself carries no documentsVerifiedByCompany).
  const empSnap = await db.collection(`tenants/${tenantId}/entity_employments`).get();
  const sec2ByKey = new Map<string, string>();
  empSnap.forEach((d) => {
    const v = d.data();
    const ts = v.i9Section2CompletedAt as admin.firestore.Timestamp | undefined;
    if (!ts?.toDate) return;
    const key = `${trim(v.entityId ?? v.hiringEntityId)}|${trim(v.userId)}`;
    sec2ByKey.set(key, ts.toDate().toISOString().slice(0, 10));
  });
  interface I9Row {
    uid: string;
    entityId: string;
    workerName: string | null;
    hasWorkbrightDocs: boolean;
    i9SignedAt: string | null;
    employerI9SignedAt: string | null;
    documentsVerifiedByCompany: boolean;
    onboardingStatus: string | null;
    lifecycleStatus: string | null;
    status: 'complete' | 'pending_employer' | 'pending_worker' | 'not_started';
    /** Manually entered from WorkBright's E-Verify case list (OnTrac
     *  attestations, Greg 2026-08-20) — one lookup per new hire, stored
     *  on users/{uid}.everifyCompletedAt. */
    everifyCompletedAt: string | null;
  }
  const rows: I9Row[] = [];
  linkSnap.forEach((d) => {
    const [entityId, uid] = d.id.includes('__') ? [d.id.split('__')[0], d.id.split('__').slice(1).join('__')] : ['', d.id];
    if (!uid) return;
    if (/sandbox/i.test(entityId)) return;
    if (contractorEntities.has(entityId)) return; // 1099 — no I-9
    if (hiringEntityId && entityId !== hiringEntityId) return;
    const v = d.data();
    if (trim(v.status) === 'retired_duplicate') return;
    // The reconciler writes the snapshot as `readinessMirror` (older docs
    // may carry `mirror`) — reading the wrong key made everyone "not started".
    const m = (v.readinessMirror ?? v.mirror ?? {}) as Record<string, any>;
    if (m.i9Applicable === false) return; // contractors — no I-9
    const tsIso = (x: unknown): string | null =>
      x && typeof (x as any).toDate === 'function' ? (x as any).toDate().toISOString().slice(0, 10) : null;
    const i9SignedAt = tsIso(m.i9SignedAt);
    const employerI9SignedAt = tsIso(m.employerI9SignedAt) ?? sec2ByKey.get(`${entityId}|${uid}`) ?? null;
    const verified = m.documentsVerifiedByCompany === true || Boolean(sec2ByKey.get(`${entityId}|${uid}`));
    const hasDocs = m.hasWorkbrightDocs === true;
    let status: I9Row['status'];
    if ((i9SignedAt || hasDocs) && (employerI9SignedAt || verified)) status = 'complete';
    else if (i9SignedAt || hasDocs) status = 'pending_employer';
    else if (trim(m.onboardingStatus) === 'IN_PROGRESS') status = 'pending_worker';
    else status = 'not_started';
    rows.push({
      uid,
      entityId,
      workerName: null,
      hasWorkbrightDocs: hasDocs,
      i9SignedAt,
      employerI9SignedAt,
      documentsVerifiedByCompany: verified,
      onboardingStatus: trim(m.onboardingStatus) || null,
      lifecycleStatus: trim(m.lifecycleStatus) || null,
      status,
      everifyCompletedAt: null,
    });
  });

  const uids = Array.from(new Set(rows.map((r) => r.uid)));
  const names = new Map<string, string>();
  const everifyDates = new Map<string, string>();
  for (let i = 0; i < uids.length; i += 100) {
    // eslint-disable-next-line no-await-in-loop
    const snaps = await db.getAll(...uids.slice(i, i + 100).map((id) => db.doc(`users/${id}`)));
    snaps.forEach((s) => {
      if (!s.exists) return;
      const u = s.data() as Record<string, unknown>;
      const n = `${trim(u.firstName)} ${trim(u.lastName)}`.trim() || trim(u.displayName);
      if (n) names.set(s.id, n);
      const ev = trim(u.everifyCompletedAt);
      if (ev) everifyDates.set(s.id, ev);
    });
  }
  rows.forEach((r) => {
    r.workerName = names.get(r.uid) ?? null;
    r.everifyCompletedAt = everifyDates.get(r.uid) ?? null;
  });
  const order: Record<I9Row['status'], number> = { pending_employer: 0, pending_worker: 1, not_started: 2, complete: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (a.workerName ?? '').localeCompare(b.workerName ?? ''));

  const count = (s: I9Row['status']): number => rows.filter((r) => r.status === s).length;
  return {
    totals: {
      workers: rows.length,
      complete: count('complete'),
      pendingEmployer: count('pending_employer'),
      pendingWorker: count('pending_worker'),
      notStarted: count('not_started'),
    },
    everifyNote:
      'E-Verify case status unavailable: HRX E-Verify processing disabled 2026-06-30; web-services vendor connection pending.',
    rows,
  };
}

/* -------------------------------------------------------------------------
 * QBO Classes & Mapping (Greg 2026-08-19): the classes were created by
 * hand in QBO and have no durable link to HRX data. The
 * `tenants/{t}/qbo_class_mappings/{classId}` collection IS that link —
 * written from the /reports/qbo-classes page (and by Mark's automation),
 * consulted FIRST by the gross-margin/job-costing matcher. This builder
 * returns the full class list + mapping status + usage (billed/expense
 * dollars in range) + an auto-suggested match per unmapped class.
 * ------------------------------------------------------------------------- */

async function buildClassCatalog(
  tenantId: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, unknown>> {
  const [classRes, mapSnap, billing, expenses] = await Promise.all([
    qboQuery(tenantId, 'SELECT * FROM Class WHERE Active IN (true, false) MAXRESULTS 1000'),
    db.collection(`tenants/${tenantId}/qbo_class_mappings`).get(),
    buildBillingAggregates(tenantId, startDate, endDate),
    buildExpenseAggregates(tenantId, startDate, endDate),
  ]);

  const mappings = new Map<string, Record<string, unknown>>();
  mapSnap.forEach((d) => mappings.set(d.id, d.data()));

  // Suggestion candidates: JO names (scoped by account) + account names.
  const joList: Array<{ id: string; name: string; accountId: string | null; accountName: string | null }> = [];
  const acctNameById = new Map<string, string>();
  const acctParentById = new Map<string, string>();
  const acctSnap = await db.collection(`tenants/${tenantId}/accounts`).get();
  acctSnap.forEach((d) => {
    acctNameById.set(d.id, trim(d.data().name));
    const p = trim(d.data().parentAccountId);
    if (p) acctParentById.set(d.id, p);
  });
  for (const coll of ['job_orders', 'jobOrders', 'recruiter_jobOrders']) {
    // eslint-disable-next-line no-await-in-loop
    const snap = await db.collection(`tenants/${tenantId}/${coll}`).get().catch(() => null);
    if (!snap) continue;
    snap.forEach((d) => {
      const j = d.data();
      const name = trim(j.jobOrderName) || trim(j.title);
      if (!name) return;
      const accountId = trim(j.recruiterAccountId) || null;
      joList.push({ id: d.id, name, accountId, accountName: accountId ? acctNameById.get(accountId) ?? null : null });
    });
  }
  const norm = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(20\d\d|llc|inc|national|account)\b/g, '').replace(/\s+/g, ' ').trim();
  // Level-aware suggestions (2026-08-27): JO first, then account (the
  // right home for bare account-named classes like "Black Caviar"), then
  // an overhead hint for expense-only classes matching nothing.
  const acctList = Array.from(acctNameById.entries()).map(([id, name]) => ({ id, name, n: norm(name) }));
  const suggest = (
    className: string,
    billed: number,
    expenses: number,
  ): {
    kind: 'job_order' | 'account' | 'overhead';
    jobOrderId?: string;
    jobOrderName?: string;
    accountId: string | null;
    accountName: string | null;
  } | null => {
    const seg = norm(className.split(':').pop() ?? className);
    if (!seg) return expenses > 0 && billed === 0 ? { kind: 'overhead', accountId: null, accountName: null } : null;
    if (seg.length >= 4) {
      let best: (typeof joList)[number] | null = null;
      for (const jo of joList) {
        const n = norm(jo.name);
        if (!n) continue;
        if (n === seg)
          return { kind: 'job_order', jobOrderId: jo.id, jobOrderName: jo.name, accountId: jo.accountId, accountName: jo.accountName };
        if (!best && seg.length >= 5 && n.length >= 5 && (n.includes(seg) || seg.includes(n))) best = jo;
      }
      // Account match beats a fuzzy JO hit when the class IS an account name
      // (the Black Caviar trap): exact first, then unique containment.
      const acctExact = acctList.filter((a) => a.n === seg);
      if (acctExact.length === 1)
        return { kind: 'account', accountId: acctExact[0].id, accountName: acctExact[0].name };
      const acctContains = acctList.filter((a) => a.n.length >= 4 && a.n.includes(seg));
      if (acctContains.length === 1 && !best)
        return { kind: 'account', accountId: acctContains[0].id, accountName: acctContains[0].name };
      if (best)
        return { kind: 'job_order', jobOrderId: best.id, jobOrderName: best.name, accountId: best.accountId, accountName: best.accountName };
    }
    if (expenses > 0 && billed === 0) return { kind: 'overhead', accountId: null, accountName: null };
    return null;
  };

  const classes = ((classRes.Class ?? []) as Array<Record<string, any>>).map((c) => {
    const id = trim(c.Id);
    const name = trim(c.Name);
    const fqn = trim(c.FullyQualifiedName) || name;
    const mapping = mappings.get(id) ?? null;
    const billedAgg = billing.classAggs.get(fqn.toLowerCase()) ?? billing.classAggs.get(name.toLowerCase());
    const expAgg = expenses.classAggs.get(fqn.toLowerCase()) ?? expenses.classAggs.get(name.toLowerCase());
    return {
      classId: id,
      name,
      fqn,
      active: c.Active !== false,
      parentClassId: trim((c.ParentRef as any)?.value) || null,
      billedInRange: billedAgg?.billed ?? 0,
      expensesInRange: expAgg?.total ?? 0,
      mapping: mapping
        ? (() => {
            const kind = trim(mapping.targetKind) || (trim(mapping.jobOrderName) ? 'job_order' : 'account');
            const acctId = trim(mapping.accountId) || null;
            const parentId = acctId ? acctParentById.get(acctId) ?? null : null;
            const joNames: string[] = Array.isArray(mapping.jobOrderNames)
              ? (mapping.jobOrderNames as unknown[]).map((x) => trim(x)).filter(Boolean)
              : [trim(mapping.jobOrderName)].filter(Boolean);
            return {
              targetKind: kind,
              jobOrderId: trim(mapping.jobOrderId) || null,
              jobOrderName: trim(mapping.jobOrderName) || null,
              jobOrderNames: joNames,
              accountId: acctId,
              accountName: trim(mapping.accountName) || null,
              parentAccountId: parentId,
              parentAccountName: parentId ? acctNameById.get(parentId) ?? null : null,
              source: trim(mapping.source) || 'manual',
            };
          })()
        : null,
      suggestion: mapping ? null : suggest(fqn, billedAgg?.billed ?? 0, expAgg?.total ?? 0),
    };
  });
  classes.sort((a, b) => (b.billedInRange + b.expensesInRange) - (a.billedInRange + a.expensesInRange) || a.fqn.localeCompare(b.fqn));

  return {
    rangeStart: startDate,
    rangeEnd: endDate,
    totals: {
      classes: classes.length,
      mapped: classes.filter((c) => c.mapping).length,
      unmappedWithActivity: classes.filter((c) => !c.mapping && (c.billedInRange > 0 || c.expensesInRange > 0)).length,
    },
    classes,
  };
}

/* -------------------------------------------------------------------------
 * Job-order costing (Greg 2026-08-27): one JO's complete P&L over its
 * WHOLE LIFE — no date window. Pick entity → account → job order; the
 * report derives its own horizon from the JO's entries (invoices often
 * land months after the work, which is exactly what date-windowed views
 * distort). Pay/hours/WC from ALL of the JO's paid entries; billing +
 * expenses from QBO classes matched to the JO (explicit qbo_class_mappings
 * first, then exact, then fuzzy — same philosophy as Gross Margin);
 * employer taxes at the entity's real Everee rate for the work span.
 * ------------------------------------------------------------------------- */
export async function buildJobOrderCosting(
  tenantId: string,
  jobOrderIds: string[],
): Promise<Record<string, unknown>> {
  // JO + account + entity context — MULTIPLE JOs aggregate into one P&L
  // (Greg 2026-08-27: MN Yacht Club #315 + MN Country Club #209 share one
  // QBO class and are really one engagement; same shape as the Maryland
  // Loader/Crew → Warehouse Associate successor pairs).
  const jos: Array<{ id: string; jo: Record<string, unknown> }> = [];
  for (const joId of jobOrderIds.slice(0, 10)) {
    for (const coll of ['job_orders', 'jobOrders', 'recruiter_jobOrders']) {
      // eslint-disable-next-line no-await-in-loop
      const s = await db.doc(`tenants/${tenantId}/${coll}/${joId}`).get();
      if (s.exists) {
        jos.push({ id: joId, jo: s.data() as Record<string, unknown> });
        break;
      }
    }
  }
  if (jos.length === 0) throw new HttpsError('not-found', 'Job order not found.');
  const joNames = jos.map(({ id, jo }) => trim(jo.jobOrderName) || trim(jo.jobTitle) || id);
  const first = jos[0].jo;
  const accountId = trim(first.recruiterAccountId) || trim(first.accountId) || null;
  let accountName: string | null = trim(first.accountName) || null;
  if (accountId) {
    const acct = await db.doc(`tenants/${tenantId}/accounts/${accountId}`).get();
    if (acct.exists) accountName = trim(acct.data()?.name) || accountName;
  }
  const entityId = trim(first.hiringEntityId);
  const entSnap = entityId ? await db.doc(`tenants/${tenantId}/entities/${entityId}`).get() : null;
  const isContractor =
    trim(entSnap?.data()?.workerType).toLowerCase() === 'contractor' || /events|workforce/i.test(entityId);

  // Every entry the JOs have ever had (single-field queries, auto-indexed).
  const PAID = new Set(['sent_to_everee', 'submitted', 'paid']);
  const PENDING = new Set(['draft', 'pending', 'approved']);
  let pay = 0;
  let pendingPay = 0;
  let hours = 0;
  let tips = 0;
  let bonus = 0;
  let reimbursements = 0;
  let wcPremium = 0;
  let minDate = '';
  let maxDate = '';
  const workers = new Set<string>();
  const payByEntity: Record<string, number> = {};
  let entryCount = 0;
  for (const { id: joId } of jos) {
    // eslint-disable-next-line no-await-in-loop
    const entriesSnap = await db
      .collection(`tenants/${tenantId}/timesheet_entries`)
      .where('jobOrderId', '==', joId)
      .get();
    entriesSnap.forEach((d) => {
      const e = d.data() as Record<string, unknown>;
      const status = trim(e.status);
      const isImport = trim(e.source) === 'csv_import';
      const rate = num(e.payRate);
      const reg = num(e.totalRegularHours);
      const ot = num(e.totalOTHours);
      const dt = num(e.totalDoubleTimeHours);
      const premiums = isImport ? 0 : round2((num(e.mealBreakPenaltyHours) + num(e.restBreakPenaltyHours)) * rate);
      const hourly = isContractor
        ? round2((reg + ot + dt) * rate)
        : isImport
          ? round2(reg * rate + ot * rate * 1.5)
          : round2(reg * rate + ot * rate * 1.5 + dt * rate * 2);
      const total = round2(hourly + premiums + num(e.tips) + num(e.bonusAmount));
      if (!(total > 0)) return;
      const wd = trim(e.workDate);
      if (PAID.has(status)) {
        pay = round2(pay + total);
        hours = round2(hours + reg + ot + dt);
        tips = round2(tips + num(e.tips));
        bonus = round2(bonus + num(e.bonusAmount));
        reimbursements = round2(reimbursements + num(e.reimbursementAmount));
        wcPremium = round2(wcPremium + (total * (num(e.workersCompRate) || 0)) / 100);
        if (trim(e.workerId)) workers.add(trim(e.workerId));
        const ent = trim(e.hiringEntityId) || 'unknown';
        payByEntity[ent] = round2((payByEntity[ent] ?? 0) + total);
        if (wd && (!minDate || wd < minDate)) minDate = wd;
        if (wd && (!maxDate || wd > maxDate)) maxDate = wd;
        entryCount += 1;
      } else if (PENDING.has(status)) {
        pendingPay = round2(pendingPay + total);
      }
    });
  }

  // Horizon: earliest work (or JO start) minus 45d → today. Invoices and
  // card spend land late; the pad catches deposits billed before work.
  const todayIso = new Date().toISOString().slice(0, 10);
  const anchor = minDate || trim(first.startDate) || todayIso;
  const start = new Date(`${anchor}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 45);
  const windowStart = start.toISOString().slice(0, 10);

  const [agg, expAgg, burdenByEntity] = await Promise.all([
    buildBillingAggregates(tenantId, windowStart, todayIso),
    buildExpenseAggregates(tenantId, windowStart, todayIso),
    minDate
      ? buildEvereeBurdenRates(tenantId, minDate, maxDate || todayIso).catch(
          () => ({}) as Record<string, EntityBurden>,
        )
      : Promise.resolve({} as Record<string, EntityBurden>),
  ]);

  // Class → this-engagement matching (mapped > exact > fuzzy;
  // account-prefix compatible, space-insensitive — mirrors the Gross
  // Margin matcher). A class matches when it matches ANY of the JOs.
  const normName = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\b(20\d\d|llc|inc|national|account)\b/g, '')
      .replace(/\bmn\b/g, 'minnesota')
      .replace(/\bkc\b/g, 'kansas city')
      .replace(/\s+/g, ' ')
      .trim();
  const squash = (s: string): string => normName(s).replace(/ /g, '');
  const tokenSubset = (a: string, b: string): boolean => {
    const ta = a.split(' ').filter(Boolean);
    const tb = new Set(b.split(' ').filter(Boolean));
    return ta.length > 0 && ta.every((t) => tb.has(t));
  };
  const acctSquash = squash(accountName ?? '');
  const acctCompatible = (classKey: string): boolean => {
    const i = classKey.lastIndexOf(':');
    if (i <= 0) return true;
    const prefix = squash(classKey.slice(0, i));
    if (!prefix || !acctSquash) return true;
    return acctSquash.includes(prefix) || prefix.includes(acctSquash);
  };
  const classMapSnap = await db.collection(`tenants/${tenantId}/qbo_class_mappings`).get().catch(() => null);
  const namesSet = new Set(joNames);
  const joIdSet = new Set(jos.map((j) => j.id));
  const mappedToThisJo = new Set<string>();
  // Level-aware mappings (2026-08-27): 'overhead' classes never touch a
  // JO or its account chip; 'account' classes mapped to this account are
  // account-level by declaration; classes mapped ELSEWHERE (other JO or
  // other account) are excluded from name/fuzzy matching entirely.
  const mappedOverhead = new Set<string>();
  const mappedToThisAccount = new Set<string>();
  const mappedElsewhere = new Set<string>();
  if (classMapSnap) {
    classMapSnap.forEach((d) => {
      const m = d.data();
      const keys = [trim(m.className), trim(m.fqn)].filter(Boolean).map((n) => n.toLowerCase());
      const kind = trim(m.targetKind) || (trim(m.jobOrderName) ? 'job_order' : 'account');
      const mNames: string[] = Array.isArray(m.jobOrderNames)
        ? (m.jobOrderNames as unknown[]).map((x) => trim(x)).filter(Boolean)
        : [trim(m.jobOrderName)].filter(Boolean);
      const mIds: string[] = Array.isArray(m.jobOrderIds)
        ? (m.jobOrderIds as unknown[]).map((x) => trim(x)).filter(Boolean)
        : [trim(m.jobOrderId)].filter(Boolean);
      let bucket: Set<string>;
      if (kind === 'overhead') bucket = mappedOverhead;
      else if (kind === 'job_order' && (mNames.some((n) => namesSet.has(n)) || mIds.some((i) => joIdSet.has(i))))
        bucket = mappedToThisJo;
      else if (kind === 'account' && accountId && trim(m.accountId) === accountId) bucket = mappedToThisAccount;
      else bucket = mappedElsewhere;
      for (const k of keys) bucket.add(k);
    });
  }
  const nameKeys = joNames.map((n) => n.toLowerCase());
  const fullKeys = accountName ? joNames.map((n) => `${accountName}:${n}`.toLowerCase()) : [];
  const joNorms = joNames.map((n) => normName(n)).filter(Boolean);
  // Bare account-named classes ("Black Caviar" under the Black Caviar
  // account) describe the ACCOUNT, not an event — every token of the
  // class lives inside the account's own name. Fuzzy-matching those
  // glommed EVERY account invoice onto whichever JO contained the account
  // words (Greg 2026-08-27, Outside Lands showing all 19 Black Caviar
  // invoices). Such classes attribute only via explicit qbo_class_mappings
  // or an exact "Account:JO" key — otherwise they're reported separately
  // as account-level billing the JO cannot claim.
  const accountTokens = new Set(normName(accountName ?? '').split(' ').filter(Boolean));
  const isAccountLevelClass = (segNorm: string): boolean => {
    const toks = segNorm.split(' ').filter(Boolean);
    return toks.length > 0 && accountTokens.size > 0 && toks.every((t) => accountTokens.has(t));
  };
  const matchesJo = (key: string): boolean => {
    if (mappedToThisJo.has(key)) return true;
    if (mappedOverhead.has(key) || mappedToThisAccount.has(key) || mappedElsewhere.has(key)) return false;
    const lastSegment = key.split(':').pop()?.trim() ?? key;
    if (fullKeys.includes(key)) return true;
    const seg = normName(lastSegment);
    if (isAccountLevelClass(seg)) return false;
    if ((nameKeys.includes(key) || nameKeys.includes(lastSegment)) && acctCompatible(key)) return true;
    if (!seg || !acctCompatible(key)) return false;
    return joNorms.some(
      (joNorm) =>
        (seg.length >= 5 && joNorm.length >= 5 && (joNorm.includes(seg) || seg.includes(joNorm))) ||
        tokenSubset(seg, joNorm) ||
        tokenSubset(joNorm, seg),
    );
  };
  const isAccountLevelKey = (key: string): boolean => {
    if (mappedToThisJo.has(key)) return false;
    if (mappedToThisAccount.has(key)) return true;
    if (mappedOverhead.has(key) || mappedElsewhere.has(key)) return false;
    const lastSegment = key.split(':').pop()?.trim() ?? key;
    return isAccountLevelClass(normName(lastSegment)) && acctCompatible(key);
  };

  let billed = 0;
  const billedClasses: string[] = [];
  const invoiceRefs: Array<Record<string, unknown>> = [];
  let accountLevelBilled = 0;
  const accountLevelClasses: string[] = [];
  for (const [key, a] of agg.classAggs) {
    if (matchesJo(key)) {
      billed = round2(billed + a.billed);
      billedClasses.push(a.className);
      invoiceRefs.push(...a.invoiceRefs);
    } else if (isAccountLevelKey(key)) {
      accountLevelBilled = round2(accountLevelBilled + a.billed);
      if (!accountLevelClasses.includes(a.className)) accountLevelClasses.push(a.className);
    }
  }
  let expenses = 0;
  const expenseClasses: string[] = [];
  const expenseLines: Array<Record<string, unknown>> = [];
  for (const [key, a] of expAgg.classAggs) {
    if (!matchesJo(key)) continue;
    expenses = round2(expenses + a.total);
    expenseClasses.push(a.className);
    expenseLines.push(...a.lines);
  }

  // Real employer taxes at each entity's Everee rate for the work span.
  let taxBurden: number | null = 0;
  for (const [ent, p] of Object.entries(payByEntity)) {
    const b = burdenByEntity[ent];
    if (!b) {
      taxBurden = null;
      break;
    }
    taxBurden = round2((taxBurden ?? 0) + (p * b.ratePct) / 100);
  }
  const burdenAvailable = taxBurden !== null;
  const effTax = taxBurden ?? round2(pay * 0.12);
  const gp = round2(billed - pay - wcPremium - effTax - expenses - reimbursements);

  return {
    jobOrderId: jos[0].id,
    jobOrderIds: jos.map((j) => j.id),
    jobOrderName: joNames.join(' + '),
    jobOrderNumber: jos.map(({ jo }) => jo.jobOrderNumber).filter((n) => n != null).join(', ') || null,
    status: jos.map(({ jo }) => trim(jo.status)).filter(Boolean).join(', ') || null,
    accountId,
    accountName,
    hiringEntityId: entityId || null,
    workSpan: minDate ? { start: minDate, end: maxDate } : null,
    windowStart,
    windowEnd: todayIso,
    entryCount,
    workers: workers.size,
    hours,
    pay,
    pendingPay,
    tips,
    bonus,
    reimbursements,
    wcPremium,
    taxBurden,
    burdenAvailable,
    burdenByEntity,
    billed,
    billedClasses,
    accountLevelBilled,
    accountLevelClasses,
    invoiceRefs: invoiceRefs.slice(0, 300),
    expenses,
    expenseClasses,
    expenseLines: expenseLines.slice(0, 300),
    grossProfit: gp,
    grossProfitPct: billed > 0 ? round2((gp / billed) * 100) : null,
  };
}

export const getPayrollCostReport = onCall(
  { region: 'us-central1', memory: '1GiB', timeoutSeconds: 300 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    // Job-order costing mode (Greg 2026-08-27): keyed by JO, not dates —
    // branch before date validation.
    if (request.data?.jobCosting === true) {
      const jobOrderIds = Array.isArray(request.data?.jobOrderIds)
        ? (request.data.jobOrderIds as unknown[]).map((x) => trim(x)).filter(Boolean)
        : [trim(request.data?.jobOrderId)].filter(Boolean);
      if (!tenantId || jobOrderIds.length === 0) {
        throw new HttpsError('invalid-argument', 'tenantId and jobOrderId(s) are required.');
      }
      await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId, 7);
      return buildJobOrderCosting(tenantId, jobOrderIds);
    }
    const startDate = trim(request.data?.startDate);
    const endDate = trim(request.data?.endDate);
    const hiringEntityId = trim(request.data?.hiringEntityId);
    if (!tenantId || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new HttpsError('invalid-argument', 'tenantId, startDate, endDate (YYYY-MM-DD) are required.');
    }
    const rangeDays = (Date.parse(endDate) - Date.parse(startDate)) / 86400000;
    if (rangeDays < 0 || rangeDays > MAX_RANGE_DAYS) {
      throw new HttpsError('invalid-argument', `Date range must be 0-${MAX_RANGE_DAYS} days.`);
    }
    await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId);

    // Data Health / Reconciliation spine (Greg 2026-08-26): Everee-settled
    // vs entry gross per month × entity + gross-weighted field coverage.
    // Level 7 — same bar as the register it reconciles against.
    if (request.data?.dataHealth === true) {
      await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId, 7);
      return buildDataHealthReport({ tenantId, startDate, endDate });
    }

    // Entries in range. Single-field range on workDate is auto-indexed;
    // status + entity filters applied in memory.
    const snap = await db
      .collection(`tenants/${tenantId}/timesheet_entries`)
      .where('workDate', '>=', startDate)
      .where('workDate', '<=', endDate)
      .get();

    interface Picked {
      id: string;
      e: Record<string, unknown>;
    }
    const picked: Picked[] = [];
    snap.forEach((d) => {
      const e = d.data();
      // Canonical "money left HRX" statuses (live vocabulary 2026-07-28:
      // draft | approved | sent_to_everee | paid | error).
      const status = trim(e.status);
      if (status !== 'sent_to_everee' && status !== 'submitted' && status !== 'paid') return;
      if (hiringEntityId && trim(e.hiringEntityId) !== hiringEntityId) return;
      picked.push({ id: d.id, e });
    });

    // Resolve attribution via assignments (batched), then JO + account names.
    const assignmentIds = Array.from(
      new Set(picked.map((p) => trim(p.e.assignmentId)).filter(Boolean)),
    );
    const assignments = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < assignmentIds.length; i += 100) {
      const chunk = assignmentIds.slice(i, i + 100);
      const snaps = await db.getAll(...chunk.map((id) => db.doc(`tenants/${tenantId}/assignments/${id}`)));
      snaps.forEach((s) => {
        if (s.exists) assignments.set(s.id, s.data() as Record<string, unknown>);
      });
    }

    const joIds = new Set<string>();
    const accountIds = new Set<string>();
    for (const p of picked) {
      const a = assignments.get(trim(p.e.assignmentId));
      const joId = trim(p.e.jobOrderId) || trim(a?.jobOrderId);
      if (joId) joIds.add(joId);
      // Entries carry accountId top-level (both scheduled and csv_import).
      const acctId = trim(p.e.accountId) || trim(a?.accountId);
      if (acctId) accountIds.add(acctId);
    }

    const joDocs = new Map<string, Record<string, unknown>>();
    for (const joId of joIds) {
      for (const coll of ['job_orders', 'jobOrders', 'recruiter_jobOrders']) {
        const s = await db.doc(`tenants/${tenantId}/${coll}/${joId}`).get();
        if (s.exists) {
          joDocs.set(joId, s.data() as Record<string, unknown>);
          const acctId = trim(s.data()?.recruiterAccountId);
          if (acctId) accountIds.add(acctId);
          break;
        }
      }
    }
    const accountDocs = new Map<string, Record<string, unknown>>();
    const acctIdList = Array.from(accountIds);
    for (let i = 0; i < acctIdList.length; i += 100) {
      const chunk = acctIdList.slice(i, i + 100);
      const snaps = await db.getAll(...chunk.map((id) => db.doc(`tenants/${tenantId}/accounts/${id}`)));
      snaps.forEach((s) => {
        if (s.exists) accountDocs.set(s.id, s.data() as Record<string, unknown>);
      });
    }

    // Venue-label mappings (admin-curated) — applied to rows that can't
    // resolve a JO through the assignment chain.
    const venueMappings = new Map<string, VenueMapping>();
    const mappingsSnap = await db.collection(`tenants/${tenantId}/payroll_venue_mappings`).get();
    mappingsSnap.forEach((d) => {
      const m = d.data() as VenueMapping & { venueKey?: string };
      const key = trim(m.venueKey) || normalizeVenueKey(trim(m.venueLabel));
      if (key && trim(m.jobOrderId)) venueMappings.set(key, m);
    });

    // Per-entry dollars — mirrors the server-side batch total math
    // (createTimesheetBatch) and the grid's dollarAmountForRow.
    const rows: ReportRow[] = [];
    for (const p of picked.slice(0, MAX_ROWS)) {
      const e = p.e;
      const a = assignments.get(trim(e.assignmentId));
      const isImport = trim(e.source) === 'csv_import';
      const rate = num(e.payRate);
      const reg = num(e.totalRegularHours);
      const ot = num(e.totalOTHours);
      const dt = num(e.totalDoubleTimeHours);
      const meal = num(e.mealBreakPenaltyHours);
      const rest = num(e.restBreakPenaltyHours);
      const tips = num(e.tips);
      const bonus = num(e.bonusAmount);
      const gross = isImport
        ? round2(reg * rate + ot * rate * 1.5)
        : round2(reg * rate + ot * rate * 1.5 + dt * rate * 2);
      const premiums = isImport ? 0 : round2((meal + rest) * rate);
      const total = round2(gross + premiums + tips + bonus);
      const hours = round2(reg + ot + dt);

      let joId = trim(e.jobOrderId) || trim(a?.jobOrderId) || null;
      const jo = joId ? joDocs.get(joId) : undefined;
      let acctId = trim(e.accountId) || trim(a?.accountId) || trim(jo?.recruiterAccountId) || null;
      const acct = acctId ? accountDocs.get(acctId) : undefined;
      const importSidecar = (e.import ?? {}) as Record<string, unknown>;
      const workerName =
        `${trim(a?.firstName)} ${trim(a?.lastName)}`.trim() ||
        trim(a?.workerDisplayName) ||
        null;

      // Submit-day key: entries don't carry a batch id in prod, and Everee
      // funds per pay run — (entity, submit date) is the wire-shaped group.
      const sentAt = e.sentToEvereeAt as admin.firestore.Timestamp | undefined;
      const sentDate = sentAt?.toDate ? sentAt.toDate().toISOString().slice(0, 10) : null;

      const worksiteName =
        trim(a?.worksiteName) ||
        trim(jo?.worksiteName) ||
        trim(importSidecar.worksiteName) ||
        trim(importSidecar.csvSite) ||
        trim(e.worksiteName) ||
        null;

      // Admin-curated venue mapping: rows that can't resolve a JO adopt
      // the mapped JO's identity (name/number/PO/account) at read time.
      // Two lookups, same memory (per Greg 2026-07-28): exact venue-label
      // match first, then mapped venue names appearing in free-text notes
      // ("all payments with that in the notes should connect").
      let joName = trim(jo?.jobOrderName) || null;
      let joNumber = trim(jo?.jobOrderNumber) || null;
      let joPo = trim(jo?.poNumber) || null;
      let acctName = trim(acct?.name) || null;
      if (!joId) {
        const m =
          (worksiteName ? venueMappings.get(normalizeVenueKey(worksiteName)) : undefined) ??
          findMappingInText(venueMappings, trim(e.notes));
        if (m) {
          joId = trim(m.jobOrderId) || null;
          joName = trim(m.jobOrderName) || null;
          joNumber = trim(m.jobOrderNumber) || null;
          joPo = trim(m.poNumber) || null;
          if (!acctId) acctId = trim(m.accountId) || null;
          if (!acctName) acctName = trim(m.accountName) || null;
        }
      }

      rows.push({
        entryId: p.id,
        workDate: trim(e.workDate),
        hiringEntityId: trim(e.hiringEntityId),
        batchId: sentDate ? `${trim(e.hiringEntityId) || 'entity'} · sent ${sentDate}` : null,
        workerId: trim(e.workerId),
        workerName,
        accountId: acctId,
        accountName: acctName,
        jobOrderId: joId,
        jobOrderName: joName,
        jobOrderNumber: joNumber,
        poNumber: joPo,
        worksiteName,
        hours,
        gross,
        tips,
        bonus,
        premiums,
        total,
        status: trim(e.status),
        source: isImport ? 'csv_import' : 'scheduled',
        payRate: rate || null,
        regularHours: round2(reg),
        overtimeHours: round2(ot),
        doubleTimeHours: round2(dt),
        workState:
          trim(e.workState).toUpperCase() ||
          trim((e.worksiteAddress as Record<string, unknown> | undefined)?.state).toUpperCase() ||
          trim((importSidecar.worksiteAddress as Record<string, unknown> | undefined)?.state).toUpperCase() ||
          null,
        workersCompCode: trim(e.workersCompCode) || null,
        workersCompRate: num(e.workersCompRate) || null,
      });
    }

    // Off-cycle payments (Mark's manual adjustments) — first-class rows,
    // attributed at creation time so no mapping/fallback chain needed.
    const ocSnap = await db
      .collection(`tenants/${tenantId}/offcycle_payments`)
      .where('workDate', '>=', startDate)
      .where('workDate', '<=', endDate)
      .get();
    ocSnap.forEach((d) => {
      const oc = d.data();
      const status = trim(oc.status);
      if (status !== 'sent_to_everee' && status !== 'paid') return;
      if (hiringEntityId && trim(oc.hiringEntityId) !== hiringEntityId) return;
      const sentAt = oc.sentToEvereeAt as admin.firestore.Timestamp | undefined;
      const sentDate = sentAt?.toDate ? sentAt.toDate().toISOString().slice(0, 10) : null;
      // Same mapping memory as timesheet entries: an off-cycle payment
      // saved without a job order links via its worksite label or a
      // mapped venue name in its notes/label text.
      let ocJoId = trim(oc.jobOrderId) || null;
      let ocJoName = trim(oc.jobOrderName) || null;
      let ocJoNumber = trim(oc.jobOrderNumber) || null;
      let ocPo = trim(oc.poNumber) || null;
      let ocAcctId = trim(oc.accountId) || null;
      let ocAcctName = trim(oc.accountName) || null;
      if (!ocJoId) {
        const wk = trim(oc.worksiteName);
        const m =
          (wk ? venueMappings.get(normalizeVenueKey(wk)) : undefined) ??
          findMappingInText(venueMappings, `${trim(oc.notes)} ${trim(oc.label)}`);
        if (m) {
          ocJoId = trim(m.jobOrderId) || null;
          ocJoName = trim(m.jobOrderName) || null;
          ocJoNumber = trim(m.jobOrderNumber) || null;
          ocPo = trim(m.poNumber) || null;
          if (!ocAcctId) ocAcctId = trim(m.accountId) || null;
          if (!ocAcctName) ocAcctName = trim(m.accountName) || null;
        }
      }
      rows.push({
        entryId: `offcycle:${d.id}`,
        workDate: trim(oc.workDate),
        hiringEntityId: trim(oc.hiringEntityId),
        batchId: sentDate ? `${trim(oc.hiringEntityId) || 'entity'} · sent ${sentDate}` : null,
        workerId: trim(oc.workerId),
        workerName: trim(oc.workerName) || null,
        accountId: ocAcctId,
        accountName: ocAcctName,
        jobOrderId: ocJoId,
        jobOrderName: ocJoName,
        jobOrderNumber: ocJoNumber,
        poNumber: ocPo,
        worksiteName: trim(oc.worksiteName) || null,
        hours: num(oc.hours),
        gross: num(oc.grossAmount),
        tips: 0,
        bonus: 0,
        premiums: 0,
        total: num(oc.total),
        status,
        source: `off_cycle (${trim(oc.reasonLabel) || trim(oc.reason)})`,
        payRate: num(oc.hourlyRate) || null,
        regularHours: num(oc.hours),
        overtimeHours: 0,
        doubleTimeHours: 0,
        workState: null,
        workersCompCode: null,
        workersCompRate: null,
      });
    });

    const grand = round2(rows.reduce((s, r) => s + r.total, 0));

    const group = (keyOf: (r: ReportRow) => string, labelOf: (r: ReportRow) => string): GroupTotals[] => {
      const m = new Map<string, GroupTotals & { workerSet: Set<string> }>();
      for (const r of rows) {
        const key = keyOf(r);
        let g = m.get(key);
        if (!g) {
          g = { key, label: labelOf(r), entries: 0, workers: 0, hours: 0, total: 0, pct: 0, workerSet: new Set() };
          m.set(key, g);
        }
        g.entries += 1;
        g.hours = round2(g.hours + r.hours);
        g.total = round2(g.total + r.total);
        g.workerSet.add(r.workerId);
      }
      return Array.from(m.values())
        .map(({ workerSet, ...g }) => ({ ...g, workers: workerSet.size, pct: grand > 0 ? round2((g.total / grand) * 100) : 0 }))
        .sort((x, y) => y.total - x.total);
    };

    // Name-first grouping (2026-07-28, per Greg): internal JO ids mean
    // different things per client (VenueSmart keys on customer PO, Flex
    // mints a job id per shift), so the stable attribution key — and the
    // future QBO class — is the NAME, scoped by account to avoid
    // cross-client collisions. Multiple JOs sharing a name merge into
    // one row; their #numbers and POs are listed as refs.
    // Worker-name fill (Greg 2026-08-09): unattributed/import rows have no
    // assignment to name the worker from, which blanked names exactly where
    // the who-was-paid expansion + CSV need them — fill from the user docs.
    const unnamedIds = Array.from(
      new Set(rows.filter((r) => !r.workerName && r.workerId).map((r) => r.workerId)),
    );
    for (let i = 0; i < unnamedIds.length; i += 100) {
      const chunk = unnamedIds.slice(i, i + 100);
      const snaps = await db.getAll(...chunk.map((id) => db.doc(`users/${id}`)));
      const names = new Map<string, string>();
      snaps.forEach((s) => {
        if (!s.exists) return;
        const u = s.data() as Record<string, unknown>;
        const n = `${trim(u.firstName)} ${trim(u.lastName)}`.trim() || trim(u.displayName);
        if (n) names.set(s.id, n);
      });
      rows.forEach((r) => {
        if (!r.workerName && names.has(r.workerId)) r.workerName = names.get(r.workerId)!;
      });
    }

    interface ClassGroup extends GroupTotals {
      accountName: string | null;
      attributed: boolean;
      /** Internal JO #numbers merged into this row (context, not the key). */
      jobOrderRefs: string[];
      /** Customer PO numbers seen on the merged JOs. */
      poNumbers: string[];
      worksites: string[];
      /** Real WC premium: Σ entry total × entry wcRate / 100 (same basis as the WC report). */
      wcPremium: number;
      /** Pay split by hiring entity — drives the real Everee burden line. */
      payByEntity: Record<string, number>;
    }
    const classMap = new Map<string, ClassGroup & { workerSet: Set<string> }>();
    for (const r of rows) {
      const name = r.jobOrderName ?? r.worksiteName ?? 'Unknown';
      const key = `${r.accountId ?? ''}|${r.jobOrderName ? 'jo' : 'venue'}|${name}`;
      let g = classMap.get(key);
      if (!g) {
        g = {
          key,
          label: r.jobOrderName ? name : `Unattributed — ${name}`,
          accountName: r.accountName,
          attributed: Boolean(r.jobOrderName),
          jobOrderRefs: [],
          poNumbers: [],
          worksites: [],
          entries: 0,
          workers: 0,
          hours: 0,
          total: 0,
          pct: 0,
          wcPremium: 0,
          payByEntity: {},
          workerSet: new Set<string>(),
        };
        classMap.set(key, g);
      }
      if (!g.accountName && r.accountName) g.accountName = r.accountName;
      const ref = r.jobOrderNumber ? `#${r.jobOrderNumber}` : null;
      if (ref && !g.jobOrderRefs.includes(ref)) g.jobOrderRefs.push(ref);
      if (r.poNumber && !g.poNumbers.includes(r.poNumber)) g.poNumbers.push(r.poNumber);
      if (r.worksiteName && !g.worksites.includes(r.worksiteName)) g.worksites.push(r.worksiteName);
      g.entries += 1;
      g.hours = round2(g.hours + r.hours);
      g.total = round2(g.total + r.total);
      g.wcPremium = round2(g.wcPremium + (r.total * (num(r.workersCompRate) || 0)) / 100);
      const ent = r.hiringEntityId || 'unknown';
      g.payByEntity[ent] = round2((g.payByEntity[ent] ?? 0) + r.total);
      g.workerSet.add(r.workerId);
    }
    const byJobOrder: ClassGroup[] = Array.from(classMap.values())
      .map(({ workerSet, ...g }) => ({
        ...g,
        workers: workerSet.size,
        pct: grand > 0 ? round2((g.total / grand) * 100) : 0,
      }))
      .sort((x, y) => y.total - x.total);
    const byAccount = group(
      (r) => r.accountId ?? 'unattributed',
      (r) => r.accountName ?? 'Unattributed',
    );
    // Parent-account nesting (Greg 2026-08-26): each account row carries its
    // parentAccountId/name so the client can roll children up under the
    // national account (CORT → CORT Baltimore/Woodbridge/…). Parents with
    // no payroll of their own aren't in accountDocs yet — fetch them.
    const parentIds = new Set<string>();
    for (const g of byAccount) {
      const p = trim(accountDocs.get(g.key)?.parentAccountId);
      if (p) parentIds.add(p);
    }
    const missingParents = Array.from(parentIds).filter((id) => !accountDocs.has(id));
    for (let i = 0; i < missingParents.length; i += 100) {
      // eslint-disable-next-line no-await-in-loop
      const snaps = await db.getAll(
        ...missingParents.slice(i, i + 100).map((id) => db.doc(`tenants/${tenantId}/accounts/${id}`)),
      );
      snaps.forEach((s) => {
        if (s.exists) accountDocs.set(s.id, s.data() as Record<string, unknown>);
      });
    }
    const byAccountOut = byAccount.map((g) => {
      const pid = trim(accountDocs.get(g.key)?.parentAccountId) || null;
      return {
        ...g,
        parentAccountId: pid,
        parentAccountName: pid ? trim(accountDocs.get(pid)?.name) || null : null,
      };
    });

    // Per-batch split — the wire-parsing view for the bookkeeper.
    interface BatchSplit {
      batchId: string;
      hiringEntityId: string;
      total: number;
      entries: number;
      dateRange: { min: string; max: string };
      byJobOrder: Array<{ label: string; total: number; pct: number }>;
    }
    const batchMap = new Map<string, ReportRow[]>();
    for (const r of rows) {
      const key = r.batchId ?? 'no-batch';
      batchMap.set(key, [...(batchMap.get(key) ?? []), r]);
    }
    const byBatch: BatchSplit[] = Array.from(batchMap.entries())
      .map(([batchId, batchRows]) => {
        const total = round2(batchRows.reduce((s, r) => s + r.total, 0));
        const joTotals = new Map<string, { label: string; total: number }>();
        for (const r of batchRows) {
          // Class-path shaped label (Account:Name) so the split lines map
          // 1:1 onto QBO classes ("Venue Smart:FIFA KC"); name-keyed —
          // same-name JOs merge, unattributed rows fall back to venue.
          const name = r.jobOrderName ?? r.worksiteName;
          const label = name
            ? `${r.accountName ? `${r.accountName}:` : ''}${name}`
            : 'Unattributed';
          const cur = joTotals.get(label) ?? { label, total: 0 };
          cur.total = round2(cur.total + r.total);
          joTotals.set(label, cur);
        }
        const dates = batchRows.map((r) => r.workDate).sort();
        return {
          batchId,
          hiringEntityId: batchRows[0]?.hiringEntityId ?? '',
          total,
          entries: batchRows.length,
          dateRange: { min: dates[0] ?? '', max: dates[dates.length - 1] ?? '' },
          byJobOrder: Array.from(joTotals.values())
            .map((t) => ({ ...t, pct: total > 0 ? round2((t.total / total) * 100) : 0 }))
            .sort((x, y) => y.total - x.total),
        };
      })
      .sort((x, y) => (x.dateRange.max < y.dateRange.max ? 1 : -1));

    // Gross-margin billing join (Greg 2026-08-19). Pay side = the groups
    // above; bill side = live QBO invoices in the SAME date range (TxnDate
    // vs workDate — month-boundary timing can skew individual jobs, the UI
    // says so). Class names match pay labels because both follow the
    // "Account:Job order name" convention.
    let billing: Record<string, unknown> | null = null;
    let billingError: string | null = null;
    if (request.data?.includeBilling === true) {
      // Revenue across all clients = Global Invoicing bar (level 7).
      await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId, 7);
      try {
        const wantExpenses = request.data?.includeExpenses === true;
        const [agg, expAgg, burdenByEntity] = await Promise.all([
          buildBillingAggregates(tenantId, startDate, endDate),
          wantExpenses ? buildExpenseAggregates(tenantId, startDate, endDate) : Promise.resolve(null),
          // Real employer burden per entity (FIN-2). Fail-soft: {} means
          // burden-unknown and the client falls back to its estimate.
          buildEvereeBurdenRates(tenantId, startDate, endDate).catch(
            () => ({}) as Record<string, EntityBurden>,
          ),
        ]);
        const burdenAvailable = Object.keys(burdenByEntity).length > 0;
        /** Real burden dollars for a group's per-entity pay split — null when
         *  ANY of the group's entities lacks an Everee-derived rate. */
        const taxBurdenOf = (payByEntity: Record<string, number>): number | null => {
          let sum = 0;
          for (const [ent, pay] of Object.entries(payByEntity)) {
            const b = burdenByEntity[ent];
            if (!b) return null;
            sum += (pay * b.ratePct) / 100;
          }
          return round2(sum);
        };

        // Class ↔ job-order name matching, two passes. QBO class names
        // drift from JO names ("Venue Smart:Lollapalooza" vs JO
        // "Lollapalooza 2026", "MN Yacht Club" vs "Minnesota Yacht Club"),
        // so after exact matching, fuzzy matching wins: substring
        // containment (≥5 chars, findMappingInText precedent) OR
        // token-subset either way ("fifa dallas" ⊆ "fifa fan festival
        // dallas"), with abbreviation expansion — same philosophy as the
        // wire-recon venue matcher. A class's account prefix ("Venue
        // Smart:…") must be compatible with the pay group's account so
        // same-named JOs under different clients can't cross-match.
        const normName = (s: string): string =>
          s
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\b(20\d\d|llc|inc|national|account)\b/g, '')
            .replace(/\bmn\b/g, 'minnesota')
            .replace(/\bkc\b/g, 'kansas city')
            .replace(/\s+/g, ' ')
            .trim();
        const tokenSubset = (a: string, b: string): boolean => {
          const ta = a.split(' ').filter(Boolean);
          const tb = new Set(b.split(' ').filter(Boolean));
          return ta.length > 0 && ta.every((t) => tb.has(t));
        };
        // Account comparisons are SPACE-INSENSITIVE ("Venue Smart" class
        // prefix vs "Venuesmart LLC National" account) — squash to one
        // token before containment checks.
        const squash = (s: string): string => normName(s).replace(/ /g, '');
        const classAcctPrefix = (key: string): string => {
          const i = key.lastIndexOf(':');
          return i > 0 ? squash(key.slice(0, i)) : '';
        };
        // Squashed norms of every pay-side account — a bare account-named
        // class ("Venue Smart", "Black Caviar") stays billed-only rather
        // than glomming onto whichever of that client's JOs sorts first.
        const accountNorms = new Set(
          byJobOrder.map((g) => squash(g.accountName ?? '')).filter(Boolean),
        );
        const acctCompatible = (prefix: string, accountName: string | null): boolean => {
          if (!prefix) return true;
          const acct = squash(accountName ?? '');
          if (!acct) return true;
          return acct.includes(prefix) || prefix.includes(acct);
        };

        const usedClassKeys = new Set<string>();
        /** classKey → PAY-side accountId it matched (drives the by-client merge). */
        const matchedClassToAccount = new Map<string, string>();
        // Pass 0 (Greg 2026-08-19): explicit qbo_class_mappings beat every
        // heuristic — a mapped class's amounts land on its mapped job
        // order/account row, period. Keyed by class DISPLAY name (lower).
        const classMapSnap = await db.collection(`tenants/${tenantId}/qbo_class_mappings`).get().catch(() => null);
        // Level-aware (2026-08-27): overhead-mapped classes are non-client
        // dollars — excluded from every row and summed separately;
        // job_order mappings may target MULTIPLE JOs (jobOrderNames[]).
        const mappedClassByName = new Map<
          string,
          { kind: string; jobOrderNames: string[]; accountId: string | null }
        >();
        if (classMapSnap) {
          classMapSnap.forEach((d) => {
            const m = d.data();
            const names = [trim(m.className), trim(m.fqn)].filter(Boolean);
            const kind = trim(m.targetKind) || (trim(m.jobOrderName) ? 'job_order' : 'account');
            const joNames: string[] = Array.isArray(m.jobOrderNames)
              ? (m.jobOrderNames as unknown[]).map((x) => trim(x)).filter(Boolean)
              : [trim(m.jobOrderName)].filter(Boolean);
            for (const n of names) {
              mappedClassByName.set(n.toLowerCase(), {
                kind,
                jobOrderNames: joNames,
                accountId: trim(m.accountId) || null,
              });
            }
          });
        }
        // Overhead classes: pull them out of the pool before any matching.
        let overheadBilled = 0;
        const overheadClasses: string[] = [];
        for (const [key, a] of agg.classAggs) {
          if (mappedClassByName.get(key)?.kind === 'overhead') {
            usedClassKeys.add(key);
            overheadBilled = round2(overheadBilled + a.billed);
            if (!overheadClasses.includes(a.className)) overheadClasses.push(a.className);
          }
        }
        const gmByJobOrder = byJobOrder.map((g) => {
          // ClassGroup key format: `${accountId}|jo-or-venue|name`.
          const payAccountId = g.key.split('|')[0] || null;
          const nameKey = g.label.toLowerCase();
          const fullKey = g.accountName ? `${g.accountName}:${g.label}`.toLowerCase() : null;
          let billed = 0;
          const billedClasses: string[] = [];
          for (const [key, a] of agg.classAggs) {
            if (usedClassKeys.has(key)) continue;
            const lastSegment = key.split(':').pop()?.trim() ?? key;
            const mapped = mappedClassByName.get(key);
            const mappedHere =
              mapped != null &&
              mapped.kind !== 'overhead' &&
              ((mapped.jobOrderNames.length > 0 && mapped.jobOrderNames.includes(g.label)) ||
                (mapped.jobOrderNames.length === 0 && mapped.accountId != null && mapped.accountId === payAccountId));
            const exact =
              mappedHere ||
              (mapped == null &&
                (key === fullKey ||
                  ((key === nameKey || lastSegment === nameKey) &&
                    acctCompatible(classAcctPrefix(key), g.accountName))));
            if (exact) {
              billed = round2(billed + a.billed);
              billedClasses.push(a.className);
              usedClassKeys.add(key);
              if (payAccountId) matchedClassToAccount.set(key, payAccountId);
            }
          }
          return {
            label: g.label,
            accountId: payAccountId,
            accountName: g.accountName,
            attributed: g.attributed,
            pay: g.total,
            hours: g.hours,
            workers: g.workers,
            billed,
            billedClasses,
            expenses: 0,
            expenseClasses: [] as string[],
            wcPremium: g.wcPremium,
            taxBurden: taxBurdenOf(g.payByEntity),
          };
        });
        // Pass 2: fuzzy — each unused class goes to the first (largest-pay,
        // byJobOrder is pay-sorted) account-compatible group it matches.
        for (const [key, a] of agg.classAggs) {
          if (usedClassKeys.has(key)) continue;
          // Explicitly-mapped classes never fuzzy-match elsewhere — if
          // their mapped row isn't in this range they stay billed-only.
          if (mappedClassByName.has(key)) continue;
          const seg = normName(key.split(':').pop() ?? key);
          if (!seg || accountNorms.has(seg.replace(/ /g, ''))) continue;
          const prefix = classAcctPrefix(key);
          const hit = gmByJobOrder.find((g) => {
            if (!acctCompatible(prefix, g.accountName)) return false;
            const n = normName(g.label);
            if (!n) return false;
            const substringHit =
              seg.length >= 5 && n.length >= 5 && (n.includes(seg) || seg.includes(n));
            return substringHit || tokenSubset(seg, n) || tokenSubset(n, seg);
          });
          if (hit) {
            hit.billed = round2(hit.billed + a.billed);
            hit.billedClasses.push(a.className);
            usedClassKeys.add(key);
            if (hit.accountId) matchedClassToAccount.set(key, hit.accountId);
          }
        }
        // Classes billed in range with no matching payroll group — real
        // rows (margin is 100% pre-burden), not noise; often month-boundary.
        // EXCEPT under an entity filter: invoices carry no HRX entity, so
        // an unmatched class can't be proven to belong to this entity —
        // showing it would leak the other entity's billing into the view.
        const entityFiltered = Boolean(hiringEntityId);
        if (!entityFiltered) {
          for (const [key, a] of agg.classAggs) {
            if (usedClassKeys.has(key)) continue;
            gmByJobOrder.push({
              label: a.className,
              accountId: null,
              accountName: null,
              attributed: false,
              pay: 0,
              hours: 0,
              workers: 0,
              billed: a.billed,
              billedClasses: [a.className],
              expenses: 0,
              expenseClasses: [],
              wcPremium: 0,
              taxBurden: 0,
            });
          }
        }

        // Expenses (job costing, Greg 2026-08-19): same matching shape —
        // exact against every row (pay rows AND billed-only rows, so
        // "Venue Smart:Bonnaroo" card spend lands next to its billing),
        // then fuzzy, then expense-only rows (skipped under an entity
        // filter for the same can't-prove-entity reason).
        if (expAgg) {
          const usedExpenseKeys = new Set<string>();
          for (const row of gmByJobOrder) {
            const nameKey = row.label.toLowerCase();
            const fullKey = row.accountName ? `${row.accountName}:${row.label}`.toLowerCase() : null;
            for (const [key, a] of expAgg.classAggs) {
              if (usedExpenseKeys.has(key)) continue;
              const lastSegment = key.split(':').pop()?.trim() ?? key;
              const exact =
                key === fullKey ||
                key === nameKey ||
                (lastSegment === nameKey && acctCompatible(classAcctPrefix(key), row.accountName));
              if (exact) {
                row.expenses = round2(row.expenses + a.total);
                row.expenseClasses.push(a.className);
                usedExpenseKeys.add(key);
              }
            }
          }
          for (const [key, a] of expAgg.classAggs) {
            if (usedExpenseKeys.has(key)) continue;
            const seg = normName(key.split(':').pop() ?? key);
            if (!seg || accountNorms.has(seg.replace(/ /g, ''))) continue;
            const prefix = classAcctPrefix(key);
            const hit = gmByJobOrder.find((g) => {
              if (!acctCompatible(prefix, g.accountName)) return false;
              const n = normName(g.label);
              if (!n) return false;
              const substringHit =
                seg.length >= 5 && n.length >= 5 && (n.includes(seg) || seg.includes(n));
              return substringHit || tokenSubset(seg, n) || tokenSubset(n, seg);
            });
            if (hit) {
              hit.expenses = round2(hit.expenses + a.total);
              hit.expenseClasses.push(a.className);
              usedExpenseKeys.add(key);
            }
          }
          if (!entityFiltered) {
            for (const [key, a] of expAgg.classAggs) {
              if (usedExpenseKeys.has(key)) continue;
              gmByJobOrder.push({
                label: a.className,
                accountId: null,
                accountName: null,
                attributed: false,
                pay: 0,
                hours: 0,
                workers: 0,
                billed: 0,
                billedClasses: [],
                expenses: a.total,
                expenseClasses: [a.className],
                wcPremium: 0,
                taxBurden: 0,
              });
            }
          }
        }
        gmByJobOrder.sort((x, y) => y.billed - x.billed || y.pay - x.pay);

        // Per-class drill-down detail (job costing): invoice refs and
        // expense lines keyed by class DISPLAY name — rows carry
        // billedClasses/expenseClasses to look these up.
        const classDetail: Record<string, Record<string, unknown>> = {};
        for (const a of agg.classAggs.values()) {
          classDetail[a.className] = { className: a.className, billed: a.billed, invoiceRefs: a.invoiceRefs };
        }
        if (expAgg) {
          for (const a of expAgg.classAggs.values()) {
            classDetail[a.className] = {
              ...(classDetail[a.className] ?? { className: a.className }),
              expenses: a.total,
              expenseLines: a.lines,
            };
          }
        }

        // By-client join: seed one row per PAY account, then fold each QBO
        // customer's billing into the right row. A customer lands on (1) its
        // mapped account when that account has payroll, else (2) the single
        // pay account its billed classes matched in the by-JO join (this is
        // what unifies AEG Management Oakland's billing with Legends
        // National Account's payroll — Greg 2026-08-19), else (3) its own
        // standalone billed-only row.
        interface AcctGmRow {
          accountId: string | null;
          label: string;
          customerName: string | null;
          billed: number;
          invoiceCount: number;
          openBalance: number;
          pay: number;
          wcPremium: number;
          taxBurden: number | null;
        }
        // Per-account WC premium + entity pay split (same math as the JO groups).
        const acctBurdenAgg = new Map<string, { wcPremium: number; payByEntity: Record<string, number> }>();
        for (const r of rows) {
          const key = r.accountId ?? 'unattributed';
          let a = acctBurdenAgg.get(key);
          if (!a) {
            a = { wcPremium: 0, payByEntity: {} };
            acctBurdenAgg.set(key, a);
          }
          a.wcPremium = round2(a.wcPremium + (r.total * (num(r.workersCompRate) || 0)) / 100);
          const ent = r.hiringEntityId || 'unknown';
          a.payByEntity[ent] = round2((a.payByEntity[ent] ?? 0) + r.total);
        }
        const rowsByAccount = new Map<string, AcctGmRow>();
        for (const g of byAccount) {
          const ba = acctBurdenAgg.get(g.key);
          rowsByAccount.set(g.key, {
            accountId: g.key === 'unattributed' ? null : g.key,
            label: g.label,
            customerName: null,
            billed: 0,
            invoiceCount: 0,
            openBalance: 0,
            pay: g.total,
            wcPremium: ba?.wcPremium ?? 0,
            taxBurden: ba ? taxBurdenOf(ba.payByEntity) : 0,
          });
        }
        const standaloneRows: AcctGmRow[] = [];
        for (const c of agg.customerAggs.values()) {
          let targetId = c.accountId && rowsByAccount.has(c.accountId) ? c.accountId : null;
          if (!targetId) {
            const candidates = new Set(
              Array.from(c.classKeys)
                .map((k) => matchedClassToAccount.get(k))
                .filter((id): id is string => Boolean(id)),
            );
            if (candidates.size === 1) {
              const only = Array.from(candidates)[0];
              if (rowsByAccount.has(only)) targetId = only;
            }
          }
          if (targetId) {
            const row = rowsByAccount.get(targetId)!;
            row.billed = round2(row.billed + c.billed);
            row.invoiceCount += c.invoiceCount;
            row.openBalance = round2(row.openBalance + c.openBalance);
            if (c.customerName) {
              row.customerName = row.customerName
                ? `${row.customerName}, ${c.customerName}`
                : c.customerName;
            }
          } else {
            // Entity view: a customer we can't tie to this entity's payroll
            // is excluded (same reasoning as the class rows above).
            if (entityFiltered) continue;
            standaloneRows.push({
              accountId: c.accountId,
              label: c.accountName ?? c.customerName ?? 'Unknown customer',
              customerName: c.customerName,
              billed: c.billed,
              invoiceCount: c.invoiceCount,
              openBalance: c.openBalance,
              pay: 0,
              wcPremium: 0,
              taxBurden: 0,
            });
          }
        }
        const gmByAccount: AcctGmRow[] = [...rowsByAccount.values(), ...standaloneRows];
        gmByAccount.sort((x, y) => y.billed - x.billed || y.pay - x.pay);

        // Cash-flow gap per client (Greg 2026-08-19): paid-to-workers vs
        // billed vs COLLECTED in the range. Collections = QBO Payments,
        // rolled to HRX accounts through the same customer map (with
        // sub-customer hierarchy) the billing side used.
        let cashFlowByClient: Array<Record<string, unknown>> | null = null;
        if (request.data?.includeCashFlow === true) {
          const payments: Array<Record<string, any>> = [];
          const pageSize = 1000;
          for (let page = 0; page < 20; page++) {
            const start = page * pageSize + 1;
            // eslint-disable-next-line no-await-in-loop
            const resp = await qboQuery(
              tenantId,
              `SELECT * FROM Payment WHERE TxnDate >= '${startDate}' AND TxnDate <= '${endDate}' STARTPOSITION ${start} MAXRESULTS ${pageSize}`,
            );
            const items = (resp.Payment ?? []) as Array<Record<string, any>>;
            payments.push(...items);
            if (items.length < pageSize) break;
          }
          const collectedByAccount = new Map<string, number>();
          let collectedUnmapped = 0;
          for (const p of payments) {
            const cid = trim((p.CustomerRef as Record<string, any> | undefined)?.value);
            const amt = Number(p.TotalAmt ?? 0);
            if (!amt) continue;
            const acct = agg.acctByCustomerId.get(cid);
            if (acct) {
              collectedByAccount.set(acct.accountId, round2((collectedByAccount.get(acct.accountId) ?? 0) + amt));
            } else {
              collectedUnmapped = round2(collectedUnmapped + amt);
            }
          }
          cashFlowByClient = gmByAccount
            .map((r) => {
              const collected = collectedByAccount.get((r.accountId as string) ?? '') ?? 0;
              return {
                accountId: r.accountId,
                label: r.label,
                customerName: r.customerName,
                pay: r.pay,
                billed: r.billed,
                collected,
                // Positive = cash C1 has floated this client in the range.
                floatBeforeBurden: round2((r.pay as number) - collected),
              };
            })
            .sort((x, y) => (y.floatBeforeBurden as number) - (x.floatBeforeBurden as number));
          cashFlowByClient.push({
            accountId: null,
            label: '(payments from unmapped customers)',
            customerName: null,
            pay: 0,
            billed: 0,
            collected: collectedUnmapped,
            floatBeforeBurden: round2(-collectedUnmapped),
          });
        }

        billing = {
          cashFlowByClient,
          // Entity view: headline billed/invoice numbers narrow to the
          // customers that matched this entity's payroll (invoices carry
          // no HRX entity of their own).
          invoiceCount: entityFiltered
            ? gmByAccount.reduce((s, r) => s + ((r.invoiceCount as number) || 0), 0)
            : agg.invoiceCount,
          totalBilled: entityFiltered
            ? round2(gmByAccount.reduce((s, r) => s + ((r.billed as number) || 0), 0))
            : agg.totalBilled,
          unclassifiedBilled: agg.unclassifiedBilled,
          totalPay: grand,
          entityFiltered,
          totalExpenses: expAgg?.totalExpenses ?? null,
          expensePurchaseCount: expAgg?.purchaseCount ?? null,
          unclassifiedExpenses: expAgg?.unclassifiedExpenses ?? null,
          excludedEvereeTotal: expAgg?.excludedEvereeTotal ?? null,
          classDetail,
          byJobOrder: gmByJobOrder,
          byAccount: gmByAccount,
          // Real employer burden (FIN-2): per-entity Everee actuals for the
          // range. Rows carry wcPremium (entry-level) + taxBurden (entity
          // rate × pay); the client shows real lines when available and
          // falls back to its estimate slider when not.
          burdenAvailable,
          burdenByEntity,
          overheadBilled: round2(overheadBilled),
          overheadClasses,
          totalWcPremium: round2(gmByJobOrder.reduce((s, r) => s + (r.wcPremium || 0), 0)),
          totalTaxBurden: burdenAvailable
            ? round2(gmByJobOrder.reduce((s, r) => s + (r.taxBurden ?? 0), 0))
            : null,
        };
      } catch (err) {
        billingError = err instanceof Error ? err.message : String(err);
      }
    }

    // Everee payroll register (Greg 2026-08-19) — same books gate (6+).
    let evereeRegister: Record<string, unknown> | null = null;
    let evereeRegisterError: string | null = null;
    if (request.data?.includeEvereeRegister === true) {
      try {
        evereeRegister = await buildEvereeRegister(tenantId, startDate, endDate, hiringEntityId || null);
      } catch (err) {
        evereeRegisterError = err instanceof Error ? err.message : String(err);
      }
    }

    // Payroll journal by QBO class (Greg 2026-08-19) — wire class splits.
    let wireJournal: Record<string, unknown> | null = null;
    let wireJournalError: string | null = null;
    if (request.data?.includeWireJournal === true) {
      try {
        wireJournal = await buildWireJournal(tenantId, startDate, endDate, hiringEntityId || null);
      } catch (err) {
        wireJournalError = err instanceof Error ? err.message : String(err);
      }
    }

    // Compliance reports (Greg 2026-08-19) — computed from the entry rows
    // this callable already built for the range.
    let acaLookback: Record<string, unknown> | null = null;
    if (request.data?.includeAcaLookback === true) {
      // ACA applies to W-2 employees only — skip contractor entities.
      const entSnap = await db.collection(`tenants/${tenantId}/entities`).get();
      const contractorEntities = new Set(
        entSnap.docs
          .filter(
            (d) =>
              trim(d.data().workerType).toLowerCase() === 'contractor' || /events|workforce/i.test(d.id),
          )
          .map((d) => d.id),
      );
      const monthsInRange = new Set<string>();
      for (let t0 = Date.parse(startDate); t0 <= Date.parse(endDate); t0 += 86400000) {
        monthsInRange.add(new Date(t0).toISOString().slice(0, 7));
      }
      const perWorker = new Map<string, { name: string | null; months: Map<string, number>; total: number }>();
      for (const r of rows) {
        if (r.entryId.startsWith('offcycle:')) continue;
        if (contractorEntities.has(r.hiringEntityId)) continue;
        if (!r.workerId || !r.hours) continue;
        const m = r.workDate.slice(0, 7);
        const w = perWorker.get(r.workerId) ?? { name: r.workerName, months: new Map(), total: 0 };
        if (!w.name && r.workerName) w.name = r.workerName;
        w.months.set(m, round2((w.months.get(m) ?? 0) + r.hours));
        w.total = round2(w.total + r.hours);
        perWorker.set(r.workerId, w);
      }
      const nMonths = Math.max(1, monthsInRange.size);
      const acaRows = Array.from(perWorker.entries())
        .map(([uid, w]) => {
          const ftMonths = Array.from(w.months.values()).filter((h) => h >= 130).length;
          const avgPerMonth = round2(w.total / nMonths);
          return {
            workerId: uid,
            workerName: w.name,
            totalHours: w.total,
            activeMonths: w.months.size,
            ftMonths,
            avgPerMonth,
            status: avgPerMonth >= 130 ? 'meets_ft' : avgPerMonth >= 110 ? 'near' : 'below',
          };
        })
        .sort((a, b) => b.totalHours - a.totalHours)
        .slice(0, 3000);
      acaLookback = {
        monthsMeasured: nMonths,
        totals: {
          workers: acaRows.length,
          meetsFt: acaRows.filter((r) => r.status === 'meets_ft').length,
          near: acaRows.filter((r) => r.status === 'near').length,
        },
        rows: acaRows,
      };
    }

    let sickLeave: Record<string, unknown> | null = null;
    if (request.data?.includeSickLeave === true) {
      const byStateWorker = new Map<string, { state: string; workerId: string; name: string | null; hours: number }>();
      for (const r of rows) {
        if (r.entryId.startsWith('offcycle:')) continue;
        const st = trim(r.workState ?? '');
        if (!st || !r.workerId || !r.hours) continue;
        const key = `${st}|${r.workerId}`;
        const w = byStateWorker.get(key) ?? { state: st, workerId: r.workerId, name: r.workerName, hours: 0 };
        if (!w.name && r.workerName) w.name = r.workerName;
        w.hours = round2(w.hours + r.hours);
        byStateWorker.set(key, w);
      }
      const byState = new Map<string, { state: string; workers: number; hours: number }>();
      for (const w of byStateWorker.values()) {
        const s = byState.get(w.state) ?? { state: w.state, workers: 0, hours: 0 };
        s.workers += 1;
        s.hours = round2(s.hours + w.hours);
        byState.set(w.state, s);
      }
      sickLeave = {
        // 1 hr accrued per 30 worked — the CA-style baseline. Caps and
        // local ordinances vary; the report is the accrual BASIS.
        byState: Array.from(byState.values())
          .map((s) => ({ ...s, estAccruedHours: round2(s.hours / 30) }))
          .sort((a, b) => b.hours - a.hours),
        workers: Array.from(byStateWorker.values())
          .map((w) => ({ ...w, estAccruedHours: round2(w.hours / 30) }))
          .sort((a, b) => b.hours - a.hours)
          .slice(0, 2000),
      };
    }

    let i9Status: Record<string, unknown> | null = null;
    let i9StatusError: string | null = null;
    if (request.data?.includeI9Status === true) {
      try {
        i9Status = await buildI9Status(tenantId, hiringEntityId || null);
      } catch (err) {
        i9StatusError = err instanceof Error ? err.message : String(err);
      }
    }

    // Cash requirements (Greg 2026-08-19): payroll dollars APPROVED (or
    // still draft) but not yet sent to Everee — the cash the next submit
    // will pull, before it's pulled. Scans a fixed recent window
    // (today−45 → today+7 work dates) independent of the report range.
    let cashRequirements: Record<string, unknown> | null = null;
    if (request.data?.includeCashFlow === true) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const winStart = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
      const winEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const entSnap2 = await db.collection(`tenants/${tenantId}/entities`).get();
      const entityNames = new Map<string, string>();
      const contractorSet = new Set<string>();
      entSnap2.docs.forEach((d) => {
        entityNames.set(d.id, trim(d.data().name) || d.id);
        if (trim(d.data().workerType).toLowerCase() === 'contractor' || /events|workforce/i.test(d.id)) {
          contractorSet.add(d.id);
        }
      });
      const pendSnap = await db
        .collection(`tenants/${tenantId}/timesheet_entries`)
        .where('workDate', '>=', winStart)
        .where('workDate', '<=', winEnd)
        .get();
      interface PendAgg {
        entityId: string;
        entityName: string;
        approvedGross: number;
        approvedEntries: number;
        draftGross: number;
        draftEntries: number;
        workerSet: Set<string>;
      }
      const pend = new Map<string, PendAgg>();
      pendSnap.forEach((d) => {
        const e = d.data();
        const status = trim(e.status);
        if (status !== 'approved' && status !== 'draft') return;
        const entityId = trim(e.hiringEntityId);
        if (/sandbox/i.test(entityId)) return;
        if (hiringEntityId && entityId !== hiringEntityId) return;
        const isImport = trim(e.source) === 'csv_import';
        const rate = num(e.payRate);
        const reg = num(e.totalRegularHours);
        const ot = num(e.totalOTHours);
        const dt = num(e.totalDoubleTimeHours);
        const premiums = isImport ? 0 : round2((num(e.mealBreakPenaltyHours) + num(e.restBreakPenaltyHours)) * rate);
        const hourly = contractorSet.has(entityId)
          ? round2((reg + ot + dt) * rate)
          : isImport
            ? round2(reg * rate + ot * rate * 1.5)
            : round2(reg * rate + ot * rate * 1.5 + dt * rate * 2);
        const total = round2(hourly + premiums + num(e.tips) + num(e.bonusAmount));
        if (total === 0) return;
        const g = pend.get(entityId) ?? {
          entityId,
          entityName: entityNames.get(entityId) ?? entityId,
          approvedGross: 0,
          approvedEntries: 0,
          draftGross: 0,
          draftEntries: 0,
          workerSet: new Set<string>(),
        };
        if (status === 'approved') {
          g.approvedGross = round2(g.approvedGross + total);
          g.approvedEntries += 1;
        } else {
          g.draftGross = round2(g.draftGross + total);
          g.draftEntries += 1;
        }
        const wid = trim(e.workerId);
        if (wid) g.workerSet.add(wid);
        pend.set(entityId, g);
      });
      const byEntity = Array.from(pend.values())
        .map(({ workerSet, ...g }) => ({ ...g, workers: workerSet.size }))
        .sort((a, b) => b.approvedGross - a.approvedGross);
      cashRequirements = {
        asOf: todayStr,
        windowStart: winStart,
        windowEnd: winEnd,
        byEntity,
        totalApprovedGross: round2(byEntity.reduce((s, g) => s + g.approvedGross, 0)),
        totalDraftGross: round2(byEntity.reduce((s, g) => s + g.draftGross, 0)),
      };
    }

    // QBO class catalog + mappings (Greg 2026-08-19) — level 7 (books structure).
    let classCatalog: Record<string, unknown> | null = null;
    let classCatalogError: string | null = null;
    if (request.data?.includeClassCatalog === true) {
      await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId, 7);
      try {
        classCatalog = await buildClassCatalog(tenantId, startDate, endDate);
      } catch (err) {
        classCatalogError = err instanceof Error ? err.message : String(err);
      }
    }

    return {
      startDate,
      endDate,
      hiringEntityId: hiringEntityId || null,
      billing,
      billingError,
      evereeRegister,
      evereeRegisterError,
      wireJournal,
      wireJournalError,
      acaLookback,
      sickLeave,
      i9Status,
      i9StatusError,
      classCatalog,
      classCatalogError,
      cashRequirements,
      totals: {
        gross: grand,
        entries: rows.length,
        workers: new Set(rows.map((r) => r.workerId)).size,
        unattributed: round2(rows.filter((r) => !r.jobOrderId).reduce((s, r) => s + r.total, 0)),
      },
      truncated: picked.length > MAX_ROWS,
      byJobOrder,
      byAccount: byAccountOut,
      byBatch,
      rows,
      venueMappings: Array.from(venueMappings.values()).map((m) => ({
        venueLabel: m.venueLabel,
        jobOrderId: m.jobOrderId,
        jobOrderName: m.jobOrderName,
        jobOrderNumber: m.jobOrderNumber,
        accountName: m.accountName,
      })),
    };
  },
);

/* -------------------------------------------------------------------------
 * Workers' comp monthly report (WC-C, Greg 2026-08-05)
 * ------------------------------------------------------------------------- */

interface WcMatrixMaps {
  /** `${STATE}_${code}` → rate, entity-scoped rows winning over generic. */
  rateByStateCode: Map<string, number>;
  /** `${STATE}_${lowercased title}` → { code, rate }, entity-scoped first. */
  byStateTitle: Map<string, { code: string; rate: number }>;
  /**
   * `${STATE}` → { code, rate } — the state DEFAULT, from a row whose
   * jobTitles contain '*'. Fallback when an entry has no resolvable job
   * title (import rows without a paired assignment); a real title match
   * always wins over the default.
   */
  byStateDefault: Map<string, { code: string; rate: number }>;
}

/**
 * Matrix rows may carry an optional `hiringEntityId` scope (added 2026-08-05):
 * C1 Events reports WC to the carrier on its own rate schedule even though
 * contractor codes never go to Everee, so the same state+code can price
 * differently per entity. Entity-scoped rows win; generic rows are the
 * fallback. Rows scoped to a DIFFERENT entity are ignored. (Account-scoped
 * `modifierAccountId` rows are excluded here as before — they exist for JO
 * pricing, not entity reporting.)
 */
async function loadWcMatrixForEntity(tenantId: string, hiringEntityId: string): Promise<WcMatrixMaps> {
  const snap = await db.collection(`tenants/${tenantId}/workers_comp_rates`).get();
  const rateByStateCode = new Map<string, number>();
  const byStateTitle = new Map<string, { code: string; rate: number }>();
  const byStateDefault = new Map<string, { code: string; rate: number }>();
  const apply = (docData: Record<string, unknown>): void => {
    const st = trim(docData.state).toUpperCase();
    const code = trim(docData.code);
    const rate = num(docData.rate);
    if (!st || !code) return;
    rateByStateCode.set(`${st}_${code}`, rate);
    const titles = Array.isArray(docData.jobTitles) ? (docData.jobTitles as unknown[]) : [];
    for (const t of titles) {
      const title = trim(t);
      if (title === '*') {
        byStateDefault.set(st, { code, rate });
        continue;
      }
      const key = `${st}_${title.toLowerCase()}`;
      if (key !== `${st}_`) byStateTitle.set(key, { code, rate });
    }
  };
  // Two passes: generic first, then entity-scoped so scoped entries overwrite.
  const generic: Array<Record<string, unknown>> = [];
  const scoped: Array<Record<string, unknown>> = [];
  snap.forEach((d) => {
    const x = d.data();
    if (trim(x.modifierAccountId)) return;
    const scope = trim(x.hiringEntityId);
    if (!scope) generic.push(x);
    else if (scope === hiringEntityId) scoped.push(x);
  });
  generic.forEach(apply);
  scoped.forEach(apply);
  return { rateByStateCode, byStateTitle, byStateDefault };
}

/**
 * Gross pay totals by work state + WC class code for one entity and one
 * calendar month — the carrier's monthly payroll report, generated from HRX.
 *
 * Codes resolve per entry at READ time: entry.workersCompCode →
 * assignment.workersCompCode → matrix (state + assignment jobTitle). C1
 * Events contractors are classified this way even though their codes never
 * reach Everee — C1 reports and pays WC premium on contractors (Greg
 * 2026-08-05). Whatever still can't resolve is returned as `unresolved`
 * groups (state + job title) so the UI can offer an assign-code control;
 * assigning writes a matrix row and the next Generate self-heals.
 *
 * Gross math mirrors getPayrollCostReport; contractor entities pay all hours
 * flat (no auto-OT). Premium = gross × rate / 100 per bucket.
 */
export const getWorkersCompMonthlyReport = onCall(
  { region: 'us-central1', memory: '1GiB', timeoutSeconds: 300 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const hiringEntityId = trim(request.data?.hiringEntityId);
    const month = trim(request.data?.month); // YYYY-MM
    // Audit-package range mode (Greg 2026-08-19): startDate/endDate span a
    // POLICY PERIOD (multi-month) instead of one month. Same math, plus
    // OT-excess/tips/reimbursement breakouts and a by-month rollup.
    const rangeStart = trim(request.data?.startDate);
    const rangeEnd = trim(request.data?.endDate);
    const rangeMode = /^\d{4}-\d{2}-\d{2}$/.test(rangeStart) && /^\d{4}-\d{2}-\d{2}$/.test(rangeEnd);
    // Coverage-gap mode (Greg 2026-08-25): cross-entity "where are we missing
    // coverage" — no hiringEntityId; defaults to the trailing 90 days.
    const coverageMode = request.data?.coverage === true;
    if (!tenantId || (!coverageMode && !hiringEntityId) || (!coverageMode && !rangeMode && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) {
      throw new HttpsError('invalid-argument', 'tenantId, hiringEntityId, and month (YYYY-MM) or startDate+endDate are required.');
    }
    await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId);

    if (coverageMode) {
      const end = rangeMode ? rangeEnd : new Date().toISOString().slice(0, 10);
      const start = rangeMode
        ? rangeStart
        : new Date(Date.now() - 90 * 24 * 3600e3).toISOString().slice(0, 10);
      const days = (Date.parse(end) - Date.parse(start)) / 86400000;
      if (days < 0 || days > 400) {
        throw new HttpsError('invalid-argument', 'Coverage range must be 0-400 days.');
      }
      return buildWcCoverageReport({ tenantId, startDate: start, endDate: end });
    }

    let startDate: string;
    let endDate: string;
    if (rangeMode) {
      const days = (Date.parse(rangeEnd) - Date.parse(rangeStart)) / 86400000;
      if (days < 0 || days > 400) {
        throw new HttpsError('invalid-argument', 'Audit range must be 0-400 days.');
      }
      startDate = rangeStart;
      endDate = rangeEnd;
    } else {
      startDate = `${month}-01`;
      const [y, m] = month.split('-').map(Number);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      endDate = `${month}-${String(lastDay).padStart(2, '0')}`;
    }

    const entitySnap = await db.doc(`tenants/${tenantId}/entities/${hiringEntityId}`).get();
    const entityData = (entitySnap.data() ?? {}) as Record<string, unknown>;
    const entityName = trim(entityData.name) || hiringEntityId;
    const isContractor =
      trim(entityData.workerType).toLowerCase() === 'contractor' ||
      /events|workforce/i.test(hiringEntityId);

    const matrix = await loadWcMatrixForEntity(tenantId, hiringEntityId);

    const snap = await db
      .collection(`tenants/${tenantId}/timesheet_entries`)
      .where('workDate', '>=', startDate)
      .where('workDate', '<=', endDate)
      .get();

    // First pass: pick entries + collect assignment ids for batched fetch.
    interface PickedEntry {
      e: Record<string, unknown>;
      total: number;
      hours: number;
      state: string;
      /** Audit breakouts: OT excess = premium HALF of OT (0.5x) + premium
       *  DOUBLE of DT (1.0x) — the portion most carriers exclude from
       *  auditable payroll. Contractor entities pay flat → 0. */
      otExcess: number;
      tips: number;
      /** Untaxed per diem / expense reimbursements — NOT in `total`
       *  (never part of gross); reported so the auditor sees them. */
      reimbursements: number;
      month: string;
    }
    const pickedEntries: PickedEntry[] = [];
    const assignmentIds = new Set<string>();
    snap.forEach((d) => {
      const e = d.data();
      const status = trim(e.status);
      if (status !== 'sent_to_everee' && status !== 'submitted' && status !== 'paid') return;
      if (trim(e.hiringEntityId) !== hiringEntityId) return;
      const isImport = trim(e.source) === 'csv_import';
      const rate = num(e.payRate);
      const reg = num(e.totalRegularHours);
      const ot = num(e.totalOTHours);
      const dt = num(e.totalDoubleTimeHours);
      const premiums = isImport ? 0 : round2((num(e.mealBreakPenaltyHours) + num(e.restBreakPenaltyHours)) * rate);
      const hourly = isContractor
        ? round2((reg + ot + dt) * rate)
        : isImport
          ? round2(reg * rate + ot * rate * 1.5)
          : round2(reg * rate + ot * rate * 1.5 + dt * rate * 2);
      const total = round2(hourly + premiums + num(e.tips) + num(e.bonusAmount));
      if (total === 0) return;
      const otExcess = isContractor
        ? 0
        : isImport
          ? round2(ot * rate * 0.5)
          : round2(ot * rate * 0.5 + dt * rate * 1.0);
      const entryTips = round2(num(e.tips));
      const entryReimb = round2(num(e.reimbursementAmount));
      const sidecarAddr = ((e.import ?? {}) as Record<string, unknown>).worksiteAddress as
        | Record<string, unknown>
        | undefined;
      const state =
        trim(e.workState).toUpperCase() ||
        trim((e.worksiteAddress as Record<string, unknown> | undefined)?.state).toUpperCase() ||
        trim(sidecarAddr?.state).toUpperCase() ||
        '';
      pickedEntries.push({
        e,
        total,
        hours: round2(reg + ot + dt),
        state,
        otExcess,
        tips: entryTips,
        reimbursements: entryReimb,
        month: trim(e.workDate).slice(0, 7),
      });
      // ALL assignments (2026-08-09) — the coverage report needs venue names
      // even when the entry already carries a code; the code-resolution chain
      // is unchanged (entry stamp still wins before the assignment is read).
      const asnId = trim(e.assignmentId);
      if (asnId) assignmentIds.add(asnId);
    });

    // Batched assignment fetch for the resolution chain.
    const assignments = new Map<string, Record<string, unknown>>();
    const asnIdList = Array.from(assignmentIds);
    for (let i = 0; i < asnIdList.length; i += 100) {
      const chunk = asnIdList.slice(i, i + 100);
      const snaps = await db.getAll(...chunk.map((id) => db.doc(`tenants/${tenantId}/assignments/${id}`)));
      snaps.forEach((s) => {
        if (s.exists) assignments.set(s.id, s.data() as Record<string, unknown>);
      });
    }

    // Job orders — worksite-name fallback for the location coverage report.
    const jobOrderIds = new Set<string>();
    pickedEntries.forEach((p) => {
      const joId =
        trim(p.e.jobOrderId) || trim(assignments.get(trim(p.e.assignmentId))?.jobOrderId);
      if (joId) jobOrderIds.add(joId);
    });
    const joDocs = new Map<string, Record<string, unknown>>();
    const joIdList = Array.from(jobOrderIds);
    for (let i = 0; i < joIdList.length; i += 100) {
      const chunk = joIdList.slice(i, i + 100);
      const snaps = await db.getAll(...chunk.map((id) => db.doc(`tenants/${tenantId}/job_orders/${id}`)));
      snaps.forEach((s) => {
        if (s.exists) joDocs.set(s.id, s.data() as Record<string, unknown>);
      });
    }

    interface Bucket {
      state: string;
      code: string;
      gross: number;
      hours: number;
      entries: number;
      workers: Set<string>;
      otExcess: number;
      tips: number;
      reimbursements: number;
    }
    const buckets = new Map<string, Bucket>();
    /** Audit package: by-month rollup across the period. */
    const monthTotals = new Map<string, { gross: number; otExcess: number; tips: number; reimbursements: number; hours: number }>();
    interface UnresolvedGroup {
      state: string;
      jobTitle: string;
      gross: number;
      entries: number;
      workers: Set<string>;
    }
    const unresolvedGroups = new Map<string, UnresolvedGroup>();
    // Missing-classification report (Greg 2026-08-09): 8040 is the tenant's
    // placeholder class — payroll riding on it is unclassified in the
    // carrier's eyes even though the report "resolves". Grouped by state +
    // title + venue with HOW it resolved, so the fix target is obvious.
    interface PlaceholderGroup {
      state: string;
      jobTitle: string;
      venue: string;
      gross: number;
      hours: number;
      entries: number;
      workers: Set<string>;
      via: Set<string>;
    }
    const placeholderGroups = new Map<string, PlaceholderGroup>();
    // Location coverage report: every venue with payroll this month, with its
    // classification health — compared against the carrier policy's location
    // schedule via the persisted on-policy flags.
    interface LocationAgg {
      state: string;
      name: string;
      address: string;
      gross: number;
      hours: number;
      entries: number;
      workers: Set<string>;
      codes: Set<string>;
      placeholderGross: number;
      unresolvedGross: number;
    }
    const locationAggs = new Map<string, LocationAgg>();
    let totalGross = 0;
    let entryCount = 0;

    for (const p of pickedEntries) {
      const e = p.e;
      const state = p.state || '(no state)';
      // Resolution chain: entry stamp → assignment stamp → matrix by title →
      // per-state default ('*' title — set from the report's assign control
      // for import rows that carry no job title).
      let code = trim(e.workersCompCode);
      let codeVia = code ? 'entry stamp' : '';
      const a = assignments.get(trim(e.assignmentId));
      const jobTitle = trim(a?.jobTitle) || '(no title)';
      if (!code && a) {
        code = trim(a.workersCompCode);
        if (code) codeVia = 'assignment';
        if (!code && p.state) {
          const hit = matrix.byStateTitle.get(`${p.state}_${jobTitle.toLowerCase()}`);
          if (hit) {
            code = hit.code;
            codeVia = 'title match';
          }
        }
      }
      if (!code && p.state) {
        const def = matrix.byStateDefault.get(p.state);
        if (def) {
          code = def.code;
          codeVia = 'state default';
        }
      }

      totalGross = round2(totalGross + p.total);
      entryCount += 1;
      const workerId = trim(e.workerId);
      const mt = monthTotals.get(p.month) ?? { gross: 0, otExcess: 0, tips: 0, reimbursements: 0, hours: 0 };
      mt.gross = round2(mt.gross + p.total);
      mt.otExcess = round2(mt.otExcess + p.otExcess);
      mt.tips = round2(mt.tips + p.tips);
      mt.reimbursements = round2(mt.reimbursements + p.reimbursements);
      mt.hours = round2(mt.hours + p.hours);
      monthTotals.set(p.month, mt);

      // Venue identity — same fallback order as the payroll cost report.
      const sidecar = (e.import ?? {}) as Record<string, unknown>;
      const jo = joDocs.get(trim(e.jobOrderId) || trim(a?.jobOrderId));
      const venueName =
        trim(a?.worksiteName) ||
        trim(jo?.worksiteName) ||
        trim(sidecar.worksiteName) ||
        trim(sidecar.csvSite) ||
        trim(e.worksiteName) ||
        '(no venue)';
      const addrSrc = (a?.worksiteAddress ?? jo?.worksiteAddress ?? sidecar.worksiteAddress ?? e.worksiteAddress ?? {}) as Record<string, unknown>;
      const address = [trim(addrSrc.street), trim(addrSrc.city)].filter(Boolean).join(', ');
      const locKey = `${state}|${normalizeVenueKey(venueName)}`;
      if (!locationAggs.has(locKey)) {
        locationAggs.set(locKey, {
          state,
          name: venueName,
          address,
          gross: 0,
          hours: 0,
          entries: 0,
          workers: new Set(),
          codes: new Set(),
          placeholderGross: 0,
          unresolvedGross: 0,
        });
      }
      const loc = locationAggs.get(locKey)!;
      loc.gross = round2(loc.gross + p.total);
      loc.hours = round2(loc.hours + p.hours);
      loc.entries += 1;
      if (workerId) loc.workers.add(workerId);
      if (!loc.address && address) loc.address = address;
      if (!code) loc.unresolvedGross = round2(loc.unresolvedGross + p.total);
      else {
        loc.codes.add(code);
        if (code === '8040') loc.placeholderGross = round2(loc.placeholderGross + p.total);
      }

      if (code === '8040') {
        const pKey = `${state}|${jobTitle}|${normalizeVenueKey(venueName)}`;
        if (!placeholderGroups.has(pKey)) {
          placeholderGroups.set(pKey, {
            state,
            jobTitle,
            venue: venueName,
            gross: 0,
            hours: 0,
            entries: 0,
            workers: new Set(),
            via: new Set(),
          });
        }
        const pg = placeholderGroups.get(pKey)!;
        pg.gross = round2(pg.gross + p.total);
        pg.hours = round2(pg.hours + p.hours);
        pg.entries += 1;
        if (workerId) pg.workers.add(workerId);
        if (codeVia) pg.via.add(codeVia);
      }

      if (!code || state === '(no state)') {
        const uKey = `${state}|${jobTitle}`;
        if (!unresolvedGroups.has(uKey)) {
          unresolvedGroups.set(uKey, { state, jobTitle, gross: 0, entries: 0, workers: new Set() });
        }
        const u = unresolvedGroups.get(uKey)!;
        u.gross = round2(u.gross + p.total);
        u.entries += 1;
        if (workerId) u.workers.add(workerId);
        continue;
      }

      const key = `${state}_${code}`;
      if (!buckets.has(key)) {
        buckets.set(key, { state, code, gross: 0, hours: 0, entries: 0, workers: new Set(), otExcess: 0, tips: 0, reimbursements: 0 });
      }
      const b = buckets.get(key)!;
      b.gross = round2(b.gross + p.total);
      b.hours = round2(b.hours + p.hours);
      b.entries += 1;
      b.otExcess = round2(b.otExcess + p.otExcess);
      b.tips = round2(b.tips + p.tips);
      b.reimbursements = round2(b.reimbursements + p.reimbursements);
      if (workerId) b.workers.add(workerId);
    }

    // Off-cycle payments (no WC classification) — separate visible section.
    const ocSnap = await db
      .collection(`tenants/${tenantId}/offcycle_payments`)
      .where('workDate', '>=', startDate)
      .where('workDate', '<=', endDate)
      .get();
    const offCycle: Array<Record<string, unknown>> = [];
    let offCycleTotal = 0;
    ocSnap.forEach((d) => {
      const p = d.data();
      if (trim(p.hiringEntityId) !== hiringEntityId) return;
      if (trim(p.status) !== 'sent_to_everee' && trim(p.status) !== 'paid') return;
      const total = num(p.total);
      offCycleTotal = round2(offCycleTotal + total);
      offCycle.push({
        workDate: trim(p.workDate),
        workerName: trim(p.workerName),
        reasonLabel: trim(p.reasonLabel),
        total,
      });
    });

    let totalPremium = 0;
    let totalPremiumAuditable = 0;
    const rows = Array.from(buckets.values())
      .map((b) => {
        const rate = matrix.rateByStateCode.get(`${b.state}_${b.code}`) ?? null;
        const premium = rate != null ? round2((b.gross * rate) / 100) : null;
        if (premium != null) totalPremium = round2(totalPremium + premium);
        // Auditable payroll = gross minus OT excess minus tips — the
        // remuneration basis most carriers use at audit. Reimbursements
        // are already outside gross; reported alongside for the auditor.
        const auditable = round2(b.gross - b.otExcess - b.tips);
        const premiumAuditable = rate != null ? round2((auditable * rate) / 100) : null;
        if (premiumAuditable != null) totalPremiumAuditable = round2(totalPremiumAuditable + premiumAuditable);
        return {
          state: b.state,
          code: b.code,
          rate,
          gross: b.gross,
          hours: b.hours,
          entries: b.entries,
          workers: b.workers.size,
          premium,
          otExcess: b.otExcess,
          tips: b.tips,
          reimbursements: b.reimbursements,
          auditable,
          premiumAuditable,
        };
      })
      .sort((a, b) => a.state.localeCompare(b.state) || a.code.localeCompare(b.code));

    const unresolved = Array.from(unresolvedGroups.values())
      .map((u) => ({
        state: u.state,
        jobTitle: u.jobTitle,
        gross: u.gross,
        entries: u.entries,
        workers: u.workers.size,
      }))
      .sort((a, b) => b.gross - a.gross);

    // Carrier-policy location flags (Greg 2026-08-09): the policy's location
    // schedule lives on paper at InSource — Greg marks each venue on/off
    // policy ONCE from the report and the flag persists, so every later month
    // computes state coverage ("2 of 5 locations on policy") automatically.
    const policySnap = await db
      .collection(`tenants/${tenantId}/workers_comp_policy_locations`)
      .where('hiringEntityId', '==', hiringEntityId)
      .get();
    const onPolicyByKey = new Map<string, boolean>();
    policySnap.forEach((d) => {
      const v = d.data() as Record<string, unknown>;
      onPolicyByKey.set(`${trim(v.state).toUpperCase()}|${trim(v.venueKey)}`, v.onPolicy === true);
    });

    const locations = Array.from(locationAggs.entries())
      .map(([key, l]) => ({
        state: l.state,
        name: l.name,
        address: l.address || null,
        gross: l.gross,
        hours: l.hours,
        entries: l.entries,
        workers: l.workers.size,
        codes: Array.from(l.codes).sort(),
        placeholderGross: l.placeholderGross,
        unresolvedGross: l.unresolvedGross,
        /** true/false = reviewed against the policy schedule; null = never marked. */
        onPolicy: onPolicyByKey.has(key) ? onPolicyByKey.get(key)! : null,
      }))
      .sort((a, b) => a.state.localeCompare(b.state) || b.gross - a.gross);

    const placeholders = Array.from(placeholderGroups.values())
      .map((g) => ({
        state: g.state,
        jobTitle: g.jobTitle,
        venue: g.venue,
        gross: g.gross,
        hours: g.hours,
        entries: g.entries,
        workers: g.workers.size,
        via: Array.from(g.via).sort().join(', '),
      }))
      .sort((a, b) => b.gross - a.gross);
    const placeholderGross = round2(placeholders.reduce((s, g) => s + g.gross, 0));

    // Available codes per state for the assign dropdown — same options the
    // timesheets WC dialog shows: this entity's rated matrix codes, labeled
    // with the catalog title. Keyed by the states that actually need codes.
    const catalogSnap = await db.collection(`tenants/${tenantId}/workers_comp_class_codes`).get();
    const catalogTitle = new Map<string, string>();
    catalogSnap.forEach((d) => {
      const code = trim(d.data().code);
      if (code && !catalogTitle.has(code)) catalogTitle.set(code, trim(d.data().title));
    });
    // Every state in the report gets options — resolved rows are re-codeable
    // (click the code → pick the right one; rate follows the matrix), not
    // just the unresolved groups.
    const reportStates = new Set([
      ...unresolved.map((u) => u.state),
      ...rows.map((r) => r.state),
    ]);
    reportStates.delete('(no state)');
    const stateCodeOptions: Record<string, Array<{ code: string; rate: number; title: string | null }>> = {};
    for (const [key, rate] of matrix.rateByStateCode) {
      const sep = key.indexOf('_');
      const st = key.slice(0, sep);
      const code = key.slice(sep + 1);
      if (!reportStates.has(st)) continue;
      if (!stateCodeOptions[st]) stateCodeOptions[st] = [];
      stateCodeOptions[st].push({ code, rate, title: catalogTitle.get(code) ?? null });
    }
    // The 8040 placeholder (tenant convention, 2.35) is always offerable even
    // in a state whose matrix lacks the row yet.
    for (const st of reportStates) {
      if (!stateCodeOptions[st]) stateCodeOptions[st] = [];
      if (!stateCodeOptions[st].some((o) => o.code === '8040')) {
        stateCodeOptions[st].push({ code: '8040', rate: 2.35, title: 'Placeholder' });
      }
      stateCodeOptions[st].sort((a, b) => a.code.localeCompare(b.code));
    }

    const byMonth = Array.from(monthTotals.entries())
      .map(([m, t]) => ({ month: m, ...t, auditable: round2(t.gross - t.otExcess - t.tips) }))
      .sort((a, b) => a.month.localeCompare(b.month));
    const totalOtExcess = round2(rows.reduce((s, r) => s + r.otExcess, 0));
    const totalTips = round2(rows.reduce((s, r) => s + r.tips, 0));
    const totalReimbursements = round2(rows.reduce((s, r) => s + r.reimbursements, 0));

    return {
      month: rangeMode ? null : month,
      rangeMode,
      startDate,
      endDate,
      hiringEntityId,
      entityName,
      workerType: isContractor ? 'contractor' : 'employee',
      byMonth,
      totalOtExcess,
      totalTips,
      totalReimbursements,
      totalAuditable: round2(totalGross - totalOtExcess - totalTips),
      totalPremiumAuditable,
      rows,
      unresolved,
      unresolvedGross: round2(unresolved.reduce((s, u) => s + u.gross, 0)),
      placeholders,
      placeholderGross,
      locations,
      stateCodeOptions,
      totalGross,
      totalPremium,
      entryCount,
      offCycle,
      offCycleTotal,
      grandTotal: round2(totalGross + offCycleTotal),
    };
  },
);

/**
 * Upsert one WC matrix row from the report's assign-code control. Optional
 * `hiringEntityId` writes an entity-scoped row (`STATE_CODE__e__ENTITY`) that
 * wins over the generic row for that entity's reports; omitted → generic row
 * (`STATE_CODE`). `jobTitles` merge (learn-once) so title-based resolution
 * self-heals next month. Books-gated like the reports it feeds.
 */
export const upsertWorkersCompRate = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 30 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const hiringEntityId = trim(request.data?.hiringEntityId);
    const state = trim(request.data?.state).toUpperCase();
    const code = trim(request.data?.code);
    const rate = num(request.data?.rate);
    const jobTitles = Array.isArray(request.data?.jobTitles)
      ? (request.data.jobTitles as unknown[]).map((t) => trim(t)).filter(Boolean).slice(0, 20)
      : [];
    if (!tenantId || !/^[A-Z]{2}$/.test(state) || !/^\d{3,4}$/.test(code) || !(rate >= 0) || rate > 100) {
      throw new HttpsError('invalid-argument', 'tenantId, state (XX), code (3-4 digits), rate (0-100) are required.');
    }
    await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId);

    const docId = hiringEntityId ? `${state}_${code}__e__${hiringEntityId}` : `${state}_${code}`;
    const ref = db.doc(`tenants/${tenantId}/workers_comp_rates/${docId}`);
    const existing = await ref.get();
    const priorTitles = Array.isArray(existing.data()?.jobTitles)
      ? (existing.data()!.jobTitles as unknown[]).map((t) => trim(t))
      : [];
    const mergedTitles = Array.from(new Set([...priorTitles, ...jobTitles])).filter(Boolean);
    await ref.set(
      {
        state,
        code,
        rate,
        jobTitles: mergedTitles,
        ...(hiringEntityId ? { hiringEntityId } : {}),
        source: 'wc_report_assign',
        updatedBy: request.auth?.uid ?? null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Connect the code to the DATA, not just the matrix (Greg 2026-08-05):
    // stamp every uncoded assignment in this state (same entity + same job
    // title when one was learned) so the assignment chain — timesheets grid,
    // imports, payroll export — resolves without the report's read-time
    // fallback. FUTURE assignments self-classify via the matrix row written
    // above (the assignment-creation denorm resolver looks up state+title).
    // With `propagateMonth`, that month's uncoded entries get stamped too.
    //
    // `reclassifyFromCode` (Greg 2026-08-05, code-first editing): move the
    // state's assignments/entries OFF a wrong or unrated code onto this one
    // (e.g. NC 9014 → NC 8044, matching how the carrier actually bills), and
    // relearn the moved assignments' job titles onto the new matrix row so
    // future work classifies to the corrected code.
    const propagateMonth = trim(request.data?.propagateMonth); // YYYY-MM, optional
    const reclassifyFromCode = trim(request.data?.reclassifyFromCode); // optional old code
    const realTitles = jobTitles.filter((t) => t !== '*').map((t) => t.toLowerCase());
    let assignmentsStamped = 0;
    let entriesStamped = 0;
    const stampedAssignmentIds = new Set<string>();
    const movedTitles = new Set<string>();
    const asnSnap = await db
      .collection(`tenants/${tenantId}/assignments`)
      .where('worksiteState', '==', state)
      .get();
    let batch = db.batch();
    let batchN = 0;
    const flush = async (): Promise<void> => {
      if (batchN > 0) {
        await batch.commit();
        batch = db.batch();
        batchN = 0;
      }
    };
    for (const d of asnSnap.docs) {
      const a = d.data();
      if (hiringEntityId && trim(a.hiringEntityId) && trim(a.hiringEntityId) !== hiringEntityId) continue;
      const currentCode = trim(a.workersCompCode);
      const title = trim(a.jobTitle).toLowerCase();
      let matches: boolean;
      if (reclassifyFromCode) {
        matches = currentCode === reclassifyFromCode;
      } else {
        if (currentCode) continue;
        // Real-title assigns stamp matching titles; a state-default ('*')
        // assign stamps only title-less assignments — titled ones should get
        // their own explicit code.
        matches = realTitles.length > 0 ? realTitles.includes(title) : !title;
      }
      if (!matches) continue;
      batch.update(d.ref, {
        workersCompCode: code,
        workersCompRate: rate,
        workersCompSource: 'wc_report_assign',
      });
      stampedAssignmentIds.add(d.id);
      if (title) movedTitles.add(trim(a.jobTitle));
      assignmentsStamped += 1;
      batchN += 1;
      if (batchN >= 400) await flush();
    }
    await flush();

    // Relearn moved titles onto the new code's matrix row (entity-scoped rows
    // apply after generic, so these mappings win for this entity).
    if (reclassifyFromCode && movedTitles.size > 0) {
      const learned = Array.from(new Set([...mergedTitles, ...movedTitles])).filter(Boolean);
      await ref.set({ jobTitles: learned }, { merge: true });
    }

    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(propagateMonth)) {
      const pStart = `${propagateMonth}-01`;
      const [py, pm] = propagateMonth.split('-').map(Number);
      const pEnd = `${propagateMonth}-${String(new Date(Date.UTC(py, pm, 0)).getUTCDate()).padStart(2, '0')}`;
      const eSnap = await db
        .collection(`tenants/${tenantId}/timesheet_entries`)
        .where('workDate', '>=', pStart)
        .where('workDate', '<=', pEnd)
        .get();
      for (const d of eSnap.docs) {
        const e = d.data();
        if (trim(e.workersCompCode)) continue;
        if (hiringEntityId && trim(e.hiringEntityId) !== hiringEntityId) continue;
        const sidecarAddr = ((e.import ?? {}) as Record<string, unknown>).worksiteAddress as
          | Record<string, unknown>
          | undefined;
        const eState =
          trim(e.workState).toUpperCase() ||
          trim((e.worksiteAddress as Record<string, unknown> | undefined)?.state).toUpperCase() ||
          trim(sidecarAddr?.state).toUpperCase();
        if (eState !== state) continue;
        const asnId = trim(e.assignmentId);
        // Reclassify moves entries carrying the old code; plain assigns stamp
        // uncoded entries (real-title: via the stamped assignments;
        // state-default: assignment-less ones too).
        const matches = reclassifyFromCode
          ? trim(e.workersCompCode) === reclassifyFromCode || stampedAssignmentIds.has(asnId)
          : realTitles.length > 0
            ? stampedAssignmentIds.has(asnId)
            : !asnId || stampedAssignmentIds.has(asnId);
        if (!matches) continue;
        batch.update(d.ref, {
          workersCompCode: code,
          workersCompRate: rate,
          workersCompSource: 'wc_report_assign',
        });
        entriesStamped += 1;
        batchN += 1;
        if (batchN >= 400) await flush();
      }
      await flush();
    }

    return { docId, state, code, rate, jobTitles: mergedTitles, assignmentsStamped, entriesStamped };
  },
);

/* -------------------------------------------------------------------------
 * Complete venue mapping — assignments as the point of truth (Greg 2026-08-05)
 * ------------------------------------------------------------------------- */

/**
 * The venue→JO label mapping alone is a READ-TIME patch: dollars report under
 * the JO but no assignments exist, so WC, rates, and future imports stay
 * hollow. This callable does the real repair: map the label AND materialize
 * an assignment per worker from the paid entries — position, pay rate (their
 * actual paid rate by default), JO/account/worksite — then stamp the entries
 * with assignmentId + attribution + WC. The assignment-write denorm trigger
 * fills worksite address/state; future imports pair to these assignments via
 * the normal date-window matcher, so the hole never reopens.
 *
 * Created assignments carry `retroactive: true` + `notificationsSuppressed:
 * true` (the existing contract every worker-facing notification trigger
 * honors) — no SMS/push to the 79 workers.
 */
/**
 * Mark one venue on/off the carrier policy's location schedule (per entity).
 * The schedule itself lives on paper — this flag is HRX's durable memory of
 * Greg's reconciliation, read back by the WC monthly report's location
 * coverage section. Doc id is entity + state + normalized venue so the same
 * venue name in two states stays distinct.
 */
export const setWorkersCompPolicyLocation = onCall(
  { region: 'us-central1', memory: '512MiB' },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const hiringEntityId = trim(request.data?.hiringEntityId);
    const state = trim(request.data?.state).toUpperCase();
    const name = trim(request.data?.name);
    const onPolicy = request.data?.onPolicy === true;
    if (!tenantId || !hiringEntityId || !state || !name) {
      throw new HttpsError('invalid-argument', 'tenantId, hiringEntityId, state, name are required.');
    }
    await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId);
    const venueKey = normalizeVenueKey(name);
    const docId = `${hiringEntityId}__${state}__${venueMappingDocId(name)}`;
    await db.doc(`tenants/${tenantId}/workers_comp_policy_locations/${docId}`).set(
      {
        tenantId,
        hiringEntityId,
        state,
        name,
        venueKey,
        onPolicy,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: request.auth?.uid ?? null,
      },
      { merge: true },
    );
    return { ok: true, onPolicy };
  },
);

export const completeVenueMapping = onCall(
  { region: 'us-central1', memory: '1GiB', timeoutSeconds: 300 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const venueLabel = trim(request.data?.venueLabel);
    const jobOrderId = trim(request.data?.jobOrderId);
    const positionTitle = trim(request.data?.positionTitle);
    const rateMode = trim(request.data?.rateMode) === 'fixed' ? 'fixed' : 'actual';
    const fixedRate = num(request.data?.fixedRate);
    const sinceDate = /^\d{4}-\d{2}-\d{2}$/.test(trim(request.data?.sinceDate))
      ? trim(request.data?.sinceDate)
      : '2026-06-01';
    const dryRun = request.data?.dryRun !== false;
    if (!tenantId || !venueLabel || !jobOrderId) {
      throw new HttpsError('invalid-argument', 'tenantId, venueLabel, jobOrderId are required.');
    }
    if (rateMode === 'fixed' && !(fixedRate > 0)) {
      throw new HttpsError('invalid-argument', 'fixedRate must be > 0 when rateMode is fixed.');
    }
    await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId);

    // Job order + account + anchor shift.
    let jo: Record<string, unknown> | null = null;
    let joColl = 'job_orders';
    for (const coll of ['job_orders', 'jobOrders', 'recruiter_jobOrders']) {
      const s = await db.doc(`tenants/${tenantId}/${coll}/${jobOrderId}`).get();
      if (s.exists) {
        jo = s.data() as Record<string, unknown>;
        joColl = coll;
        break;
      }
    }
    if (!jo) throw new HttpsError('not-found', `Job order ${jobOrderId} not found.`);
    const accountId = trim(jo.recruiterAccountId) || null;
    let accountName: string | null = trim(jo.accountName) || null;
    if (accountId && !accountName) {
      const acct = await db.doc(`tenants/${tenantId}/accounts/${accountId}`).get();
      accountName = acct.exists ? trim(acct.data()?.name) || null : null;
    }
    const joEntityId = trim(jo.hiringEntityId);
    const joStatus = trim(jo.status).toLowerCase();
    const ongoing = ['open', 'active', 'in_progress', 'filled'].includes(joStatus);
    const jobTitle = positionTitle || trim(jo.jobTitle) || '';

    const shiftsSnap = await db.collection(`tenants/${tenantId}/${joColl}/${jobOrderId}/shifts`).get();
    let anchorShiftId = '';
    let anchorShift: Record<string, unknown> | null = null;
    for (const d of shiftsSnap.docs) {
      const s = d.data();
      if (trim(s.shiftType) === 'open') {
        anchorShiftId = d.id;
        anchorShift = s;
        break;
      }
    }
    if (!anchorShiftId && shiftsSnap.docs.length > 0) {
      anchorShiftId = shiftsSnap.docs[0].id;
      anchorShift = shiftsSnap.docs[0].data();
    }
    // No shifts at all: a surrogate keeps the id convention without pointing
    // at a nonexistent shift doc (grid ignores it; pairing works by userId).
    const assignmentPrefix = anchorShiftId || `jo_${jobOrderId}`;

    // Entries carrying this venue label with no assignment/JO attribution.
    const wantedKey = normalizeVenueKey(venueLabel);
    const entriesSnap = await db
      .collection(`tenants/${tenantId}/timesheet_entries`)
      .where('workDate', '>=', sinceDate)
      .get();
    interface WorkerGroup {
      userId: string;
      entryIds: string[];
      minDate: string;
      maxDate: string;
      rates: Map<number, number>; // rate -> entry count
      entityIds: Set<string>;
      states: Set<string>;
    }
    const groups = new Map<string, WorkerGroup>();
    entriesSnap.forEach((d) => {
      const e = d.data();
      if (trim(e.assignmentId) || trim(e.jobOrderId)) return;
      const importSidecar = (e.import ?? {}) as Record<string, unknown>;
      const label =
        trim(e.worksiteName) || trim(importSidecar.worksiteName) || trim(importSidecar.csvSite);
      if (!label || normalizeVenueKey(label) !== wantedKey) return;
      const userId = trim(e.workerId);
      if (!userId) return;
      const workDate = trim(e.workDate);
      if (!groups.has(userId)) {
        groups.set(userId, {
          userId,
          entryIds: [],
          minDate: workDate,
          maxDate: workDate,
          rates: new Map(),
          entityIds: new Set(),
          states: new Set(),
        });
      }
      const g = groups.get(userId)!;
      g.entryIds.push(d.id);
      if (workDate < g.minDate) g.minDate = workDate;
      if (workDate > g.maxDate) g.maxDate = workDate;
      const r = num(e.payRate);
      if (r > 0) g.rates.set(r, (g.rates.get(r) ?? 0) + 1);
      if (trim(e.hiringEntityId)) g.entityIds.add(trim(e.hiringEntityId));
      const sidecarAddr = (importSidecar.worksiteAddress ?? {}) as Record<string, unknown>;
      const st =
        trim(e.workState).toUpperCase() ||
        trim((e.worksiteAddress as Record<string, unknown> | undefined)?.state).toUpperCase() ||
        trim(sidecarAddr.state).toUpperCase();
      if (st) g.states.add(st);
    });

    const workers = Array.from(groups.values());
    const totalEntries = workers.reduce((s, g) => s + g.entryIds.length, 0);
    const dominantEntity =
      joEntityId ||
      Array.from(
        workers.reduce((m, g) => {
          g.entityIds.forEach((id) => m.set(id, (m.get(id) ?? 0) + 1));
          return m;
        }, new Map<string, number>()),
      ).sort((a, b) => b[1] - a[1])[0]?.[0] ||
      '';

    // WC via the same chain the report uses (title -> state default).
    const matrix = dominantEntity ? await loadWcMatrixForEntity(tenantId, dominantEntity) : null;
    const wcFor = (state: string): { code: string; rate: number } | null => {
      if (!matrix || !state) return null;
      if (jobTitle) {
        const t = matrix.byStateTitle.get(`${state}_${jobTitle.toLowerCase()}`);
        if (t) return t;
      }
      return matrix.byStateDefault.get(state) ?? null;
    };

    // Worker names for preview + assignment docs.
    const userDocs = new Map<string, Record<string, unknown>>();
    const ids = workers.map((g) => g.userId);
    for (let i = 0; i < ids.length; i += 100) {
      const snaps = await db.getAll(...ids.slice(i, i + 100).map((id) => db.doc(`users/${id}`)));
      snaps.forEach((s) => {
        if (s.exists) userDocs.set(s.id, s.data() as Record<string, unknown>);
      });
    }

    const preview = {
      venueLabel,
      jobOrderId,
      jobOrderName: trim(jo.jobOrderName) || null,
      accountName,
      jobTitle,
      rateMode,
      ongoing,
      anchorShiftId: assignmentPrefix,
      hiringEntityId: dominantEntity || null,
      workers: workers.length,
      entries: totalEntries,
      dateSpan: workers.length
        ? `${workers.reduce((m, g) => (g.minDate < m ? g.minDate : m), workers[0].minDate)} → ${workers.reduce((m, g) => (g.maxDate > m ? g.maxDate : m), workers[0].maxDate)}`
        : null,
      rateSummary: Array.from(
        workers.reduce((m, g) => {
          g.rates.forEach((n, r) => m.set(r, (m.get(r) ?? 0) + n));
          return m;
        }, new Map<number, number>()),
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([r, n]) => `$${r} × ${n}`),
      sample: workers.slice(0, 8).map((g) => {
        const u = userDocs.get(g.userId);
        return {
          name: `${trim(u?.firstName)} ${trim(u?.lastName)}`.trim() || g.userId,
          entries: g.entryIds.length,
          span: `${g.minDate} → ${g.maxDate}`,
        };
      }),
    };
    if (dryRun) return { dryRun: true, ...preview };

    // 1) The label mapping (read-time attribution for anything not stamped).
    await db.doc(`tenants/${tenantId}/payroll_venue_mappings/${venueMappingDocId(venueLabel)}`).set({
      venueLabel,
      venueKey: wantedKey,
      jobOrderId,
      jobOrderName: trim(jo.jobOrderName) || null,
      jobOrderNumber: trim(jo.jobOrderNumber) || null,
      poNumber: trim(jo.poNumber) || null,
      accountId,
      accountName,
      updatedByUid: request.auth?.uid ?? null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 2) Assignments + entry stamps.
    let assignmentsCreated = 0;
    let assignmentsReused = 0;
    let entriesStamped = 0;
    for (const g of workers) {
      const u = userDocs.get(g.userId) ?? {};
      const assignmentId = `${assignmentPrefix}__${g.userId}`;
      const aRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
      const existing = await aRef.get();
      // Most common actual rate; ties break to the highest (worker-favorable).
      const actualRate =
        Array.from(g.rates.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
      const payRate = rateMode === 'fixed' ? fixedRate : actualRate;
      const state = g.states.size === 1 ? Array.from(g.states)[0] : Array.from(g.states)[0] ?? '';
      const wc = wcFor(state);
      if (!existing.exists) {
        await aRef.set({
          tenantId,
          jobOrderId,
          shiftId: anchorShiftId || null,
          candidateId: g.userId,
          userId: g.userId,
          status: ongoing ? 'active' : 'ended',
          startDate: g.minDate,
          endDate: ongoing ? '' : g.maxDate,
          startTime: trim(anchorShift?.startTime) || '',
          endTime: trim(anchorShift?.endTime) || '',
          payRate,
          billRate: num(jo.billRate) || 0,
          timesheetMode: trim(jo.timesheetMode) || 'import',
          firstName: trim(u.firstName),
          lastName: trim(u.lastName),
          email: trim(u.email),
          phone: trim(u.phone) || trim(u.phoneE164),
          companyId: trim(jo.companyId) || '',
          companyName: trim(jo.companyName) || accountName || '',
          accountId: accountId || null,
          accountName: accountName || null,
          hiringEntityId: dominantEntity || null,
          worksiteName: trim(jo.worksiteName) || venueLabel,
          jobOrderType: trim(jo.jobType) || 'gig',
          jobTitle,
          assignmentSource: 'venue_mapping_backfill',
          placementMode: 'retro_backfill',
          retroactive: true,
          notificationsSuppressed: true,
          suppressInitialNotification: true,
          ...(wc ? { workersCompCode: wc.code, workersCompRate: wc.rate, workersCompSource: 'venue_mapping_backfill' } : {}),
          createdBy: request.auth?.uid ?? null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        assignmentsCreated += 1;
      } else {
        assignmentsReused += 1;
      }
      // Stamp the worker's entries.
      for (let i = 0; i < g.entryIds.length; i += 400) {
        const batch = db.batch();
        for (const entryId of g.entryIds.slice(i, i + 400)) {
          const patch: Record<string, unknown> = {
            assignmentId,
            jobOrderId,
            ...(accountId ? { accountId } : {}),
            ...(accountName ? { accountName } : {}),
          };
          if (wc) {
            patch.workersCompCode = wc.code;
            patch.workersCompRate = wc.rate;
            patch.workersCompSource = 'venue_mapping_backfill';
          }
          batch.update(db.doc(`tenants/${tenantId}/timesheet_entries/${entryId}`), patch);
        }
        await batch.commit();
        entriesStamped += g.entryIds.length > 400 ? 400 : g.entryIds.length;
      }
    }

    return { dryRun: false, ...preview, assignmentsCreated, assignmentsReused, entriesStamped };
  },
);

/**
 * Import-tab companion to completeVenueMapping (phase 2 of the
 * assignment-as-truth directive): rows that matched a WORKER and resolved a
 * JOB ORDER (via site mapping) but paired to NO assignment get real
 * assignments created BEFORE submit — so rate/worksite/WC resolve through
 * the normal chain and month-end unattributed payroll trends to zero.
 * The client re-runs the matcher afterwards; the new assignments pair via
 * the standard date-window matcher.
 *
 * Assignment shape mirrors completeVenueMapping's retro docs (retroactive +
 * notificationsSuppressed — no worker-facing notifications, no onboarding).
 * Gate matches the import flow: tenant securityLevel 5–7 (or hrx).
 */
export const createImportAssignments = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const hiringEntityId = trim(request.data?.hiringEntityId);
    const groupsIn = Array.isArray(request.data?.groups) ? (request.data.groups as Array<Record<string, unknown>>) : [];
    // When true, each worker's saved csv_import entries on the covered dates
    // are stamped with the assignment (id/JO/account/worksite/WC/entity) in
    // the SAME call — one bulk fix instead of a re-resolve per row (Greg
    // 2026-08-05, ~200-row Lollapalooza cohorts). Live rows never touched.
    const stampEntries = request.data?.stampEntries === true;
    if (!tenantId || groupsIn.length === 0) {
      throw new HttpsError('invalid-argument', 'tenantId and groups are required.');
    }
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
    const token = request.auth?.token as Record<string, unknown> | undefined;
    if (token?.hrx !== true) {
      const userSnap = await db.collection('users').doc(uid).get();
      const data = (userSnap.data() || {}) as Record<string, any>;
      const nested = data.tenantIds?.[tenantId]?.securityLevel;
      const level = Number.parseInt(String(nested ?? data.securityLevel ?? '0'), 10) || 0;
      if (!(level >= 5 && level <= 7)) {
        throw new HttpsError('permission-denied', 'Creating assignments requires tenant security level 5–7.');
      }
    }

    const results: Array<{ jobOrderId: string; userId: string; assignmentId: string; created: boolean }> = [];
    let stamped = 0;
    for (const groupRaw of groupsIn.slice(0, 20)) {
      const jobOrderId = trim(groupRaw.jobOrderId);
      const workersIn = Array.isArray(groupRaw.workers) ? (groupRaw.workers as Array<Record<string, unknown>>) : [];
      if (!jobOrderId || workersIn.length === 0) continue;

      // JO context (same resolution as completeVenueMapping).
      let jo: Record<string, unknown> | null = null;
      let joColl = 'job_orders';
      for (const coll of ['job_orders', 'jobOrders', 'recruiter_jobOrders']) {
        const s = await db.doc(`tenants/${tenantId}/${coll}/${jobOrderId}`).get();
        if (s.exists) {
          jo = s.data() as Record<string, unknown>;
          joColl = coll;
          break;
        }
      }
      if (!jo) continue;
      const accountId = trim(jo.recruiterAccountId) || null;
      let accountName: string | null = trim(jo.accountName) || null;
      if (accountId && !accountName) {
        const acct = await db.doc(`tenants/${tenantId}/accounts/${accountId}`).get();
        accountName = acct.exists ? trim(acct.data()?.name) || null : null;
      }
      const joEntityId = trim(jo.hiringEntityId) || hiringEntityId;
      const ongoing = ['open', 'active', 'in_progress', 'filled'].includes(trim(jo.status).toLowerCase());
      const shiftsSnap = await db.collection(`tenants/${tenantId}/${joColl}/${jobOrderId}/shifts`).get();
      let anchorShiftId = '';
      for (const d of shiftsSnap.docs) {
        if (trim(d.data().shiftType) === 'open') {
          anchorShiftId = d.id;
          break;
        }
      }
      if (!anchorShiftId && shiftsSnap.docs.length > 0) anchorShiftId = shiftsSnap.docs[0].id;
      const assignmentPrefix = anchorShiftId || `jo_${jobOrderId}`;
      const matrix = joEntityId ? await loadWcMatrixForEntity(tenantId, joEntityId) : null;
      // Worksite flows from the JO — the whole point of the fix-assignment
      // card is "link the job order, everything else derives" (Greg 2026-08-05).
      const joWorksiteAddress =
        jo.worksiteAddress && typeof jo.worksiteAddress === 'object'
          ? (jo.worksiteAddress as Record<string, unknown>)
          : null;
      const joState = trim(joWorksiteAddress?.state).toUpperCase();

      // 1099-ness drives the lifecycle recompute when stamping entries.
      let is1099 = false;
      if (stampEntries && joEntityId) {
        const entSnap = await db.doc(`tenants/${tenantId}/entities/${joEntityId}`).get();
        is1099 = trim((entSnap.data() || {}).workerType) === '1099';
      }

      /** Stamp the worker's saved csv_import entries on the covered dates
       *  with this assignment — the "apply" half of the fix, done server-side
       *  so a 200-row event is one call, not 200 re-resolves. Live rows and
       *  rows already anchored to an assignment are never touched. */
      const stampWorkerEntries = async (args: {
        userId: string;
        dates: string[];
        assignmentId: string;
        payRate: number;
        wc: { code: string; rate: number } | null;
        state: string;
      }): Promise<number> => {
        const snap = await db
          .collection(`tenants/${tenantId}/timesheet_entries`)
          .where('workerId', '==', args.userId)
          .where('source', '==', 'csv_import')
          .get();
        const dateSet = new Set(args.dates);
        const LIVE = new Set(['submitted', 'paid', 'voided']);
        let n = 0;
        for (const doc of snap.docs) {
          const e = doc.data() as Record<string, unknown>;
          const imp = (e.import as Record<string, unknown>) || {};
          if (!dateSet.has(trim(e.workDate))) continue;
          if (LIVE.has(trim(imp.matchStatus)) || ['sent_to_everee', 'paid'].includes(trim(e.status))) continue;
          if (trim(e.assignmentId)) continue;
          const entryPay = Number(e.payRate);
          const effPay = entryPay > 0 ? entryPay : args.payRate;
          const wcCode =
            trim(e.workersCompCode) || trim(imp.workersCompCode) || (args.wc ? args.wc.code : '');
          const entryWcRate = Number(e.workersCompRate);
          const impWcRate = Number(imp.workersCompRate);
          const wcRate =
            entryWcRate > 0
              ? entryWcRate
              : impWcRate > 0
                ? impWcRate
                : args.wc && args.wc.rate > 0
                  ? args.wc.rate
                  : 0;
          const nextStatus =
            trim(imp.matchStatus) === 'blocked'
              ? 'blocked'
              : !(effPay > 0)
                ? 'needs_rate'
                : !is1099 && !(wcCode && wcRate > 0)
                  ? 'needs_wc'
                  : 'ready';
          const prevEntity = trim(e.hiringEntityId);
          n += 1;
          // eslint-disable-next-line no-await-in-loop
          await doc.ref.update({
            assignmentId: args.assignmentId,
            jobOrderId,
            shiftId: anchorShiftId || null,
            hiringEntityId: joEntityId || prevEntity || null,
            accountId: accountId || null,
            accountName: accountName || null,
            ...(entryPay > 0 ? {} : args.payRate > 0 ? { payRate: args.payRate } : {}),
            ...(wcCode ? { workersCompCode: wcCode } : {}),
            ...(wcRate > 0 ? { workersCompRate: wcRate } : {}),
            ...(trim(e.workState) ? {} : args.state ? { workState: args.state } : {}),
            'import.assignmentId': args.assignmentId,
            ...(wcCode ? { 'import.workersCompCode': wcCode } : {}),
            ...(wcRate > 0 ? { 'import.workersCompRate': wcRate } : {}),
            'import.matchStatus': nextStatus,
            ...(joEntityId && prevEntity && joEntityId !== prevEntity
              ? { 'import.entityOverrideFrom': prevEntity }
              : {}),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        return n;
      };

      for (const w of workersIn.slice(0, 500)) {
        const userId = trim(w.userId);
        const dates = Array.isArray(w.dates)
          ? (w.dates as unknown[]).map((d) => trim(d)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
          : [];
        if (!userId || dates.length === 0) continue;
        const payRate = num(w.payRate);
        const title = trim(w.title) || trim(jo.jobTitle) || '';
        const state = trim(w.state).toUpperCase() || joState;
        // Explicit WC from the fix-assignment card wins; otherwise resolve
        // via the matrix chain (state+title → state default). 8040 always
        // rates at the synthetic $2.35 placeholder when unrated.
        const wcCodeIn = trim(w.wcCode);
        const wcRateIn = num(w.wcRate);
        let wc: { code: string; rate: number } | null = null;
        if (wcCodeIn) {
          const matrixRate = state ? matrix?.rateByStateCode.get(`${state}_${wcCodeIn}`) : undefined;
          const rate = wcRateIn > 0 ? wcRateIn : matrixRate ?? (wcCodeIn === '8040' ? 2.35 : 0);
          wc = { code: wcCodeIn, rate };
        } else if (matrix && state) {
          wc =
            (title ? matrix.byStateTitle.get(`${state}_${title.toLowerCase()}`) : undefined) ??
            matrix.byStateDefault.get(state) ??
            null;
        }
        const assignmentId = `${assignmentPrefix}__${userId}`;
        const aRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
        const existing = await aRef.get();
        if (existing.exists) {
          results.push({ jobOrderId, userId, assignmentId, created: false });
          if (stampEntries) {
            stamped += await stampWorkerEntries({
              userId, dates, assignmentId, payRate, wc, state,
            });
          }
          continue;
        }
        const uSnap = await db.doc(`users/${userId}`).get();
        const u = (uSnap.data() ?? {}) as Record<string, unknown>;
        await aRef.set({
          tenantId,
          jobOrderId,
          shiftId: anchorShiftId || null,
          candidateId: userId,
          userId,
          status: ongoing ? 'active' : 'ended',
          startDate: dates[0],
          endDate: ongoing ? '' : dates[dates.length - 1],
          startTime: '',
          endTime: '',
          payRate,
          billRate: num(jo.billRate) || 0,
          timesheetMode: trim(jo.timesheetMode) || 'import',
          firstName: trim(u.firstName),
          lastName: trim(u.lastName),
          email: trim(u.email),
          phone: trim(u.phone) || trim(u.phoneE164),
          companyId: trim(jo.companyId) || '',
          companyName: trim(jo.companyName) || accountName || '',
          accountId: accountId || null,
          accountName: accountName || null,
          hiringEntityId: joEntityId || null,
          worksiteName: trim(jo.worksiteName) || '',
          ...(joWorksiteAddress ? { worksiteAddress: joWorksiteAddress } : {}),
          ...(state ? { worksiteState: state } : {}),
          jobOrderType: trim(jo.jobType) || 'gig',
          jobTitle: title,
          assignmentSource: 'import_backfill',
          placementMode: 'retro_backfill',
          retroactive: true,
          notificationsSuppressed: true,
          suppressInitialNotification: true,
          ...(wc
            ? {
                workersCompCode: wc.code,
                ...(wc.rate > 0 ? { workersCompRate: wc.rate } : {}),
                workersCompSource: 'import_backfill',
              }
            : {}),
          createdBy: uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        results.push({ jobOrderId, userId, assignmentId, created: true });
        if (stampEntries) {
          stamped += await stampWorkerEntries({ userId, dates, assignmentId, payRate, wc, state });
        }
      }
    }
    return {
      created: results.filter((r) => r.created).length,
      reused: results.filter((r) => !r.created).length,
      stamped,
      results,
    };
  },
);

/**
 * getWcPlaceholderUsage — everywhere the 8040 placeholder WC code is in
 * live use (Greg 2026-08-14): the working table of jobs that still need
 * real carrier coverage while the InSource letter is out.
 *
 * Two sources, merged per (entity, state, job order):
 *   - assignments carrying workersCompCode 8040 in a live status — the
 *     durable "this job is running on the placeholder" signal, and
 *   - timesheet entries from the last 60 days coded 8040 (top-level or
 *     import sidecar) — the actual dollars flowing at the $2.35 stand-in.
 *
 * Each group is checked against the rate matrix for a real replacement
 * (state+title row, else the entity's per-state '*' default, never 8040):
 * found → 'replace_now' with the suggested code+rate (fix is on our side);
 * none → 'coverage_needed' (belongs on the carrier ask list).
 */
export const getWcPlaceholderUsage = onCall(
  { cors: true, region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
    await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId);

    const LIVE_ASN = new Set(['active', 'confirmed', 'pending']);
    const cutoff = new Date(Date.now() - 60 * 24 * 3600e3).toISOString().slice(0, 10);

    interface Group {
      key: string;
      hiringEntityId: string;
      state: string;
      jobOrderId: string;
      jobOrderName: string;
      accountName: string;
      worksiteName: string;
      jobTitle: string;
      workers: Set<string>;
      liveAssignments: number;
      entryCount: number;
      recentGross: number;
      lastUsed: string;
    }
    const groups = new Map<string, Group>();
    const ensure = (
      entityId: string,
      state: string,
      jobOrderId: string,
      extras: Partial<Pick<Group, 'accountName' | 'worksiteName' | 'jobTitle'>>,
    ): Group => {
      const key = `${entityId}__${state || '??'}__${jobOrderId || 'no_jo'}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          key, hiringEntityId: entityId, state: state || '', jobOrderId: jobOrderId || '',
          jobOrderName: '', accountName: '', worksiteName: '', jobTitle: '',
          workers: new Set(), liveAssignments: 0, entryCount: 0, recentGross: 0, lastUsed: '',
        };
        groups.set(key, g);
      }
      if (extras.accountName && !g.accountName) g.accountName = extras.accountName;
      if (extras.worksiteName && !g.worksiteName) g.worksiteName = extras.worksiteName;
      if (extras.jobTitle && !g.jobTitle) g.jobTitle = extras.jobTitle;
      return g;
    };

    const asnSnap = await db
      .collection(`tenants/${tenantId}/assignments`)
      .where('workersCompCode', '==', '8040')
      .get();
    asnSnap.forEach((d) => {
      const v = d.data() as Record<string, any>;
      if (!LIVE_ASN.has(String(v.status ?? '').toLowerCase())) return;
      const state =
        trim(v.worksiteState).toUpperCase() ||
        trim((v.worksiteAddress as Record<string, unknown> | undefined)?.state as string).toUpperCase();
      const g = ensure(trim(v.hiringEntityId), state, trim(v.jobOrderId), {
        accountName: trim(v.accountName) || trim(v.companyName),
        worksiteName: trim(v.worksiteName),
        jobTitle: trim(v.jobTitle),
      });
      g.liveAssignments += 1;
      if (v.userId) g.workers.add(String(v.userId));
    });

    // Entries: top-level stamp + import-sidecar-only stamps, deduped by id.
    const seenEntries = new Set<string>();
    const foldEntry = (d: FirebaseFirestore.QueryDocumentSnapshot) => {
      if (seenEntries.has(d.id)) return;
      seenEntries.add(d.id);
      const v = d.data() as Record<string, any>;
      const wd = trim(v.workDate);
      if (!wd || wd < cutoff) return;
      if (trim(v.status) === 'voided') return;
      const imp = (v.import ?? {}) as Record<string, any>;
      const state =
        trim(v.workState).toUpperCase() ||
        trim((imp.worksiteAddress as Record<string, unknown> | undefined)?.state as string).toUpperCase();
      const g = ensure(trim(v.hiringEntityId), state, trim(v.jobOrderId), {
        worksiteName: trim(imp.worksiteName),
      });
      g.entryCount += 1;
      if (v.workerId) g.workers.add(String(v.workerId));
      if (wd > g.lastUsed) g.lastUsed = wd;
      const pay = num(v.payRate);
      const hours =
        num(v.totalRegularHours) + 1.5 * num(v.totalOTHours) + 2 * num(v.totalDoubleTimeHours);
      const effHours = hours > 0 ? hours : num(v.actualHoursOverride);
      if (pay > 0 && effHours > 0) g.recentGross += round2(pay * effHours);
    };
    (
      await db.collection(`tenants/${tenantId}/timesheet_entries`).where('workersCompCode', '==', '8040').get()
    ).forEach(foldEntry);
    (
      await db
        .collection(`tenants/${tenantId}/timesheet_entries`)
        .where('import.workersCompCode', '==', '8040')
        .get()
    ).forEach(foldEntry);

    // Drop groups with no live footprint at all.
    const active = [...groups.values()].filter((g) => g.liveAssignments > 0 || g.entryCount > 0);

    // JO names for links.
    const joIds = [...new Set(active.map((g) => g.jobOrderId).filter(Boolean))];
    const joNames = new Map<string, { name: string; num: number | null; account: string }>();
    for (const joId of joIds) {
      const s = await db.doc(`tenants/${tenantId}/job_orders/${joId}`).get();
      if (s.exists) {
        joNames.set(joId, {
          name: trim(s.get('jobOrderName')),
          num: typeof s.get('jobOrderNumber') === 'number' ? s.get('jobOrderNumber') : null,
          account: trim(s.get('accountName')) || trim(s.get('recruiterAccountName')),
        });
      }
    }

    // Replacement check per (entity, state, title) — matrix rows excluding 8040.
    const matrixByEntity = new Map<string, Awaited<ReturnType<typeof loadWcMatrixForEntity>>>();
    const rows = [];
    for (const g of active) {
      const jo = g.jobOrderId ? joNames.get(g.jobOrderId) : undefined;
      let suggestion: { code: string; rate: number } | null = null;
      if (g.state) {
        const entityKey = g.hiringEntityId || '__none__';
        if (!matrixByEntity.has(entityKey)) {
          matrixByEntity.set(entityKey, await loadWcMatrixForEntity(tenantId, g.hiringEntityId));
        }
        const matrix = matrixByEntity.get(entityKey)!;
        const cand =
          (g.jobTitle ? matrix.byStateTitle.get(`${g.state}_${g.jobTitle.toLowerCase()}`) : undefined) ??
          matrix.byStateDefault.get(g.state) ??
          null;
        if (cand && cand.code !== '8040') suggestion = cand;
      }
      rows.push({
        hiringEntityId: g.hiringEntityId,
        state: g.state,
        jobOrderId: g.jobOrderId,
        jobOrderName: jo?.name || g.worksiteName || '(no job order)',
        jobOrderNumber: jo?.num ?? null,
        accountName: jo?.account || g.accountName,
        worksiteName: g.worksiteName,
        jobTitle: g.jobTitle,
        workers: g.workers.size,
        liveAssignments: g.liveAssignments,
        entryCount: g.entryCount,
        recentGross: round2(g.recentGross),
        lastUsed: g.lastUsed || null,
        status: suggestion ? 'replace_now' : 'coverage_needed',
        suggestion,
      });
    }
    rows.sort((a, b) =>
      a.status !== b.status
        ? a.status === 'coverage_needed' ? -1 : 1
        : b.recentGross - a.recentGross,
    );
    return {
      rows,
      totals: {
        groups: rows.length,
        workers: new Set(active.flatMap((g) => [...g.workers])).size,
        recentGross: round2(rows.reduce((s, r) => s + r.recentGross, 0)),
        coverageNeeded: rows.filter((r) => r.status === 'coverage_needed').length,
        replaceNow: rows.filter((r) => r.status === 'replace_now').length,
        sinceDate: cutoff,
      },
    };
  },
);
