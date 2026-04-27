/**
 * Read-only QA batch review for worker AI prescreen interviews (`users/{uid}/interviews/*`, interviewKind === worker_ai_prescreen).
 *
 * Does not write Firestore, send messages, or mutate interviews.
 *
 * Usage (repo root):
 *   npx ts-node --project scripts/tsconfig.json scripts/reviewPrescreenInterviewBatch.ts [options]
 *
 * Cursor file (optional, for repeated runs):
 *   Default path: .qa/prescreen-review-cursor.json (override with --cursor-file=)
 *   --cursor-read         Apply stored cursor filters (incremental and/or pagination bounds merged with --after/--before)
 *   --cursor-write=mode   After a successful run, update cursor: incremental | pagination | both
 *   --dry-run-cursor      Do not write cursor file
 *
 * Incremental cursor: stores max(createdAt) in batch → next run with --cursor-read only loads interviews **newer** than that.
 * Pagination cursor: stores min(createdAt) in batch → next run with --cursor-read only loads interviews **older** than that (walk back in time).
 *
 * Efficiency:
 *   - Default path uses collectionGroup `interviews` + `interviewKind == worker_ai_prescreen` + `orderBy createdAt desc`
 *     with optional **single-field range** on `createdAt` (indexed — see firestore.indexes.json).
 *   - Filters like decision, score, flags, applicationId are applied **in memory** after fetch; use --max-scans to cap reads
 *     (default 400). If filters are very selective, the script may scan many docs before filling --limit.
 *   - `--user-id` uses only `orderBy(createdAt)` on that user’s interviews subcollection and filters kind/time in memory
 *     (avoids needing a per-user composite index).
 *
 * Examples:
 *   npm run qa:prescreen-review -- --limit=10
 *   npm run qa:prescreen-review -- --limit=10 --decision=review
 *   npm run qa:prescreen-review -- --limit=10 --flag=vague_response
 *   npm run qa:prescreen-review -- --limit=10 --has-application=true
 *   npm run qa:prescreen-review -- --limit=10 --has-application=false
 *   npm run qa:prescreen-review -- --min-score=80 --decision=review --limit=20
 *   npm run qa:prescreen-review -- --max-score=40 --limit=10
 *   npm run qa:prescreen-review -- --after=2026-04-10T00:00:00.000Z
 *   npm run qa:prescreen-review -- --cursor-read --cursor-write=incremental
 *   npm run qa:prescreen-review -- --limit=15 --batch-label="morning review"
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

function initAdmin(): void {
  let credential: admin.credential.Credential | undefined;
  const possibleKeyPaths = [
    path.join(__dirname, '..', 'serviceAccountKey.json'),
    path.join(__dirname, '..', 'firebase-adminsdk.json'),
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
  ].filter(Boolean) as string[];

  for (const keyPath of possibleKeyPaths) {
    if (keyPath && fs.existsSync(keyPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      credential = admin.credential.cert(serviceAccount);
      break;
    }
  }
  if (!credential) {
    credential = admin.credential.applicationDefault();
  }

  const projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    undefined;

  try {
    admin.initializeApp({ credential, ...(projectId ? { projectId } : {}) });
  } catch {
    /* already initialized */
  }
}

type CliConfig = {
  limit: number;
  maxScans: number;
  after?: Date;
  before?: Date;
  decision?: 'advance' | 'review' | 'hold' | 'reject';
  hasApplication?: boolean;
  minScore?: number;
  maxScore?: number;
  flag?: string;
  userId?: string;
  applicationId?: string;
  entry?: string;
  json: boolean;
  cursorFile: string;
  cursorRead: boolean;
  cursorWrite: 'incremental' | 'pagination' | 'both' | '';
  dryRunCursor: boolean;
  /** Optional label shown in markdown header (batch identification when pasting). */
  batchLabel: string;
};

