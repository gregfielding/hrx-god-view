import type { BackgroundCheckRecord, ServiceOrderStatusEntry } from '../types/backgroundCheck';

export type AccusourceScreeningLineItem = {
  id: string;
  name: string;
  type?: string;
  status: string;
};

/**
 * One row per ordered catalog screen: name + webhook status (or Pending until AccuSource reports).
 */
export function accusourceScreeningLineItems(r: BackgroundCheckRecord): AccusourceScreeningLineItem[] {
  const byId = (r.providerServiceOrderStatus ?? {}) as Record<string, ServiceOrderStatusEntry>;
  const catalog = Array.isArray(r.requestedServicesCatalog) ? r.requestedServicesCatalog : [];
  const idsFromReq = Array.isArray(r.requestedServices) ? r.requestedServices.map(String) : [];

  if (catalog.length > 0) {
    return catalog.map((s) => {
      const id = String(s.id).trim();
      const entry = byId[id];
      const status = String(entry?.status ?? '').trim() || 'Pending';
      return {
        id,
        name: String(s.name || '').trim() || id,
        type: s.type != null ? String(s.type).trim() : undefined,
        status,
      };
    });
  }

  const ids = idsFromReq.length > 0 ? idsFromReq : Object.keys(byId);
  if (ids.length === 0) return [];

  return ids.map((id) => {
    const entry = byId[id];
    const status = String(entry?.status ?? '').trim() || 'Pending';
    const name = String(entry?.serviceName ?? '').trim() || id;
    return { id, name, type: undefined, status };
  });
}
