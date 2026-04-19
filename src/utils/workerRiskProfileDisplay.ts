/**
 * Recruiter table / profile helpers for `users/{uid}.riskProfile`.
 */

import type { WorkerRiskItemV1, WorkerRiskProfileV1 } from '../types/workerRiskProfile';
import { normalizeOperationalRiskSummary } from './riskSummaryNormalize';

/** Placeholder for future recruiter overrides — no runtime effect yet. */
export function stubRecruiterRiskExtensions(): void {
  /* Future: merge recruiter_notes + dismissed risks into display layer */
}

function formatRiskTime(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'object' && raw !== null && 'toDate' in raw && typeof (raw as { toDate: () => Date }).toDate === 'function') {
    try {
      return (raw as { toDate: () => Date }).toDate().toLocaleString();
    } catch {
      return null;
    }
  }
  return null;
}

function truncateSmart(s: string, max = 72): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.35 ? cut.slice(0, sp) : cut).trim()}…`;
}

/** Fallback one-liner when a row exists but summary is empty. */
export function fallbackRiskSummaryFromItem(item: Pick<WorkerRiskItemV1, 'type' | 'severity' | 'source'>): string {
  const sev = String(item.severity || '').toLowerCase();
  const t = String(item.type || '').toLowerCase();
  if (t === 'transportation' && (sev === 'moderate' || sev === 'high')) return 'Transportation concern';
  if (t === 'background' && sev === 'moderate') return 'Background-check response needs review';
  if (t === 'background' && sev === 'high') return 'Background review needed';
  if (t === 'compliance' && sev === 'high') return 'Compliance issue';
  if (t === 'attendance' && sev === 'moderate') return 'Attendance concern';
  if (t === 'drug' && sev === 'moderate') return 'Drug-screen response needs review';
  if (t === 'drug') return 'Drug screening attention';
  if (t === 'documentation') return 'Documentation incomplete';
  return `${item.type} ${item.severity} (${item.source})`;
}

function displaySummaryForItem(item: WorkerRiskItemV1): string {
  const raw = String(item.summary || '').trim();
  if (raw) return normalizeOperationalRiskSummary(raw);
  return fallbackRiskSummaryFromItem(item);
}

/** Primary line for table: top risk summary (normalized + truncated). */
export function workerRiskPrimaryLine(risk: WorkerRiskProfileV1 | null | undefined): string | null {
  if (!risk?.topRisks?.length) return null;
  const line = displaySummaryForItem(risk.topRisks[0]);
  return truncateSmart(line, 100);
}

/**
 * Rich recruiter-friendly tooltip (plain text, not JSON).
 */
export function workerRiskTooltipContent(risk: WorkerRiskProfileV1 | null | undefined): string {
  if (!risk?.topRisks?.length) return '';
  const lines: string[] = [];
  lines.push(`Overall risk index: ${risk.overallRiskScore} (higher = more review needed)`);
  const t = formatRiskTime(risk.lastUpdatedAt) ?? formatRiskTime(risk.staleness?.lastInputAt);
  if (t) lines.push(`Last updated: ${t}`);
  lines.push('');
  for (const r of risk.topRisks.slice(0, 3)) {
    const sum = displaySummaryForItem(r);
    lines.push(
      `• ${String(r.severity || '').toUpperCase()} — ${sum}`,
      `  Source: ${r.source} · confidence ${Math.round((r.confidence ?? 0) * 100)}%`,
    );
  }
  return lines.join('\n');
}

export function normalizeRiskProfileFromUserDoc(raw: unknown): WorkerRiskProfileV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const overall = o.overallRiskScore;
  if (typeof overall !== 'number' || !Number.isFinite(overall)) return null;
  const top = o.topRisks;
  if (!Array.isArray(top)) return null;
  const topRisks: WorkerRiskItemV1[] = [];
  for (const item of top) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const type = typeof it.type === 'string' ? it.type : '';
    const sev = typeof it.severity === 'string' ? it.severity : 'unknown';
    const source = typeof it.source === 'string' ? it.source : 'system_review';
    if (!type) continue;
    let summary = typeof it.summary === 'string' ? it.summary : '';
    if (!summary.trim()) {
      summary = fallbackRiskSummaryFromItem({
        type: type as WorkerRiskItemV1['type'],
        severity: sev as WorkerRiskItemV1['severity'],
        source: source as WorkerRiskItemV1['source'],
      });
    } else {
      summary = normalizeOperationalRiskSummary(summary);
    }
    topRisks.push({
      type: type as WorkerRiskItemV1['type'],
      severity: sev as WorkerRiskItemV1['severity'],
      confidence: typeof it.confidence === 'number' ? it.confidence : 0,
      summary,
      source: source as WorkerRiskItemV1['source'],
      sourceRef: it.sourceRef == null ? undefined : String(it.sourceRef),
      status: it.status as WorkerRiskItemV1['status'] | undefined,
    });
  }
  return {
    overallRiskScore: Math.round(overall),
    topRisks,
    lastGeneratedBy: o.lastGeneratedBy as WorkerRiskProfileV1['lastGeneratedBy'],
    version: typeof o.version === 'number' ? o.version : 1,
    generationSignature: typeof o.generationSignature === 'string' ? o.generationSignature : '',
    lastUpdatedAt: o.lastUpdatedAt,
    staleness: o.staleness as WorkerRiskProfileV1['staleness'],
  };
}
