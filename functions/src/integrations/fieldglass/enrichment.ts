/**
 * **Fieldglass detail-page enrichment — extraction types + LLM extractor
 * (FG Slice 5).**
 *
 * The notification email is the minute-0 trigger, but the detail page
 * behind the supplier login carries what the email lacks: positions
 * requested, ST/OT/DT pay+bill rates, the full street work location,
 * schedule free-text, hiring manager, max submissions, and — competitive
 * gold — the "do you have a candidate in mind?" answer that reveals an
 * order wired for a competitor.
 *
 * The Chrome extension (browser-extensions/fieldglass-sync/) is a dumb
 * courier: it ships the page's TEXT here and the server extracts. That
 * choice is deliberate — DOM-selector scraping breaks the day SAP tweaks
 * markup, while LLM extraction over visible text survives layout changes.
 * Conventions mirror the Indeed Flex `llmFallback.ts` (gpt-5, NO
 * temperature param — the model 400s on non-default values,
 * `response_format: json_object`, tolerant JSON parse).
 */

import OpenAI from 'openai';

/** Everything we try to pull off a job_posting_detail.do page. All
 *  optional — pages vary and the extractor omits what it can't see. */
export interface FieldglassEnrichment {
  /** "SDXOJP\d+" — also extracted by regex as a cross-check. */
  jobPostingId?: string;
  title?: string;
  /** Site name as shown (often with the code in parens). */
  siteName?: string;
  /** 10-digit Sodexo site code, e.g. "0088151020". */
  siteCode?: string;
  /** Full street work location — THE address source. */
  workLocation?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  positionsRequested?: number;
  maxSubmissions?: number;
  payRateSt?: number;
  payRateOt?: number;
  payRateDt?: number;
  billRateSt?: number;
  billRateOt?: number;
  billRateDt?: number;
  /** "First Day Schedule Start and End Time" free text. */
  scheduleText?: string;
  hiringManagerName?: string;
  hiringManagerEmail?: string;
  /** Often buried in the Description prose ("My phone number is …"). */
  hiringManagerPhone?: string;
  uniform?: string;
  /** Full Description block, verbatim — duties + site contact prose. */
  description?: string;
  /** "Report To Location" — e.g. "4420 Arrowswest Drive Dock #3". */
  reportToLocation?: string;
  /** "Add additional Onboarding items…" — often carries site-specific
   *  EXTRA screenings (FBI fingerprinting, state clearances, drug panels). */
  additionalOnboarding?: string;
  contractType?: string;
  sourceType?: string;
  segment?: string;
  hoursPerDay?: number;
  hoursPerWeek?: number;
  totalHours?: number;
  /** "Respond by Date" with timezone as printed. */
  respondByDate?: string;
  /** Page status: "Submitted" (open) / "Closed" — drives the close cascade. */
  postingStatus?: string;
  category?: string;
  laborType?: string;
  jobCode?: string;
  startDate?: string;
  endDate?: string;
  closeDate?: string;
  /** True when the buyer answered yes to "do you have a candidate in
   *  mind that you have previously used before?" — order is likely
   *  wired for a specific worker/competitor. */
  candidateInMind?: boolean;
  /** The verbatim answer, e.g. "Yes / rudolph with jobletics". */
  candidateInMindNote?: string;
}

/** Sidecar stamped onto the `external_shift_requests` row. */
export interface FieldglassEnrichmentStamp extends FieldglassEnrichment {
  capturedAt: string;
  capturedBy: 'extension';
  sourceUrl?: string;
  extractionNotes?: string;
}

export interface OpenAILike {
  chat: {
    completions: {
      create: OpenAI['chat']['completions']['create'];
    };
  };
}

let cached: OpenAILike | null = null;
export function defaultOpenAI(): OpenAILike {
  if (cached) return cached;
  cached = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' }) as OpenAILike;
  return cached;
}

export function extractPostingIdFromText(text: string): string | null {
  const m = /SDXOJP\d{6,}/.exec(String(text ?? ''));
  return m ? m[0] : null;
}

