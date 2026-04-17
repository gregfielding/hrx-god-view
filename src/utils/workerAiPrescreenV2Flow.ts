/**
 * Client-only Worker AI prescreen v2: fast path ordering, early dynamic placement, optional expanded narrative.
 * Does not change server REQUIRED_KEYS — submit pipeline merges/pads text as needed.
 */

import type { WorkerAiPrescreenStep } from '../constants/workerAiPrescreenQuestions';
import type { WorkerAiPrescreenStepId } from '../constants/workerAiPrescreenQuestions';
import type { WorkerAiPrescreenAnswers } from './workerAiPrescreenScore';
import type { WorkerAiPrescreenDynamicStep } from '../types/workerAiPrescreenDynamic';
import { PRESCREEN_MIN_SUBSTANTIVE_WORDS } from '../shared/prescreenAnswerQuality';

export const PRESCREEN_FAST_PATH_V2 = true;

export function wordCountAnswer(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Heuristic: weak experience → show expanded narrative (motivation + pressure) in flow. */
export function shouldAskExpandedQuestions(answers: WorkerAiPrescreenAnswers): boolean {
  const exp = answers.experience_details || '';
  return wordCountAnswer(exp) < 8;
}

export type PrescreenNavEntry =
  | { kind: 'core'; step: WorkerAiPrescreenStep }
  | { kind: 'dynamic'; step: WorkerAiPrescreenDynamicStep; phase: 'early' | 'late' }
  | { kind: 'client_followup'; followup: 'experience' | 'pressure' | 'supervisor' };

function stepById(visible: WorkerAiPrescreenStep[]): Partial<Record<WorkerAiPrescreenStepId, WorkerAiPrescreenStep>> {
  const o: Partial<Record<WorkerAiPrescreenStepId, WorkerAiPrescreenStep>> = {};
  for (const s of visible) o[s.id] = s;
  return o;
}

/**
 * Build ordered navigation: openings → work_confidence → early dynamic → experience → [exp followup] →
 * [motivation+pressure if expanded] → reliability → late dynamic → drug/bg/supervisor/notes.
 * When not expanded, motivation & pressure are omitted from UI and padded at submit.
 */
/** Once true for this interview session, optional follow-up steps stay in the nav (reduces step-count churn). */
export type PrescreenSessionFollowupLocks = {
  experienceFollowup?: boolean;
  pressureFollowup?: boolean;
  supervisorFollowup?: boolean;
};

export function buildPrescreenNavEntries(params: {
  isFastPath: boolean;
  visibleCoreSteps: WorkerAiPrescreenStep[];
  dynamicSteps: WorkerAiPrescreenDynamicStep[];
  answers: WorkerAiPrescreenAnswers;
  experienceFollowupText: string;
  /** Sticky session locks (client-only); see {@link PrescreenSessionFollowupLocks}. */
  sessionFollowupLocks?: PrescreenSessionFollowupLocks;
  /**
   * Once true for this session, keep motivation + pressure in the nav even if `experience_details`
   * later crosses the weak/strong word-count threshold (avoids nav churn while editing).
   */
  expandedNarrativeSticky?: boolean;
}): PrescreenNavEntry[] {
  const {
    isFastPath,
    visibleCoreSteps,
    dynamicSteps,
    answers,
    experienceFollowupText,
    sessionFollowupLocks,
    expandedNarrativeSticky,
  } = params;
  const byId = stepById(visibleCoreSteps);
  const early = dynamicSteps.slice(0, Math.min(2, dynamicSteps.length));
  const late = dynamicSteps.slice(early.length);

  const expWc = wordCountAnswer(String(answers.experience_details ?? ''));
  const showExpFollow =
    isFastPath && ((expWc >= 3 && expWc < 9) || sessionFollowupLocks?.experienceFollowup === true);
  const expanded =
    isFastPath && (expandedNarrativeSticky === true || shouldAskExpandedQuestions(answers));

  const out: PrescreenNavEntry[] = [];

  for (const s of visibleCoreSteps) {
    if (String(s.id).startsWith('opening_')) out.push({ kind: 'core', step: s });
  }

  if (byId.work_confidence) out.push({ kind: 'core', step: byId.work_confidence });

  for (const step of early) {
    out.push({ kind: 'dynamic', step, phase: 'early' });
  }

  if (byId.experience_details) out.push({ kind: 'core', step: byId.experience_details });

  if (showExpFollow) {
    out.push({ kind: 'client_followup', followup: 'experience' });
  }

  if (expanded) {
    if (byId.motivation) out.push({ kind: 'core', step: byId.motivation });
    if (byId.pressure_situation) {
      out.push({ kind: 'core', step: byId.pressure_situation });
      const pWc = wordCountAnswer(String(answers.pressure_situation ?? ''));
      const showPressureFollow =
        expanded &&
        isFastPath &&
        ((pWc >= 3 && pWc < 9) || sessionFollowupLocks?.pressureFollowup === true);
      if (showPressureFollow) out.push({ kind: 'client_followup', followup: 'pressure' });
    }
  }

  const reliabilityOrder: WorkerAiPrescreenStepId[] = [
    'attendance_issues',
    'attendance_explanation',
    'transportation_plan',
    'backup_transportation',
    'physical_comfort',
  ];
  for (const id of reliabilityOrder) {
    const s = byId[id];
    if (s) out.push({ kind: 'core', step: s });
  }

  for (const step of late) {
    out.push({ kind: 'dynamic', step, phase: 'late' });
  }

  const tailOrder: WorkerAiPrescreenStepId[] = ['drug_screen', 'background_check', 'supervisor_feedback', 'additional_notes'];
  for (const id of tailOrder) {
    const s = byId[id];
    if (!s) continue;
    out.push({ kind: 'core', step: s });
    if (id === 'supervisor_feedback') {
      const sWc = wordCountAnswer(String(answers.supervisor_feedback ?? ''));
      const showSupFollow =
        isFastPath && ((sWc >= 3 && sWc < 9) || sessionFollowupLocks?.supervisorFollowup === true);
      if (showSupFollow) out.push({ kind: 'client_followup', followup: 'supervisor' });
    }
  }

  return out;
}

export function navEntryStepId(entry: PrescreenNavEntry): string {
  if (entry.kind === 'core') return entry.step.id;
  if (entry.kind === 'dynamic') return entry.step.id;
  if (entry.followup === 'experience') return 'experience_followup_optional';
  if (entry.followup === 'pressure') return 'pressure_followup_optional';
  return 'supervisor_followup_optional';
}

export function prescreenUiSectionForNavEntry(entry: PrescreenNavEntry): import('./workerAiPrescreenUiFlow').WorkerAiPrescreenUiSection {
  if (entry.kind === 'dynamic') return 'job_fit';
  if (entry.kind === 'client_followup') {
    if (entry.followup === 'supervisor') return 'wrapUp';
    return 'experience';
  }
  const id = entry.step.id;
  if (id.startsWith('opening_')) return 'preferences';
  if (['work_confidence', 'motivation', 'experience_details', 'pressure_situation'].includes(id)) return 'experience';
  if (
    [
      'attendance_issues',
      'attendance_explanation',
      'transportation_plan',
      'backup_transportation',
      'physical_comfort',
      'drug_screen',
      'background_check',
    ].includes(id)
  ) {
    return 'reliability';
  }
  if (['supervisor_feedback', 'additional_notes'].includes(id)) return 'wrapUp';
  return 'experience';
}

/**
 * Merge client-only follow-up lines into canonical answer fields before submit.
 */
export function mergeClientFollowUpsIntoAnswers(
  answers: WorkerAiPrescreenAnswers,
  experienceFollowupText: string,
  pressureFollowupText = '',
  supervisorFollowupText = '',
): WorkerAiPrescreenAnswers {
  let next: WorkerAiPrescreenAnswers = { ...answers };
  const expExtra = String(experienceFollowupText ?? '').trim();
  if (expExtra) {
    const base = String(next.experience_details ?? '').trim();
    next = { ...next, experience_details: base ? `${base}\n${expExtra}` : expExtra };
  }
  const pExtra = String(pressureFollowupText ?? '').trim();
  if (pExtra) {
    const base = String(next.pressure_situation ?? '').trim();
    next = { ...next, pressure_situation: base ? `${base}\n${pExtra}` : pExtra };
  }
  const sExtra = String(supervisorFollowupText ?? '').trim();
  if (sExtra) {
    const base = String(next.supervisor_feedback ?? '').trim();
    next = { ...next, supervisor_feedback: base ? `${base}\n${sExtra}` : sExtra };
  }
  return next;
}

/**
 * When expanded narrative steps were skipped (strong experience), pad motivation + pressure so scoring/text pipelines receive substantive strings.
 */
export function ensureFastPathNarrativePadding(
  answers: WorkerAiPrescreenAnswers,
  expandedNarrativeShown: boolean,
): WorkerAiPrescreenAnswers {
  if (expandedNarrativeShown) return answers;
  const exp = String(answers.experience_details ?? '').trim();
  const snippet = exp.length > 40 ? `${exp.slice(0, 200)}…` : exp || 'my recent work history and availability.';

  const pad = (existing: string, lead: string): string => {
    if (wordCountAnswer(existing) >= PRESCREEN_MIN_SUBSTANTIVE_WORDS) return existing;
    return `${lead} ${snippet} I can share more in a follow-up conversation with the team.`.trim();
  };

  return {
    ...answers,
    motivation: pad(String(answers.motivation ?? ''), 'My goals align with roles that fit'),
    pressure_situation: pad(
      String(answers.pressure_situation ?? ''),
      'I stay calm under pressure. Context from my background:',
    ),
  };
}

const SUBSTANTIVE_TEXT_IDS = new Set<WorkerAiPrescreenStepId>([
  'motivation',
  'experience_details',
  'pressure_situation',
  'supervisor_feedback',
]);

type DynamicValidFn = (step: WorkerAiPrescreenDynamicStep, da: Record<string, string>) => boolean;

export function validatePrescreenNavEntry(
  entry: PrescreenNavEntry,
  answers: WorkerAiPrescreenAnswers,
  dynamicAnswers: Record<string, string>,
  experienceFollowupText: string,
  isFastPath: boolean,
  dynamicStepValid: DynamicValidFn,
  pressureFollowupText = '',
  supervisorFollowupText = '',
): boolean {
  if (entry.kind === 'client_followup') {
    if (entry.followup === 'experience') {
      const merged = wordCountAnswer(
        `${String(answers.experience_details ?? '').trim()}\n${String(experienceFollowupText ?? '').trim()}`.trim(),
      );
      return merged >= PRESCREEN_MIN_SUBSTANTIVE_WORDS;
    }
    if (entry.followup === 'pressure') {
      const merged = wordCountAnswer(
        `${String(answers.pressure_situation ?? '').trim()}\n${String(pressureFollowupText ?? '').trim()}`.trim(),
      );
      return merged >= PRESCREEN_MIN_SUBSTANTIVE_WORDS;
    }
    const merged = wordCountAnswer(
      `${String(answers.supervisor_feedback ?? '').trim()}\n${String(supervisorFollowupText ?? '').trim()}`.trim(),
    );
    return merged >= PRESCREEN_MIN_SUBSTANTIVE_WORDS;
  }
  if (entry.kind === 'dynamic') {
    return dynamicStepValid(entry.step, dynamicAnswers);
  }
  const step = entry.step;
  switch (step.type) {
    case 'text': {
      const v = String((answers as Record<string, unknown>)[step.id] ?? '').trim();
      if (step.id === 'additional_notes') return true;
      if (step.id === 'experience_details' && isFastPath) {
        const wc = wordCountAnswer(v);
        if (wc >= PRESCREEN_MIN_SUBSTANTIVE_WORDS) return true;
        return wc >= 3;
      }
      if (step.id === 'pressure_situation' && isFastPath) {
        const wc = wordCountAnswer(v);
        if (wc >= PRESCREEN_MIN_SUBSTANTIVE_WORDS) return true;
        return wc >= 3 && wc < 9;
      }
      if (step.id === 'supervisor_feedback' && isFastPath) {
        const wc = wordCountAnswer(v);
        if (wc >= PRESCREEN_MIN_SUBSTANTIVE_WORDS) return true;
        return wc >= 3 && wc < 9;
      }
      if (SUBSTANTIVE_TEXT_IDS.has(step.id)) {
        return wordCountAnswer(v) >= PRESCREEN_MIN_SUBSTANTIVE_WORDS;
      }
      if (step.id === 'attendance_explanation') {
        const attYes = String(answers.attendance_issues ?? '').trim().toLowerCase() === 'yes';
        if (!attYes) return true;
        return wordCountAnswer(v) >= PRESCREEN_MIN_SUBSTANTIVE_WORDS || /^(n\/a|na)$/i.test(v.trim());
      }
      return v.length >= 2;
    }
    case 'single_select': {
      const v = String((answers as Record<string, unknown>)[step.id] ?? '').trim();
      return v.length > 0;
    }
    case 'multi_select': {
      const arr =
        step.id === 'work_confidence'
          ? answers.work_confidence || []
          : Array.isArray((answers as Record<string, unknown>)[step.id])
            ? ((answers as Record<string, unknown>)[step.id] as string[])
            : [];
      return arr.length > 0;
    }
    default:
      return true;
  }
}
