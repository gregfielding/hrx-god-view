const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

export async function getTraitsAndTags(quote: string): Promise<{ traits: string[]; tags: string[] }> {
  if (!OPENAI_API_KEY) throw new Error('Missing OpenAI API key');

  const prompt = `Given the following motivational quote, suggest up to 3 behavioral traits (from this list: [persistence, optimism, confidence, patience, empathy, resilience, focus, discipline, creativity, adaptability, teamwork, leadership, self-compassion, gratitude, courage, integrity, humility, growth mindset, self-awareness, communication]) and up to 5 tags (freeform, e.g., 'leadership', 'resilience', 'teamwork') that best describe it.\n\nQuote: "${quote}"\n\nTraits (comma-separated):\nTags (comma-separated):`;

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as any;
  const content = data.choices[0].message.content as string;

  // Parse traits and tags from the response
  const traitsMatch = content.match(/Traits\s*[:\-]?\s*(.*)/i);
  const tagsMatch = content.match(/Tags\s*[:\-]?\s*(.*)/i);
  const traits = traitsMatch ? traitsMatch[1].split(',').map(t => t.trim()).filter(Boolean) : [];
  const tags = tagsMatch ? tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean) : [];

  return { traits, tags };
} 