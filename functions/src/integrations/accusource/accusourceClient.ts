import { getAccusourceBearerToken } from './accusourceAccessToken';
import { getAccusourceConfig } from './config';

export interface AccusourceRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

export interface AccusourcePartialProfileRequest {
  clientId: string;
  candidate: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    dateOfBirth?: string;
  };
  account?: {
    accountId?: string;
    accountName?: string;
  };
  job?: {
    jobOrderId?: string;
    worksiteId?: string;
  };
  package?: {
    packageId?: string;
    packageName?: string;
  };
  requestedServices?: string[];
  metadata?: Record<string, unknown>;
}

export interface AccusourcePartialProfileResponse {
  profileId?: string;
  providerProfileId?: string;
  clientId?: string;
  portalLink?: string;
  applicantPortalUrl?: string;
  status?: string;
  [key: string]: unknown;
}

/**
 * SourceDirect API client scaffold for Phase 1.
 * Phase 2 will add create-profile and order-specific methods.
 */
export class AccusourceClient {
  private readonly baseUrl: string;

  constructor() {
    const cfg = getAccusourceConfig();
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
  }

  async request<T = unknown>(path: string, options: AccusourceRequestOptions = {}): Promise<T> {
    const method = options.method || 'GET';
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${this.baseUrl}${normalizedPath}`;

    const headers: Record<string, string> = { ...options.headers };
    if (method !== 'GET') {
      headers['content-type'] = headers['content-type'] || 'application/json';
    }
    const bearer = await getAccusourceBearerToken();
    if (bearer) {
      headers.authorization = `Bearer ${bearer}`;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AccuSource request failed (${response.status}): ${text}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async createPartialProfile(payload: AccusourcePartialProfileRequest): Promise<AccusourcePartialProfileResponse> {
    const createPath = process.env.ACCUSOURCE_CREATE_PROFILE_PATH || '/profiles';
    return this.request<AccusourcePartialProfileResponse>(createPath, {
      method: 'POST',
      body: payload,
    });
  }

  /**
   * Company catalog: packages + services (SourceDirect API V2).
   * @param isActive 1 = active only, 0 = inactive only, 'all' = both
   */
  async getCompanyDetails(isActive: number | 'all' = 1): Promise<unknown> {
    const pathBase = process.env.ACCUSOURCE_COMPANY_DETAILS_PATH || '/api/v2/company/details';
    const param = isActive === 'all' ? 'all' : String(isActive);
    const sep = pathBase.includes('?') ? '&' : '?';
    return this.request(`${pathBase}${sep}isActive=${encodeURIComponent(param)}`, { method: 'GET' });
  }
}

export const accusourceClient = new AccusourceClient();

