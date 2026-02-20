/**
 * E-Verify adapter: maps HRX inputs → provider payloads; provider statuses → HRX enums.
 * HRX E-Verify Master Plan §3.1
 */

import { EverifyCaseStatus } from './everifySchemas';
import type { EverifyCreateCaseRequest } from './everifyClient';

export function mapProviderStatusToHrx(providerStatus: string): EverifyCaseStatus {
  const lower = String(providerStatus || '').toLowerCase();
  if (lower.includes('authorized') || lower.includes('employment authorized'))
    return 'employment_authorized';
  if (lower.includes('tnc') || lower.includes('tentative nonconfirmation')) return 'tnc';
  if (lower.includes('dhs') && lower.includes('process')) return 'dhs_verification_in_process';
  if (lower.includes('further action')) return 'further_action_required';
  if (lower.includes('final') && lower.includes('nonconfirmation')) return 'final_nonconfirmation';
  if (lower.includes('closed')) return 'closed';
  if (lower.includes('error') || lower.includes('failed')) return 'error';
  if (lower.includes('pending') || lower.includes('submitted')) return 'submitted';
  return 'pending';
}

export function buildCreateCaseRequest(params: {
  tenantId: string;
  entityId: string;
  userId: string;
  everifyCompanyId: string;
  startDate: string;
  requestHash: string;
}): EverifyCreateCaseRequest {
  return {
    tenantId: params.tenantId,
    entityId: params.entityId,
    userId: params.userId,
    everifyCompanyId: params.everifyCompanyId,
    startDate: params.startDate,
    requestHash: params.requestHash,
  };
}
