/**
 * AI hiring monitor — pure selection-rate math (Greg 2026-09-10, Illinois).
 *
 * The Illinois Human Rights Act (as amended by HB 3773, effective 2026-01-01)
 * makes AI use that has the EFFECT of discriminating a civil-rights
 * violation, so the evidence we keep is outcome data: for applicants to
 * Illinois postings, how often each self-identified group reaches Tier 2+
 * (promotion) and gets hired, compared with the best-performing group.
 *
 * Impact ratio = group rate / highest group rate among comparable groups (the
 * EEOC "four-fifths" rule of thumb flags ratios below 0.8). Groups smaller
 * than the minimum size, "decline to answer", and unanswered applicants are
 * counted but never compared — small samples swing wildly and would flag
 * noise. Self-ID answers are voluntary and never reach recruiters; only these
 * aggregates are stored.
 */

export {
  RACE_ETHNICITY_CODES,
  SEX_CODES,
  isIllinoisPosting,
  postingStateCode,
} from '../shared/illinoisAiHiring';
export type { RaceEthnicityCode, SexCode } from '../shared/illinoisAiHiring';

export type AgeBand = 'under_40' | '40_plus';

export const FOUR_FIFTHS_THRESHOLD = 0.8;
export const DEFAULT_MIN_GROUP_SIZE = 5;

export interface MonitorApplicant {
  raceEthnicity: string | null;
  sex: string | null;
  ageBand: AgeBand | null;
  /** Currently Tier 1 or Tier 2. */
  promoted: boolean;
  /** Employed at the posting's hiring entity. */
  hired: boolean;
}

export type GroupFlag = 'ok' | 'below_four_fifths' | 'too_few';

export interface GroupRate {
  group: string;
  applicants: number;
  promoted: number;
  hired: number;
  promotionRate: number | null;
  hireRate: number | null;
  promotionImpactRatio: number | null;
  hireImpactRatio: number | null;
  flag: GroupFlag;
}

export interface DimensionRates {
  groups: GroupRate[];
  declined: number;
  unanswered: number;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function ageBandFromDob(dob: unknown, now: Date = new Date()): AgeBand | null {
  let d: Date | null = null;
  if (dob && typeof (dob as { toDate?: unknown }).toDate === 'function') {
    d = (dob as { toDate: () => Date }).toDate();
  } else if (typeof dob === 'string' && dob.trim()) {
    const parsed = new Date(dob.trim());
    d = Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (!d) return null;
  let age = now.getFullYear() - d.getFullYear();
  const beforeBirthday =
    now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate());
  if (beforeBirthday) age--;
  if (age < 14 || age > 110) return null;
  return age >= 40 ? '40_plus' : 'under_40';
}

export function computeSelectionRates(
  applicants: MonitorApplicant[],
  groupOf: (a: MonitorApplicant) => string | null,
  minGroupSize: number = DEFAULT_MIN_GROUP_SIZE,
): DimensionRates {
  const tallies = new Map<string, { applicants: number; promoted: number; hired: number }>();
  let declined = 0;
  let unanswered = 0;
  for (const a of applicants) {
    const g = groupOf(a);
    if (g == null || g === '') {
      unanswered++;
      continue;
    }
    if (g === 'decline') {
      declined++;
      continue;
    }
    const t = tallies.get(g) ?? { applicants: 0, promoted: 0, hired: 0 };
    t.applicants++;
    if (a.promoted) t.promoted++;
    if (a.hired) t.hired++;
    tallies.set(g, t);
  }

  const comparable = [...tallies.values()].filter((t) => t.applicants >= minGroupSize);
  const bestPromotion = Math.max(0, ...comparable.map((t) => t.promoted / t.applicants));
  const bestHire = Math.max(0, ...comparable.map((t) => t.hired / t.applicants));

  const groups: GroupRate[] = [...tallies.entries()]
    .map(([group, t]) => {
      const promotionRate = t.promoted / t.applicants;
      const hireRate = t.hired / t.applicants;
      if (t.applicants < minGroupSize) {
        return {
          group,
          ...t,
          promotionRate: round3(promotionRate),
          hireRate: round3(hireRate),
          promotionImpactRatio: null,
          hireImpactRatio: null,
          flag: 'too_few' as const,
        };
      }
      const promotionImpactRatio = bestPromotion > 0 ? promotionRate / bestPromotion : null;
      const hireImpactRatio = bestHire > 0 ? hireRate / bestHire : null;
      const below =
        (promotionImpactRatio != null && promotionImpactRatio < FOUR_FIFTHS_THRESHOLD) ||
        (hireImpactRatio != null && hireImpactRatio < FOUR_FIFTHS_THRESHOLD);
      return {
        group,
        ...t,
        promotionRate: round3(promotionRate),
        hireRate: round3(hireRate),
        promotionImpactRatio: promotionImpactRatio == null ? null : round3(promotionImpactRatio),
        hireImpactRatio: hireImpactRatio == null ? null : round3(hireImpactRatio),
        flag: below ? ('below_four_fifths' as const) : ('ok' as const),
      };
    })
    .sort((a, b) => b.applicants - a.applicants || a.group.localeCompare(b.group));

  return { groups, declined, unanswered };
}
