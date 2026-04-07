import { getAccusourceBearerToken } from './accusourceAccessToken';
import { getAccusourceConfig } from './config';
import { accusourceLog } from './accusourceLogger';

export interface AccusourceRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * POST /api/v2/profile/partial body (SourceDirect API V2).
 * @see https://sdapi.accusourcedirect.com/documentation/external.html — Create a new profile (partial)
 */
export interface AccusourceV2PartialProfileBody {
  /** Required: integer package id from GET /api/v2/company/details (synced catalog). */
  packageId: number;
  /** HRX correlation id (echoed on webhooks). */
  clientId: string;
  /** Subject / applicant — partial profile; remaining data via Applicant Portal. */
  subject: Record<string, unknown>;
  notes?: string;
  createdBy?: string;
  ecocEmail?: string;
  drugScreenReason?: string;
  drugScreenTestingAuthority?: string;
  drugScreenAutomaticScheduling?: boolean;
  drugScreenApplicantScheduling?: boolean;
  accountingCodes?: { primary?: string; secondary?: string; tertiary?: string };
  accountingCode?: string;
  accountingCodeId?: number;
  customFields?: Record<string, string>;
  /**
   * À la carte add-on services (catalog service ids). Each `serviceId` must exist in company/details.
   * @see SourceDirect V2 partial profile — `orders` with `serviceId` per service.
   */
  orders?: Array<{ serviceId: number }>;
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

/** Request metadata for catalog sync (no secrets). */
export type AccusourceCompanyDetailsRequestMeta = {
  fullUrl: string;
  /** Value sent as `isActive` query param (e.g. `1`, `0`, `all`). */
  isActiveParam: string;
  relativePath: string;
};

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

    accusourceLog('info', 'http', `${method} ${normalizedPath}`, {
      method,
      path: normalizedPath,
    });

    const response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (!response.ok) {
      const text = await response.text();
      accusourceLog('error', 'http', 'AccuSource HTTP error response', {
        method,
        path: normalizedPath,
        status: response.status,
        bodySnippet: text.slice(0, 500),
      });
      throw new Error(`AccuSource request failed (${response.status}): ${text}`);
    }

    if (response.status === 204) {
      accusourceLog('info', 'http', `${method} ${normalizedPath} → 204`, { method, path: normalizedPath });
      return undefined as T;
    }

    accusourceLog('info', 'http', `${method} ${normalizedPath} → ${response.status}`, {
      method,
      path: normalizedPath,
      status: response.status,
    });

    return (await response.json()) as T;
  }

  /** POST documented V2 partial profile (override path only for vendor-approved aliases). */
  async createPartialProfile(payload: AccusourceV2PartialProfileBody): Promise<AccusourcePartialProfileResponse> {
    const createPath = process.env.ACCUSOURCE_CREATE_PROFILE_PATH || '/api/v2/profile/partial';
    return this.request<AccusourcePartialProfileResponse>(createPath, {
      method: 'POST',
      body: payload,
    });
  }

  private buildCompanyDetailsRelativePath(isActive: number | 'all'): {
    relativePath: string;
    isActiveParam: string;
  } {
    const pathBase = process.env.ACCUSOURCE_COMPANY_DETAILS_PATH || '/api/v2/company/details';
    const param = isActive === 'all' ? 'all' : String(isActive);
    const sep = pathBase.includes('?') ? '&' : '?';
    let relativePath = `${pathBase}${sep}isActive=${encodeURIComponent(param)}`;
    if (!relativePath.startsWith('/')) {
      relativePath = `/${relativePath}`;
    }
    return { relativePath, isActiveParam: param };
  }

  /**
   * Company catalog: packages + services (SourceDirect API V2).
   * @param isActive 1 = active only, 0 = inactive only, 'all' = both
   */
  async getCompanyDetails(isActive: number | 'all' = 1): Promise<{
    raw: unknown;
    meta: AccusourceCompanyDetailsRequestMeta;
  }> {
    const { relativePath, isActiveParam } = this.buildCompanyDetailsRelativePath(isActive);
    const raw = await this.request(relativePath, { method: 'GET' });
    const fullUrl = `${this.baseUrl}${relativePath}`;
    return {
      raw,
      meta: { fullUrl, isActiveParam, relativePath },
    };
  }
}

export const accusourceClient = new AccusourceClient();

