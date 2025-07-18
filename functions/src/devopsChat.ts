import * as functions from 'firebase-functions';
// @ts-ignore
import fetch, { RequestInit } from 'node-fetch';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

export const devopsChat = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  const { message, context } = req.body;
  const systemPrompt = `You are the DevOps assistant for the HRX project. You have access to the following context:\n- Recent logs: ${context?.logs}\n- Current error: ${context?.error}\n- Current file: ${context?.filename}\n- Project structure: ${context?.filetree}\nAnswer as a helpful, expert AI DevOps assistant. Suggest fixes, explain issues, and propose code changes as needed.`;

  const payload = {
    model: 'gpt-4',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message }
    ],
    max_tokens: 512,
    temperature: 0.2
  };

  try {
    const openaiRes = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(payload)
    });
    const data = await openaiRes.json();
    const choices = (data as any).choices;
    const reply = choices?.[0]?.message?.content || 'No response from AI.';
    // Log request/response
    console.log('[DevOpsChat] User:', message);
    console.log('[DevOpsChat] Context:', context);
    console.log('[DevOpsChat] AI:', reply);
    res.json({ reply });
  } catch (err) {
    console.error('[DevOpsChat] Error:', err);
    res.status(500).json({ reply: 'Error contacting OpenAI.' });
  }
}); 