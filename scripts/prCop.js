// Lightweight PR Cop: summarizes diff and emits guidance; non-blocking without OPENAI key.
const { execSync } = require('child_process');

function getDiff() {
  try { return execSync('git diff --name-status origin/main...HEAD', { encoding: 'utf8' }); } catch { return ''; }
}

async function run() {
  const diff = getDiff();
  console.log('PR-COP DIFF:\n' + diff);
  const key = process.env.OPENAI_API_KEY;
  if (!key) { console.log('No OPENAI_API_KEY; skipping GPT analysis.'); return; }
  const body = {
    model: 'gpt-5',
    stream: false,
    messages: [
      { role: 'system', content: 'You are a cautious senior reviewer. Call out risky diffs, missing tests, bundle risks, Firestore index needs. Keep it under 300 words.' },
      { role: 'user', content: `Diff (git name-status):\n${diff}\nProject standards: TS strict, ESLint plugins, prefer tool-calls for AI, JSON-schema on extractors.` }
    ]
  };
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!r.ok) { console.log('OpenAI request failed:', r.status); return; }
  const data = await r.json();
  console.log('\nPR-COP SUMMARY:\n' + (data?.choices?.[0]?.message?.content || ''));
}

run().catch(e => { console.error('prCop error', e); process.exit(0); });