function printHelp(): void {
  console.log(`
Prescreen interview QA batch (read-only)

Usage:
  npm run qa:prescreen-review -- [options]

Options:
  --limit=N              Max interviews to output (default 10, max 500)
  --max-scans=N          Max Firestore documents to read while paging (default 400)
  --after=ISO            createdAt > (exclusive)
  --before=ISO           createdAt < (exclusive)
  --decision=advance|review|hold|reject   hiringDecision.decision
  --has-application=true|false
  --min-score=N / --max-score=N   ai.overallScore
  --flag=NAME            ai.flags contains
  --user-id=UID          Single-user subcollection (memory-filtered)
  --application-id=ID
  --entry=STRING         ai.aiInterviewContext.entry (rare)
  --json                 JSON instead of markdown
  --cursor-file=PATH     Default: .qa/prescreen-review-cursor.json
  --cursor-read          Merge cursor bounds with CLI times
  --cursor-write=incremental|pagination|both
  --dry-run-cursor
  --batch-label=TEXT    Optional label for markdown header (e.g. "morning review")
  --help
`);
}

function parseArgs(argv: string[]): CliConfig {
  const out: CliConfig = {
    limit: 10,
    maxScans: 400,
    json: false,
    cursorFile: path.join(__dirname, '..', '.qa', 'prescreen-review-cursor.json'),
    cursorRead: false,
    cursorWrite: '',
    dryRunCursor: false,
    batchLabel: '',
  };

  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
    if (a === '--json') out.json = true;
    else if (a === '--cursor-read') out.cursorRead = true;
    else if (a === '--dry-run-cursor') out.dryRunCursor = true;
    else if (a.startsWith('--cursor-write=')) {
      const v = a.slice('--cursor-write='.length).trim();
      if (v === 'incremental' || v === 'pagination' || v === 'both') out.cursorWrite = v;
    } else if (a.startsWith('--limit=')) {
      const n = parseInt(a.slice('--limit='.length), 10);
      if (Number.isFinite(n) && n > 0 && n <= 500) out.limit = n;
    } else if (a.startsWith('--max-scans=')) {
      const n = parseInt(a.slice('--max-scans='.length), 10);
      if (Number.isFinite(n) && n >= 50 && n <= 10000) out.maxScans = n;
    } else if (a.startsWith('--after=')) {
      const d = new Date(a.slice('--after='.length));
      if (!isNaN(d.getTime())) out.after = d;
    } else if (a.startsWith('--before=')) {
      const d = new Date(a.slice('--before='.length));
      if (!isNaN(d.getTime())) out.before = d;
    } else if (a.startsWith('--decision=')) {
      const v = a.slice('--decision='.length).trim() as CliConfig['decision'];
      if (v === 'advance' || v === 'review' || v === 'hold' || v === 'reject') out.decision = v;
    } else if (a.startsWith('--has-application=')) {
      const v = a.slice('--has-application='.length).trim().toLowerCase();
      if (v === 'true') out.hasApplication = true;
      else if (v === 'false') out.hasApplication = false;
    } else if (a.startsWith('--min-score=')) {
      const n = parseFloat(a.slice('--min-score='.length));
      if (Number.isFinite(n)) out.minScore = n;
    } else if (a.startsWith('--max-score=')) {
      const n = parseFloat(a.slice('--max-score='.length));
      if (Number.isFinite(n)) out.maxScore = n;
    } else if (a.startsWith('--flag=')) {
      out.flag = a.slice('--flag='.length).trim();
    } else if (a.startsWith('--user-id=')) {
      out.userId = a.slice('--user-id='.length).trim();
    } else if (a.startsWith('--application-id=')) {
      out.applicationId = a.slice('--application-id='.length).trim();
    } else if (a.startsWith('--entry=')) {
      out.entry = a.slice('--entry='.length).trim();
    } else if (a.startsWith('--cursor-file=')) {
      out.cursorFile = path.resolve(a.slice('--cursor-file='.length).trim());
    } else if (a.startsWith('--batch-label=')) {
      out.batchLabel = a.slice('--batch-label='.length).trim();
    }
  }
  return out;
}

type CursorState = {
  version: 1;
  /** Only interviews with createdAt > this (exclusive) — incremental “since last run”. */
  incrementalAfterIso?: string | null;
  /** Only interviews with createdAt < this (exclusive) — page older batches. */
  paginationBeforeIso?: string | null;
  updatedAt?: string;
};

