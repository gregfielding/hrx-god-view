/**
 * Reconstruct answer objects from a stored `users/{uid}/interviews/{id}` worker AI prescreen doc.
 */
import type { WorkerAiPrescreenAnswers } from './scoreWorkerAiPrescreen';
import { PRESCREEN_OPENING_MULTI_SELECT_KEYS } from './prescreenOpeningKeys';

const CORE_KEYS: (keyof WorkerAiPrescreenAnswers | string)[] = [
  'motivation',
  'experience_details',
  'work_confidence',
  'pressure_situation',
  'attendance_issues',
  'attendance_explanation',
  'transportation_plan',
  'backup_transportation',
  'physical_comfort',
  'drug_screen',
  'background_check',
  'supervisor_feedback',
  'additional_notes',
];

const REQUIRED_KEYS: (keyof WorkerAiPrescreenAnswers | string)[] = [
  ...PRESCREEN_OPENING_MULTI_SELECT_KEYS,
  ...CORE_KEYS,
];

const MULTI_SELECT_KEYS = new Set<string>(['work_confidence', ...PRESCREEN_OPENING_MULTI_SELECT_KEYS]);

export function extractPrescreenAnswersFromInterviewDoc(data: Record<string, unknown>): {
  answers: WorkerAiPrescreenAnswers | null;
  dynamicAnswers: Record<string, string>;
} {
  const questions = data.questions as Array<{ id: string; answer: string }> | undefined;
  if (!Array.isArray(questions)) return { answers: null, dynamicAnswers: {} };

  const byId: Record<string, string> = {};
  for (const q of questions) {
    if (q?.id) byId[q.id] = String(q.answer ?? '');
  }

  const answers: Partial<WorkerAiPrescreenAnswers> = {};
  for (const key of REQUIRED_KEYS) {
    if (MULTI_SELECT_KEYS.has(String(key))) {
      const s = byId[key] || '';
      (answers as Record<string, unknown>)[key] = s.split(',').map((x) => x.trim()).filter(Boolean);
      continue;
    }
    (answers as Record<string, string>)[key] = byId[key] ?? '';
  }

  const dynamicAnswers: Record<string, string> = {};
  for (const [k, v] of Object.entries(byId)) {
    if (k.startsWith('dyn_')) {
      dynamicAnswers[k] = String(v).trim().toLowerCase().replace(/\s+/g, '_');
    }
  }

  if (!String(answers.attendance_issues ?? '').trim() || !String(answers.transportation_plan ?? '').trim()) {
    return { answers: null, dynamicAnswers };
  }

  return { answers: answers as WorkerAiPrescreenAnswers, dynamicAnswers };
}
