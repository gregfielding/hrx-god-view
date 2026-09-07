/**
 * Natalie's brain for Slack: one Claude tool-use loop per inbound message,
 * with the thread's prior turns as context. Posting is done by the caller
 * (natalieSlackInbox) with her user token so replies appear as her.
 */
import Anthropic from '@anthropic-ai/sdk';
import { logger } from 'firebase-functions/v2';
import { NATALIE_TOOLS, runNatalieTool, type NatalieToolContext } from './natalieTools';

export const NATALIE_MODEL = process.env.NATALIE_MODEL || 'claude-opus-5';
const MAX_TOOL_ROUNDS = 8;

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (!cached) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY unset');
    cached = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  }
  return cached;
}

export const NATALIE_SYSTEM_PROMPT = `You are Natalie Brooks, recruiting assistant at C1 Staffing. You are a real member of the team on Slack: recruiters and Greg (the owner) DM you or @mention you to ask what is going on with a worker, whether the Fieldglass (Sodexo) or Indeed Flex portal syncs are current, what Flex requests came in, how an order is filling, or to have you take an action such as running a sync, accepting a Flex request, or texting a worker.

How you work:
- Use the tools to look things up before answering. Never guess at worker status, sync status, or order status; if a tool returns nothing, say so plainly.
- Take the action when it was clearly requested (sync, accept, text). If the request is ambiguous about WHICH worker or WHICH request, ask one short clarifying question instead of guessing.
- Accepting a Flex request commits C1 to filling it. Only do it when the person asked to accept that specific request.
- You cannot yet book workers into Flex or submit candidates to Fieldglass from Slack; say so and point to the HRX link if asked.
- Be honest about limits and errors. Do not invent phone numbers, names, or times.

Style (Slack):
- Short, warm, direct. Lead with the answer. A few lines, not an essay. Use Slack mrkdwn (*bold*, bullet lines with "•", links as <url|text>). No markdown headers, no tables.
- Refer to people by first name. Times in the site's local time when known. Include HRX links from the tools when they help.
- You are speaking as yourself; no sign-off is needed.`;

export interface NatalieTurn {
  role: 'user' | 'assistant';
  text: string;
  /** Slack user id or 'natalie'. */
  by: string;
  byName?: string;
  ts?: string;
}

export interface NatalieAnswer {
  text: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown>; ok: boolean }>;
  usage: { input: number; output: number };
}

function historyToMessages(history: NatalieTurn[]): Anthropic.Beta.BetaMessageParam[] {
  const msgs: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of history) {
    const text = t.role === 'user' ? `${t.byName || t.by}: ${t.text}` : t.text;
    if (!text.trim()) continue;
    msgs.push({ role: t.role, content: text });
  }
  return msgs;
}

export async function answerAsNatalie(args: {
  history: NatalieTurn[];
  message: NatalieTurn;
  ctx: NatalieToolContext;
}): Promise<NatalieAnswer> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...historyToMessages(args.history),
    { role: 'user', content: `${args.message.byName || args.message.by}: ${args.message.text}` },
  ];
  // The API needs the first message to be a user turn.
  while (messages.length && messages[0].role !== 'user') messages.shift();

  const toolCalls: NatalieAnswer['toolCalls'] = [];
  let input = 0, output = 0;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const res = await client().beta.messages.create({
      model: NATALIE_MODEL,
      max_tokens: 4096,
      system: [{ type: 'text', text: NATALIE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: NATALIE_TOOLS,
      tool_choice: round < MAX_TOOL_ROUNDS ? { type: 'auto' } : { type: 'none' },
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages,
    } as Anthropic.Beta.MessageCreateParamsNonStreaming & { fallbacks: string });
    input += res.usage.input_tokens;
    output += res.usage.output_tokens;

    if (res.stop_reason === 'refusal') {
      return { text: "I can't help with that one.", toolCalls, usage: { input, output } };
    }
    const toolUses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { text: text || 'Done.', toolCalls, usage: { input, output } };
    }
    messages.push({ role: 'assistant', content: res.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const toolInput = (tu.input ?? {}) as Record<string, unknown>;
      let ok = true;
      let payload: unknown;
      try {
        payload = await runNatalieTool(tu.name, toolInput, args.ctx);
      } catch (err) {
        ok = false;
        payload = { error: err instanceof Error ? err.message : String(err) };
        logger.warn('[natalie] tool failed', { tool: tu.name, err: String(err) });
      }
      toolCalls.push({ name: tu.name, input: toolInput, ok });
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(payload).slice(0, 60_000), is_error: !ok });
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: 'I got stuck looking that up. Can you try asking again?', toolCalls, usage: { input, output } };
}
