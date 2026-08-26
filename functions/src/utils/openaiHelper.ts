// Claude-backed since 2026-08-21 (was a raw OpenAI fetch) — utils/claudeChat.
import { createChatCompletion } from './claudeChat';

export async function getTraitsAndTags(quote: string): Promise<{ traits: string[]; tags: string[] }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Missing LLM API key');

  const prompt = `Given the following motivational quote, suggest up to 3 behavioral traits (from this list: [persistence, optimism, confidence, patience, empathy, resilience, focus, discipline, creativity, adaptability, teamwork, leadership, self-compassion, gratitude, courage, integrity, humility, growth mindset, self-awareness, communication]) and up to 5 tags (freeform, e.g., 'leadership', 'resilience', 'teamwork') that best describe it.\n\nQuote: "${quote}"\n\nTraits (comma-separated):\nTags (comma-separated):`;

  const data = await createChatCompletion({
    model: 'claude-opus-5',
    messages: [{ role: 'user', content: prompt }],
    max_completion_tokens: 100,
  });
  const content = (data.choices[0].message.content ?? '') as string;

  // Parse traits and tags from the response
  const traitsMatch = content.match(/Traits\s*[:\-]?\s*(.*)/i);
  const tagsMatch = content.match(/Tags\s*[:\-]?\s*(.*)/i);
  const traits = traitsMatch ? traitsMatch[1].split(',').map(t => t.trim()).filter(Boolean) : [];
  const tags = tagsMatch ? tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean) : [];

  return { traits, tags };
} 