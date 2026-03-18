import type { AccusourcePartialProfileRequest, AccusourcePartialProfileResponse } from './accusourceClient';

type AnyRecord = Record<string, unknown>;

function toStr(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

export interface CreateBackgroundCheckInput {
  tenantId?: string;
  accountId?: string;
  accountName?: string;
  candidateId?: string;
  candidateName?: string;
  applicantId?: string;
  jobOrderId?: string;
  worksiteId?: string;
  requestedPackageId?: string;
  requestedPackageName?: string;
  requestedServices?: string[];
  candidate?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    dateOfBirth?: string;
  };
}

export function buildPartialProfilePayload(
  input: CreateBackgroundCheckInput,
  clientId: string,
  backgroundCheckId: string,
): AccusourcePartialProfileRequest {
  return {
    clientId,
    candidate: {
      firstName: toStr(input.candidate?.firstName),
      lastName: toStr(input.candidate?.lastName),
      email: toStr(input.candidate?.email),
      phone: toStr(input.candidate?.phone),
      dateOfBirth: toStr(input.candidate?.dateOfBirth),
    },
    account: {
      accountId: toStr(input.accountId),
      accountName: toStr(input.accountName),
    },
    job: {
      jobOrderId: toStr(input.jobOrderId),
      worksiteId: toStr(input.worksiteId),
    },
    package: {
      packageId: toStr(input.requestedPackageId),
      packageName: toStr(input.requestedPackageName),
    },
    requestedServices: Array.isArray(input.requestedServices)
      ? input.requestedServices.map((s) => String(s || '').trim()).filter(Boolean)
      : [],
    metadata: {
      source: 'hrx',
      integration: 'accusource',
      orderMode: 'partial_profile',
      backgroundCheckId,
    },
  };
}

export function parseProviderCreateResponse(response: AccusourcePartialProfileResponse): {
  providerProfileId: string | null;
  providerClientId: string | null;
  applicantPortalLink: string | null;
  providerStatus: string | null;
  raw: AnyRecord;
} {
  const raw = (response || {}) as AnyRecord;
  const providerProfileId = toStr(
    response.providerProfileId ||
    response.profileId ||
    raw.profile_id ||
    raw.applicantProfileId
  ) || null;
  const providerClientId = toStr(response.clientId || raw.client_id || raw.referenceId) || null;
  const applicantPortalLink = toStr(response.applicantPortalUrl || response.portalLink || raw.portal_url || raw.portalLink) || null;
  const providerStatus = toStr(response.status || raw.profileStatus || raw.state) || null;

  return {
    providerProfileId,
    providerClientId,
    applicantPortalLink,
    providerStatus,
    raw,
  };
}

