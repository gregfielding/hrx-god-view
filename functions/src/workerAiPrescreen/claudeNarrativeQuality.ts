/**
 * LLM narrative-quality evaluation (2026-08-29, interview review F4).
 *
 * Replaces the English-only regex heuristics in
 * `prescreenTextAnswerQuality.ts` as the PRIMARY judge of narrative answer
 * quality — the regex layer systematically scored Spanish answers as
 * "vague" (its concrete-detail keywords, filler lists, and admission
 * phrases are all English) inside a pipeline that gates automated hiring.
 * A rubric-scored Claude call is language-agnostic by nature.
 *
 * Contract: returns the exact `PrescreenAnswerQualityResult` shape the
 * rules evaluator produces, so everything downstream (flags, category
 * scores, score adjustment) is untouched. Returns `null` on ANY failure —
 * timeout, refusal, malformed JSON, kill switch — and the caller falls
 * back to the regex evaluator. The prescreen stays deterministic-first;
 * this is one bounded judgment call, not a rewrite.
 *
 * Latency: worker-facing (they wait on submit) — claude-sonnet-5 with a
 * tight rubric and a hard 8s race; observed well under that. Kill switch:
 * env `PRESCREEN_LLM_QUALITY=off`.
 */
import Anthropic from '@anthropic-ai/sdk';
import { logger } from 'firebase-functions/v2';
import type {
  PrescreenAnswersForQuality,
  PrescreenAnswerQualityResult,
  AnswerQualityTier,
} from './prescreenTextAnswerQuality';

const MODEL = process.env.PRESCREEN_LLM_QUALITY_MODEL || 'claude-sonnet-5';
const TIMEOUT_MS = 8000;

let cachedClient: Anthropic | null = null;
function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) cachedClient = new Anthropic({ apiKey, maxRetries: 0 });
  return cachedClient;
}

const RUBRIC = `You evaluate short free-text answers from hourly-work job applicants (warehouse, events, hospitality). Answers may be in ANY language — most are English or Spanish. Judge substance identically regardless of language; NEVER penalize an answer for not being in English.

Rate each provided answer field on substance:
- "high": specific and concrete — names real workplaces/roles/durations/tasks, or gives a real situation with what the person actually did.
- "medium": responsive and plausible but generic — real content, little specificity.
- "low": empty of substance — a few words, evasive, off-topic, or filler.

Also decide:
- lowEffort: true when TWO OR MORE answered narrative fields are low-substance.
- vague: true when THREE OR MORE answered fields are generic/thin (medium or below with no specifics).
Unanswered/absent fields count toward neither.

Respond with ONLY this JSON, no prose:
{"motivation":"low|medium|high","experience":"low|medium|high","communication":"low|medium|high","lowEffort":boolean,"vague":boolean}
- "experience" rates experience_details.
- "motivation" rates motivation.
- "communication" rates pressure_situation and supervisor_feedback together.
- For any field with no answer text, rate it "low" but remember it does not count toward lowEffort/vague.`;

function coerceTier(v: unknown): AnswerQualityTier {
  return v === 'high' || v === 'medium' || v === 'low' ? v : 'low';
}

export async function evaluatePrescreenAnswerQualityLlm(
  answers: PrescreenAnswersForQuality,
): Promise<PrescreenAnswerQualityResult | null> {
  if (process.env.PRESCREEN_LLM_QUALITY === 'off') return null;
  const client = getClient();
  if (!client) return null;

  const fields = {
    motivation: String(answers.motivation ?? '').slice(0, 1500),
    experience_details: String(answers.experience_details ?? '').slice(0, 1500),
    pressure_situation: String(answers.pressure_situation ?? '').slice(0, 1500),
    supervisor_feedback: String(answers.supervisor_feedback ?? '').slice(0, 1500),
  };
  const anyText = Object.values(fields).some((v) => v.trim().length > 0);
  if (!anyText) return null; // nothing to judge — regex path handles empties fine

  try {
    const call = client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: RUBRIC,
      messages: [{ role: 'user', content: JSON.stringify(fields) }],
    });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('llm_quality_timeout')), TIMEOUT_MS),
    );
    const res = (await Promise.race([call, timeout])) as Anthropic.Message;
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    const parsed = JSON.parse(text) as Record<string, unknown>;

    const flags: string[] = [];
    if (parsed.lowEffort === true) flags.push('low_effort_response');
    if (parsed.vague === true) flags.push('vague_response');

    const experienceTier = coerceTier(parsed.experience);
    const communicationTier = coerceTier(parsed.communication);
    // Positive adjustments mirror the rules evaluator's only live deltas
    // (+5 strong experience, +4 strong communication); negatives arrive via
    // the flags, exactly as in the rules path.
    const scoreAdjustment = (experienceTier === 'high' ? 5 : 0) + (communicationTier === 'high' ? 4 : 0);

    return {
      answerQuality: {
        motivation: coerceTier(parsed.motivation),
        experience: experienceTier,
        communication: communicationTier,
      },
      flags,
      scoreAdjustment,
    };
  } catch (e: unknown) {
    logger.warn('[prescreen.llmQuality] falling back to rules evaluator', {
      message: (e instanceof Error ? e.message : String(e)).slice(0, 160),
    });
    return null;
  }
}
