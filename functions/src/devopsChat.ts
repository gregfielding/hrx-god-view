import * as functions from 'firebase-functions';
import { createChatCompletion } from './utils/claudeChat';

export const devopsChat = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  const { message, context } = req.body;
  const systemPrompt = `You are the DevOps assistant for the HRX project. You have access to the following context:\n- Recent logs: ${context?.logs}\n- Current error: ${context?.error}\n- Current file: ${context?.filename}\n- Project structure: ${context?.filetree}\nAnswer as a helpful, expert AI DevOps assistant. Suggest fixes, explain issues, and propose code changes as needed.`;

  const payload = {
    model: 'gpt-5',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message }
    ],
          max_completion_tokens: 512,
    temperature: 0.2
  };

  try {
    // Claude-backed since 2026-08-21 (utils/claudeChat).
    const data = await createChatCompletion(payload as any);
    const choices = (data as any).choices;
    const reply = choices?.[0]?.message?.content || 'No response from AI.';
    // Log request/response
    console.log('[DevOpsChat] User:', message);
    console.log('[DevOpsChat] Context:', context);
    console.log('[DevOpsChat] AI:', reply);
    res.json({ reply });
  } catch (err) {
    console.error('[DevOpsChat] Error:', err);
    res.status(500).json({ reply: 'Error contacting the AI provider.' });
  }
}); 