const EXTRACTION_SCHEMA = `{
  "jobPostingId": "SDXOJP... string",
  "title": "string",
  "siteName": "string (site name WITHOUT any trailing code in parentheses)",
  "siteCode": "string (the 10-digit code, often shown in parentheses after the site name)",
  "workLocation": { "street": "string", "city": "string", "state": "2-letter code", "zipCode": "string" },
  "positionsRequested": number,
  "maxSubmissions": number,
  "payRateSt": number, "payRateOt": number, "payRateDt": number,
  "billRateSt": number, "billRateOt": number, "billRateDt": number,
  "scheduleText": "string (First Day Schedule Start and End Time, verbatim)",
  "hiringManagerName": "string", "hiringManagerEmail": "string",
  "hiringManagerPhone": "string (often inside the Description prose, e.g. 'My phone number is …')",
  "uniform": "string",
  "description": "string (the full Description block, verbatim)",
  "reportToLocation": "string (Report To Location, verbatim — may include dock/entrance)",
  "additionalOnboarding": "string (the 'Add additional Onboarding items for your specific client/site' answer, verbatim — often lists extra background checks/clearances)",
  "contractType": "string", "sourceType": "string", "segment": "string",
  "hoursPerDay": number, "hoursPerWeek": number, "totalHours": number,
  "respondByDate": "string (Respond by Date, verbatim incl. timezone)",
  "postingStatus": "string (the page's Status value, e.g. Submitted or Closed)",
  "category": "string", "laborType": "string", "jobCode": "string",
  "startDate": "MM/DD/YYYY", "endDate": "MM/DD/YYYY", "closeDate": "MM/DD/YYYY",
  "candidateInMind": boolean,
  "candidateInMindNote": "string (verbatim answer to the candidate-in-mind question, including the name if given)"
}`;

function buildSystemPrompt(): string {
  return `You are a strict JSON extractor for SAP Fieldglass "Job Posting" detail pages (supplier view, buyer Sodexo).
Input is the visible text of the page, which may include navigation chrome and unrelated boilerplate — ignore those.
Output JSON only — no prose, no markdown fences. Omit any field not clearly present rather than guessing.
Rates: "ST/OT/DT" = straight/overtime/double time. Pay Rate = what the worker is paid; Bill Rate = what the supplier bills.
candidateInMind: the page asks something like "Do you have a candidate in mind that you have previously used before?" — set true ONLY when the answer indicates yes; capture the verbatim answer in candidateInMindNote.`;
}

export interface EnrichmentExtractResult {
  enrichment: FieldglassEnrichment;
  notes?: string;
}

