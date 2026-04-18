/**
 * Deterministic dynamic question modules (no LLM). Appended after core templates.
 */
import type { AiInterviewContext, DynamicPrescreenStep } from './aiInterviewContextTypes';
import { DEFAULT_AI_PRESCREEN_TENANT_POLICY } from './aiPrescreenJobSlice';

const YNNS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'not_sure', label: 'Not sure' },
];

const MAX_CERT_QUESTIONS = 3;
const MAX_PHYSICAL_BULLETS = 5;

function joinPhysicalList(items: string[]): string {
  const slice = items.slice(0, MAX_PHYSICAL_BULLETS);
  if (slice.length === 0) return '';
  if (slice.length === 1) return slice[0];
  if (slice.length === 2) return `${slice[0]} and ${slice[1]}`;
  return `${slice.slice(0, -1).join(', ')}, and ${slice[slice.length - 1]}`;
}

function joinUniformList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return items.join(', ');
}

function certSlug(cert: string): string {
  return cert
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'cert';
}

/**
 * Ordered: shift → location → compliance (drug, background) → physical → certifications → uniform → gig path.
 */
export function buildDynamicPrescreenSteps(context: AiInterviewContext): DynamicPrescreenStep[] {
  const prescreen = context.businessRules?.aiPrescreen ?? DEFAULT_AI_PRESCREEN_TENANT_POLICY;
  if (prescreen.enabled === false) return [];

  const steps: DynamicPrescreenStep[] = [];
  const a = context.assignment;
  const q = prescreen.questions;

  if (q.askShiftConfirmation && a?.startTime) {
    const startTime = String(a.startTime);
    steps.push({
      id: 'dyn_shift_punctuality',
      type: 'single_select',
      module: 'shift',
      prompt: `This shift starts at ${startTime}. Can you be on time for this start time?`,
      promptKey: 'workerAiPrescreen.dynamic.dyn_shift_punctuality',
      promptParams: { startTime },
      options: YNNS,
    });
  }

  if (q.askLocationConfirmation && a?.location) {
    const location = String(a.location);
    steps.push({
      id: 'dyn_worksite_commute',
      type: 'single_select',
      module: 'location',
      prompt: `This job’s worksite is in ${location}. Can you get to this location reliably for this job?`,
      promptKey: 'workerAiPrescreen.dynamic.dyn_worksite_commute',
      promptParams: { location },
      options: YNNS,
    });
  }

  if (q.askDrugScreenConfirmation && a?.requiresDrugScreen) {
    steps.push({
      id: 'dyn_job_drug_screen',
      type: 'single_select',
      module: 'compliance_drug',
      prompt:
        'This posting requires a drug screen before you start. Are you able to complete it?',
      promptKey: 'workerAiPrescreen.dynamic.dyn_job_drug_screen',
      options: YNNS,
    });
  }

  if (q.askBackgroundConfirmation && a?.requiresBackgroundCheck) {
    steps.push({
      id: 'dyn_job_background_check',
      type: 'single_select',
      module: 'compliance_background',
      prompt: 'This posting requires a background check. Are you able to pass and complete it?',
      promptKey: 'workerAiPrescreen.dynamic.dyn_job_background_check',
      options: YNNS,
    });
  }

  const phys = a?.physicalRequirements?.filter(Boolean) ?? [];
  if (phys.length > 0) {
    const list = joinPhysicalList(phys);
    steps.push({
      id: 'dyn_physical_job_fit',
      type: 'single_select',
      module: 'physical',
      prompt: `For this role, the work includes physical tasks like ${list}. Are you comfortable with that for this posting?`,
      promptKey: 'workerAiPrescreen.dynamic.dyn_physical_job_fit',
      promptParams: { list },
      options: YNNS,
    });
  }

  const certs = q.askCertificationConfirmation
    ? [...new Set((a?.certificationsRequired ?? []).filter(Boolean))].slice(0, MAX_CERT_QUESTIONS)
    : [];
  for (const cert of certs) {
    const slug = certSlug(cert);
    steps.push({
      id: `dyn_cert__${slug}`,
      type: 'single_select',
      module: 'certification',
      prompt: `This job requires ${cert}. Do you have this certification?`,
      promptKey: 'workerAiPrescreen.dynamic.dyn_cert_have',
      promptParams: { cert },
      options: YNNS,
    });
    steps.push({
      id: `dyn_cert_willing__${slug}`,
      type: 'single_select',
      module: 'certification',
      prompt: `If you don't already have ${cert}, are you willing to obtain it before or shortly after starting?`,
      promptKey: 'workerAiPrescreen.dynamic.dyn_cert_willing',
      promptParams: { cert },
      options: YNNS,
    });
  }

  const uniforms = q.askUniformConfirmation ? (a?.uniformRequirements?.filter(Boolean) ?? []) : [];
  if (uniforms.length > 0) {
    const uText = joinUniformList(uniforms);
    steps.push({
      id: 'dyn_uniform_available',
      type: 'single_select',
      module: 'uniform',
      prompt: `This role requires ${uText}. Do you have these available?`,
      promptKey: 'workerAiPrescreen.dynamic.dyn_uniform_available',
      promptParams: { uniformText: uText },
      options: YNNS,
    });
  }

  if (q.allowGigFallbackQuestion && context.businessRules?.allowGigPath) {
    steps.push({
      id: 'dyn_gig_path_willing',
      type: 'single_select',
      module: 'gig_path',
      prompt:
        'We may have gig shifts available before a full-time role opens. Would you be willing to take gig shifts in the meantime?',
      promptKey: 'workerAiPrescreen.dynamic.dyn_gig_path_willing',
      options: YNNS,
    });
  }

  return steps;
}
