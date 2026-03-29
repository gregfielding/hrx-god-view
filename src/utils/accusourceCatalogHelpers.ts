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