export async function extractEnrichmentFromPageText(
  pageText: string,
  client?: OpenAILike,
  model = 'gpt-5',
): Promise<EnrichmentExtractResult> {
  const openai = client ?? defaultOpenAI();
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'user',
        content: [
          `Expected schema: ${EXTRACTION_SCHEMA}`,
          '',
          'Page text:',
          '"""',
          // Detail pages are a few KB of visible text; cap defensively.
          String(pageText ?? '').slice(0, 24000),
          '"""',
          '',
          'Respond with one JSON object only.',
        ].join('\n'),
      },
    ],
    // NO temperature — gpt-5 rejects non-default values (see the
    // 2026-05-23 note in indeedFlex/parser/llmFallback.ts).
    response_format: { type: 'json_object' },
    // gpt-5 is a reasoning model: completion tokens are consumed by
    // internal reasoning BEFORE any visible output. 1200 was fully eaten
    // by reasoning over a ~20KB page → empty content → "json parse
    // failed" (first live capture, SDXOJP00186302, 2026-07-07). 6000
    // leaves generous headroom; the JSON itself is only ~500 tokens.
    max_completion_tokens: 6000,
  });

  const raw = completion.choices?.[0]?.message?.content ?? '';
  const { parsed, notes } = parseLlmJson(raw);

  // Light normalization — numbers may arrive as "$18.44" strings.
  const num = (v: unknown): number | undefined => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v.replace(/[$,\s]/g, ''));
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  };
  const str = (v: unknown): string | undefined => {
    const s = String(v ?? '').trim();
    return s ? s : undefined;
  };

  const wl = (parsed.workLocation ?? {}) as Record<string, unknown>;
  const enrichment: FieldglassEnrichment = {
    jobPostingId: str(parsed.jobPostingId),
    title: str(parsed.title),
    siteName: str(parsed.siteName),
    siteCode: str(parsed.siteCode)?.replace(/[()\s]/g, ''),
    workLocation:
      str(wl.street) || str(wl.city)
        ? {
            street: str(wl.street),
            city: str(wl.city),
            state: str(wl.state),
            zipCode: str(wl.zipCode),
          }
        : undefined,
    positionsRequested: num(parsed.positionsRequested),
    maxSubmissions: num(parsed.maxSubmissions),
    payRateSt: num(parsed.payRateSt),
    payRateOt: num(parsed.payRateOt),
    payRateDt: num(parsed.payRateDt),
    billRateSt: num(parsed.billRateSt),
    billRateOt: num(parsed.billRateOt),
    billRateDt: num(parsed.billRateDt),
    scheduleText: str(parsed.scheduleText),
    hiringManagerName: str(parsed.hiringManagerName),
    hiringManagerEmail: str(parsed.hiringManagerEmail),
    hiringManagerPhone: str(parsed.hiringManagerPhone),
    uniform: str(parsed.uniform),
    description: str(parsed.description),
    reportToLocation: str(parsed.reportToLocation),
    additionalOnboarding: str(parsed.additionalOnboarding),
    contractType: str(parsed.contractType),
    sourceType: str(parsed.sourceType),
    segment: str(parsed.segment),
    hoursPerDay: num(parsed.hoursPerDay),
    hoursPerWeek: num(parsed.hoursPerWeek),
    totalHours: num(parsed.totalHours),
    respondByDate: str(parsed.respondByDate),
    postingStatus: str(parsed.postingStatus),
    category: str(parsed.category),
    laborType: str(parsed.laborType),
    jobCode: str(parsed.jobCode),
    startDate: str(parsed.startDate),
    endDate: str(parsed.endDate),
    closeDate: str(parsed.closeDate),
    candidateInMind: parsed.candidateInMind === true,
    candidateInMindNote: str(parsed.candidateInMindNote),
  };

  // Drop undefined keys so the Firestore merge stays clean.
  for (const k of Object.keys(enrichment) as Array<keyof FieldglassEnrichment>) {
    if (enrichment[k] === undefined) delete enrichment[k];
  }

  return { enrichment, ...(notes ? { notes } : {}) };
}

/**
 * Compose the JO `notes` block from everything the Fieldglass detail page
 * carries (Greg, 2026-07-07: "make an orderNotes field on the job order
 * overview tab to include everything in the job details column in
 * fieldglass"). Deterministic composition — NOT LLM-formatted — so the
 * block reads the same on every order and diffs cleanly on re-sync.
 */
export function composeFieldglassOrderNotes(
  enrichment: FieldglassEnrichment,
  postingId: string,
): string {
  const lines: string[] = [`— Fieldglass order ${postingId} —`];
  const add = (label: string, v: unknown): void => {
    const s = String(v ?? '').trim();
    if (s) lines.push(`${label}: ${s}`);
  };
  if (enrichment.candidateInMind) {
    lines.push(
      `⚠ CANDIDATE IN MIND: ${enrichment.candidateInMindNote ?? 'yes'} — buyer already has someone; confirm before investing recruiting effort.`,
    );
  }
  add('Schedule (first day)', enrichment.scheduleText);
  if (enrichment.hoursPerDay != null || enrichment.hoursPerWeek != null || enrichment.totalHours != null) {
    lines.push(
      `Hours: ${enrichment.hoursPerDay ?? '?'} per day · ${enrichment.hoursPerWeek ?? '?'} per week · ${enrichment.totalHours ?? '?'} total`,
    );
  }
  add('Report to', enrichment.reportToLocation);
  add('Uniform', enrichment.uniform);
  add(
    'Hiring manager',
    [enrichment.hiringManagerName, enrichment.hiringManagerEmail, enrichment.hiringManagerPhone]
      .filter(Boolean)
      .join(' · '),
  );
  add('Respond by', enrichment.respondByDate);
  if (enrichment.maxSubmissions != null) add('Max submissions', enrichment.maxSubmissions);
  add('Category / labor type', [enrichment.category, enrichment.laborType].filter(Boolean).join(' / '));
  add('Job code', enrichment.jobCode);
  add('Contract / source', [enrichment.contractType, enrichment.sourceType].filter(Boolean).join(' / '));
  add('Segment', enrichment.segment);
  if (
    enrichment.payRateSt != null ||
    enrichment.payRateOt != null ||
    enrichment.payRateDt != null
  ) {
    const fmt = (n?: number): string => (n != null ? `$${n.toFixed(2)}` : '—');
    lines.push(
      `Rates ST/OT/DT: pay ${fmt(enrichment.payRateSt)} / ${fmt(enrichment.payRateOt)} / ${fmt(enrichment.payRateDt)}` +
        ` · bill ${fmt(enrichment.billRateSt)} / ${fmt(enrichment.billRateOt)} / ${fmt(enrichment.billRateDt)}`,
    );
  }
  if (enrichment.additionalOnboarding) {
    lines.push(
      '',
      '⚠ ADDITIONAL ONBOARDING (site-specific — beyond the standard package):',
      enrichment.additionalOnboarding.trim(),
    );
  }
  if (enrichment.description) {
    lines.push('', 'Description (from Fieldglass):', enrichment.description.trim());
  }
  return lines.join('\n');
}

