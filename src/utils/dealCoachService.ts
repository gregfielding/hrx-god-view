import { getFunctions, httpsCallable } from 'firebase/functions';

type AnalyzeParams = {
  dealId: string;
  stageKey?: string;
  tenantId: string;
  entityType?: string;
  entityName?: string;
  contactCompany?: string;
  contactTitle?: string;
};

type AnalyzeResult = {
  summary: string;
  suggestions?: any[];
};

/**
 * Client-side singleton to drastically cut dealCoachAnalyzeCallable invocations.
 * - 2h TTL persistent cache (localStorage) + in-memory cache
 * - Global per-entity debounce (5 minutes)
 * - Coalesces in-flight requests
 * - Visibility of consumers can further gate calls; service itself guarantees TTL/minInterval
 */
class DealCoachService {
  private static instance: DealCoachService | null = null;
  static getInstance(): DealCoachService {
    if (!DealCoachService.instance) DealCoachService.instance = new DealCoachService();
    return DealCoachService.instance;
  }

  private memoryCache = new Map<string, { at: number; result: AnalyzeResult }>();
  private inFlight = new Map<string, Promise<AnalyzeResult>>();
  private lastCallAt = new Map<string, number>(); // per key min interval

  private readonly TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
  private readonly MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  private key(params: AnalyzeParams): string {
    return `${params.dealId}|${params.stageKey || 'general'}`;
  }

  private lsKey(params: AnalyzeParams): string {
    return `coach.analysis.${params.dealId}.${params.stageKey || 'general'}`;
  }

  async analyze(params: AnalyzeParams, options?: { force?: boolean }): Promise<AnalyzeResult> {
    const key = this.key(params);
    const now = Date.now();

    // Serve valid in-memory cache
    const mem = this.memoryCache.get(key);
    if (!options?.force && mem && now - mem.at < this.TTL_MS) {
      return mem.result;
    }

    // Serve valid localStorage cache
    if (!options?.force) {
      try {
        const raw = localStorage.getItem(this.lsKey(params));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (now - parsed.timestamp < this.TTL_MS && parsed.summary) {
            const result: AnalyzeResult = { summary: parsed.summary, suggestions: parsed.suggestions || [] };
            this.memoryCache.set(key, { at: parsed.timestamp, result });
            return result;
          }
        }
      } catch {}
    }

    // Global per-entity debounce
    if (!options?.force) {
      const prev = this.lastCallAt.get(key) || 0;
      if (now - prev < this.MIN_INTERVAL_MS) {
        // If we have any cached value, serve that; otherwise short-circuit with empty result
        const fallback = this.memoryCache.get(key)?.result || { summary: '' };
        return fallback;
      }
    }

    // Coalesce in-flight
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const p = (async () => {
      this.lastCallAt.set(key, now);
      const functions = getFunctions(undefined, 'us-central1');
      const analyzeFn = httpsCallable(functions, 'dealCoachAnalyzeCallable');
      const resp: any = await analyzeFn({
        dealId: params.dealId,
        stageKey: params.stageKey || 'general',
        tenantId: params.tenantId,
        entityType: params.entityType || 'deal',
        entityName: params.entityName || 'Unknown',
        contactCompany: params.contactCompany || '',
        contactTitle: params.contactTitle || ''
      });
      const data = resp?.data || {};
      const result: AnalyzeResult = { summary: data.summary || '', suggestions: data.suggestions || [] };
      const stamped = { at: Date.now(), result };
      this.memoryCache.set(key, stamped);
      try {
        localStorage.setItem(this.lsKey(params), JSON.stringify({ summary: result.summary, suggestions: result.suggestions, timestamp: stamped.at }));
      } catch {}
      this.inFlight.delete(key);
      return result;
    })();

    this.inFlight.set(key, p);
    return p;
  }
}

export const getDealCoachService = (): DealCoachService => DealCoachService.getInstance();


