/**
 * Adaptive “Strengthen your profile” helpers for worker AI prescreen (v1).
 * Gap detection stays client-side; saves are explicit user actions only.
 */

import { WORKER_AI_PRESCREEN_STEPS } from '../constants/workerAiPrescreenQuestions';
import { PRESCREEN_MIN_SUBSTANTIVE_WORDS } from '../shared/prescreenAnswerQuality';
import type { WorkerAiPrescreenAnswers } from './workerAiPrescreenScore';

export function prescreenWordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Experience questions answered enough to derive adaptive suggestions (matches substantive bar for experience text). */
export function hasExperienceBlockCompleteForAdaptive(answers: WorkerAiPrescreenAnswers): boolean {
  const exp = String(answers.experience_details ?? '');
  const wc = answers.work_confidence || [];
  return prescreenWordCount(exp) >= PRESCREEN_MIN_SUBSTANTIVE_WORDS && wc.length > 0;
}

function skillNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function capitalizeWords(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export type WorkerSkillWriteRow = {
  name: string;
  canonicalId: string;
  source: 'predefined' | 'custom';
  type: string;
  confidence: number;
};

type ParsedSkill = { name: string; canonicalId?: string; source: 'predefined' | 'custom'; type: string; confidence: number };

function parseSkillsFromFirestore(raw: unknown): ParsedSkill[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((skillItem: unknown) => {
      const o = skillItem as Record<string, unknown>;
      const skillName = typeof skillItem === 'string' ? skillItem : String(o?.name || '');
      const capitalizedName = capitalizeWords(String(skillName));
      if (!capitalizedName) return null;
      const type = String(o?.type || o?.category || 'General');
      const source = (o?.source as 'predefined' | 'custom') || 'custom';
      const confidence = typeof o?.confidence === 'number' ? o.confidence : 1;
      return {
        name: capitalizedName,
        canonicalId: typeof o?.canonicalId === 'string' ? o.canonicalId : capitalizedName,
        source,
        type,
        confidence,
      } as ParsedSkill;
    })
    .filter(Boolean) as ParsedSkill[];
}

export function countUserProfileSkills(userDoc: Record<string, unknown> | null | undefined): number {
  if (!userDoc || typeof userDoc !== 'object') return 0;
  return parseSkillsFromFirestore(userDoc.skills).length;
}

/** Aligns with worker profile hub heuristic (skills list length). */
export function isUserDocSkillsThin(userDoc: Record<string, unknown> | null | undefined): boolean {
  return countUserProfileSkills(userDoc) < 3;
}

export type DerivedSkillSuggestion = { key: string; label: string };

const EXPERIENCE_KEYWORD_SKILLS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(forklift|pallet\s*jack|reach\s*truck)\b/i, label: 'Forklift / material handling' },
  { pattern: /\b(warehouse|shipping|receiving|pick\s*pack|order\s*fulfillment)\b/i, label: 'Warehouse operations' },
  { pattern: /\b(inventory|cycle\s*count|stock)\b/i, label: 'Inventory control' },
  { pattern: /\b(customer\s*service|retail|cashier|sales\s*floor)\b/i, label: 'Customer service / retail' },
  { pattern: /\b(data\s*entry|microsoft\s*excel|spreadsheet|computer|office)\b/i, label: 'Office / computer skills' },
  { pattern: /\b(driving|delivery|cdl|route)\b/i, label: 'Driving / delivery' },
  { pattern: /\b(food\s*service|restaurant|cook|kitchen|barista)\b/i, label: 'Food service' },
  { pattern: /\b(healthcare|hospital|patient|nursing|cna|medical)\b/i, label: 'Healthcare support' },
  { pattern: /\b(manufacturing|assembly|production|machine\s*operator)\b/i, label: 'Manufacturing / assembly' },
  { pattern: /\b(cleaning|janitorial|housekeeping)\b/i, label: 'Cleaning / janitorial' },
  { pattern: /\b(security|loss\s*prevention)\b/i, label: 'Security / loss prevention' },
];

/**
 * Derive suggested skill labels from work_confidence selections and experience_details keywords.
 */
export function deriveSuggestedSkillsFromPrescreenAnswers(answers: WorkerAiPrescreenAnswers): DerivedSkillSuggestion[] {
  const out: DerivedSkillSuggestion[] = [];
  const seen = new Set<string>();

  const push = (key: string, label: string) => {
    const lab = capitalizeWords(label);
    const k = skillNameKey(lab);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ key, label: lab });
  };

  const step = WORKER_AI_PRESCREEN_STEPS.find((s) => s.id === 'work_confidence');
  const optMap = new Map((step?.options ?? []).map((o) => [o.value, o.label]));

  for (const v of answers.work_confidence || []) {
    const lab = optMap.get(v) ?? v;
    push(`wc_${v}`, lab);
  }

  const text = String(answers.experience_details ?? '');
  for (const { pattern, label } of EXPERIENCE_KEYWORD_SKILLS) {
    if (pattern.test(text)) {
      push(`kw_${skillNameKey(label)}`, label);
    }
  }

  return out;
}

function existingSkillNameKeys(userDoc: Record<string, unknown> | null | undefined): Set<string> {
  const keys = new Set<string>();
  for (const s of parseSkillsFromFirestore(userDoc?.skills)) {
    keys.add(skillNameKey(s.name));
  }
  return keys;
}

/** Suggestions that are not already represented on the profile (by name, case-insensitive). */
export function filterNewSkillSuggestions(
  userDoc: Record<string, unknown> | null | undefined,
  suggestions: DerivedSkillSuggestion[],
): DerivedSkillSuggestion[] {
  const have = existingSkillNameKeys(userDoc);
  return suggestions.filter((s) => !have.has(skillNameKey(s.label)));
}

function normalizeForWrite(rows: ParsedSkill[]): WorkerSkillWriteRow[] {
  return rows.map((s) => ({
    name: s.name,
    canonicalId: s.canonicalId || s.name,
    source: s.source,
    type: s.type,
    confidence: s.confidence ?? 1,
  }));
}

/** Merge selected interview suggestions into existing `users.skills` without dropping prior entries. */
export function mergeInterviewSkillLabelsIntoUserSkills(
  existingRaw: unknown,
  labelsToAdd: string[],
): WorkerSkillWriteRow[] {
  const base = parseSkillsFromFirestore(existingRaw);
  const keys = new Set(base.map((s) => skillNameKey(s.name)));
  const next: ParsedSkill[] = [...base];
  for (const rawLabel of labelsToAdd) {
    const name = capitalizeWords(rawLabel);
    if (!name) continue;
    const k = skillNameKey(name);
    if (keys.has(k)) continue;
    keys.add(k);
    next.push({
      name,
      canonicalId: name,
      source: 'custom',
      type: 'General',
      confidence: 1,
    });
  }
  return normalizeForWrite(next);
}
