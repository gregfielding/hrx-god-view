/**
 * WC coverage-gap report (Greg 2026-08-25 — "where are we missing coverage").
 *
 * Cross-entity, one timesheet scan (the per-entity monthly report already
 * fetches the whole range and filters in memory, so this costs the same).
 * Detects, with dollars attached:
 *   - payroll in states with NO policy on file for the entity (true gap)
 *   - payroll worked OUTSIDE a policy's effective→expiration window
 *   - entities with payroll and zero policy records
 *   - resolved class codes with no rate on file (premium not computable)
 *   - unresolved payroll (survives the whole resolution chain uncoded)
 *   - 8040-placeholder payroll split replace-now vs coverage-needed
 *   - payroll with no work state at all (data-quality gap)
 *   - LIVE assignments with no code — next cycle's uncoded payroll
 *   - class-catalog codes still unverified
 *
 * ☠️ Data traps honored (see docs/claude/project_wc_classification.md):
 * work state uses the three-way fallback (workState → worksiteAddress.state →
 * import.worksiteAddress.state); entries count only when status is
 * sent_to_everee/submitted/paid and total > 0 — matching the carrier report
 * so the dollars tie out.
 *
 * Invoked from getWorkersCompMonthlyReport({ coverage: true }) — Cloud Run
 * cap forbids a new function.
 */
import * as admin from 'firebase-admin';

const db = admin.firestore();

const trim = (v: unknown): string => String(v ?? '').trim();
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n: number): number => Math.round(n * 100) / 100;

interface PolicyWindow {
  state: string;
  carrierName: string;
  active: boolean;
  effectiveDate: string; // '' when unset
  expirationDate: string; // '' when unset
}

interface MatrixMaps {
  rateByStateCode: Map<string, number>;
  byStateTitle: Map<string, { code: string; rate: number }>;
  byStateDefault: Map<string, { code: string; rate: number }>;
  /** title(lower) → code → number of states where that title carries that
   *  code on this entity's matrix (8040 excluded) — powers the "what code to
   *  ask the carrier for" suggestion (Greg 2026-09-05). */
  titleCodes: Map<string, Map<string, number>>;
  /** code → rates across this entity's rated states (8040 excluded) — the
   *  comparable-rate range shown next to each ask. */
  codeRates: Map<string, number[]>;
}

interface MoneyAgg {
  gross: number;
  hours: number;
  entries: number;
  workers: Set<string>;
}

function emptyAgg(): MoneyAgg {
  return { gross: 0, hours: 0, entries: 0, workers: new Set() };
}

function bump(agg: MoneyAgg, gross: number, hours: number, workerId: string): void {
  agg.gross = round2(agg.gross + gross);
  agg.hours = round2(agg.hours + hours);
  agg.entries += 1;
  if (workerId) agg.workers.add(workerId);
}

function aggOut(a: MoneyAgg): { gross: number; hours: number; entries: number; workers: number } {
  return { gross: a.gross, hours: a.hours, entries: a.entries, workers: a.workers.size };
}

