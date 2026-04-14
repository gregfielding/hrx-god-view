/**
 * Application-level no-show risk for Placements worker tiles.
 * Source: `applications/{id}.aiAutomation.noShowRisk`.
 */

import type { NoShowRiskBand } from '../types/noShowRisk';

export type PlacementApplicationNoShowRisk = {
  band: NoShowRiskBand;
  score: number;
};

function pickNoShowRiskFromApplicationData(data: Record<string, unknown>): PlacementApplicationNoShowRisk | undefined {
  const auto = data.aiAutomation as Record<string, unknown> | undefined;
  if (!auto || typeof auto !== 'object') return undefined;
  const ns = auto.noShowRisk as Record<string, unknown> | undefined;
  if (!ns || typeof ns !== 'object') return undefined;
  const score = typeof ns.score === 'number' && Number.isFinite(ns.score) ? ns.score : undefined;
  const band = typeof ns.band === 'string' && ns.band ? (ns.band as NoShowRiskBand) : undefined;
  if (score == null || !band) return undefined;
  return { band, score: Math.round(score) };
}

/** When a user has multiple applications for this job, keep the worst (highest) score. */
export function buildPlacementApplicationNoShowRiskMap(
  applicationDocs: Array<{ id: string; data: Record<string, unknown> }>,
): Map<string, PlacementApplicationNoShowRisk> {
  const m = new Map<string, PlacementApplicationNoShowRisk>();
  for (const { data } of applicationDocs) {
    const uid = String(data.userId || '').trim();
    if (!uid) continue;
    const row = pickNoShowRiskFromApplicationData(data);
    if (!row) continue;
    const prev = m.get(uid);
    if (!prev || row.score > prev.score) m.set(uid, row);
  }
  return m;
}

const BAND_LABEL: Record<string, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  critical: 'Critical',
};

/** Compact recruiter copy: `No-show: Low / 22` */
export function formatPlacementNoShowRiskCompact(args: { band: string; score: number }): string {
  const b = BAND_LABEL[String(args.band).toLowerCase()] || args.band;
  return `No-show: ${b} / ${Math.round(args.score)}`;
}
