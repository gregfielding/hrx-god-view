/**
 * Name the `order:*` service lines that AccuSource's webhooks leave blank.
 *
 * **The gap** (found 2026-07-15 on Payton Harris + Charles Scott): some
 * SourceDirect webhooks are order-level — they carry `order_id` but no
 * `service_id`/`service_name` — so `accusourceWebhookServiceLine` keys the
 * line `order:{id}` and names it "Order 9356691". The panel then shows an
 * unlabeled row (and, before the AC.0a guard fix, hid it entirely). The
 * recruiter can see a screen finished but not WHICH screen.
 *
 * **The fix**: `GET /api/v2/order/{orderId}` (undocumented — found by live
 * probe) returns the authoritative `serviceId` + `serviceTypeAlias`, which
 * we resolve against the synced package catalog
 * (`integrations_accusource/catalog`) to get the real name:
 *
 *   order 9356691 → serviceId 68207 → "CrimNet"
 *   order 9356696 → serviceId 68208 → "County Criminal"
 *
 * **Why not infer from the package**: Charles's package lists 3 services but
 * his profile had 4 orders — CrimNet spawns county-level searches beyond the
 * package's base set. Positional guessing would mislabel a criminal search,
 * which is unacceptable in an FCRA adjudication surface. Only the vendor's
 * own serviceId is trustworthy here.
 *
 * Best-effort by design: a failed lookup leaves the line as-is (still
 * visible, still adjudicable) rather than failing the webhook.
 */
import * as admin from 'firebase-admin';
import { accusourceClient } from './accusourceClient';
import { accusourceLog } from './accusourceLogger';
import { ACCUSOURCE_CATALOG_DOC_PATH } from './syncPackageCatalog';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** `order:9356691` → `9356691`; anything else → null. */
function orderIdFromKey(key: string): string | null {
  const m = /^order:(\d+)$/.exec(String(key ?? '').trim());
  return m ? m[1] : null;
}

/** True when the line still carries the placeholder "Order N" name. */
function needsName(line: Record<string, unknown>): boolean {
  const name = String(line?.serviceName ?? '').trim();
  return name === '' || /^order\s+\S+$/i.test(name);
}

interface CatalogService {
  id: string;
  name: string;
  type?: string;
}

let catalogCache: { byId: Map<string, CatalogService>; at: number } | null = null;
const CATALOG_TTL_MS = 10 * 60 * 1000;

async function serviceNameIndex(): Promise<Map<string, CatalogService>> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.byId;
  const snap = await db.doc(ACCUSOURCE_CATALOG_DOC_PATH).get();
  const services = (snap.data()?.services ?? []) as CatalogService[];
  const byId = new Map<string, CatalogService>();
  for (const s of services) {
    if (s?.id != null) byId.set(String(s.id), s);
  }
  catalogCache = { byId, at: Date.now() };
  return byId;
}

interface AccusourceOrderDetail {
  serviceId?: number | string;
  serviceTypeAlias?: string;
  statusId?: string | number;
  completedDate?: string | null;
}

/** GET /api/v2/order/{id} — undocumented; returns `{ payload: {...} }`. */
async function fetchOrderDetail(orderId: string): Promise<AccusourceOrderDetail | null> {
  try {
    const res = await accusourceClient.request<{ payload?: AccusourceOrderDetail }>(
      `/api/v2/order/${encodeURIComponent(orderId)}`,
    );
    return res?.payload ?? null;
  } catch (err) {
    accusourceLog('warn', 'http', 'order detail lookup failed (line keeps placeholder name)', {
      orderId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface ResolveOrderNamesResult {
  checked: number;
  named: number;
  unresolved: number;
}

/**
 * Fill in real service names on a backgroundChecks doc's `order:*` lines.
 * Only touches lines that still hold a placeholder name; never overwrites a
 * name the vendor already gave us (e.g. the lab-payload "Quest Drug Screen").
 */
export async function resolveOrderServiceNames(
  backgroundCheckId: string,
): Promise<ResolveOrderNamesResult> {
  const out: ResolveOrderNamesResult = { checked: 0, named: 0, unresolved: 0 };
  const ref = db.collection('backgroundChecks').doc(backgroundCheckId);
  const snap = await ref.get();
  if (!snap.exists) return out;

  const lines = (snap.get('providerServiceOrderStatus') ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const targets = Object.entries(lines).filter(
    ([key, line]) => orderIdFromKey(key) !== null && needsName(line),
  );
  if (targets.length === 0) return out;

  const byId = await serviceNameIndex();
  const patch: Record<string, unknown> = {};

  for (const [key, line] of targets) {
    out.checked += 1;
    const orderId = orderIdFromKey(key) as string;
    const detail = await fetchOrderDetail(orderId);
    const serviceId = detail?.serviceId != null ? String(detail.serviceId) : '';
    const svc = serviceId ? byId.get(serviceId) : undefined;
    if (!svc) {
      out.unresolved += 1;
      continue;
    }
    patch[`providerServiceOrderStatus.${key}`] = {
      ...line,
      serviceName: svc.name,
      serviceId: serviceId,
      serviceType: svc.type ?? detail?.serviceTypeAlias ?? null,
      nameResolvedAt: admin.firestore.Timestamp.now(),
      nameResolvedFrom: 'accusource_order_detail',
    };
    out.named += 1;
  }

  if (Object.keys(patch).length > 0) {
    await ref.update(patch);
    accusourceLog('info', 'webhook', 'Resolved order-level line names from vendor', {
      backgroundCheckId,
      ...out,
    });
  }
  return out;
}