function loadCursor(filePath: string): CursorState | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (raw && raw.version === 1) return raw as CursorState;
  } catch {
    /* ignore */
  }
  return null;
}

function saveCursor(filePath: string, state: CursorState): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
}

function tsToDate(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function') {
    try {
      return (v as admin.firestore.Timestamp).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

function iso(d: Date | null): string {
  return d ? d.toISOString() : '—';
}

function conciseAnswer(s: string, maxLen: number): string {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t || '—';
  return `${t.slice(0, maxLen)}…`;
}

function summarizeQuestions(
  questions: unknown,
): { ids: string[]; short: string; adaptiveFollowUps: boolean; dynamicIds: string[] } {
  if (!Array.isArray(questions)) return { ids: [], short: '—', adaptiveFollowUps: false, dynamicIds: [] };
  const ids: string[] = [];
  const dyn: string[] = [];
  const parts: string[] = [];
  for (const q of questions) {
    if (!q || typeof q !== 'object') continue;
    const o = q as Record<string, unknown>;
    const id = String(o.id || '');
    if (id) ids.push(id);
    if (id.startsWith('dyn_') || id.includes('dyn_cert')) dyn.push(id);
    const a = String(o.answer ?? '').trim();
    if (id) parts.push(`${id}: ${conciseAnswer(a, 80)}`);
  }
  const adaptive = ids.some((x) => /follow|optional|expanded|narrative/i.test(x));
  const moreSuffix = parts.length > 12 ? ` (+${parts.length - 12} more)` : '';
  const short = parts.length ? parts.slice(0, 12).join(' | ') + moreSuffix : '—';
  return { ids, short, adaptiveFollowUps: adaptive, dynamicIds: dyn };
}

function guessEntryFromAi(ai: Record<string, unknown> | undefined): string | null {
  if (!ai) return null;
  const ctx = ai.aiInterviewContext as Record<string, unknown> | undefined;
  if (ctx && typeof ctx === 'object') {
    const e = (ctx as { entry?: unknown }).entry;
    if (typeof e === 'string' && e.trim()) return e.trim();
  }
  return null;
}

function qaNote(args: {
  score: number | null;
  recommendation: string | null;
  decision: string | null;
  flags: string[];
  categoryConfidence: unknown;
}): string {
  const { score, recommendation, decision, flags } = args;
  const parts: string[] = [];
  if (score != null && score >= 80 && recommendation === 'review') {
    parts.push('high score but review recommendation');
  }
  if (score != null && score <= 40) {
    parts.push('low overall score');
  }
  if (flags.includes('vague_response') || flags.some((f) => f.includes('vague'))) {
    parts.push('vague-answer flags present');
  }
  if (recommendation === 'proceed' && decision === 'review') {
    parts.push('model says proceed vs rules decision review');
  }
  if (score != null && score >= 70 && flags.length > 2) {
    parts.push('many flags relative to score');
  }
  if (parts.length === 0) return 'looks reasonable';
  return parts.join('; ');
}

function mergeLowerBound(cfg: CliConfig, cursor: CursorState | null): Date | undefined {
  const dates: number[] = [];
  if (cfg.after) dates.push(cfg.after.getTime());
  if (cursor?.incrementalAfterIso) {
    const d = new Date(cursor.incrementalAfterIso);
    if (!isNaN(d.getTime())) dates.push(d.getTime());
  }
  if (dates.length === 0) return undefined;
  return new Date(Math.max(...dates));
}

function mergeUpperBound(cfg: CliConfig, cursor: CursorState | null): Date | undefined {
  const dates: number[] = [];
  if (cfg.before) dates.push(cfg.before.getTime());
  if (cursor?.paginationBeforeIso) {
    const d = new Date(cursor.paginationBeforeIso);
    if (!isNaN(d.getTime())) dates.push(d.getTime());
  }
  if (dates.length === 0) return undefined;
  return new Date(Math.min(...dates));
}

function passesFilters(data: Record<string, unknown>, cfg: CliConfig): boolean {
  const ai = (data.ai || {}) as Record<string, unknown>;
  const hd = (ai.hiringDecision || {}) as Record<string, unknown>;
  const decision = String(hd.decision || '');

  if (cfg.decision && decision !== cfg.decision) return false;

  const overall = typeof ai.overallScore === 'number' ? ai.overallScore : null;
  if (cfg.minScore != null && (overall == null || overall < cfg.minScore)) return false;
  if (cfg.maxScore != null && (overall == null || overall > cfg.maxScore)) return false;

  if (cfg.flag) {
    const flags = Array.isArray(ai.flags) ? (ai.flags as unknown[]).map(String) : [];
    if (!flags.includes(cfg.flag)) return false;
  }

  const appId = data.applicationId;
  const hasApp = appId != null && String(appId).trim() !== '';
  if (cfg.hasApplication === true && !hasApp) return false;
  if (cfg.hasApplication === false && hasApp) return false;

  if (cfg.applicationId && String(data.applicationId || '') !== cfg.applicationId) return false;

  if (cfg.entry) {
    const g = guessEntryFromAi(ai);
    if (!g || g !== cfg.entry) return false;
  }

  return true;
}

async function fetchBatch(
  db: admin.firestore.Firestore,
  cfg: CliConfig,
  cursor: CursorState | null,
): Promise<{ docs: admin.firestore.QueryDocumentSnapshot[]; scansUsed: number }> {
  const scansUsed = { n: 0 };
  const useCursor = Boolean(cfg.cursorRead && cursor);
  const lower = useCursor ? mergeLowerBound(cfg, cursor) : cfg.after;
  const upper = useCursor ? mergeUpperBound(cfg, cursor) : cfg.before;

  if (lower && upper && lower.getTime() >= upper.getTime()) {
    console.error(
      '[qa:prescreen-review] Empty range: --after/cursor incremental lower bound is not before --before/cursor pagination upper bound. Reset .qa/prescreen-review-cursor.json or use one cursor mode.',
    );
    return { docs: [], scansUsed: 0 };
  }

  if (cfg.userId) {
    /**
     * Single-user path: orderBy createdAt only, filter kind + time in memory to avoid needing a
     * per-user composite index (interviewKind + createdAt).
     */
    let q: admin.firestore.Query = db
      .collection('users')
      .doc(cfg.userId)
      .collection('interviews')
      .orderBy('createdAt', 'desc');

    const collected: admin.firestore.QueryDocumentSnapshot[] = [];
    let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null;
    const pageSize = 40;

    while (collected.length < cfg.limit && scansUsed.n < cfg.maxScans) {
      let pageQ = q.limit(pageSize);
      if (lastDoc) pageQ = pageQ.startAfter(lastDoc);
      const snap = await pageQ.get();
      scansUsed.n += snap.size;
      if (snap.empty) break;
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>;
        if (String(data.interviewKind || '') !== 'worker_ai_prescreen') continue;
        const cAt = tsToDate(data.createdAt) || tsToDate(data.timestamp);
        if (!cAt) continue;
        if (lower && cAt.getTime() <= lower.getTime()) continue;
        if (upper && cAt.getTime() >= upper.getTime()) continue;
        if (!passesFilters(data, cfg)) continue;
        collected.push(d);
        if (collected.length >= cfg.limit) break;
      }
      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.size < pageSize) break;
    }
    return { docs: collected.slice(0, cfg.limit), scansUsed: scansUsed.n };
  }

  /** Collection group: equality on interviewKind + optional range on createdAt (indexed). */
  let q: admin.firestore.Query = db
    .collectionGroup('interviews')
    .where('interviewKind', '==', 'worker_ai_prescreen')
    .orderBy('createdAt', 'desc');

  if (lower) q = q.where('createdAt', '>', admin.firestore.Timestamp.fromDate(lower));
  if (upper) q = q.where('createdAt', '<', admin.firestore.Timestamp.fromDate(upper));

  const collected: admin.firestore.QueryDocumentSnapshot[] = [];
  let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null;
  const pageSize = Math.min(50, Math.max(cfg.limit, 10));

  while (collected.length < cfg.limit && scansUsed.n < cfg.maxScans) {
    let pageQ = q.limit(pageSize);
    if (lastDoc) pageQ = pageQ.startAfter(lastDoc);
    const snap = await pageQ.get();
    scansUsed.n += snap.size;
    if (snap.empty) break;
    for (const d of snap.docs) {
      if (passesFilters(d.data() as Record<string, unknown>, cfg)) {
        collected.push(d);
        if (collected.length >= cfg.limit) break;
      }
    }
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  return { docs: collected.slice(0, cfg.limit), scansUsed: scansUsed.n };
}

type PrescreenBatchSummary = {
  interviewsReturned: number;
  scansUsed: number;
  dateRangeCovered: { minIso: string | null; maxIso: string | null };
  /** decision string → count; key "(none)" when missing */
  decisionBreakdown: Record<string, number>;
  withApplicationCount: number;
  withoutApplicationCount: number;
  /** Sorted by count desc, capped */
  flagsTop: Array<{ flag: string; count: number }>;
  scoreStats: {
    min: number | null;
    max: number | null;
    avg: number | null;
    /** Docs with a numeric overallScore */
    withScoreCount: number;
  };
};

function buildBatchSummary(
  docs: admin.firestore.QueryDocumentSnapshot[],
  scansUsed: number,
): PrescreenBatchSummary {
  const decisionBreakdown: Record<string, number> = {};
  let withApplicationCount = 0;
  let withoutApplicationCount = 0;
  const flagAgg = new Map<string, number>();
  const scores: number[] = [];
  const times: number[] = [];

  for (const d of docs) {
    const data = d.data() as Record<string, unknown>;
    const ai = (data.ai || {}) as Record<string, unknown>;
    const hd = (ai.hiringDecision || {}) as Record<string, unknown>;
    const decRaw = hd.decision != null ? String(hd.decision).trim() : '';
    const decKey = decRaw || '(none)';
    decisionBreakdown[decKey] = (decisionBreakdown[decKey] || 0) + 1;

    const appId = data.applicationId;
    const hasApp = appId != null && String(appId).trim() !== '';
    if (hasApp) withApplicationCount += 1;
    else withoutApplicationCount += 1;

    const flags = Array.isArray(ai.flags) ? (ai.flags as unknown[]).map(String) : [];
    for (const f of flags) {
      const k = f.trim() || '(empty)';
      flagAgg.set(k, (flagAgg.get(k) || 0) + 1);
    }

    const overall = typeof ai.overallScore === 'number' ? ai.overallScore : null;
    if (overall != null && Number.isFinite(overall)) scores.push(overall);

    const created = tsToDate(data.createdAt) || tsToDate(data.timestamp);
    if (created) times.push(created.getTime());
  }

  const minT = times.length ? Math.min(...times) : null;
  const maxT = times.length ? Math.max(...times) : null;
  const avg =
    scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;

  const flagsTop = [...flagAgg.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([flag, count]) => ({ flag, count }));

  return {
    interviewsReturned: docs.length,
    scansUsed,
    dateRangeCovered: {
      minIso: minT != null ? new Date(minT).toISOString() : null,
      maxIso: maxT != null ? new Date(maxT).toISOString() : null,
    },
    decisionBreakdown,
    withApplicationCount,
    withoutApplicationCount,
    flagsTop,
    scoreStats: {
      min: scores.length ? Math.min(...scores) : null,
      max: scores.length ? Math.max(...scores) : null,
      avg,
      withScoreCount: scores.length,
    },
  };
}

function formatMarkdown(docs: admin.firestore.QueryDocumentSnapshot[], cfg: CliConfig, scansUsed: number): string {
  const summary = buildBatchSummary(docs, scansUsed);
  const lines: string[] = [];
  lines.push(`# Worker AI prescreen — QA batch`);
  lines.push('');
  if (cfg.batchLabel) {
    lines.push(`- **Batch:** ${cfg.batchLabel}`);
    lines.push('');
  }
  lines.push(`- Generated: ${new Date().toISOString()}`);
  const { batchLabel: _batchLabelOmitted, ...cfgRest } = cfg;
  lines.push(`- Filters: ${JSON.stringify({ ...cfgRest, cursor: undefined })}`);
  lines.push('');

  lines.push(`## Summary`);
  lines.push('');
  lines.push(`- **Interviews returned:** ${summary.interviewsReturned}`);
  lines.push(`- **Scans used:** ${summary.scansUsed}`);
  const drMin = summary.dateRangeCovered.minIso;
  const drMax = summary.dateRangeCovered.maxIso;
  lines.push(
    `- **Date range (createdAt):** ${drMin && drMax ? `\`${drMin}\` → \`${drMax}\`` : '— (no rows)'}`,
  );
  const decParts = Object.entries(summary.decisionBreakdown)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}: ${v}`);
  lines.push(`- **Decisions:** ${decParts.length ? decParts.join(' · ') : '—'}`);
  lines.push(
    `- **Application link:** with \`applicationId\`: ${summary.withApplicationCount} · without: ${summary.withoutApplicationCount}`,
  );
  const flagLine =
    summary.flagsTop.length > 0
      ? summary.flagsTop.map(({ flag, count }) => `\`${flag}\` (${count})`).join(', ')
      : '—';
  lines.push(`- **Common flags (batch):** ${flagLine}`);
  const { min, max, avg, withScoreCount } = summary.scoreStats;
  if (withScoreCount > 0 && min != null && max != null && avg != null) {
    lines.push(`- **Score (overall):** min ${min} · max ${max} · avg ${avg} (_n=${withScoreCount} with score_)`);
  } else {
    lines.push(`- **Score (overall):** — (_no numeric scores in batch_)`);
  }
  lines.push('');

  let n = 0;
  for (const d of docs) {
    n += 1;
    const data = d.data() as Record<string, unknown>;
    const parts = d.ref.path.split('/');
    const userId = parts.length >= 2 ? parts[1] : '';
    const ai = (data.ai || {}) as Record<string, unknown>;
    const hd = (ai.hiringDecision || {}) as Record<string, unknown>;
    const created = tsToDate(data.createdAt) || tsToDate(data.timestamp);
    const questions = data.questions;
    const sum = summarizeQuestions(questions);
    const overall = typeof ai.overallScore === 'number' ? ai.overallScore : null;
    const rec = typeof ai.recommendation === 'string' ? ai.recommendation : null;
    const flags = Array.isArray(ai.flags) ? (ai.flags as unknown[]).map(String) : [];
    const reasonCodes = Array.isArray(hd.reasonCodes) ? (hd.reasonCodes as unknown[]).map(String) : [];
    const cat = ai.categoryScores as Record<string, unknown> | undefined;
    const catConf = ai.categoryConfidence as Record<string, unknown> | undefined;

    lines.push(`## ${n}. ${d.id}`);
    lines.push('');
    lines.push('### Context');
    lines.push('');
    lines.push(`- **interviewId**: \`${d.id}\``);
    lines.push(`- **userId**: \`${userId}\``);
    lines.push(`- **path**: \`${d.ref.path}\``);
    lines.push(`- **applicationId**: ${data.applicationId != null ? `\`${String(data.applicationId)}\`` : '—'}`);
    lines.push(`- **timestamp**: ${iso(created)}`);
    lines.push(`- **jobId**: ${data.jobId != null ? String(data.jobId) : '—'}`);
    lines.push(`- **jobOrderId**: ${data.jobOrderId != null ? String(data.jobOrderId) : '—'}`);
    const gEntry = guessEntryFromAi(ai);
    lines.push(`- **entry source (if stored)**: ${gEntry || '— (not on interview doc; URL entry not persisted by default)'}`);
    lines.push('');

    lines.push('### Interview summary');
    lines.push('');
    lines.push(`- **question IDs** (${sum.ids.length}): ${sum.ids.length ? `\`${sum.ids.join('`, `')}\`` : '—'}`);
    lines.push(`- **dynamic / job-aware question IDs**: ${sum.dynamicIds.length ? `\`${sum.dynamicIds.join('`, `')}\`` : '—'}`);
    lines.push(`- **adaptive follow-ups (heuristic)**: ${sum.adaptiveFollowUps ? 'possibly (check IDs)' : 'not detected'}`);
    lines.push(`- **answers (truncated)**: ${sum.short}`);
    lines.push('');

    lines.push('### Score summary');
    lines.push('');
    lines.push(`- **overallScore**: ${overall != null ? overall : '—'}`);
    lines.push(`- **score10**: ${data.score10 != null ? String(data.score10) : '—'}`);
    lines.push(`- **recommendation**: ${rec || '—'}`);
    lines.push(`- **hiring decision**: ${hd.decision != null ? String(hd.decision) : '—'}`);
    lines.push(`- **category scores**: ${cat ? `\`${JSON.stringify(cat)}\`` : '—'}`);
    lines.push(`- **category confidence**: ${catConf ? `\`${JSON.stringify(catConf)}\`` : '—'}`);
    lines.push(
      `- **no-show risk**: — (interview doc may not duplicate application \`aiAutomation.applicationNoShowRisk\`; pull application doc separately if needed)`,
    );
    lines.push('');

    lines.push('### Flags / reasons');
    lines.push('');
    lines.push(`- **flags**: ${flags.length ? flags.map((x) => `\`${x}\``).join(', ') : '—'}`);
    lines.push(`- **reason codes**: ${reasonCodes.length ? reasonCodes.map((x) => `\`${x}\``).join(', ') : '—'}`);
    lines.push(
      `- **orchestrator**: — on interview doc (rules decision is in \`ai.hiringDecision\`; full orchestrator trace is usually on **application** \`aiAutomation.orchestratorV1\`)`,
    );
    lines.push('');

    lines.push('### QA note');
    lines.push('');
    lines.push(
      `- ${qaNote({
        score: overall,
        recommendation: rec,
        decision: hd.decision != null ? String(hd.decision) : null,
        flags,
        categoryConfidence: catConf,
      })}`,
    );
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cfg = parseArgs(argv);
  initAdmin();
  const db = admin.firestore();

  let cursor: CursorState | null = null;
  if (cfg.cursorFile && (cfg.cursorRead || cfg.cursorWrite)) {
    cursor = loadCursor(cfg.cursorFile);
  }

  const { docs, scansUsed } = await fetchBatch(db, cfg, cfg.cursorRead ? cursor : null);

  if (cfg.json) {
    const payload = docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const parts = d.ref.path.split('/');
      const userId = parts.length >= 2 ? parts[1] : '';
      const ai = { ...(data.ai as Record<string, unknown> | undefined) };
      if (ai && typeof ai === 'object') {
        delete (ai as { debug?: unknown }).debug;
        if (ai.aiInterviewContext && typeof ai.aiInterviewContext === 'object') {
          const slim = { ...(ai.aiInterviewContext as object) };
          const s = JSON.stringify(slim);
          if (s.length > 8000) (ai as { aiInterviewContext: unknown }).aiInterviewContext = '[truncated]';
        }
      }
      return {
        path: d.ref.path,
        interviewId: d.id,
        userId,
        data: { ...data, ai },
      };
    });
    const summary = buildBatchSummary(docs, scansUsed);
    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          batchLabel: cfg.batchLabel || undefined,
          summary,
          scansUsed,
          count: payload.length,
          interviews: payload,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatMarkdown(docs, cfg, scansUsed));
    console.log('');
    console.log(`---`);
    console.log(`_Scans (read documents): ${scansUsed}_`);
  }

  if (cfg.cursorWrite && docs.length > 0 && !cfg.dryRunCursor) {
    const dates = docs
      .map((d) => tsToDate((d.data() as Record<string, unknown>).createdAt) || tsToDate((d.data() as Record<string, unknown>).timestamp))
      .filter((x): x is Date => x != null);
    if (dates.length) {
      const minD = new Date(Math.min(...dates.map((x) => x.getTime())));
      const maxD = new Date(Math.max(...dates.map((x) => x.getTime())));
      const next: CursorState = { version: 1, ...(cursor || {}) };
      if (cfg.cursorWrite === 'incremental' || cfg.cursorWrite === 'both') {
        next.incrementalAfterIso = maxD.toISOString();
      }
      if (cfg.cursorWrite === 'pagination' || cfg.cursorWrite === 'both') {
        next.paginationBeforeIso = minD.toISOString();
      }
      saveCursor(cfg.cursorFile, next);
      if (!cfg.json) console.error(`\n[Cursor saved] ${cfg.cursorFile}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
