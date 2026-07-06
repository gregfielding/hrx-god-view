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
  uniform?: string;
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
  "uniform": "string",
  "category": "string", "laborType": "string", "jobCode": "string",
  "startDate": "MM/DD/YYYY", "endDate": "MM/DD/YYYY", "closeDate": "MM/DD/YYYY",
  "candidateInMind": boolean,
  "candidateInMindNote": "string (verbatim answer to the candidate-in-mind question)"
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
    max_completion_tokens: 1200,
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
    uniform: str(parsed.uniform),
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
