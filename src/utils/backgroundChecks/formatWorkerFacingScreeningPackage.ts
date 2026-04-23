import type { BackgroundCheckRecord } from '../../types/backgroundCheck';
import { accusourceScreeningLineItems } from '../accusourceScreeningLineItems';

export type WorkerFacingScreeningItem = {
  label: string;
  /** Optional plain-language grouping hint (e.g. drug vs criminal). */
  type?: string;
};

export type FormatWorkerFacingScreeningPackageResult = {
  /** Short heading for cards (worker-safe; never the vendor package marketing name alone). */
  title: string;
  items: WorkerFacingScreeningItem[];
  /** Comma-separated names for compact one-line UI. */
  summary: string;
};

const DEFAULT_TITLE = 'Required screening';
const DEFAULT_SUMMARY = 'Complete required screening before proceeding';

/** One-line worker-safe fallback when services are unknown (no vendor package name). */
export const WORKER_SCREENING_SHORT_FALLBACK = 'Background screening required';
const TITLE_WITH_ITEMS = 'Complete these required screenings:';

const normalizeNameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Map AccuSource-style short codes to optional group labels (service `name` still wins for display).
 */
export function screeningTypeGroupLabel(type: string | undefined | null): string | undefined {
  if (type == null) return undefined;
  const t = String(type).trim().toLowerCase();
  if (!t) return undefined;
  if (t === 'drug' || t.includes('drug')) return 'Drug screening';
  if (t === 'ssnt' || t.includes('ssn')) return 'Social Security trace';
  if (t === 'cnet' || t.includes('crim')) return 'Criminal background check';
  return undefined;
}

function dedupePreserveOrder(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = String(raw || '').trim();
    if (!n) continue;
    const k = normalizeNameKey(n);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

/**
 * Worker-facing copy for AccuSource screening: prefer catalog `services[]` names over package label.
 */
export function formatWorkerFacingScreeningPackage(input: {
  packageName?: string | null;
  services?: Array<{ id?: string; name?: string; type?: string }> | null;
}): FormatWorkerFacingScreeningPackageResult {
  const raw = Array.isArray(input.services) ? input.services : [];
  const items: WorkerFacingScreeningItem[] = [];
  const seenLabels = new Set<string>();
  for (const s of raw) {
    const label = String(s?.name ?? '').trim();
    if (!label) continue;
    const dedupeKey = normalizeNameKey(label);
    if (seenLabels.has(dedupeKey)) continue;
    seenLabels.add(dedupeKey);
    const type = s?.type != null ? String(s.type).trim() : undefined;
    const group = screeningTypeGroupLabel(type);
    items.push({ label, ...(group ? { type: group } : {}) });
  }

  if (items.length > 0) {
    const labels = items.map((i) => i.label);
    return {
      title: TITLE_WITH_ITEMS,
      items,
      summary: labels.join(', '),
    };
  }

  return {
    title: DEFAULT_TITLE,
    items: [],
    summary: DEFAULT_SUMMARY,
  };
}

/**
 * Maps a background check row to formatter input (prefers `requestedServicesCatalog` snapshot).
 */
export function workerFacingScreeningInputFromBackgroundRecord(
  r: Pick<BackgroundCheckRecord, 'requestedPackageName' | 'requestedServicesCatalog'>
): {
  packageName: string | null | undefined;
  services: Array<{ id?: string; name?: string; type?: string }> | null;
} {
  const catalog = Array.isArray(r.requestedServicesCatalog) ? r.requestedServicesCatalog : [];
  const services = catalog.map((s) => ({
    id: String(s.id ?? '').trim() || undefined,
    name: String(s.name ?? '').trim() || undefined,
    type: s.type != null ? String(s.type).trim() : undefined,
  }));
  return {
    packageName: r.requestedPackageName,
    services: services.length ? services : null,
  };
}

/**
 * Primary one-line label for worker UI: service names from catalog snapshot, else line items, else generic copy.
 * Does not lead with vendor package marketing names.
 */
export function workerFacingScreeningPrimaryLineFromRecord(
  r: BackgroundCheckRecord,
): string {
  const fromCatalog = formatWorkerFacingScreeningPackage(workerFacingScreeningInputFromBackgroundRecord(r));
  if (fromCatalog.items.length > 0) return fromCatalog.summary;

  const lineNames = dedupePreserveOrder(accusourceScreeningLineItems(r).map((x) => x.name));
  if (lineNames.length > 0) {
    return lineNames.join(', ');
  }

  return fromCatalog.summary;
}
