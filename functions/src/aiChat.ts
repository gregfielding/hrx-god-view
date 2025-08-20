import { onCall } from 'firebase-functions/v2/https';
import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

export const startAIThread = onCall({ cors: true }, async (request) => {
  const { tenantId, context } = request.data || {};
  const uid = request.auth?.uid || request.data?.userId;
  if (!uid || !tenantId) {
    throw new Error('Missing tenantId or user');
  }
  const db = admin.firestore();
  const threadRef = await db.collection('tenants').doc(tenantId).collection('ai_chats').add({
    createdBy: uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    title: 'New Conversation',
    context: typeof context === 'string' && context.trim() ? String(context).trim() : 'assistant'
  });
  return { threadId: threadRef.id };
});

// Minimal non-streaming placeholder that echoes back a canned response
export const chatWithAI = onRequest(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.status(204).send('');
      return;
    }
    const { tenantId, userId, threadId, messages } = req.body || {};
    if (!tenantId || !userId || !threadId) {
      res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
      res.status(400).json({ error: 'Missing tenantId, userId, or threadId' });
      return;
    }

    const lastUserMsg = (messages || []).slice().reverse().find((m: any) => m.role === 'user');

    // Basic intent handling for V1
    const text: string = (lastUserMsg?.content || '').toLowerCase();
    const db = admin.firestore();

    async function getTopDeals(): Promise<string> {
      const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
      // Grab more than needed, then filter client-side to avoid complex indexing requirements
      const snap = await dealsRef.orderBy('estimatedRevenue', 'desc').limit(25).get().catch(async () => {
        // Fallback to order by updatedAt if estimatedRevenue not indexed
        const s2 = await dealsRef.orderBy('updatedAt', 'desc').limit(50).get();
        return s2;
      });
      const all = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      const active = all.filter((d: any) => {
        const stage = (d.stage || '').toLowerCase();
        return stage !== 'closedlost' && stage !== 'closed_lost' && stage !== 'dormant';
      });
      // Sort by estimatedRevenue desc with fallbacks
      active.sort((a: any, b: any) => (Number(b.estimatedRevenue || b.value || 0) - Number(a.estimatedRevenue || a.value || 0)));
      const top = active.slice(0, 5);
      if (top.length === 0) return 'I did not find any active deals.';
      const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
      const lines = top.map((d: any, i: number) => `${i + 1}. ${d.name || 'Untitled Deal'} — ${fmt.format(Number(d.estimatedRevenue || d.value || 0))}${d.companyName ? ` (Company: ${d.companyName})` : ''}`);
      return `Top deals by estimated revenue:\n\n${lines.join('\n')}`;
    }

    let reply: string;
    if (text.includes('biggest') && text.includes('deal')) {
      reply = await getTopDeals();
    } else if ((text.includes('top') || text.includes('largest')) && text.includes('deal')) {
      reply = await getTopDeals();
    } else {
      reply = lastUserMsg?.content
        ? `I received: "${lastUserMsg.content}". Ask about deals, contacts, tasks, or emails.`
        : 'Hello! Ask me about your CRM data.';
    }

    // Persist assistant response for future extension
    // Store user message if included
    if (lastUserMsg?.content) {
      await db
        .collection('tenants').doc(tenantId)
        .collection('ai_chats').doc(threadId)
        .collection('messages').add({
          role: 'user',
          content: lastUserMsg.content,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          userId
        });
    }
    await db
      .collection('tenants').doc(tenantId)
      .collection('ai_chats').doc(threadId)
      .collection('messages').add({
        role: 'assistant',
        content: reply,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        userId
      });

    res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
    res.status(200).json({ reply });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('chatWithAI error:', err);
    res.set('Access-Control-Allow-Origin', 'https://hrxone.com');
    res.status(500).json({ error: err?.message || 'Internal error' });
  }
});

export const logAIUserMessage = onCall({ cors: true }, async (request) => {
  const { tenantId, threadId, content } = request.data || {};
  const uid = request.auth?.uid || request.data?.userId;
  if (!tenantId || !threadId || !uid || !content) {
    throw new Error('Missing tenantId, threadId, content or user');
  }
  const db = admin.firestore();
  await db
    .collection('tenants').doc(tenantId)
    .collection('ai_chats').doc(threadId)
    .collection('messages').add({
      role: 'user',
      content,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      userId: uid
    });
  return { success: true };
});


