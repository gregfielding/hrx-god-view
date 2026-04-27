/**
 * When job postings inject `dyn_job_drug_screen` / `dyn_job_background_check`, submit omits core
 * `drug_screen` / `background_check` from stored `questions` — answers live only under dynamic keys.
 * Scoring must merge those into the core shape before normalize/score.
 */
import type { WorkerAiPrescreenAnswers } from './scoreWorkerAiPrescreen';

export const DYN_JOB_DRUG_SCREEN_ID = 'dyn_job_drug_screen';
export const DYN_JOB_BACKGROUND_CHECK_ID = 'dyn_job_background_check';

export type DrugBackgroundMergeSource = 'core' | 'dynamic' | 'none';

export type MergeDrugBackgroundMeta = {
  drugSource: DrugBackgroundMergeSource;
  backgroundSource: DrugBackgroundMergeSource;
};

/** Prefer non-empty core; if core empty, fall back to job dynamic answer (normalized storage). */
export function mergeDynamicDrugBackgroundIntoCoreAnswers(
  answers: WorkerAiPrescreenAnswers,
  dynamicAnswers: Record<string, string>,
): { merged: WorkerAiPrescreenAnswers; meta: MergeDrugBackgroundMeta } {
  const merged: WorkerAiPrescreenAnswers = { ...answers };
  const coreDrug = String(merged.drug_screen ?? '').trim();
  const coreBg = String(merged.background_check ?? '').trim();
  const dynDrug = String(dynamicAnswers[DYN_JOB_DRUG_SCREEN_ID] ?? '').trim();
  const dynBg = String(dynamicAnswers[DYN_JOB_BACKGROUND_CHECK_ID] ?? '').trim();

  let drugSource: DrugBackgroundMergeSource = 'none';
  let backgroundSource: DrugBackgroundMergeSource = 'none';

  if (coreDrug) {
    merged.drug_screen = coreDrug;
    drugSource = 'core';
  } else if (dynDrug) {
    merged.drug_screen = dynDrug;
    drugSource = 'dynamic';
  }

  if (coreBg) {
    merged.background_check = coreBg;
    backgroundSource = 'core';
  } else if (dynBg) {
    merged.background_check = dynBg;
    backgroundSource = 'dynamic';
  }

  return { merged, meta: { drugSource, backgroundSource } };
}