export async function buildWcCoverageReport(input: {
  tenantId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}): Promise<Record<string, unknown>> {
  const { tenantId, startDate, endDate } = input;

  // ---- Reference data ------------------------------------------------------
  const [entitiesSnap, policiesSnap, ratesSnap, codesSnap] = await Promise.all([
    db.collection(`tenants/${tenantId}/entities`).get(),
    db.collection(`tenants/${tenantId}/workers_comp`).get(),
    db.collection(`tenants/${tenantId}/workers_comp_rates`).get(),
    db.collection(`tenants/${tenantId}/workers_comp_class_codes`).get(),
  ]);

  const entityMeta = new Map<string, { name: string; isContractor: boolean }>();
  entitiesSnap.forEach((d) => {
    const name = trim(d.data().name) || d.id;
    if (/sandbox/i.test(d.id) || /sandbox/i.test(name)) return;
    const isContractor =
      trim(d.data().workerType).toLowerCase() === 'contractor' || /events|workforce/i.test(d.id);
    entityMeta.set(d.id, { name, isContractor });
  });

  // Policies keyed entity → state → windows (a state can have year-over-year
  // renewals as separate docs).
  const policiesByEntity = new Map<string, Map<string, PolicyWindow[]>>();
  policiesSnap.forEach((d) => {
    const x = d.data() as Record<string, unknown>;
    const entityId = trim(x.entityId);
    const state = trim(x.state).toUpperCase();
    if (!entityId || !state) return;
    if (!policiesByEntity.has(entityId)) policiesByEntity.set(entityId, new Map());
    const byState = policiesByEntity.get(entityId)!;
    if (!byState.has(state)) byState.set(state, []);
    byState.get(state)!.push({
      state,
      carrierName: trim(x.carrierName),
      active: x.active !== false,
      effectiveDate: trim(x.effectiveDate),
      expirationDate: trim(x.expirationDate),
    });
  });

  // Rate matrix: generic rows apply everywhere, entity-scoped rows overlay
  // (same two-pass semantics as loadWcMatrixForEntity in payrollCostReport).
  const genericRates: Array<Record<string, unknown>> = [];
  const scopedRates = new Map<string, Array<Record<string, unknown>>>();
  ratesSnap.forEach((d) => {
    const x = d.data() as Record<string, unknown>;
    if (trim(x.modifierAccountId)) return; // account-pricing rows, not coverage
    const scope = trim(x.hiringEntityId);
    if (!scope) genericRates.push(x);
    else {
      if (!scopedRates.has(scope)) scopedRates.set(scope, []);
      scopedRates.get(scope)!.push(x);
    }
  });
  const matrixCache = new Map<string, MatrixMaps>();
  const matrixFor = (entityId: string): MatrixMaps => {
    const hit = matrixCache.get(entityId);
    if (hit) return hit;
    const m: MatrixMaps = {
      rateByStateCode: new Map(),
      byStateTitle: new Map(),
      byStateDefault: new Map(),
      titleCodes: new Map(),
      codeRates: new Map(),
    };
    const apply = (x: Record<string, unknown>): void => {
      const st = trim(x.state).toUpperCase();
      const code = trim(x.code);
      const rate = num(x.rate);
      if (!st || !code) return;
      m.rateByStateCode.set(`${st}_${code}`, rate);
      if (code !== '8040') {
        if (!m.codeRates.has(code)) m.codeRates.set(code, []);
        if (rate > 0) m.codeRates.get(code)!.push(rate);
      }
      const titles = Array.isArray(x.jobTitles) ? (x.jobTitles as unknown[]) : [];
      for (const t of titles) {
        const title = trim(t);
        if (title === '*') m.byStateDefault.set(st, { code, rate });
        else if (title) {
          m.byStateTitle.set(`${st}_${title.toLowerCase()}`, { code, rate });
          if (code !== '8040') {
            const key = title.toLowerCase();
            if (!m.titleCodes.has(key)) m.titleCodes.set(key, new Map());
            const tc = m.titleCodes.get(key)!;
            tc.set(code, (tc.get(code) ?? 0) + 1);
          }
        }
      }
    };
    genericRates.forEach(apply);
    (scopedRates.get(entityId) ?? []).forEach(apply);
    matrixCache.set(entityId, m);
    return m;
  };

  const unverifiedCodes: Array<{ code: string; title: string; statesInUse: string[] }> = [];
  codesSnap.forEach((d) => {
    const x = d.data() as Record<string, unknown>;
    if (x.active === false) return;
    if (x.descriptionVerified === true) return;
    unverifiedCodes.push({
      code: trim(x.code) || d.id,
      title: trim(x.title),
      statesInUse: Array.isArray(x.statesInUse) ? (x.statesInUse as unknown[]).map(trim).filter(Boolean) : [],
    });
  });

  // ---- Entries scan --------------------------------------------------------
  const snap = await db
    .collection(`tenants/${tenantId}/timesheet_entries`)
    .where('workDate', '>=', startDate)
    .where('workDate', '<=', endDate)
    .get();

  interface Picked {
    entityId: string;
    state: string;
    workDate: string;
    jobTitle: string; // filled after assignment fetch when needed
    assignmentId: string;
    jobOrderId: string;
    /** Denormalized on timesheet entries — often the ONLY account linkage on
     *  import rows (no assignment, no job order). */
    entryAccountId: string;
    entryCode: string;
    workerId: string;
    total: number;
    hours: number;
    /** Import sidecar worksite (CSV rows carry venue only here). */
    sidecarName: string;
    sidecarAddress: string;
    /** Filled during the aggregation loop for the Mass PN builder. */
    resolvedCode?: string;
    carrierAsk?: boolean; // no-policy / outside-window / 8040-coverage-needed
  }
  const picked: Picked[] = [];
  const uncodedAsnIds = new Set<string>();
  snap.forEach((d) => {
    const e = d.data() as Record<string, unknown>;
    const status = trim(e.status);
    if (status !== 'sent_to_everee' && status !== 'submitted' && status !== 'paid') return;
    const entityId = trim(e.hiringEntityId);
    const meta = entityMeta.get(entityId);
    if (!meta) return; // sandbox / unknown entity
    const isImport = trim(e.source) === 'csv_import';
    const rate = num(e.payRate);
    const reg = num(e.totalRegularHours);
    const ot = num(e.totalOTHours);
    const dt = num(e.totalDoubleTimeHours);
    const premiums = isImport
      ? 0
      : round2((num(e.mealBreakPenaltyHours) + num(e.restBreakPenaltyHours)) * rate);
    const hourly = meta.isContractor
      ? round2((reg + ot + dt) * rate)
      : isImport
        ? round2(reg * rate + ot * rate * 1.5)
        : round2(reg * rate + ot * rate * 1.5 + dt * rate * 2);
    const total = round2(hourly + premiums + num(e.tips) + num(e.bonusAmount));
    if (total === 0) return;
    const sidecar = ((e.import ?? {}) as Record<string, unknown>).worksiteAddress as
      | Record<string, unknown>
      | undefined;
    const state =
      trim(e.workState).toUpperCase() ||
      trim((e.worksiteAddress as Record<string, unknown> | undefined)?.state).toUpperCase() ||
      trim(sidecar?.state).toUpperCase() ||
      '';
    const entryCode = trim(e.workersCompCode);
    const assignmentId = trim(e.assignmentId);
    // Assignment fetch set: uncoded entries (resolution chain) + rows the
    // Mass PN export needs venue detail for (8040 stamps; policy-gap states
    // are classified in the main loop, so grab those too via a cheap inline
    // policy check).
    if (assignmentId) {
      const windows = policiesByEntity.get(entityId)?.get(state) ?? [];
      const policyGap =
        state !== '' &&
        (windows.length === 0 || !windows.some((w) => w.active && (!w.effectiveDate || trim(e.workDate) >= w.effectiveDate) && (!w.expirationDate || trim(e.workDate) <= w.expirationDate)));
      if (!entryCode || entryCode === '8040' || policyGap) uncodedAsnIds.add(assignmentId);
    }
    const sidecarName = trim(((e.import ?? {}) as Record<string, unknown>).worksiteName);
    const sidecarAddress = sidecar
      ? [trim(sidecar.street) || trim(sidecar.line1), trim(sidecar.city), trim(sidecar.state), trim(sidecar.zip)]
          .filter(Boolean)
          .join(', ')
      : '';
    picked.push({
      entityId,
      state,
      workDate: trim(e.workDate),
      jobTitle: '',
      assignmentId,
      jobOrderId: trim(e.jobOrderId),
      entryAccountId: trim(e.accountId),
      entryCode,
      workerId: trim(e.workerId),
      total,
      hours: round2(reg + ot + dt),
      sidecarName,
      sidecarAddress,
    });
  });

  // Assignments only for uncoded entries (resolution chain hops 2-3).
  const assignments = new Map<string, Record<string, unknown>>();
  const asnList = Array.from(uncodedAsnIds);
  for (let i = 0; i < asnList.length; i += 100) {
    const chunk = asnList.slice(i, i + 100);
    const snaps = await db.getAll(...chunk.map((id) => db.doc(`tenants/${tenantId}/assignments/${id}`)));
    snaps.forEach((s) => {
      if (s.exists) assignments.set(s.id, s.data() as Record<string, unknown>);
    });
  }

  // ---- Per-entity gap aggregation -----------------------------------------
  interface EntityGaps {
    stateGross: Map<string, MoneyAgg>;
    noPolicyStates: Map<string, MoneyAgg>;
    outsideWindow: Map<string, MoneyAgg>; // state → gross worked outside every window
    unresolved: Map<string, MoneyAgg>; // state
    placeholderReplaceNow: Map<string, MoneyAgg>; // state
    placeholderCoverageNeeded: Map<string, MoneyAgg>;
    ratesMissing: Map<string, MoneyAgg>; // `${state}_${code}`
    noState: MoneyAgg;
    total: MoneyAgg;
  }
  const perEntity = new Map<string, EntityGaps>();
  const gapsFor = (entityId: string): EntityGaps => {
    let g = perEntity.get(entityId);
    if (!g) {
      g = {
        stateGross: new Map(),
        noPolicyStates: new Map(),
        outsideWindow: new Map(),
        unresolved: new Map(),
        placeholderReplaceNow: new Map(),
        placeholderCoverageNeeded: new Map(),
        ratesMissing: new Map(),
        noState: emptyAgg(),
        total: emptyAgg(),
      };
      perEntity.set(entityId, g);
    }
    return g;
  };
  const mapBump = (m: Map<string, MoneyAgg>, key: string, p: Picked): void => {
    if (!m.has(key)) m.set(key, emptyAgg());
    bump(m.get(key)!, p.total, p.hours, p.workerId);
  };

  const coversDate = (w: PolicyWindow, date: string): boolean => {
    if (w.effectiveDate && date < w.effectiveDate) return false;
    if (w.expirationDate && date > w.expirationDate) return false;
    return true;
  };

  for (const p of picked) {
    const g = gapsFor(p.entityId);
    bump(g.total, p.total, p.hours, p.workerId);
    if (!p.state) {
      bump(g.noState, p.total, p.hours, p.workerId);
      continue;
    }
    mapBump(g.stateGross, p.state, p);

    // Policy classification (the actual "missing coverage" answer).
    const windows = policiesByEntity.get(p.entityId)?.get(p.state) ?? [];
    if (windows.length === 0) {
      mapBump(g.noPolicyStates, p.state, p);
      p.carrierAsk = true;
    } else if (!windows.some((w) => w.active && coversDate(w, p.workDate))) {
      mapBump(g.outsideWindow, p.state, p);
      p.carrierAsk = true;
    }

    // Classification-chain gaps (unresolved / placeholder / rate-missing).
    const matrix = matrixFor(p.entityId);
    let code = p.entryCode;
    const a = p.assignmentId ? assignments.get(p.assignmentId) : undefined;
    const jobTitle = trim(a?.jobTitle) || '(no title)';
    if (!code && a) code = trim(a.workersCompCode);
    if (!code) code = matrix.byStateTitle.get(`${p.state}_${jobTitle.toLowerCase()}`)?.code ?? '';
    if (!code) code = matrix.byStateDefault.get(p.state)?.code ?? '';

    if (!code) {
      mapBump(g.unresolved, p.state, p);
      continue;
    }
    p.resolvedCode = code;
    p.jobTitle = jobTitle;
    if (code === '8040') {
      const titleHit = matrix.byStateTitle.get(`${p.state}_${jobTitle.toLowerCase()}`);
      const fixable = Boolean(titleHit && titleHit.code !== '8040');
      mapBump(fixable ? g.placeholderReplaceNow : g.placeholderCoverageNeeded, p.state, p);
      if (!fixable) p.carrierAsk = true;
    }
    if (!matrix.rateByStateCode.has(`${p.state}_${code}`)) {
      mapBump(g.ratesMissing, `${p.state}_${code}`, p);
    }
  }

  // ---- Mass PN rows (InSource "Mass Prospect Notification", 2026-08-25) ---
  // One row per (entity, account, worksite, state, code) for the CARRIER-ASK
  // cohorts: payroll in no-policy states, work outside a policy window, and
  // 8040 payroll the carrier must add coverage for. Annual payroll estimate
  // is the window gross annualized, rounded up to the nearest $10k (matching
  // the granularity of past submissions).
  const periodDays = Math.max(1, (Date.parse(endDate) - Date.parse(startDate)) / 86400000 + 1);
  interface MassPnAgg {
    entityId: string;
    accountId: string;
    worksiteName: string;
    worksiteAddress: string;
    state: string;
    code: string;
    jobTitles: Set<string>;
    gross: number;
    workers: Set<string>;
  }
  const massAgg = new Map<string, MassPnAgg>();
  const accountIds = new Set<string>();
  // Client resolution fallback (Greg 2026-09-05): import rows rarely carry an
  // assignment account — hop through the entry's job order instead.
  const askJoIds = new Set<string>();
  for (const p of picked) {
    if (!p.carrierAsk) continue;
    const a = p.assignmentId ? assignments.get(p.assignmentId) : undefined;
    if (!trim(a?.recruiterAccountId) && !p.entryAccountId && p.jobOrderId) askJoIds.add(p.jobOrderId);
  }
  const joAccounts = new Map<string, string>();
  const joIdList = Array.from(askJoIds);
  for (let i = 0; i < joIdList.length; i += 100) {
    const chunk = joIdList.slice(i, i + 100);
    const snaps = await db.getAll(...chunk.map((id) => db.doc(`tenants/${tenantId}/job_orders/${id}`)));
    snaps.forEach((s) => {
      if (!s.exists) return;
      const x = s.data() as Record<string, unknown>;
      const acct = trim(x.accountId) || trim(x.recruiterAccountId);
      if (acct) joAccounts.set(s.id, acct);
    });
  }
  for (const p of picked) {
    if (!p.carrierAsk) continue;
    const a = p.assignmentId ? assignments.get(p.assignmentId) : undefined;
    const worksiteName =
      trim(a?.worksiteName) || p.sidecarName || trim(a?.location) || '(worksite unknown)';
    const wa = (a?.worksiteAddress ?? null) as Record<string, unknown> | null;
    const worksiteAddress =
      (wa
        ? [trim(wa.street) || trim(wa.line1), trim(wa.city), trim(wa.state), trim(wa.zip)]
            .filter(Boolean)
            .join(', ')
        : '') || p.sidecarAddress;
    const accountId =
      trim(a?.recruiterAccountId) || p.entryAccountId || joAccounts.get(p.jobOrderId) || '';
    if (accountId) accountIds.add(accountId);
    const key = `${p.entityId}|${accountId}|${worksiteName}|${p.state}|${p.resolvedCode ?? ''}`;
    if (!massAgg.has(key)) {
      massAgg.set(key, {
        entityId: p.entityId,
        accountId,
        worksiteName,
        worksiteAddress,
        state: p.state,
        code: p.resolvedCode ?? '',
        jobTitles: new Set(),
        gross: 0,
        workers: new Set(),
      });
    }
    const m = massAgg.get(key)!;
    if (p.jobTitle && p.jobTitle !== '(no title)') m.jobTitles.add(p.jobTitle);
    m.gross = round2(m.gross + p.total);
    if (p.workerId) m.workers.add(p.workerId);
    if (!m.worksiteAddress && worksiteAddress) m.worksiteAddress = worksiteAddress;
  }
  // Resolve names at the TOP-LEVEL account (Greg 2026-09-05): the carrier's
  // "Client/Prospect Name" is the standalone or national account, never a
  // child venue — walk parentAccountId up (one hop in practice, capped at 3).
  const accountDocs = new Map<string, { name: string; parentAccountId: string }>();
  const fetchAccounts = async (ids: string[]): Promise<void> => {
    const missing = ids.filter((id) => id && !accountDocs.has(id));
    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100);
      const snaps = await db.getAll(...chunk.map((id) => db.doc(`tenants/${tenantId}/accounts/${id}`)));
      snaps.forEach((s) => {
        if (!s.exists) return;
        const x = s.data() as Record<string, unknown>;
        accountDocs.set(s.id, { name: trim(x.name), parentAccountId: trim(x.parentAccountId) });
      });
    }
  };
  await fetchAccounts(Array.from(accountIds));
  await fetchAccounts(Array.from(accountDocs.values()).map((a) => a.parentAccountId).filter(Boolean));
  const accountNames = new Map<string, string>();
  for (const id of accountIds) {
    let cur = id;
    for (let hop = 0; hop < 3; hop++) {
      const doc = accountDocs.get(cur);
      if (!doc?.parentAccountId || !accountDocs.get(doc.parentAccountId)) break;
      cur = doc.parentAccountId;
    }
    accountNames.set(id, accountDocs.get(cur)?.name ?? accountDocs.get(id)?.name ?? '');
  }

  // Last resort for rows with NO account linkage anywhere (traveler import
  // rows): conservative name-match of the worksite string against TOP-LEVEL
  // account names ("Venuesmart" sidecar → "Venuesmart LLC National"). Only
  // fires when the account's base name (≥5 chars, suffixes stripped) appears
  // in the site name — never fuzzy.
  const topLevelNamesByToken: Array<{ token: string; name: string }> = [];
  {
    const allAccounts = await db
      .collection(`tenants/${tenantId}/accounts`)
      .select('name', 'parentAccountId')
      .get();
    allAccounts.forEach((s) => {
      const x = s.data() as Record<string, unknown>;
      if (trim(x.parentAccountId)) return; // children never match
      const name = trim(x.name);
      const token = name
        .toLowerCase()
        .replace(/\b(llc|inc|national|account|accounts|corp|co)\b/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      if (token.length >= 5) topLevelNamesByToken.push({ token, name });
    });
    // Longest tokens first so "venuesmart events" beats "venuesmart".
    topLevelNamesByToken.sort((a, b) => b.token.length - a.token.length);
  }
  const matchClientBySiteName = (siteName: string): string => {
    const hay = siteName.toLowerCase();
    for (const t of topLevelNamesByToken) {
      if (hay.includes(t.token)) return t.name;
    }
    return '';
  };
  // "What to ask the carrier for" (Greg 2026-09-05): a gap riding 8040 (or
  // nothing) gets a suggested REAL class code — the dominant code the same
  // job titles carry in the entity's OTHER rated states — plus that code's
  // rate range on the existing policy, so each ask row is actionable.
  const suggestAsk = (
    entityId: string,
    currentCode: string,
    titles: Set<string>,
  ): { code: string; basis: string[]; rateMin: number | null; rateMax: number | null } | null => {
    const matrix = matrixFor(entityId);
    let code = currentCode && currentCode !== '8040' ? currentCode : '';
    let basis: string[] = [];
    if (!code) {
      const tally = new Map<string, { hits: number; titles: string[] }>();
      for (const raw of titles) {
        const tc = matrix.titleCodes.get(raw.toLowerCase());
        if (!tc) continue;
        for (const [c, hits] of tc) {
          if (!tally.has(c)) tally.set(c, { hits: 0, titles: [] });
          const t = tally.get(c)!;
          t.hits += hits;
          t.titles.push(raw);
        }
      }
      const best = Array.from(tally.entries()).sort((a, b) => b[1].hits - a[1].hits)[0];
      if (!best) return null;
      code = best[0];
      basis = Array.from(new Set(best[1].titles)).slice(0, 4);
    }
    const rates = matrix.codeRates.get(code) ?? [];
    return {
      code,
      basis,
      rateMin: rates.length ? Math.min(...rates) : null,
      rateMax: rates.length ? Math.max(...rates) : null,
    };
  };

  const massPn = Array.from(massAgg.values())
    .map((m) => {
      const ask = suggestAsk(m.entityId, m.code, m.jobTitles);
      return {
        entityId: m.entityId,
        entityName: entityMeta.get(m.entityId)?.name ?? m.entityId,
        accountName: accountNames.get(m.accountId) || matchClientBySiteName(m.worksiteName) || '',
        worksiteName: m.worksiteName,
        worksiteAddress: m.worksiteAddress,
        state: m.state,
        code: m.code,
        jobTitles: Array.from(m.jobTitles).slice(0, 4),
        periodGross: m.gross,
        workers: m.workers.size,
        annualEstimate: Math.max(10000, Math.ceil(((m.gross / periodDays) * 365) / 10000) * 10000),
        suggestedCode: ask?.code ?? null,
        suggestedBasis: ask?.basis ?? [],
        comparableRateMin: ask?.rateMin ?? null,
        comparableRateMax: ask?.rateMax ?? null,
      };
    })
    .sort((a, b) => b.periodGross - a.periodGross);

  // The add-coverage order form: carrier-ask dollars grouped by
  // (entity, state, suggested code).
  interface AskAgg {
    entityId: string;
    state: string;
    code: string | null;
    gross: number;
    workers: Set<string>;
    titles: Set<string>;
    rateMin: number | null;
    rateMax: number | null;
  }
  const askAgg = new Map<string, AskAgg>();
  for (const m of Array.from(massAgg.values())) {
    const ask = suggestAsk(m.entityId, m.code, m.jobTitles);
    const codeKey = ask?.code ?? '(needs classification)';
    const key = `${m.entityId}|${m.state}|${codeKey}`;
    if (!askAgg.has(key)) {
      askAgg.set(key, {
        entityId: m.entityId,
        state: m.state,
        code: ask?.code ?? null,
        gross: 0,
        workers: new Set(),
        titles: new Set(),
        rateMin: ask?.rateMin ?? null,
        rateMax: ask?.rateMax ?? null,
      });
    }
    const a = askAgg.get(key)!;
    a.gross = round2(a.gross + m.gross);
    m.workers.forEach((w) => a.workers.add(w));
    m.jobTitles.forEach((t) => a.titles.add(t));
  }
  const coverageAsks = Array.from(askAgg.values())
    .map((a) => ({
      entityId: a.entityId,
      entityName: entityMeta.get(a.entityId)?.name ?? a.entityId,
      state: a.state,
      suggestedCode: a.code,
      jobTitles: Array.from(a.titles).slice(0, 6),
      periodGross: a.gross,
      annualEstimate: Math.max(10000, Math.ceil(((a.gross / periodDays) * 365) / 10000) * 10000),
      workers: a.workers.size,
      comparableRateMin: a.rateMin,
      comparableRateMax: a.rateMax,
    }))
    .sort((a, b) => a.entityName.localeCompare(b.entityName) || b.periodGross - a.periodGross);

  // ---- Forward-looking: LIVE assignments with no code ---------------------
  // Mirrors getWcPlaceholderUsage's live set + recency cutoff. status-in is a
  // single-field auto-indexed query; empty-code filtered in memory (missing
  // field can't be queried).
  const cutoff = new Date(Date.now() - 60 * 24 * 3600e3).toISOString().slice(0, 10);
  const liveAsnSnap = await db
    .collection(`tenants/${tenantId}/assignments`)
    .where('status', 'in', ['active', 'confirmed', 'pending'])
    .select('workersCompCode', 'workState', 'worksiteState', 'hiringEntityId', 'entityId', 'endDate', 'startDate')
    .get();
  const uncodedLive = new Map<string, { count: number; states: Map<string, number> }>();
  liveAsnSnap.forEach((d) => {
    const x = d.data() as Record<string, unknown>;
    if (trim(x.workersCompCode)) return;
    const end = trim(x.endDate) || trim(x.startDate);
    if (end && end < cutoff) return; // long-dead rows
    const entityId = trim(x.hiringEntityId) || trim(x.entityId) || '(unknown)';
    if (entityId !== '(unknown)' && !entityMeta.has(entityId)) return;
    const state = (trim(x.workState) || trim(x.worksiteState)).toUpperCase() || '(no state)';
    if (!uncodedLive.has(entityId)) uncodedLive.set(entityId, { count: 0, states: new Map() });
    const agg = uncodedLive.get(entityId)!;
    agg.count += 1;
    agg.states.set(state, (agg.states.get(state) ?? 0) + 1);
  });

  // ---- Shape output --------------------------------------------------------
  const mapOut = (m: Map<string, MoneyAgg>): Array<Record<string, unknown>> =>
    Array.from(m.entries())
      .map(([key, a]) => ({ key, ...aggOut(a) }))
      .sort((x, y) => Number(y.gross) - Number(x.gross));

  const entities = Array.from(perEntity.entries())
    .map(([entityId, g]) => {
      const meta = entityMeta.get(entityId)!;
      const policies = policiesByEntity.get(entityId);
      return {
        entityId,
        name: meta.name,
        isContractor: meta.isContractor,
        hasAnyPolicy: Boolean(policies && policies.size > 0),
        policyStates: policies ? Array.from(policies.keys()).sort() : [],
        total: aggOut(g.total),
        workedStates: mapOut(g.stateGross),
        gaps: {
          statesNoPolicy: mapOut(g.noPolicyStates),
          workedOutsidePolicyWindow: mapOut(g.outsideWindow),
          unresolved: mapOut(g.unresolved),
          placeholderReplaceNow: mapOut(g.placeholderReplaceNow),
          placeholderCoverageNeeded: mapOut(g.placeholderCoverageNeeded),
          ratesMissing: mapOut(g.ratesMissing),
          noState: aggOut(g.noState),
          uncodedLiveAssignments: uncodedLive.get(entityId)
            ? {
                count: uncodedLive.get(entityId)!.count,
                byState: Object.fromEntries(uncodedLive.get(entityId)!.states),
              }
            : { count: 0, byState: {} },
        },
      };
    })
    .sort((a, b) => Number(b.total.gross) - Number(a.total.gross));

  const sumGap = (pickKey: keyof (typeof entities)[number]['gaps']): number =>
    round2(
      entities.reduce((s, e) => {
        const v = e.gaps[pickKey] as unknown;
        if (Array.isArray(v)) return s + v.reduce((s2, r) => s2 + Number((r as { gross?: number }).gross ?? 0), 0);
        if (v && typeof v === 'object' && 'gross' in (v as Record<string, unknown>)) {
          return s + Number((v as { gross: number }).gross);
        }
        return s;
      }, 0),
    );

  return {
    tenantId,
    startDate,
    endDate,
    generatedAt: new Date().toISOString(),
    entities,
    summary: {
      totalGross: round2(entities.reduce((s, e) => s + e.total.gross, 0)),
      statesNoPolicyGross: sumGap('statesNoPolicy'),
      outsidePolicyWindowGross: sumGap('workedOutsidePolicyWindow'),
      unresolvedGross: sumGap('unresolved'),
      placeholderReplaceNowGross: sumGap('placeholderReplaceNow'),
      placeholderCoverageNeededGross: sumGap('placeholderCoverageNeeded'),
      ratesMissingGross: sumGap('ratesMissing'),
      noStateGross: sumGap('noState'),
      uncodedLiveAssignments: Array.from(uncodedLive.values()).reduce((s, v) => s + v.count, 0),
    },
    unverifiedCodes,
    massPn,
    coverageAsks,
  };
}
