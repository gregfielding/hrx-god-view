/** Dynamic modules returned by `getWorkerAiPrescreenInterviewPlan` / sent as `dynamicAnswers` keys. */

export type WorkerAiPrescreenDynamicAnswer = 'yes' | 'no' | 'not_sure';

export type WorkerAiPrescreenDynamicStep = {
  id: string;
  type: 'single_select';
  prompt: string;
  /** When set, worker UI should render `t(promptKey, promptParams)` (fallback: `prompt`). */
  promptKey?: string;
  promptParams?: Record<string, string | number>;
  options: { value: string; label: string }[];
  module: string;
};
