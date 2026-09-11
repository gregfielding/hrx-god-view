/**
 * Change detection for sync passes. Every ingest of a portal page costs an
 * LLM extraction server-side, so a page whose visible text has not changed
 * since the last successful ingest is skipped (unless `force`, or the last
 * ingest is older than `maxAgeMs` — a periodic refresh keeps status honest
 * even if a change slipped past the hash).
 *
 * State lives in tenants/{t}/portal_state/{provider}_sync so every worker
 * shares it: { pages: { [key]: { hash, at, note? } }, updatedAt }.
 */
import { createHash } from 'node:crypto';
import { Timestamp, type Firestore } from './firebase.ts';
import { log } from './logger.ts';

export interface PageStamp {
  hash: string;
  /** ISO timestamp of the last successful ingest. */
  at: string;
  note?: string;
}

/** Collapse whitespace and drop obviously volatile lines (clock-like timestamps). */
export function normalizePageText(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?$/i.test(l))
    .join('\n');
}

export function hashPageText(text: string): string {
  return createHash('sha256').update(normalizePageText(text)).digest('hex').slice(0, 24);
}

export class SyncState {
  private pages: Record<string, PageStamp> = {};
  private loaded = false;
  private dirty = false;

  constructor(
    private readonly db: Firestore,
    private readonly tenantId: string,
    private readonly name: string,
  ) {}

  private get ref() {
    return this.db.collection('tenants').doc(this.tenantId).collection('portal_state').doc(this.name);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    const snap = await this.ref.get();
    this.pages = (snap.exists ? (snap.get('pages') as Record<string, PageStamp>) : {}) ?? {};
    this.loaded = true;
  }

  get(key: string): PageStamp | undefined {
    return this.pages[key];
  }

  /**
   * Decide whether to ingest. Returns the reason so the run summary can
   * report skipped-unchanged counts.
   */
  shouldIngest(key: string, hash: string, opts: { force?: boolean; maxAgeMs?: number } = {}): 'force' | 'new' | 'changed' | 'stale' | 'unchanged' {
    if (opts.force) return 'force';
    const prev = this.pages[key];
    if (!prev) return 'new';
    if (prev.hash !== hash) return 'changed';
    const ageMs = Date.now() - Date.parse(prev.at);
    if (opts.maxAgeMs !== undefined && ageMs > opts.maxAgeMs) return 'stale';
    return 'unchanged';
  }

  stamp(key: string, hash: string, note?: string): void {
    this.pages[key] = { hash, at: new Date().toISOString(), ...(note ? { note } : {}) };
    this.dirty = true;
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    try {
      await this.ref.set({ pages: this.pages, updatedAt: Timestamp.now() }, { merge: true });
      this.dirty = false;
    } catch (err) {
      log.warn('sync state save failed', { name: this.name, err });
    }
  }
}
