import type { AccusourceCatalogDocument, AccusourceCatalogPackage } from '../types/accusourceCatalog';

/** True when a non-empty id is not present in the synced catalog (catalog empty or stale id). */
export function isAccusourcePackageIdMissingFromCatalog(
  catalog: AccusourceCatalogDocument | null | undefined,
  packageId: string
): boolean {
  const id = String(packageId || '').trim();
  if (!id) return false;
  const pkgs = catalog?.packages;
  if (!pkgs?.length) return false;
  return !pkgs.some((p) => p.id === id);
}

export function findAccusourcePackageById(
  catalog: AccusourceCatalogDocument | null | undefined,
  packageId: string
): AccusourceCatalogPackage | undefined {
  const id = String(packageId || '').trim();
  if (!id) return undefined;
  return catalog?.packages?.find((p) => p.id === id);
}

/**
 * Human-readable service names for a catalog package (for job board copy, etc.).
 * Prefers embedded `services`; falls back to resolving `serviceIds` via catalog `services`.
 */
export function getAccusourcePackageServiceDisplayNames(
  catalog: AccusourceCatalogDocument | null | undefined,
  packageId: string
): string[] {
  const pkg = findAccusourcePackageById(catalog, packageId);
  if (!pkg) return [];
  const fromEmbedded = (pkg.services ?? [])
    .map((s) => String(s?.name ?? '').trim())
    .filter(Boolean);
  if (fromEmbedded.length > 0) {
    const seen = new Set<string>();
    return fromEmbedded.filter((n) => (seen.has(n) ? false : (seen.add(n), true)));
  }
  const svcMap = new Map((catalog?.services ?? []).map((s) => [s.id, String(s.name ?? '').trim()]));
  const ids = pkg.serviceIds ?? [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const sid of ids) {
    const label = (svcMap.get(sid) || sid).trim();
    if (label && !seen.has(label)) {
      seen.add(label);
      names.push(label);
    }
  }
  return names;
}
