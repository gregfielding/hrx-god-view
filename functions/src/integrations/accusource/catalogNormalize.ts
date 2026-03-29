/**
 * Normalize SourceDirect GET /api/v2/company/details into stable catalog rows for Firestore.
 * @see docs/SOURCEDIRECT_API_REFERENCE.md
 */

export interface NormalizedAccusourcePackage {
  id: string;
  name: string;
  isActive: boolean;
  fee?: number;
  serviceIds: string[];
  services: Array<{ id: string; name: string; type?: string }>;
}

export interface NormalizedAccusourceService {
  id: string;
  name: string;
  type?: string;
}

function numId(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

export function normalizeAccusourceCompanyDetailsResponse(raw: unknown): {
  packages: NormalizedAccusourcePackage[];
  services: NormalizedAccusourceService[];
  companyCount: number;
} {
  const root = raw as Record<string, unknown>;
  const payload = root.payload;
  const companies: unknown[] = Array.isArray(payload)
    ? payload
    : payload != null && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).companies)
      ? ((payload as Record<string, unknown>).companies as unknown[])
      : [];

  const packagesById = new Map<string, NormalizedAccusourcePackage>();
  const servicesById = new Map<string, NormalizedAccusourceService>();

  for (const c of companies) {
    if (c == null || typeof c !== 'object') continue;
    const co = c as Record<string, unknown>;
    const pkgs = Array.isArray(co.packages) ? co.packages : [];
    for (const p of pkgs) {
      if (p == null || typeof p !== 'object') continue;
      const row = p as Record<string, unknown>;
      const id = numId(row.id);
      if (!id) continue;
      const name = String(row.package ?? row.name ?? '').trim() || id;
      const isActive = row.isActive !== false && row.isActive !== 0 && row.isActive !== '0';
      const fee = typeof row.fee === 'number' ? row.fee : undefined;
      const servicesNested = Array.isArray(row.services) ? row.services : [];
      const nestedServices: Array<{ id: string; name: string; type?: string }> = [];
      for (const s of servicesNested) {
        if (s == null || typeof s !== 'object') continue;
        const sv = s as Record<string, unknown>;
        const sid = numId(sv.id);
        if (!sid) continue;
        const sname = String(sv.service ?? sv.name ?? '').trim() || sid;
        const type = sv.type != null ? String(sv.type) : undefined;
        nestedServices.push({ id: sid, name: sname, type });
        servicesById.set(sid, { id: sid, name: sname, type });
      }
      const serviceIds = nestedServices.map((x) => x.id);
      packagesById.set(id, {
        id,
        name,
        isActive,
        fee,
        serviceIds,
        services: nestedServices,
      });
    }
    const topServices = Array.isArray(co.services) ? co.services : [];
    for (const s of topServices) {
      if (s == null || typeof s !== 'object') continue;
      const sv = s as Record<string, unknown>;
      const sid = numId(sv.id);
      if (!sid) continue;
      const sname = String(sv.service ?? sv.name ?? '').trim() || sid;
      const type = sv.type != null ? String(sv.type) : undefined;
      servicesById.set(sid, { id: sid, name: sname, type });
    }
  }

  const packages = Array.from(packagesById.values()).sort((a, b) => a.name.localeCompare(b.name));
  const services = Array.from(servicesById.values()).sort((a, b) => a.name.localeCompare(b.name));
  return { packages, services, companyCount: companies.length };
}
