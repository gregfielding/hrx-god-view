import type { CertificationShadowEventLike } from '../../types/certifications/certEngineShadowEvent';

export type CertificationShadowStats = {
  totalEvents: number;
  /** Mismatch docs / total events (0 if no events). */
  mismatchRate: number;

  bySurface: {
    apply: number;
    placement: number;
    readiness: number;
  };

  topUnmappedStrings: Array<{
    label: string;
    count: number;
  }>;

  /** Catalog / label keys most often present on mismatch events (for alias work). */
  topMismatchCerts: Array<{
    catalogEntryId?: string;
    legacyLabel?: string;
    count: number;
  }>;
};

const CRITICAL_IDS = new Set(['forklift-certification', 'food-handler-card']);

function sortCountDesc(items: Array<{ count: number }>): void {
  items.sort((a, b) => b.count - a.count);
}

function bumpStringCount(map: Map<string, number>, key: string, n = 1): void {
  map.set(key, (map.get(key) ?? 0) + n);
}

/**
 * Pure aggregation over shadow event docs (from query or fixtures).
 */
export function buildCertificationShadowStats(events: CertificationShadowEventLike[]): CertificationShadowStats {
  const totalEvents = events.length;
  let mismatches = 0;
  const bySurface = { apply: 0, placement: 0, readiness: 0 };
  const unmappedMap = new Map<string, number>();
  const mismatchCertMap = new Map<string, { catalogEntryId?: string; legacyLabel?: string; count: number }>();

  for (const ev of events) {
    const s = ev.surface;
    if (s === 'apply') bySurface.apply += 1;
    else if (s === 'placement') bySurface.placement += 1;
    else if (s === 'readiness') bySurface.readiness += 1;

    if (ev.mismatched) {
      mismatches += 1;
      const detail = ev.details;
      for (const u of detail?.unmappedStrings ?? []) {
        if (typeof u === 'string' && u.trim()) bumpStringCount(unmappedMap, u.trim());
      }
      const ids = detail?.resolvedCatalogIds?.length
        ? detail.resolvedCatalogIds
        : ((detail?.engine as { rows?: Array<{ catalogEntryId?: string; legacySourceLabel?: string }> })?.rows ?? [])
            .map((r) => r.catalogEntryId)
            .filter((x): x is string => typeof x === 'string' && x.length > 0);
      for (const id of ids) {
        const k = `id:${id}`;
        const row = (detail?.engine as { rows?: Array<{ catalogEntryId?: string; legacySourceLabel?: string }> })?.rows?.find(
          (r) => r.catalogEntryId === id,
        );
        const prev = mismatchCertMap.get(k) ?? {
          catalogEntryId: id,
          legacyLabel: row?.legacySourceLabel,
          count: 0,
        };
        prev.count += 1;
        if (!prev.legacyLabel && row?.legacySourceLabel) prev.legacyLabel = row.legacySourceLabel;
        mismatchCertMap.set(k, prev);
      }
      const leg = detail?.legacy as { missingLabels?: string[] } | undefined;
      for (const lab of leg?.missingLabels ?? []) {
        if (typeof lab === 'string' && lab.trim()) {
          const k = `lab:${lab.trim()}`;
          const prev = mismatchCertMap.get(k) ?? { legacyLabel: lab.trim(), count: 0 };
          prev.count += 1;
          mismatchCertMap.set(k, prev);
        }
      }
    }
  }

  const topUnmappedStrings = [...unmappedMap.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const topMismatchCertsRaw = [...mismatchCertMap.values()];
  sortCountDesc(topMismatchCertsRaw);
  const criticalFirst = [...topMismatchCertsRaw].sort((a, b) => {
    const ac = a.catalogEntryId && CRITICAL_IDS.has(a.catalogEntryId) ? 1 : 0;
    const bc = b.catalogEntryId && CRITICAL_IDS.has(b.catalogEntryId) ? 1 : 0;
    if (ac !== bc) return bc - ac;
    return b.count - a.count;
  });

  return {
    totalEvents,
    mismatchRate: totalEvents > 0 ? mismatches / totalEvents : 0,
    bySurface,
    topUnmappedStrings: topUnmappedStrings.slice(0, 5),
    topMismatchCerts: criticalFirst.slice(0, 5),
  };
}
