/**
 * HRX courier endpoints — the same HTTP contract the Chrome extensions use
 * (functions/src/integrations/fieldglass/enrichmentApi.ts and
 * functions/src/integrations/indeedFlex/*Ingest.ts), authenticated with the
 * static extension keys. Errors carry HRX's {code,message} when present.
 */
import type { WorkerConfig } from './config.ts';
import { PortalActionFailure } from './errors.ts';

export class HrxApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HrxApiError';
  }
}

async function call<T>(
  config: WorkerConfig,
  key: string,
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 120_000);
  try {
    const res = await fetch(`${config.hrxBaseUrl}/${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { code?: string; message?: string } } & T;
    if (!res.ok || data.success === false) {
      const code = data.error?.code || `HTTP_${res.status}`;
      const message = data.error?.message || `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 503) {
        throw new PortalActionFailure('INVALID_PAYLOAD', `HRX rejected the extension key (${code}: ${message})`);
      }
      throw new HrxApiError(res.status, code, message);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// --- Fieldglass ---------------------------------------------------------------

export interface FieldglassQueueItem {
  requestId: string;
  postingId: string;
  detailUrl: string | null;
  title: string | null;
  siteName: string | null;
}

export async function fetchFieldglassQueue(config: WorkerConfig, key: string): Promise<FieldglassQueueItem[]> {
  const data = await call<{ pending?: FieldglassQueueItem[] }>(
    config,
    key,
    `fieldglassEnrichmentQueue?tenantId=${encodeURIComponent(config.tenantId)}`,
    { timeoutMs: 60_000 },
  );
  return data.pending ?? [];
}

export interface FieldglassIngestResult {
  requestId: string;
  postingId: string;
  created: boolean;
  candidateInMind: boolean;
  fieldsExtracted: number;
  siteResolution: Record<string, unknown> | null;
  jobOrder: { action?: string; [k: string]: unknown } | null;
}

// --- Indeed Flex --------------------------------------------------------------

export interface FlexPortalEnvelope {
  agencyId: string | null;
  context: { jobId: string; roleId: string | null; venueId: string | null; platformId: string | null; url: string | null };
  job: unknown;
  shifts: unknown;
  roster: unknown;
  capturedAt: number;
}

export interface FlexPortalIngestResult {
  flexJobId?: string;
  matched?: boolean;
  reason?: string;
  created?: number;
  reconfirmed?: number;
  observedDrops?: number;
  unmatchedWorkers?: unknown[];
  [k: string]: unknown;
}

export async function ingestFlexPortalCapture(config: WorkerConfig, key: string, envelope: FlexPortalEnvelope): Promise<FlexPortalIngestResult> {
  return call<FlexPortalIngestResult>(config, key, 'indeedFlexPortalIngest', {
    method: 'POST',
    body: { tenantId: config.tenantId, ...envelope },
    timeoutMs: 120_000,
  });
}

export interface FlexTimesheetIngestResult {
  entries?: number;
  ok?: number;
  okUnlinkedJob?: number;
  workerUnmatched?: number;
  noAssignment?: number;
  [k: string]: unknown;
}

export async function ingestFlexTimesheets(
  config: WorkerConfig,
  key: string,
  envelope: { url: string; entries: unknown; capturedAt: number },
): Promise<FlexTimesheetIngestResult> {
  return call<FlexTimesheetIngestResult>(config, key, 'indeedFlexTimesheetIngest', {
    method: 'POST',
    body: { tenantId: config.tenantId, ...envelope },
    timeoutMs: 120_000,
  });
}

export async function ingestFieldglassPage(
  config: WorkerConfig,
  key: string,
  input: { pageText: string; url: string; postingId?: string },
): Promise<FieldglassIngestResult> {
  return call<FieldglassIngestResult>(config, key, 'fieldglassEnrichmentIngest', {
    method: 'POST',
    body: {
      tenantId: config.tenantId,
      pageText: input.pageText,
      url: input.url,
      ...(input.postingId ? { postingId: input.postingId } : {}),
    },
    timeoutMs: 150_000, // LLM extraction runs server-side (10-60s)
  });
}
