/**
 * INT-2b (Greg 2026-08-30): position-type question packs + opening-block trim.
 *
 * Application-mode interviews get 2–3 questions RELEVANT to the position type
 * (resolved from the job title) and drop the generic opening block — a
 * warehouse applicant answers lifting/equipment questions instead of "what
 * kinds of work do you want". Types align with the existing
 * opening_experience_* taxonomy so the kept experience step matches.
 *
 * Pack questions ride the standard dynamics pipe (single_select yes/no/
 * not_sure, promptKey → workerAiPrescreen.dynamic.*), so both clients render
 * them with zero client changes and the answer bank covers them on repeat
 * interviews automatically. ADA framing throughout ("with or without a
 * reasonable accommodation") per the b3387e7d copy rewrite.
 *
 * Unresolved titles get NO pack and NO trim — the generic interview is the
 * safe fallback.
 */
import type { AiInterviewContext, DynamicPrescreenStep } from './aiInterviewContextTypes';

export type PrescreenPositionType =
  | 'industrial'
  | 'events'
  | 'hospitality'
  | 'clerical'
  | 'healthcare';

/** Ordered — first hit wins, role words before venue words (a "General
 *  Maintenance Worker — Sharp Hospital" is maintenance, not healthcare). */
const KEYWORD_RULES: Array<{ type: PrescreenPositionType; re: RegExp }> = [
  { type: 'clerical', re: /(clerical|admin(istrative)?|office assistant|receptionist|data entry|clerk|front desk)/i },
  { type: 'healthcare', re: /(caregiver|cna\b|nurse|nursing|med(ical)? assistant|patient|phlebotom)/i },
  { type: 'hospitality', re: /(housekeep|room attendant|banquet|server|bartender|barista|host(ess)?\b|steward|hospitality|catering|dishwash|busser|cook|food service|concession)/i },
  { type: 'industrial', re: /(warehouse|loader|unloader|forklift|pallet|production|assembly|operative|machine|manufactur|dock|picker|packer|material handler|general labor|laborer|maintenance|janitor|custodi|groundskeep|station attendant|environmental service)/i },
  { type: 'events', re: /(event|usher|festival|stadium|arena|concert|gameday|game day|crowd|guest services|ticket|venue|crew)/i },
];

export function resolvePrescreenPositionType(title: string | null | undefined): PrescreenPositionType | null {
  const t = String(title ?? '').trim();
  if (!t) return null;
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(t)) return rule.type;
  }
  return null;
}

const YNNS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'not_sure', label: 'Not sure' },
];

interface PackQuestion {
  slug: string;
  prompt: string;
}

const PACKS: Record<PrescreenPositionType, PackQuestion[]> = {
  industrial: [
    {
      slug: 'lifting',
      prompt:
        'This kind of role involves repetitive lifting, often up to 50 lbs. Are you able to do that, with or without a reasonable accommodation?',
    },
    {
      slug: 'equipment',
      prompt: 'Have you used warehouse equipment like pallet jacks or hand trucks before?',
    },
    {
      slug: 'early_starts',
      prompt: 'Warehouse and site shifts often start early in the morning. Do early start times work for you?',
    },
  ],
  events: [
    {
      slug: 'standing',
      prompt:
        'Event shifts usually mean being on your feet for 6–8+ hours. Are you able to do that, with or without a reasonable accommodation?',
    },
    {
      slug: 'crowds',
      prompt: 'Are you comfortable working in loud, crowded venues?',
    },
    {
      slug: 'weekends',
      prompt: 'Events mostly run evenings and weekends. Does that schedule work for you?',
    },
  ],
  hospitality: [
    {
      slug: 'guest_facing',
      prompt: 'Are you comfortable in guest-facing roles where presentation and friendliness matter?',
    },
    {
      slug: 'standards',
      prompt: 'Hospitality clients set uniform and grooming standards. Are you okay following them?',
    },
    {
      slug: 'peak_days',
      prompt: 'Hotels and venues are busiest on weekends and holidays. Can you work those days?',
    },
  ],
  clerical: [
    {
      slug: 'computer',
      prompt: 'Are you comfortable with basic computer work — email, spreadsheets, and data entry?',
    },
    {
      slug: 'phones',
      prompt: 'Are you comfortable answering phones and speaking with customers professionally?',
    },
    {
      slug: 'accuracy',
      prompt: 'Clerical work depends on accuracy with details like names and numbers. Is that a strength of yours?',
    },
  ],
  healthcare: [
    {
      slug: 'environment',
      prompt: 'Have you worked in a healthcare or care-facility environment before?',
    },
    {
      slug: 'discretion',
      prompt: 'Healthcare settings call for patience and discretion around patients. Are you comfortable with that?',
    },
    {
      slug: 'screenings',
      prompt:
        'Healthcare clients often require immunization records or extra screenings. Are you able to complete those?',
    },
  ],
};

/** Generic opening block dropped when the position type is known. The matched
 *  type's own experience step is KEPT — it is the relevant one. */
const OPENING_BLOCK_IDS = [
  'opening_target_work_types',
  'opening_schedule_preferences',
  'opening_gig_types',
  'opening_experience_industrial',
  'opening_experience_hospitality',
  'opening_experience_events',
  'opening_experience_clerical',
  'opening_experience_healthcare',
];

export interface PrescreenPositionContext {
  positionType: PrescreenPositionType | null;
  packSteps: DynamicPrescreenStep[];
  trimmedCoreStepIds: string[];
}

export function resolvePrescreenPositionContext(
  context: AiInterviewContext,
): PrescreenPositionContext {
  const positionType = resolvePrescreenPositionType(context.assignment?.title);
  if (!positionType) {
    return { positionType: null, packSteps: [], trimmedCoreStepIds: [] };
  }
  const packSteps: DynamicPrescreenStep[] = PACKS[positionType].map((q) => ({
    id: `dyn_pos_${positionType}_${q.slug}`,
    type: 'single_select',
    module: 'position_fit',
    prompt: q.prompt,
    promptKey: `workerAiPrescreen.dynamic.dyn_pos_${positionType}_${q.slug}`,
    options: YNNS,
  }));
  const keepExperienceId = `opening_experience_${positionType}`;
  const trimmedCoreStepIds = OPENING_BLOCK_IDS.filter((id) => id !== keepExperienceId);
  return { positionType, packSteps, trimmedCoreStepIds };
}