/**
 * Public jobs-board posting copy (Greg, 2026-07-07: "using AI to
 * generate a better jobs board posting"). Follows the house rules from
 * the `generateJobDescription` callable the recruiters' button uses:
 * NEVER name the client or worksite — "C1" is hiring; city/state/zip
 * only. Plain text, Indeed-style. Fail-open: null → caller keeps the
 * raw client description.
 */
export async function generateFieldglassPostingCopy(
  input: {
    title: string;
    city?: string;
    state?: string;
    zipCode?: string;
    payRate?: number;
    scheduleText?: string;
    uniform?: string;
    description?: string;
    jobType: 'gig' | 'career';
  },
  client?: OpenAILike,
  model = 'gpt-5',
): Promise<string | null> {
  try {
    const openai = client ?? defaultOpenAI();
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `You write job-board posting descriptions for C1, a staffing agency.
HARD RULES:
- NEVER mention the client company or worksite name. Say "C1 is hiring" — the role is with one of C1's clients.
- City/state/zip are fine to mention. No street addresses.
- Professional, engaging, clear — Indeed/Craigslist style. 100-170 words.
- Plain text only: short paragraphs and simple hyphen bullets. No markdown headers, no bold, no emojis.
- Include the pay rate when provided. Include schedule/uniform details when provided, phrased naturally.
- End with one short apply call-to-action sentence.`,
        },
        {
          role: 'user',
          content: [
            `Job title: ${input.title}`,
            input.city || input.state
              ? `Location: ${[input.city, input.state].filter(Boolean).join(', ')} ${input.zipCode ?? ''}`.trim()
              : '',
            input.payRate ? `Pay: $${input.payRate.toFixed(2)}/hour (show it)` : '',
            input.scheduleText ? `Schedule note: ${input.scheduleText}` : '',
            input.uniform ? `Uniform: ${input.uniform}` : '',
            `Engagement type: ${input.jobType === 'gig' ? 'short-term' : 'ongoing / contract-to-hire'}`,
            input.description ? `Client's role description (do not quote client names):\n${input.description}` : '',
            '',
            'Write the posting description now.',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      // NO temperature — gpt-5 rejects non-default values.
      max_completion_tokens: 4000,
    });
    const text = (completion.choices?.[0]?.message?.content ?? '').trim();
    return text.length >= 60 ? text : null;
  } catch {
    return null;
  }
}

/** Same tolerant parse as indeedFlex/parser/llmFallback.ts. */
function parseLlmJson(raw: string): { parsed: Record<string, unknown>; notes?: string } {
  const trimmed = raw.trim();
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return { parsed: obj as Record<string, unknown> };
    }
  } catch {
    // fall through
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) {
    try {
      const obj = JSON.parse(fenced[1]);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return { parsed: obj as Record<string, unknown>, notes: 'json fence stripped' };
      }
    } catch {
      // fall through
    }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(trimmed.slice(start, end + 1));
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return { parsed: obj as Record<string, unknown>, notes: 'json brace-balance fallback' };
      }
    } catch {
      // give up
    }
  }
  return { parsed: {}, notes: 'json parse failed; returned empty object' };
}
