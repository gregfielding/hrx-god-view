/**
 * Everee approval-group helpers (Phase B of HRX Everee Master Plan §5).
 *
 * Wraps the three Everee endpoints we care about for runtime management of
 * worker → approval-group routing:
 *
 *   GET  /integration/v1/approval-groups
 *   GET  /integration/v1/workers/{id}/approval-group
 *   PUT  /integration/v1/workers/{id}/approval-group     (body: {approvalGroupId | null})
 *
 * Phase A wired entity-level defaults into the create-worker path
 * (`createWorkerIfNeeded`). Phase B exposes runtime callables backed by
 * these helpers so admins can:
 *   - List the groups available in a given Everee tenant (UI dropdown source).
 *   - Look up which group a worker is currently in.
 *   - Re-assign a single worker to a different group (or clear the assignment
 *     by passing `null`).
 *   - Bulk-reassign every worker in an entity to a target group (used when an
 *     entity is migrated between Everee approval workflows; same surface the
 *     `backfillEvereeApprovalGroups20260513.js` scratch script uses, but
 *     callable from product UI without needing a service-account env).
 *
 * No business logic beyond the API call lives here — gating, validation,
 * and audit-trail writes belong in the callables.
 */

import type { EvereeEntityConfig } from './evereeConfig';
import { evereeRequest } from './evereeHttp';

export interface EvereeApprovalGroup {
  id: string;
  name?: string;
  description?: string | null;
  /**
   * Pass-through for fields Everee may surface that we don't model yet
   * (createdAt, updatedAt, approvers, …). Callers use it for diagnostics
   * but should NOT depend on stable shape.
   */
  raw?: Record<string, unknown>;
}

interface ApprovalGroupsListResponse {
  approvalGroups?: unknown;
  data?: unknown;
  results?: unknown;
}

/**
 * GET /integration/v1/approval-groups
 *
 * Everee's response shape is undocumented in detail; we defensively look in
 * `approvalGroups`, `data`, and `results` (we've seen all three in similar
 * Everee endpoints). Returns `[]` when the response is malformed rather
 * than throwing — this keeps the admin UI degradation graceful (empty
 * dropdown vs. error toast).
 */
export async function listEvereeApprovalGroups(
  config: EvereeEntityConfig,
): Promise<EvereeApprovalGroup[]> {
  const raw = await evereeRequest<ApprovalGroupsListResponse | unknown[]>(
    config,
    'GET',
    '/integration/v1/approval-groups',
  );
  const candidates = (() => {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
      const r = raw as ApprovalGroupsListResponse;
      if (Array.isArray(r.approvalGroups)) return r.approvalGroups;
      if (Array.isArray(r.data)) return r.data;
      if (Array.isArray(r.results)) return r.results;
    }
    return [];
  })();

  const out: EvereeApprovalGroup[] = [];
  for (const item of candidates as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    // Everee ids are always strings on the wire ("7900"). Coerce defensively
    // in case someone returns numerics somewhere downstream.
    const id =
      typeof obj.id === 'string'
        ? obj.id
        : typeof obj.id === 'number' && Number.isFinite(obj.id)
          ? String(obj.id)
          : '';
    if (!id) continue;
    out.push({
      id,
      name: typeof obj.name === 'string' ? obj.name : undefined,
      description: typeof obj.description === 'string' ? obj.description : null,
      raw: obj,
    });
  }
  return out;
}

interface WorkerApprovalGroupResponse {
  approvalGroupId?: unknown;
  approvalGroup?: { id?: unknown } | null;
}

/**
 * GET /integration/v1/workers/{id}/approval-group
 *
 * Returns the assigned id (string) or `null` when the worker is unassigned.
 * Throws on 4xx/5xx so callers can distinguish "no group" from "API down".
 */
export async function getEvereeWorkerApprovalGroupId(
  config: EvereeEntityConfig,
  externalWorkerId: string,
): Promise<string | null> {
  const raw = await evereeRequest<WorkerApprovalGroupResponse | unknown>(
    config,
    'GET',
    `/integration/v1/workers/${encodeURIComponent(externalWorkerId)}/approval-group`,
  );
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as WorkerApprovalGroupResponse;
  const direct = r.approvalGroupId;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  if (typeof direct === 'number' && Number.isFinite(direct)) return String(direct);
  const nested = r.approvalGroup?.id;
  if (typeof nested === 'string' && nested.trim()) return nested.trim();
  if (typeof nested === 'number' && Number.isFinite(nested)) return String(nested);
  return null;
}

/**
 * PUT /integration/v1/workers/{id}/approval-group
 *
 * Pass `approvalGroupId: null` to clear the assignment. Everee returns 200
 * on success (204 in some tenants); we don't need the body. Throws on
 * non-2xx via `evereeRequest`.
 */
export async function setEvereeWorkerApprovalGroup(
  config: EvereeEntityConfig,
  externalWorkerId: string,
  approvalGroupId: string | null,
): Promise<void> {
  await evereeRequest<unknown>(
    config,
    'PUT',
    `/integration/v1/workers/${encodeURIComponent(externalWorkerId)}/approval-group`,
    { approvalGroupId },
  );
}
