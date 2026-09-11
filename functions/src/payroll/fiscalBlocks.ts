/**
 * Fiscal "blocks" — Greg's standard reporting calendar (2026-09-08).
 *
 * A week runs Sunday → Saturday and belongs to the calendar month that
 * holds its Wednesday (4+ of its 7 days), giving 4- or 5-week blocks that
 * hug calendar months. Both views must be exact: the MONTHLY P&L and the
 * BLOCK P&L. Automated month-level journal entries (revenue reclass, WC
 * allocation) are therefore posted per SEGMENT = calendar month ∩ block,
 * dated the segment's last day, so month totals and block totals both sum
 * from whole entries. A month straddling a block boundary gets two entries.
 *
 * Reference: docs/claude/reference_fiscal_blocks_2026.md
 */

export interface FiscalBlock {
  year: number;
  n: number;
  start: string; // YYYY-MM-DD (Sunday)
  end: string; // YYYY-MM-DD (Saturday)
  weeks: number;
}

export interface ReportSegment {
  /** `YYYY-MM/B<n>` — month + the block the days belong to. */
  key: string;
  month: string; // YYYY-MM
  block: FiscalBlock;
  start: string; // first day of the segment
  end: string; // last day of the segment
  /** true when the segment starts on the 1st (carries the legacy month-keyed JE) */
  isFirstOfMonth: boolean;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const utc = (s: string): Date => new Date(`${s}T00:00:00Z`);

const cache = new Map<number, FiscalBlock[]>();

export function blocksForYear(year: number): FiscalBlock[] {
  const hit = cache.get(year);
  if (hit) return hit;
  const byMonth = new Map<string, Date[]>();
  const d = new Date(Date.UTC(year - 1, 11, 28));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // back to Sunday
  const stop = new Date(Date.UTC(year + 1, 0, 10));
  for (; d <= stop; d.setUTCDate(d.getUTCDate() + 7)) {
    const wed = new Date(d);
    wed.setUTCDate(wed.getUTCDate() + 3);
    const key = `${wed.getUTCFullYear()}-${String(wed.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(new Date(d));
  }
  const out = [...byMonth.entries()]
    .filter(([k]) => k.startsWith(`${year}-`))
    .sort()
    .map(([k, sundays]) => {
      const end = new Date(sundays[sundays.length - 1]);
      end.setUTCDate(end.getUTCDate() + 6);
      return { year, n: Number(k.slice(5)), start: iso(sundays[0]), end: iso(end), weeks: sundays.length };
    });
  cache.set(year, out);
  return out;
}

/** The block containing a YYYY-MM-DD date (checks the date's year, then its neighbours). */
export function blockForDate(date: string): FiscalBlock {
  const y = Number(date.slice(0, 4));
  for (const yy of [y, y - 1, y + 1]) {
    const b = blocksForYear(yy).find((x) => x.start <= date && date <= x.end);
    if (b) return b;
  }
  throw new Error(`no fiscal block for ${date}`);
}

const monthEnd = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return iso(new Date(Date.UTC(y, m, 0)));
};

/** The (month ∩ block) segment a date falls in. */
export function segmentFor(date: string): ReportSegment {
  const day = date.slice(0, 10);
  const month = day.slice(0, 7);
  const block = blockForDate(day);
  const start = block.start > `${month}-01` ? block.start : `${month}-01`;
  const end = block.end < monthEnd(month) ? block.end : monthEnd(month);
  return { key: `${month}/B${block.n}`, month, block, start, end, isFirstOfMonth: start === `${month}-01` };
}

/** Posting date for a segment's JE: its last day, or today while it is still open. */
export function segmentTxnDate(seg: ReportSegment, today = iso(new Date())): string {
  return seg.end > today ? today : seg.end;
}

/** `MMYY B<n>` suffix for DocNumbers (QBO caps DocNumber at 21 chars). */
export function segmentDocSuffix(seg: ReportSegment): string {
  return `${seg.month.slice(5)}${seg.month.slice(2, 4)} B${seg.block.n}`;
}

/** Map each segment to its prior JE. Exact segment tags win; a legacy
 *  month-only tag (pre-2026-09-08 entries, one per month) is handed to the
 *  month's FIRST segment that has data, so it is rewritten rather than
 *  duplicated. `orphans` are tagged JEs no segment claimed (the month no
 *  longer has data) — surface them for a manual delete. */
export function resolvePriors<T>(
  existing: Map<string, T>,
  segs: Iterable<ReportSegment>,
): { priors: Map<string, T>; orphans: Array<{ tag: string; je: T }> } {
  const priors = new Map<string, T>();
  const byMonth = new Map<string, ReportSegment[]>();
  for (const s of segs) byMonth.set(s.month, [...(byMonth.get(s.month) ?? []), s]);
  const claimed = new Set<string>();
  for (const [month, list] of byMonth) {
    list.sort((a, b) => a.start.localeCompare(b.start));
    const legacy = existing.get(month);
    let legacyUsed = false;
    for (const s of list) {
      const exact = existing.get(s.key);
      if (exact) {
        priors.set(s.key, exact);
        claimed.add(s.key);
        continue;
      }
      if (legacy && !legacyUsed) {
        priors.set(s.key, legacy);
        claimed.add(month);
        legacyUsed = true;
      }
    }
  }
  const orphans = [...existing.entries()].filter(([tag]) => !claimed.has(tag)).map(([tag, je]) => ({ tag, je }));
  return { priors, orphans };
}
