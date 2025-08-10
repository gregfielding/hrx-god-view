import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { embedText } from './codeAware';
import { logAIAction } from './utils/aiLogging';
import { withIdempotency } from './middleware/aiGuard';
import { updateLocationAssociation as _ignore } from './updateLocationAssociation';
import { performUpdate as performLocationUpdate } from './updateLocationAssociation';

if (!admin.apps.length) {
  admin.initializeApp();
}

const MODEL = 'gpt-5';

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0; let na = 0; let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { const x = a[i]; const y = b[i]; dot += x*y; na += x*x; nb += y*y; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function retrieveCodeContextForIntent(userText: string): Promise<string> {
  const text = (userText || '').toLowerCase();
  let query = '';
  if ((text.includes('create') || text.includes('add') || text.includes('new')) && text.includes('task')) {
    query = 'create task payload fields classification appointment todo startTime duration tasks collection taskService cloud function';
  } else if ((text.includes('update') || text.includes('set') || text.includes('change') || text.includes('associate')) && text.includes('location')) {
    query = 'update location association firestore path updateLocationAssociation function crm_companies {companyId}/locations subcollection deal contact';
  } else {
    return '';
  }
  const qVec = await embedText(query);
  const db = admin.firestore();
  const snap = await db.collection('code_index').doc('global').collection('chunks').orderBy('createdAt', 'desc').limit(800).get();
  const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const scored = items.map(it => ({ ...it, score: cosineSimilarity(qVec, it.embedding || []) }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(6, scored.length));
  if (top.length === 0) return '';
  const blocks = top.map(t => {
    const body: string = (t.text || '').slice(0, 1200);
    return `// File: ${t.path}\n${body}`;
  });
  return blocks.join('\n\n---\n\n');
}

export const chatWithGPT = onRequest({ region: 'us-central1', concurrency: 80, timeoutSeconds: 60, memory: '512MiB', minInstances: 1 }, async (req, res): Promise<void> => {
  const startedAt = Date.now();
  try {
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.status(204).send('');
      return;
    }

    const { tenantId, userId, threadId, messages, toolMode } = req.body || {};
    if (!tenantId || !userId || !threadId || !Array.isArray(messages)) {
      res.set('Access-Control-Allow-Origin', '*');
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Build compact context (placeholder V1)
    const context = await buildCompactContext(tenantId, userId, messages);
    const lastUserMsg = messages?.slice().reverse().find((m: any) => m.role === 'user');
    const codeContext = lastUserMsg ? await retrieveCodeContextForIntent(lastUserMsg.content || '') : '';

    const systemPrompt = `You are an AI assistant embedded in a React + Firebase CRM.\n- Only answer within the user's tenant scope.\n- Use the provided context when relevant.\n- Prefer concise, actionable output.\n${toolMode ? '- When the user intent is to create tasks or update location associations, respond via function/tool calls (createTask, updateLocationAssociation) instead of plain text. If information is missing, ask one concise follow-up question or make a best-effort using defaults.' : ''}`;

    const tools = [
      {
        type: 'function',
        function: {
          name: 'createTask',
          description: 'Create a CRM task within the given tenant and user scope. Supports todo or appointment.',
          parameters: {
            type: 'object',
            properties: {
              tenantId: { type: 'string' },
              createdBy: { type: 'string' },
              assignedTo: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              type: { type: 'string' },
              priority: { type: 'string', enum: ['urgent','high','medium','low'] },
              status: { type: 'string', enum: ['upcoming','due','in_progress','completed','postponed','cancelled','draft'] },
              classification: { type: 'string', enum: ['todo','appointment'] },
              scheduledDate: { type: 'string', description: 'ISO date string (YYYY-MM-DD or ISO8601)' },
              startTime: { type: ['string','null'] },
              duration: { type: ['number','null'] },
              dueDate: { type: ['string','null'] },
              associations: {
                type: 'object',
                properties: {
                  deals: { type: 'array', items: { type: 'string' } },
                  companies: { type: 'array', items: { type: 'string' } },
                  contacts: { type: 'array', items: { type: 'string' } },
                  salespeople: { type: 'array', items: { type: 'string' } }
                },
                additionalProperties: true
              },
              aiSuggested: { type: 'boolean' },
              aiPrompt: { type: 'string' }
            },
            required: ['tenantId','createdBy','assignedTo','title','type','priority','status','scheduledDate']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'draftEmail',
          description: 'Draft an email to a contact, optionally with deal context and recent email history.',
          parameters: {
            type: 'object',
            properties: {
              tenantId: { type: 'string' },
              userId: { type: 'string' },
              contactId: { type: 'string', description: 'Preferred identifier for recipient contact' },
              contactEmail: { type: 'string', description: 'If contactId is unknown' },
              dealId: { type: 'string' },
              subjectHint: { type: 'string' },
              tone: { type: 'string', enum: ['professional','friendly','urgent','casual'] },
              includeRecentContext: { type: 'boolean' }
            },
            required: ['tenantId','userId']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'summarizeEmailThread',
          description: 'Summarize a recent Gmail thread or conversation for a deal/contact within the tenant.',
          parameters: {
            type: 'object',
            properties: {
              tenantId: { type: 'string' },
              userId: { type: 'string' },
              threadId: { type: 'string' },
              dealId: { type: 'string' },
              contactId: { type: 'string' },
              maxItems: { type: 'number', minimum: 1, maximum: 50 }
            },
            required: ['tenantId','userId']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'updateLocationAssociation',
          description: 'Associate or clear a location for an entity (deal/contact/salesperson).',
          parameters: {
            type: 'object',
            properties: {
              tenantId: { type: 'string' },
              entityType: { type: 'string', enum: ['deal','contact','salesperson'] },
              entityId: { type: 'string' },
              companyId: { type: 'string' },
              locationId: { type: ['string','null'] },
              locationName: { type: ['string','null'] }
            },
            required: ['tenantId','entityType','entityId','companyId']
          }
        }
      }
    ];

    const wantSSE = (req.query?.sse === '1') || (req.body?.sse === true);

    const payload = {
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'system', content: `Context:\n${context}` },
        ...(codeContext ? [{ role: 'system' as const, content: `Codebase Context (read-only):\n${codeContext}` }] : []),
        ...messages
      ],
      stream: wantSSE ? true : false,
      tools,
      tool_choice: wantSSE ? 'none' : (toolMode ? 'auto' : 'auto')
    } as any;

    // Use OpenAI-compatible endpoint if key present
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // For local testing, fallback simple echo
      const reply = messages?.slice().reverse().find((m: any) => m.role === 'user')?.content || 'Hello!';
      await persistAssistantMessage(tenantId, threadId, userId, reply);
      res.set('Access-Control-Allow-Origin', '*');
      res.status(200).json({ reply });
      return;
    }

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Provider error ${r.status}: ${text}`);
    }

    // SSE streaming path
    if (wantSSE) {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Content-Type', 'text/event-stream');
      res.set('Cache-Control', 'no-cache');
      res.set('Connection', 'keep-alive');
      // @ts-ignore - Express typings
      res.flushHeaders?.();

      const reader = r.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      if (!reader) {
        res.write(`event: error\n`);
        res.write(`data: Failed to read provider stream\n\n`);
        res.end();
        return;
      }
      try {
        let buffered = '';
        // Notify client stream opened
        res.write(`event: open\n`);
        res.write(`data: ok\n\n`);
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          buffered += chunk;
          // Forward raw provider SSE for immediate UX
          res.write(chunk);
          // Accumulate assistant text by parsing data lines
          const parts = buffered.split('\n\n');
          buffered = parts.pop() || '';
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data:')) continue;
            const dataStr = line.replace(/^data:\s?/, '').trim();
            if (dataStr === '[DONE]') continue;
            try {
              const obj = JSON.parse(dataStr);
              const delta = obj?.choices?.[0]?.delta?.content;
              if (typeof delta === 'string') fullText += delta;
            } catch {}
          }
        }
      } catch (streamErr) {
        res.write(`event: error\n`);
        res.write(`data: ${String(streamErr)}\n\n`);
      } finally {
        res.write(`event: done\n`);
        res.write(`data: end\n\n`);
        res.end();
      }
      try {
        if (fullText) await persistAssistantMessage(tenantId, threadId, userId, fullText);
      } catch {}
      return;
    }

    const data = await r.json();
    const choice = data?.choices?.[0];
    const toolCalls = choice?.message?.tool_calls || [];

    let primaryReply = choice?.message?.content ?? '';
    const executed: any[] = [];

    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      for (const call of toolCalls.slice(0, 3)) {
        const name = call.function?.name;
        let args: any = {};
        try { args = JSON.parse(call.function?.arguments || '{}'); } catch {}
        if (name === 'createTask') {
          const result = await withIdempotency('createTask.v1', { tenantId, userId, args }, 60, () => executeCreateTask(args, { tenantId, userId }));
          executed.push({ tool: name, result });
        } else if (name === 'draftEmail') {
          const result = await executeDraftEmail(args, { tenantId, userId });
          executed.push({ tool: name, result });
        } else if (name === 'summarizeEmailThread') {
          const result = await executeSummarizeEmailThread(args, { tenantId, userId });
          executed.push({ tool: name, result });
        } else if (name === 'updateLocationAssociation') {
          const result = await withIdempotency('updateLocationAssociation.v1', { tenantId, userId, args }, 60, () => executeUpdateLocationAssociation(args, { tenantId, userId }));
          executed.push({ tool: name, result });
        }
      }
      if (!primaryReply) {
        primaryReply = executed.length ? 'Action completed.' : '';
      }
    }

    const reply = primaryReply || (executed.length ? 'Action executed.' : 'No response');
    await persistAssistantMessage(tenantId, threadId, userId, reply);
    res.set('Access-Control-Allow-Origin', '*');
    res.status(200).json({ reply, tools: executed, actions: executed });
    console.log('chatWithGPT completed', { latencyMs: Date.now() - startedAt, model: MODEL });
    return;
  } catch (err: any) {
    console.error('chatWithGPT error:', err);
    res.set('Access-Control-Allow-Origin', '*');
    res.status(500).json({ error: err?.message || 'Internal error' });
    return;
  }
});

async function buildCompactContext(tenantId: string, userId: string, _messages: any[]): Promise<string> {
  const db = admin.firestore();
  const take = 8;
  try {
    const [dealsSnap, contactsSnap, tasksSnap, emailsSnap] = await Promise.all([
      // Deals: prefer assignedTo filter, fallback to recent
      (async () => {
        try {
          const q = db.collection('tenants').doc(tenantId).collection('crm_deals')
            .where('assignedTo', '==', userId)
            .orderBy('updatedAt', 'desc')
            .limit(take);
          return await q.get();
        } catch {
          return await db.collection('tenants').doc(tenantId).collection('crm_deals')
            .orderBy('updatedAt', 'desc').limit(take).get();
        }
      })(),
      // Contacts: prefer assignedTo, fallback to recent
      (async () => {
        try {
          const q = db.collection('tenants').doc(tenantId).collection('crm_contacts')
            .where('assignedTo', '==', userId)
            .orderBy('updatedAt', 'desc')
            .limit(take);
          return await q.get();
        } catch {
          return await db.collection('tenants').doc(tenantId).collection('crm_contacts')
            .orderBy('updatedAt', 'desc').limit(take).get();
        }
      })(),
      // Tasks: assigned to user, most recent first
      (async () => {
        try {
          const q = db.collection('tenants').doc(tenantId).collection('tasks')
            .where('assignedTo', '==', userId)
            .orderBy('updatedAt', 'desc')
            .limit(take);
          return await q.get();
        } catch {
          return await db.collection('tenants').doc(tenantId).collection('tasks')
            .orderBy('updatedAt', 'desc').limit(take).get();
        }
      })(),
      // Email logs: tied to user sync; if none, just latest tenant emails
      (async () => {
        try {
          const q = db.collection('tenants').doc(tenantId).collection('email_logs')
            .where('userId', '==', userId)
            .orderBy('timestamp', 'desc')
            .limit(take);
          const snap = await q.get();
          if (!snap.empty) return snap;
        } catch {}
        return await db.collection('tenants').doc(tenantId).collection('email_logs')
          .orderBy('timestamp', 'desc').limit(take).get();
      })()
    ]);

    const deals = dealsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    const contacts = contactsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    const tasks = tasksSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    const emails = emailsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

    function safeStr(v: any, max = 120) {
      const s = (v ?? '').toString();
      return s.length > max ? s.slice(0, max - 1) + '…' : s;
    }

    const dealLines = deals.map((x: any) => `- ${safeStr(x.name || x.title)} [${x.stage || 'stage?'}] id:${x.id}`);
    const contactLines = contacts.map((x: any) => `- ${safeStr(x.fullName || x.firstName || x.lastName || 'Unnamed')} (${safeStr(x.title || x.jobTitle || '')}) id:${x.id}`);
    const taskLines = tasks.map((x: any) => `- ${safeStr(x.title)} [${x.status || 'pending'} ${x.classification || 'todo'}] date:${x.scheduledDate || x.dueDate || ''} id:${x.id}`);
    const emailLines = emails.map((x: any) => `- ${safeStr(x.subject)} [${x.direction || ''}] ${x.timestamp?.toDate?.() ? x.timestamp.toDate().toISOString() : x.timestamp || ''} deal:${x.dealId || ''} contact:${x.contactId || ''}`);

    const sections = [] as string[];
    if (dealLines.length) sections.push(`Deals (recent):\n${dealLines.join('\n')}`);
    if (contactLines.length) sections.push(`Contacts (recent):\n${contactLines.join('\n')}`);
    if (taskLines.length) sections.push(`Tasks (assigned):\n${taskLines.join('\n')}`);
    if (emailLines.length) sections.push(`Email Logs (recent):\n${emailLines.join('\n')}`);

    return sections.join('\n\n');
  } catch (e) {
    console.warn('Context retrieval failed:', e);
    return 'Context unavailable';
  }
}

async function persistAssistantMessage(tenantId: string, threadId: string, userId: string, content: string) {
  const db = admin.firestore();
  await db
    .collection('tenants').doc(tenantId)
    .collection('ai_chats').doc(threadId)
    .collection('messages').add({
      role: 'assistant',
      content,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      userId
    });
}

function assertTenantMatch(requestTenantId: string, sessionTenantId: string) {
  if (!requestTenantId || requestTenantId !== sessionTenantId) {
    throw new Error('Tenant mismatch or missing tenantId');
  }
}

async function executeCreateTask(raw: any, session: { tenantId: string; userId: string }) {
  assertTenantMatch(raw?.tenantId, session.tenantId);
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const title: string = (raw.title || '').toString().slice(0, 160);
  if (!title) throw new Error('title required');
  const taskData: any = {
    title,
    description: raw.description || '',
    type: raw.type || 'custom',
    priority: raw.priority || 'medium',
    status: raw.status || 'upcoming',
    classification: raw.classification || 'todo',
    scheduledDate: raw.scheduledDate,
    dueDate: raw.dueDate || null,
    startTime: raw.classification === 'appointment' ? raw.startTime || null : null,
    duration: raw.classification === 'appointment' ? (raw.duration ?? 30) : null,
    endTime: null,
    assignedTo: raw.assignedTo,
    assignedToName: 'Unknown User',
    associations: raw.associations || {},
    notes: '',
    category: raw.category || null,
    quotaCategory: raw.quotaCategory || null,
    estimatedDuration: raw.duration ?? 30,
    aiSuggested: !!raw.aiSuggested,
    aiPrompt: raw.aiPrompt || '',
    aiReason: raw.aiPrompt || '',
    aiConfidence: raw.aiSuggested ? 85 : null,
    aiContext: raw.aiSuggested ? 'AI generated task' : null,
    aiInsights: raw.aiSuggested ? ['AI suggested based on context'] : [],
    googleCalendarEventId: null,
    googleTaskId: null,
    lastGoogleSync: null,
    syncStatus: 'pending',
    tags: [],
    relatedToName: '',
    tenantId: session.tenantId,
    createdBy: raw.createdBy || session.userId,
    createdByName: 'Unknown User',
    createdAt: now,
    updatedAt: now
  };

  // Compute endTime if appointment
  if (taskData.classification === 'appointment' && taskData.startTime && taskData.duration) {
    try {
      const start = new Date(taskData.startTime).getTime();
      taskData.endTime = new Date(start + taskData.duration * 60000).toISOString();
    } catch {}
  }

  // Denormalize user names (best-effort)
  try {
    if (taskData.assignedTo) {
      const assignedSnap = await db.collection('users').doc(taskData.assignedTo).get();
      const u = assignedSnap.data() as any;
      taskData.assignedToName = u?.displayName || u?.fullName || `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || u?.email || 'Unknown User';
    }
  } catch {}
  try {
    const createdSnap = await db.collection('users').doc(taskData.createdBy).get();
    const u = createdSnap.data() as any;
    taskData.createdByName = u?.displayName || u?.fullName || `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || u?.email || 'Unknown User';
  } catch {}

  const ref = await db.collection('tenants').doc(session.tenantId).collection('tasks').add(taskData);

  // Log
  try {
    await logAIAction({
      eventType: 'ai_task.created',
      targetType: 'task',
      targetId: ref.id,
      reason: `AI tool createTask: ${taskData.title}`,
      contextType: 'task_creation',
      aiTags: ['ai_suggestions','task_creation', taskData.type],
      urgencyScore: 3,
      tenantId: session.tenantId,
      userId: session.userId,
      aiResponse: JSON.stringify({ title: taskData.title, classification: taskData.classification })
    });
  } catch {}

  return { taskId: ref.id, success: true };
}

async function executeUpdateLocationAssociation(raw: any, session: { tenantId: string; userId: string }) {
  assertTenantMatch(raw?.tenantId, session.tenantId);
  const payload = {
    tenantId: raw.tenantId,
    entityType: raw.entityType,
    entityId: raw.entityId,
    companyId: raw.companyId,
    locationId: raw.locationId ?? null,
    locationName: raw.locationName ?? null
  };
  const result = await performLocationUpdate(payload as any);
  try {
    await logAIAction({
      eventType: 'ai_location.association_updated',
      targetType: payload.entityType,
      targetId: payload.entityId,
      reason: 'AI tool updateLocationAssociation',
      contextType: 'locations',
      aiTags: ['association','location'],
      urgencyScore: 2,
      tenantId: session.tenantId,
      userId: session.userId,
      aiResponse: JSON.stringify(result)
    });
  } catch {}
  return result;
}

function htmlToText(html: string): string {
  try {
    return html.replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return html;
  }
}

async function getEmailsForContext(db: FirebaseFirestore.Firestore, tenantId: string, filter: { threadId?: string; dealId?: string; contactId?: string; userId?: string }, limit: number) {
  let q = db.collection('tenants').doc(tenantId).collection('email_logs') as FirebaseFirestore.Query;
  if (filter.threadId) q = q.where('threadId', '==', filter.threadId);
  if (filter.dealId) q = q.where('dealId', '==', filter.dealId);
  if (filter.contactId) q = q.where('contactId', '==', filter.contactId);
  q = q.orderBy('timestamp', 'desc').limit(limit);
  const snap = await q.get();
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
}

async function executeDraftEmail(raw: any, session: { tenantId: string; userId: string }) {
  assertTenantMatch(raw?.tenantId, session.tenantId);
  const db = admin.firestore();
  const tenantId = session.tenantId;
  const userId = raw.userId || session.userId;
  const tone = (raw.tone || 'professional') as string;
  const includeRecent = !!raw.includeRecentContext;

  let contact: any = null;
  if (raw.contactId) {
    const doc = await db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(raw.contactId).get();
    if (doc.exists) contact = { id: doc.id, ...(doc.data() as any) };
  }
  if (!contact && raw.contactEmail) {
    const snap = await db.collection('tenants').doc(tenantId).collection('crm_contacts').where('email', '==', raw.contactEmail).limit(1).get();
    if (!snap.empty) contact = { id: snap.docs[0].id, ...(snap.docs[0].data() as any) };
  }

  let deal: any = null;
  if (raw.dealId) {
    const doc = await db.collection('tenants').doc(tenantId).collection('crm_deals').doc(raw.dealId).get();
    if (doc.exists) deal = { id: doc.id, ...(doc.data() as any) };
  }
  let company: any = null;
  const companyId = contact?.companyId || deal?.companyId;
  if (companyId) {
    const c = await db.collection('tenants').doc(tenantId).collection('crm_companies').doc(companyId).get();
    if (c.exists) company = { id: c.id, ...(c.data() as any) };
  }

  let recentContext = '';
  if (includeRecent && (raw.dealId || raw.contactId)) {
    const emails = await getEmailsForContext(db, tenantId, { dealId: raw.dealId, contactId: raw.contactId, userId }, 5);
    if (emails.length) {
      const lines = emails.map((e: any) => `- ${e.direction || ''} ${e.subject || ''}: ${htmlToText(e.bodySnippet || e.bodyHtml || '').slice(0, 200)}`);
      recentContext = `Recent emails:\n${lines.join('\n')}`;
    }
  }

  const contactName = contact?.fullName || [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || 'there';
  const companyName = company?.companyName || company?.name || '';
  const topic = raw.subjectHint || (deal?.name ? `Follow up: ${deal.name}` : 'Following up');

  const greeting = tone === 'casual' ? `Hi ${contactName},` : `Hello ${contactName},`;
  const closing = tone === 'casual' ? 'Thanks' : 'Best regards';

  const body = [
    greeting,
    '',
    companyName ? `I’m following up regarding ${companyName}.` : `I’m following up on our recent conversation.`,
    deal?.name ? `Subject: ${deal.name}.` : '',
    'Let me know if you have any questions or would like to schedule time to discuss next steps.',
    '',
    `${closing},`,
    '',
    '[Your Name]'
  ].filter(Boolean).join('\n');

  const draft = {
    to: contact?.email || raw.contactEmail || '',
    subject: topic,
    body,
    tone,
    context: recentContext
  };

  try {
    await logAIAction({
      eventType: 'ai_email.draft_created',
      targetType: 'email_draft',
      targetId: contact?.id || raw.contactEmail || 'unknown_contact',
      reason: `Draft email generated`,
      contextType: 'email',
      aiTags: ['email','draft'],
      urgencyScore: 3,
      tenantId,
      userId,
      aiResponse: JSON.stringify(draft)
    });
  } catch {}

  return { success: true, draft };
}

async function executeSummarizeEmailThread(raw: any, session: { tenantId: string; userId: string }) {
  assertTenantMatch(raw?.tenantId, session.tenantId);
  const db = admin.firestore();
  const tenantId = session.tenantId;
  const userId = raw.userId || session.userId;
  const maxItems = Math.max(1, Math.min(20, Number(raw.maxItems) || 10));
  const emails = await getEmailsForContext(db, tenantId, { threadId: raw.threadId, dealId: raw.dealId, contactId: raw.contactId }, maxItems);
  if (!emails.length) return { success: true, summary: 'No emails found for the requested context.' };

  const chunks = emails.map((e: any) => {
    const text = htmlToText(e.bodyHtml || e.bodySnippet || '');
    return `From: ${e.from}\nTo: ${(e.to || []).join(', ')}\nSubject: ${e.subject}\nDate: ${e.timestamp?.toDate?.() ? e.timestamp.toDate().toISOString() : e.timestamp}\nDirection: ${e.direction}\nBody: ${text.slice(0, 800)}`;
  });

  const apiKey = process.env.OPENAI_API_KEY;
  let summary = '';
  if (apiKey) {
    const prompt = `Summarize the following email conversation succinctly with key decisions, open questions, next steps, and overall sentiment. Provide a bullet list of action items if present.\n\n${chunks.join('\n\n---\n\n')}`;
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: prompt }], stream: false })
    });
    if (r.ok) {
      const data = await r.json();
      summary = data?.choices?.[0]?.message?.content || '';
    }
  }
  if (!summary) {
    summary = `Conversation with ${emails.length} messages. Latest subject: ${emails[0]?.subject || ''}.`;
  }

  try {
    await logAIAction({
      eventType: 'ai_email.thread_summarized',
      targetType: 'email_thread',
      targetId: raw.threadId || raw.dealId || raw.contactId || 'unknown',
      reason: 'Email thread summarized',
      contextType: 'email',
      aiTags: ['email','summary'],
      urgencyScore: 2,
      tenantId,
      userId,
      aiResponse: summary
    });
  } catch {}

  return { success: true, summary };
}


