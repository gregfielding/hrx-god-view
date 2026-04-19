/**
 * Composes recruiter-facing copy for the Overview "Worker Intelligence" dashboard.
 * No backend calls — pure functions over user doc + scoreSummary + riskProfile.
 */

import type { ScoreSummary } from '../../../utils/scoreSummary';
import { getCanonicalStoredAiScore } from '../../../utils/scoreSummary';
import type { WorkerRiskProfileV1 } from '../../../types/workerRiskProfile';

export function letterGradeFromAiScore(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return '—';
  const s = Math.max(0, Math.min(100, Math.round(score)));
  if (s >= 90) return 'A';
  if (s >= 80) return 'B';
  if (s >= 70) return 'C';
  if (s >= 60) return 'D';
  return 'F';
}

export interface OverviewBlockerLine {
  label: string;
  severity: 'info' | 'warning' | 'error';
}

/**
 * Priority-ordered operational blockers (max 2 shown in snapshot).
 */
export function composeOverviewBlockers(input: {
  workAuthorized: boolean;
  scoreSummary?: ScoreSummary | null;
  hasInterview: boolean;
}): OverviewBlockerLine[] {
  const out: OverviewBlockerLine[] = [];

  if (!input.workAuthorized) {
    out.push({ label: 'Work authorization not confirmed', severity: 'error' });
  }

  const next = input.scoreSummary?.explainability?.nextActions?.[0];
  if (next?.label && typeof next.label === 'string') {
    out.push({ label: next.label, severity: 'warning' });
  } else {
    const missing = input.scoreSummary?.explainability?.missingFields?.filter(Boolean);
    if (missing && missing.length > 0) {
      out.push({
        label: `Profile gap: ${String(missing[0])}`,
        severity: 'warning',
      });
    }
  }

  if (!input.hasInterview && out.length < 2) {
    out.push({ label: 'No interview on file', severity: 'info' });
  }

  return out.slice(0, 2);
}

/**
 * Deployment snapshot only — no interview filler; score/interview live on record header.
 */
export function composeOverviewBlockersOperational(input: {
  workAuthorized: boolean;
  scoreSummary?: ScoreSummary | null;
}): OverviewBlockerLine[] {
  const out: OverviewBlockerLine[] = [];

  if (!input.workAuthorized) {
    out.push({ label: 'Work authorization not confirmed', severity: 'error' });
  }

  const next = input.scoreSummary?.explainability?.nextActions?.[0];
  if (next?.label && typeof next.label === 'string') {
    out.push({ label: next.label, severity: 'warning' });
  } else {
    const missing = input.scoreSummary?.explainability?.missingFields?.filter(Boolean);
    if (missing && missing.length > 0) {
      out.push({
        label: `Profile gap: ${String(missing[0])}`,
        severity: 'warning',
      });
    }
  }

  return out.slice(0, 2);
}

export function formatOverviewInterviewLine(summary?: ScoreSummary | null): string | null {
  if (!summary?.interviewLastAt || typeof summary.interviewLastScore10 !== 'number') return null;
  let d: Date | null = null;
  const raw = summary.interviewLastAt as { toDate?: () => Date } | Date | string | number;
  if (raw && typeof raw === 'object' && 'toDate' in raw && typeof (raw as { toDate: () => Date }).toDate === 'function') {
    try {
      d = (raw as { toDate: () => Date }).toDate();
    } catch {
      d = null;
    }
  } else if (raw instanceof Date) d = raw;
  else if (typeof raw === 'string' || typeof raw === 'number') d = new Date(raw);
  if (!d || Number.isNaN(d.getTime())) return null;
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const sc = Math.round(summary.interviewLastScore10 * 10) / 10;
  return `Interviewed ${dateStr} · ${sc}/10`;
}

export function canonicalAiDisplay(summary?: ScoreSummary | null): { grade: string; numeric: string } {
  const n = getCanonicalStoredAiScore(summary ?? undefined);
  return {
    grade: letterGradeFromAiScore(n),
    numeric: n == null ? '—' : String(Math.round(n)),
  };
}

export function riskSeverityChipColor(risk: WorkerRiskProfileV1 | null | undefined): 'default' | 'warning' | 'error' {
  const score = risk?.overallRiskScore;
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'default';
  if (score >= 70) return 'error';
  if (score >= 40) return 'warning';
  return 'default';
}

export function extractSkillLabelsFromUserDoc(skills: unknown): string[] {
  if (!Array.isArray(skills)) return [];
  const out: string[] = [];
  for (const s of skills) {
    if (typeof s === 'string') {
      const t = s.trim();
      if (t) out.push(t);
    } else if (s && typeof s === 'object') {
      const o = s as Record<string, unknown>;
      const label = String(o.label || o.name || o.language || o.value || '').trim();
      if (label) out.push(label);
    }
  }
  return out.slice(0, 16);
}

/** Same as {@link extractSkillLabelsFromUserDoc} without a cap — for Overview Qualifications snapshot. */
export function extractAllSkillLabelsFromUserDoc(skills: unknown): string[] {
  if (!Array.isArray(skills)) return [];
  const out: string[] = [];
  for (const s of skills) {
    if (typeof s === 'string') {
      const t = s.trim();
      if (t) out.push(t);
    } else if (s && typeof s === 'object') {
      const o = s as Record<string, unknown>;
      const label = String(o.label || o.name || o.language || o.value || '').trim();
      if (label) out.push(label);
    }
  }
  return out;
}

export function extractWorkHeadlinesFromUserDoc(workExperience: unknown): string[] {
  if (!Array.isArray(workExperience)) return [];
  const lines: string[] = [];
  for (const item of workExperience) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const title = String(o.jobTitle || o.title || '').trim();
    const company = String(o.employer || o.company || '').trim();
    if (title || company) lines.push([title, company].filter(Boolean).join(' — '));
    if (lines.length >= 5) break;
  }
  return lines;
}
