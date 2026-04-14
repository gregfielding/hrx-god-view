/** Dynamic modules returned by `getWorkerAiPrescreenInterviewPlan` / sent as `dynamicAnswers` keys. */

export type WorkerAiPrescreenDynamicAnswer = 'yes' | 'no' | 'not_sure';

export type WorkerAiPrescreenDynamicStep = {
  id: string;
  type: 'single_select';
  prompt: string;
  options: { value: string; label: string }[];
  module: string;
};
