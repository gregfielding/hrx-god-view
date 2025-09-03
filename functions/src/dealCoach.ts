import { onRequest, onCall } from 'firebase-functions/v2/https';
import fetch from 'node-fetch';
import * as admin from 'firebase-admin';
import { AnalyzeResponse, ChatResponse } from './schemas/dealCoach';
import { logAIAction } from './utils/aiLogging';

const OPENAI_KEY = process.env.OPENAI_API_KEY || (process.env.FUNCTIONS_EMULATOR ? 'test' : '');

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const dealCoachAnalyze = onRequest({ cors: true, region: 'us-central1' }, async (req, res) => {
  try {
    const { dealId, stageKey, tenantId } = req.body || {};
    if (!dealId || !stageKey || !tenantId) { res.status(400).json({ error: 'Missing dealId, stageKey or tenantId' }); return; }

    // Cache key
    const cacheId = `coach_analyze_${dealId}_${stageKey}`;
    const cacheRef = db.collection('ai_cache').doc(cacheId);
    const cached = await cacheRef.get();
    const now = Date.now();
    if (cached.exists) {
      const data = cached.data() as any;
      if (data.updatedAt && (now - data.updatedAt.toMillis()) < CACHE_TTL_MS) {
        try {
          const parsed = AnalyzeResponse.parse(data.payload);
          try { await logAIAction({ eventType: 'dealCoach.analyze.cache_hit', targetType: 'deal', targetId: dealId, reason: 'cache_hit', contextType: 'dealCoach', aiTags: ['dealCoach'], urgencyScore: 3, tenantId, aiResponse: JSON.stringify(parsed), cacheHit: true }); } catch {}
          res.json({ ...parsed, threadId: dealId, cacheHit: true });
          return;
        } catch {}
      }
    }

    // Ensure thread doc exists and update stageKey
    const threadRef = db.doc(`tenants/${tenantId}/ai_threads/${dealId}`);
    const threadSnap = await threadRef.get();
    if (!threadSnap.exists) {
      await threadRef.set({
        id: dealId,
        stageKey,
        model: 'gpt-5-mini',
        messages: [],
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      await threadRef.set({ stageKey, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }

    // Fetch minimal deal snapshot
    const dealSnap = await db.doc(`tenants/${tenantId}/crm_deals/${dealId}`).get();
    const deal = dealSnap.exists ? dealSnap.data() : {};
    const companyId = (deal as any)?.companyId;
    let company: any = null;
    if (companyId) {
      const companySnap = await db.doc(`tenants/${tenantId}/crm_companies/${companyId}`).get();
      company = companySnap.exists ? companySnap.data() : null;
    }

    // Build snapshot from compact context helper
    // Reuse compact context from GPT gateway to enrich analysis
    let compactContext = '';
    try {
      const mod = await import('./gptGateway');
      // @ts-ignore access internal helper
      if (typeof (mod as any).buildCompactContext === 'function') {
        compactContext = await (mod as any).buildCompactContext(tenantId, 'system', []);
      }
    } catch {}
    const snapshot = { deal: { id: dealId, stage: stageKey, name: (deal as any)?.name }, company, compactContext };
    const system = `You are the Deal Coach AI. Given a JSON deal snapshot (deal metadata, stage values, contacts, last activities, AI summary) return a concise summary for the current stage and up to 3 suggestions that push the deal forward. Output strictly valid JSON.`;

    // Call OpenAI with JSON schema
    let result: any;
    const apiKey = OPENAI_KEY;
    if (apiKey) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-5-mini',
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'AnalyzeResponse',
              schema: {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  suggestions: {
                    type: 'array',
                    maxItems: 3,
                    items: {
                      type: 'object',
                      properties: {
                        label: { type: 'string' },
                        action: {
                          oneOf: [
                            { type: 'object', properties: { type: { const: 'draftEmail' }, toContactId: { type: 'string' }, subjectHint: { type: 'string' }, goal: { type: 'string' } }, required: ['type','goal'] },
                            { type: 'object', properties: { type: { const: 'draftCall' }, scriptGoal: { type: 'string' }, objectionsFocus: { type: 'array', items: { type: 'string' } } }, required: ['type','scriptGoal'] },
                            { type: 'object', properties: { type: { const: 'createTask' }, title: { type: 'string' }, dueInDays: { type: 'integer' }, assigneeId: { type: 'string' } }, required: ['type','title','dueInDays'] },
                            { type: 'object', properties: { type: { const: 'askQuestion' }, target: { enum: ['buyer','ops','finance','legal','unknown'] }, question: { type: 'string' } }, required: ['type','question'] }
                          ]
                        }
                      },
                      required: ['label','action']
                    }
                  }
                },
                required: ['summary','suggestions'],
                additionalProperties: false
              }
            }
          },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: `Stage: ${stageKey}\nSnapshot: ${JSON.stringify(snapshot)}` }
          ],
          temperature: 0.3
        })
      });
      const data: any = await r.json();
      const raw = data?.choices?.[0]?.message?.content;
      try {
        result = JSON.parse(raw);
      } catch {
        result = { summary: 'No summary available.', suggestions: [] };
      }
    } else {
      result = { summary: `Summary for ${stageKey}.`, suggestions: [] };
    }

    // Validate via zod
    const parsed = AnalyzeResponse.parse(result);

    // Persist cache
    await cacheRef.set({ payload: parsed, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    // Log telemetry (best-effort)
    try { await logAIAction({ eventType: 'dealCoach.analyze', targetType: 'deal', targetId: dealId, reason: 'analyze', contextType: 'dealCoach', aiTags: ['dealCoach'], urgencyScore: 5, tenantId, aiResponse: JSON.stringify(parsed) }); } catch {}

    res.json({ ...parsed, threadId: dealId, cacheHit: false });
    return;
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Server error' });
  }
});

export const dealCoachChat = onRequest({ cors: true, region: 'us-central1' }, async (req, res) => {
  try {
    const { dealId, stageKey, tenantId, userId, message } = req.body || {};
    if (!dealId || !stageKey || !tenantId || !message) { res.status(400).json({ error: 'Missing fields' }); return; }
    const apiKey = OPENAI_KEY;
    let payload: any = { text: 'Okay — here are next steps.' };
    if (apiKey) {
      const system = 'You are the Deal Coach AI for live assistance. Answer concisely, propose a next best action, and—when asked—produce drafts tailored to the buyer persona. Only use facts from the provided snapshot and thread.';
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-5-mini',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: `Deal: ${dealId} | Stage: ${stageKey}\nInstruction: ${message}` }
          ],
          temperature: 0.3
        })
      });
      const data: any = await r.json();
      const raw = data?.choices?.[0]?.message?.content;
      try {
        const parsed = ChatResponse.parse(JSON.parse(raw));
        payload = parsed;
      } catch {
        payload = { text: typeof raw === 'string' ? raw : 'Acknowledged.' };
      }
    }

    // Append to thread and emit AI log event for downstream processors
    const threadRef = db.doc(`tenants/${tenantId}/ai_threads/${dealId}`);
    const threadSnap = await threadRef.get();
    const existing = threadSnap.exists ? (threadSnap.data() as any) : {};
    const existingMessages: any[] = Array.isArray(existing.messages) ? existing.messages : [];
    const appended = [
      ...existingMessages,
      { role: 'user', text: message, at: new Date(), userId: userId || null },
      { role: 'assistant', text: payload.text, actions: payload.actions || null, at: new Date() }
    ].slice(-200); // keep last 200

    await threadRef.set({
      id: dealId,
      stageKey,
      model: 'gpt-5-mini',
      messages: appended,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    // Also add an event snapshot (for history/analytics)
    await db.collection(`tenants/${tenantId}/ai_threads/${dealId}/events`).add({ type: 'chat', messages: appended, ts: admin.firestore.FieldValue.serverTimestamp() });

    try { await logAIAction({ eventType: 'dealCoach.chat', targetType: 'deal', targetId: dealId, reason: 'chat', contextType: 'dealCoach', aiTags: ['dealCoach'], urgencyScore: 5, tenantId, userId: userId || '', aiResponse: JSON.stringify(payload) }); } catch {}
    try { await logAIAction({ eventType: 'ai_log.enqueue', targetType: 'deal', targetId: dealId, reason: 'Deal Coach chat message logged', contextType: 'dealCoach', aiTags: ['dealCoach','chat'], urgencyScore: 5, tenantId, userId: userId || '' }); } catch {}
    res.json(payload);
    return;
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Server error' });
  }
});

// Archive current thread and start a new blank one
export const dealCoachStartNewCallable = onCall({ cors: true }, async (request) => {
  const { tenantId, dealId } = request.data || {};
  if (!tenantId || !dealId) throw new Error('Missing fields');
  const threadRef = db.doc(`tenants/${tenantId}/ai_threads/${dealId}`);
  const snap = await threadRef.get();
  const data = snap.exists ? (snap.data() as any) : {};
  const messages: any[] = Array.isArray(data.messages) ? data.messages : [];
  if (messages.length > 0) {
    await db.collection(`tenants/${tenantId}/ai_threads/${dealId}/events`).add({ type: 'archive', messages, ts: admin.firestore.FieldValue.serverTimestamp() });
  }
  await threadRef.set({ messages: [], updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  try { await logAIAction({ eventType: 'dealCoach.thread.reset', targetType: 'deal', targetId: dealId, reason: 'reset', contextType: 'dealCoach', aiTags: ['dealCoach'], urgencyScore: 4, tenantId, aiResponse: JSON.stringify({ archived: messages.length }) }); } catch {}
  return { ok: true };
});

// Load an archived conversation into the active thread
export const dealCoachLoadConversationCallable = onCall({ cors: true }, async (request) => {
  const { tenantId, dealId, eventId } = request.data || {};
  if (!tenantId || !dealId || !eventId) throw new Error('Missing fields');
  const evRef = db.doc(`tenants/${tenantId}/ai_threads/${dealId}/events/${eventId}`);
  const evSnap = await evRef.get();
  if (!evSnap.exists) throw new Error('Conversation not found');
  const messages = (evSnap.data() as any).messages || [];
  await db.doc(`tenants/${tenantId}/ai_threads/${dealId}`).set({ messages, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  try { await logAIAction({ eventType: 'dealCoach.thread.load', targetType: 'deal', targetId: dealId, reason: 'load', contextType: 'dealCoach', aiTags: ['dealCoach'], urgencyScore: 4, tenantId, aiResponse: JSON.stringify({ eventId }) }); } catch {}
  return { ok: true };
});

export const dealCoachAction = onRequest({ cors: true, region: 'us-central1' }, async (req, res) => {
  try {
    const { tenantId, dealId, action, userId } = req.body || {};
    if (!tenantId || !action) { res.status(400).json({ error: 'Missing fields' }); return; }
    let result: any = { ok: true };
    if (action?.type === 'createTask') {
      const task = {
        title: action.title,
        status: 'upcoming',
        priority: 'medium',
        classification: 'todo',
        scheduledDate: new Date().toISOString().slice(0,10),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        associations: dealId ? { deals: [dealId] } : {}
      };
      const ref = await db.collection('tenants').doc(tenantId).collection('crm_tasks').add(task);
      result.taskId = ref.id;
      try { await logAIAction({ eventType: 'dealCoach.action.createTask', targetType: 'deal', targetId: (dealId || ''), reason: 'action', contextType: 'dealCoach', aiTags: ['dealCoach'], urgencyScore: 5, tenantId, userId: userId || '', aiResponse: JSON.stringify({ taskId: ref.id }) }); } catch {}
    } else if (action?.type === 'draftEmail') {
      const draft = {
        dealId: dealId || null,
        toContactId: action.toContactId || null,
        subjectHint: action.subjectHint || null,
        goal: action.goal,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };
      const ref = await db.collection('tenants').doc(tenantId).collection('email_drafts').add(draft);
      result.draftId = ref.id;
      try { await logAIAction({ eventType: 'dealCoach.action.draftEmail', targetType: 'deal', targetId: (dealId || ''), reason: 'action', contextType: 'dealCoach', aiTags: ['dealCoach'], urgencyScore: 5, tenantId, userId: userId || '', aiResponse: JSON.stringify({ draftId: ref.id }) }); } catch {}
    } else if (action?.type === 'draftCall') {
      const script = {
        dealId: dealId || null,
        scriptGoal: action.scriptGoal,
        objectionsFocus: action.objectionsFocus || [],
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };
      const ref = await db.collection('tenants').doc(tenantId).collection('call_scripts').add(script);
      result.scriptId = ref.id;
      try { await logAIAction({ eventType: 'dealCoach.action.draftCall', targetType: 'deal', targetId: (dealId || ''), reason: 'action', contextType: 'dealCoach', aiTags: ['dealCoach'], urgencyScore: 5, tenantId, userId: userId || '', aiResponse: JSON.stringify({ scriptId: ref.id }) }); } catch {}
    } else if (action?.type === 'askQuestion') {
      const note = {
        dealId: dealId || null,
        type: 'coach_question',
        text: action.question,
        target: action.target || 'buyer',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };
      const ref = await db.collection('tenants').doc(tenantId).collection('activity_logs').add(note);
      result.noteId = ref.id;
      try { await logAIAction({ eventType: 'dealCoach.action.askQuestion', targetType: 'deal', targetId: (dealId || ''), reason: 'action', contextType: 'dealCoach', aiTags: ['dealCoach'], urgencyScore: 5, tenantId, userId: userId || '', aiResponse: JSON.stringify({ noteId: ref.id }) }); } catch {}
    }
    res.json(result);
    return;
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Server error' });
  }
});

// Callable equivalents for easy client access without hosting rewrites
export const dealCoachAnalyzeCallable = onCall({ 
  cors: true,
  maxInstances: 1, // Reduced from 2 to 1 for cost containment
  timeoutSeconds: 120,
  memory: '512MiB'
}, async (request) => {
  try {
    const { dealId, stageKey, tenantId, entityType, entityName, contactCompany, contactTitle, userId: callerUserId } = request.data || {};
    if (!dealId || !stageKey || !tenantId) throw new Error('Missing dealId, stageKey or tenantId');

    // Caller metadata for tracing frequent sources
    const callerMeta: any = {
      userId: (request as any)?.auth?.uid || callerUserId || '',
      userAgent: ((request as any)?.rawRequest?.headers?.['user-agent'] as string) || '',
      referer: ((request as any)?.rawRequest?.headers?.referer as string) || '',
      ip: ((request as any)?.rawRequest?.headers?.['x-forwarded-for'] as string) || ((request as any)?.rawRequest as any)?.ip || ''
    };

    // ENHANCED CACHING: Use a more sophisticated cache key that includes all parameters
    // Hash the parameters to create a shorter, more efficient cache key
    const paramString = `${dealId}_${stageKey}_${entityType || 'deal'}_${entityName || 'default'}_${contactCompany || 'default'}_${contactTitle || 'default'}`;
    const cacheKey = `coach_analyze_${Buffer.from(paramString).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 32)}`;
    const cacheRef = db.collection('ai_cache').doc(cacheKey);
    
    // Check cache first with MUCH longer TTL for analysis results
    const CACHE_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours (increased from 4 hours for better cost reduction)
    const cached = await cacheRef.get();
    const now = Date.now();
    
    if (cached.exists) {
      const data = cached.data() as any;
      if (data.updatedAt && (now - data.updatedAt.toMillis()) < CACHE_TTL_MS) {
        try {
          const parsed = AnalyzeResponse.parse(data.payload);
          console.log('✅ Deal Coach analysis served from cache for:', cacheKey);
          try { await logAIAction({ eventType: 'dealCoach.analyze.cache_hit', targetType: entityType || 'deal', targetId: dealId, reason: 'cache_hit', contextType: 'dealCoach', aiTags: ['dealCoach'], urgencyScore: 3, tenantId, aiResponse: JSON.stringify(parsed), cacheHit: true, metadata: { callerMeta } }); } catch {}
          return { ...parsed, threadId: dealId, cacheHit: true };
        } catch (parseError) {
          console.log('Cache data invalid, will regenerate:', parseError);
        }
      }
    }

    // OPTIMIZATION: Check if we have recent analysis for this entity (within last 4 hours)
    // This prevents rapid successive calls for the same entity
    const recentCacheKey = `coach_analyze_recent_${tenantId}_${dealId}_${stageKey}`;
    const recentCacheRef = db.collection('ai_cache').doc(recentCacheKey);
    const recentCached = await recentCacheRef.get();
    
    if (recentCached.exists) {
      const recentData = recentCached.data() as any;
      if (recentData.updatedAt && (now - recentData.updatedAt.toMillis()) < 4 * 60 * 60 * 1000) { // 4 hours (increased for better cost containment)
        console.log('⏱️ Recent analysis found, returning cached result to prevent rapid calls');
        try {
          const parsed = AnalyzeResponse.parse(recentData.payload);
          return { ...parsed, threadId: dealId, cacheHit: true, recent: true };
        } catch {}
      }
    }

    // STRICTER RATE LIMITING: Check if this deal has been analyzed too recently
    const rateLimitKey = `coach_analyze_ratelimit_${tenantId}_${dealId}`;
    const rateLimitRef = db.collection('ai_cache').doc(rateLimitKey);
    const rateLimitCached = await rateLimitRef.get();
    
    if (rateLimitCached.exists) {
      const rateLimitData = rateLimitCached.data() as any;
      if (rateLimitData.updatedAt && (now - rateLimitData.updatedAt.toMillis()) < 60 * 60 * 1000) { // 1 hour rate limit (increased from 30 minutes)
        console.log('🚫 Rate limit hit for deal:', dealId, 'returning cached result');
        try {
          const parsed = AnalyzeResponse.parse(rateLimitData.payload);
          return { ...parsed, threadId: dealId, cacheHit: true, rateLimited: true };
        } catch {}
      }
    }

    // SERVER-SIDE DEDUPE: Strict 10-minute dedupe window per tenant+deal+stage
    const duplicateKey = `coach_analyze_dedupe_${tenantId}_${dealId}_${stageKey}`;
    const duplicateRef = db.collection('ai_cache').doc(duplicateKey);
    const duplicateCached = await duplicateRef.get();
    
    if (duplicateCached.exists) {
      const duplicateData = duplicateCached.data() as any;
      if (duplicateData.updatedAt && (now - duplicateData.updatedAt.toMillis()) < 10 * 60 * 1000) { // 10 minutes dedupe window
        console.log('🔄 DEDUPED duplicate request within 10 min, returning cached result');
        try {
          const parsed = AnalyzeResponse.parse(duplicateData.payload);
          try { await logAIAction({ eventType: 'dealCoach.analyze.deduped', targetType: entityType || 'deal', targetId: dealId, reason: 'deduped_10m', contextType: 'dealCoach', aiTags: ['dealCoach','dedupe'], urgencyScore: 2, tenantId, aiResponse: JSON.stringify(parsed), metadata: { deduped: true, callerMeta } }); } catch {}
          return { ...parsed, threadId: dealId, cacheHit: true, deduped: true };
        } catch {}
      }
    }

    console.log('🔄 Generating new Deal Coach analysis for:', cacheKey);

    // Ensure thread doc exists and update stageKey
    const threadRef = db.doc(`tenants/${tenantId}/ai_threads/${dealId}`);
    const threadSnap = await threadRef.get();
    const existing = threadSnap.exists ? (threadSnap.data() as any) : {};
    const existingMessages: any[] = Array.isArray(existing.messages) ? existing.messages : [];
    await threadRef.set({
      id: dealId,
      stageKey,
      model: 'gpt-4o-mini',
      messages: existingMessages,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Fetch minimal deal snapshot
    const dealSnap = await db.doc(`tenants/${tenantId}/crm_deals/${dealId}`).get();
    const deal = dealSnap.exists ? dealSnap.data() : {};
    const companyId = (deal as any)?.companyId;
    let company: any = null;
    if (companyId) {
      const companySnap = await db.doc(`tenants/${tenantId}/crm_companies/${companyId}`).get();
      company = companySnap.exists ? companySnap.data() : null;
    }

    // Build snapshot from compact context helper
    // Reuse compact context from GPT gateway to enrich analysis
    let compactContext = '';
    try {
      const mod = await import('./gptGateway');
      // @ts-ignore access internal helper
      if (typeof (mod as any).buildCompactContext === 'function') {
        compactContext = await (mod as any).buildCompactContext(tenantId, 'system', []);
      }
    } catch {}
    const snapshot = { deal: { id: dealId, stage: stageKey, name: (deal as any)?.name }, company, compactContext };
    const system = `You are the Deal Coach AI. Given a JSON deal snapshot (deal metadata, stage values, contacts, last activities, AI summary) return a concise summary for the current stage and up to 3 suggestions that push the deal forward. Output strictly valid JSON.`;

    // Call OpenAI with JSON schema
    let result: any;
    const apiKey = OPENAI_KEY;
    if (apiKey) {
      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: `Stage: ${stageKey}\nSnapshot: ${JSON.stringify(snapshot)}` }
            ],
            temperature: 0.3
          })
        });
        const data: any = await r.json();
        const raw = data?.choices?.[0]?.message?.content;
        try {
          result = JSON.parse(raw);
        } catch {
          result = { summary: 'No summary available.', suggestions: [] };
        }
      } catch (e) {
        console.error('OpenAI API error:', e);
        result = { summary: 'Unable to generate analysis at this time.', suggestions: [] };
      }
    } else {
      result = { summary: `Summary for ${stageKey}.`, suggestions: [] };
    }

    // Validate via zod
    const parsed = AnalyzeResponse.parse(result);

    // ENHANCED CACHING: Store in all cache locations with longer TTL
    // Main cache (8 hours)
    await cacheRef.set({ payload: parsed, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    
    // Recent cache (4 hours) to prevent rapid successive calls
    await recentCacheRef.set({ payload: parsed, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    // Rate limit cache (1 hour) to enforce minimum time between calls
    await rateLimitRef.set({ payload: parsed, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    // Duplicate cache (5 minutes) to prevent rapid duplicate requests
    await duplicateRef.set({ payload: parsed, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    // Log telemetry (best-effort)
    try { await logAIAction({ eventType: 'dealCoach.analyze', targetType: entityType || 'deal', targetId: dealId, reason: 'analyze', contextType: 'dealCoach', aiTags: ['dealCoach'], urgencyScore: 5, tenantId, aiResponse: JSON.stringify(parsed), metadata: { callerMeta } }); } catch {}

    console.log('✅ Deal Coach analysis completed and cached for:', cacheKey);
    return { ...parsed, threadId: dealId, cacheHit: false };
  } catch (e: any) {
    console.error('❌ Deal Coach analysis error:', e);
    throw new Error(e?.message || 'Server error');
  }
});

export const dealCoachChatCallable = onCall({ cors: true }, async (request) => {
  try {
    const { dealId, stageKey, tenantId, userId, message, entityType, entityName, contactCompany, contactTitle } = request.data || {};
    if (!dealId || !stageKey || !tenantId || !message) throw new Error('Missing fields');
    const apiKey = process.env.OPENAI_API_KEY;
    let payload: any = { text: 'Okay — here are next steps.' };
    
    // 🎯 ENHANCED CONTEXT GATHERING
    let dealContext: any;
    let enhancedMessage: string | undefined;
    
    // Determine entity type
    const isContact = entityType === 'contact';
    const isCompany = entityType === 'company';
    
    if (isContact) {
      // Contact context gathering
      try {
        const contactRef = db.doc(`tenants/${tenantId}/crm_contacts/${dealId}`);
        const contactSnap = await contactRef.get();
        if (!contactSnap.exists) throw new Error('Contact not found');
        const contactData = contactSnap.exists ? contactSnap.data() : {};
        
        // Get company data if available
        let companyData = null;
        if (contactData.companyId) {
          const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${contactData.companyId}`);
          const companySnap = await companyRef.get();
          companyData = companySnap.exists ? companySnap.data() : null;
        }
        
        // Get associated deals
        let deals = [];
        try {
          const dealsQuery = db.collection(`tenants/${tenantId}/crm_deals`)
            .where('contactIds', 'array-contains', dealId)
            .limit(10);
          const dealsSnap = await dealsQuery.get();
          deals = dealsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
          console.warn('Could not fetch associated deals:', e);
        }
        
        // Get contact notes
        let notes = [];
        try {
          const notesQuery = db.collection(`tenants/${tenantId}/contact_notes`)
            .where('contactId', '==', dealId)
            .orderBy('createdAt', 'desc')
            .limit(20);
          const notesSnap = await notesQuery.get();
          notes = notesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
          console.warn('Could not fetch contact notes:', e);
        }
        
        // Get email activity
        let emails = [];
        try {
          const emailsQuery = db.collection(`tenants/${tenantId}/email_logs`)
            .where('contactId', '==', dealId)
            .orderBy('timestamp', 'desc')
            .limit(10);
          const emailsSnap = await emailsQuery.get();
          emails = emailsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
          console.warn('Could not fetch contact emails:', e);
        }
        
        // Build contact context
        dealContext = {
          contact: contactData,
          contactName: entityName || contactData.fullName || contactData.firstName || contactData.lastName,
          contactCompany: contactCompany || contactData.companyName,
          contactTitle: contactTitle || contactData.jobTitle || contactData.title,
          company: companyData,
          deals: deals,
          notes: notes,
          emails: emails,
          currentStage: stageKey,
          enhancedContext: {
            contact: contactData,
            company: companyData,
            deals: deals,
            notes: notes,
            emails: emails
          }
        };
        
        console.log(`✅ Contact context loaded successfully for contact: ${dealId}`);
        
      } catch (error) {
        console.error('❌ Contact context failed:', error);
        throw error;
      }
    } else if (isCompany) {
      // Company context gathering
      try {
        const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${dealId}`);
        const companySnap = await companyRef.get();
        if (!companySnap.exists) throw new Error('Company not found');
        const companyData = companySnap.exists ? companySnap.data() : {};
        
        // Get associated contacts
        let contacts = [];
        try {
          const contactsQuery = db.collection(`tenants/${tenantId}/crm_contacts`)
            .where('companyId', '==', dealId)
            .limit(20);
          const contactsSnap = await contactsQuery.get();
          contacts = contactsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
          console.warn('Could not fetch company contacts:', e);
        }
        
        // Get associated deals
        let deals = [];
        try {
          const dealsQuery = db.collection(`tenants/${tenantId}/crm_deals`)
            .where('companyId', '==', dealId)
            .limit(10);
          const dealsSnap = await dealsQuery.get();
          deals = dealsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
          console.warn('Could not fetch company deals:', e);
        }
        
        // Get company locations
        let locations = [];
        try {
          const locationsQuery = db.collection(`tenants/${tenantId}/crm_companies/${dealId}/locations`);
          const locationsSnap = await locationsQuery.get();
          locations = locationsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
          console.warn('Could not fetch company locations:', e);
        }
        
        // Get company notes
        let notes = [];
        try {
          const notesQuery = db.collection(`tenants/${tenantId}/company_notes`)
            .where('companyId', '==', dealId)
            .orderBy('createdAt', 'desc')
            .limit(20);
          const notesSnap = await notesQuery.get();
          notes = notesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
          console.warn('Could not fetch company notes:', e);
        }
        
        // Build company context
        dealContext = {
          company: companyData,
          companyName: entityName || companyData.companyName || companyData.name,
          contacts: contacts,
          deals: deals,
          locations: locations,
          notes: notes,
          currentStage: stageKey,
          enhancedContext: {
            company: companyData,
            contacts: contacts,
            deals: deals,
            locations: locations,
            notes: notes
          }
        };
        
        console.log(`✅ Company context loaded successfully for company: ${dealId}`);
        
      } catch (error) {
        console.error('❌ Company context failed:', error);
        throw error;
      }
    } else {
      // Deal context gathering (existing logic)
      try {
        // Import and use enhanced context system
        const { getEnhancedDealContext } = await import('./enhancedDealContext');
        const enhancedContext = await getEnhancedDealContext(dealId, tenantId, userId);
        
        // Convert enhanced context to legacy format for compatibility
        dealContext = {
          deal: enhancedContext.deal,
          company: enhancedContext.company?.company || null,
          contacts: enhancedContext.contacts.map(c => c.contact).filter(Boolean),
          salespeople: enhancedContext.salespeople.map(s => s.salesperson).filter(Boolean),
          notes: enhancedContext.notes,
          emails: enhancedContext.emails,
          activities: enhancedContext.activities,
          stageData: enhancedContext.deal?.stageData || {},
          currentStage: stageKey,
          stageForms: enhancedContext.deal?.stageData || {},
          learningInsights: enhancedContext.learningData || {
            successfulPatterns: [],
            stageSuccessRates: {},
            salespersonPerformance: {},
            commonObjections: [],
            effectiveQuestions: []
          },
          enhancedContext: enhancedContext
        };
        
        console.log(`✅ Enhanced deal context loaded successfully for deal: ${dealId}`);
        
      } catch (error) {
        console.error('❌ Enhanced context failed, falling back to basic context:', error);
        
        // Fallback to basic context gathering
        const dealRef = db.doc(`tenants/${tenantId}/crm_deals/${dealId}`);
        const dealSnap = await dealRef.get();
        const dealData = dealSnap.exists ? dealSnap.data() : {};
        
        // Get company data
        let companyData = null;
        if (dealData.companyId) {
          const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${dealData.companyId}`);
          const companySnap = await companyRef.get();
          companyData = companySnap.exists ? companySnap.data() : null;
        }
        
        // Get associated contacts
        let contacts = [];
        if (dealData.contactIds && Array.isArray(dealData.contactIds)) {
          const contactPromises = dealData.contactIds.map(async (contactId: string) => {
            const contactRef = db.doc(`tenants/${tenantId}/crm_contacts/${contactId}`);
            const contactSnap = await contactRef.get();
            return contactSnap.exists ? { id: contactId, ...contactSnap.data() } : null;
          });
          contacts = (await Promise.all(contactPromises)).filter(Boolean);
        }
        
        // Get associated salespeople
        let salespeople = [];
        if (dealData.salespeopleIds && Array.isArray(dealData.salespeopleIds)) {
          const salespersonPromises = dealData.salespeopleIds.map(async (salespersonId: string) => {
            const salespersonRef = db.doc(`tenants/${tenantId}/users/${salespersonId}`);
            const salespersonSnap = await salespersonRef.get();
            return salespersonSnap.exists ? { id: salespersonId, ...salespersonSnap.data() } : null;
          });
          salespeople = (await Promise.all(salespersonPromises)).filter(Boolean);
        }
        
        // Get deal notes
        let notes = [];
        try {
          const notesQuery = db.collection(`tenants/${tenantId}/crm_deals/${dealId}/notes`)
            .orderBy('createdAt', 'desc')
            .limit(20);
          const notesSnap = await notesQuery.get();
          notes = notesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
          console.warn('Could not fetch deal notes:', e);
        }
        
        // Get email activity
        let emails = [];
        try {
          const emailsQuery = db.collection(`tenants/${tenantId}/emails`)
            .where('dealId', '==', dealId)
            .orderBy('sentAt', 'desc')
            .limit(10);
        const emailsSnap = await emailsQuery.get();
        emails = emailsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } catch (e) {
        console.warn('Could not fetch email activity:', e);
      }
      
      // Get activity logs
      let activities = [];
      try {
        const activitiesQuery = db.collection(`tenants/${tenantId}/activities`)
          .where('dealId', '==', dealId)
          .orderBy('createdAt', 'desc')
          .limit(20);
        const activitiesSnap = await activitiesQuery.get();
        activities = activitiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } catch (e) {
        console.warn('Could not fetch activities:', e);
      }
      
      // Get historical success patterns and learning data
      let learningData = {
        successfulPatterns: [],
        failedPatterns: [],
        salespersonPerformance: {},
        stageSuccessRates: {},
        commonObjections: [],
        effectiveQuestions: []
      };
      
      try {
        const learningRef = db.doc(`tenants/${tenantId}/ai_learning`);
        const learningSnap = await learningRef.get();
        if (learningSnap.exists) {
          const data = learningSnap.data();
          if (data) {
            learningData = {
              successfulPatterns: data.successfulPatterns || [],
              failedPatterns: data.failedPatterns || [],
              salespersonPerformance: data.salespersonPerformance || {},
              stageSuccessRates: data.stageSuccessRates || {},
              commonObjections: data.commonObjections || [],
              effectiveQuestions: data.effectiveQuestions || []
            };
          }
        }
      } catch (e) {
        console.warn('Could not fetch learning data:', e);
      }
      
      // Build basic context
      dealContext = {
        deal: dealData,
        company: companyData,
        contacts,
        salespeople,
        notes,
        emails,
        activities,
        stageData: dealData.stageData || {},
        currentStage: stageKey,
        stageForms: dealData.stageData || {},
        learningInsights: {
          successfulPatterns: learningData.successfulPatterns || [],
          stageSuccessRates: learningData.stageSuccessRates || {},
          salespersonPerformance: learningData.salespersonPerformance || {},
          commonObjections: learningData.commonObjections || [],
          effectiveQuestions: learningData.effectiveQuestions || []
        }
      };
      }
    }
    
    // 🎯 ENHANCED SYSTEM PROMPT GENERATION
    let system: string;
    
    if (!apiKey) {
      // For local testing, fallback simple echo
      payload = { text: 'Hello! I\'m your Deal Coach. How can I help you today?' };
    } else {
      try {
        // Use enhanced prompt system if enhanced context is available
        if (dealContext.enhancedContext) {
          const { generateEnhancedSystemPrompt, enhanceUserPrompt } = await import('./enhancedDealCoachPrompts');
          system = generateEnhancedSystemPrompt(dealContext.enhancedContext);
          
          // Enhance the user's message with context
          enhancedMessage = enhanceUserPrompt(message, dealContext.enhancedContext);
          console.log(`✅ Enhanced prompt generated with rich context`);
          console.log(`📝 Enhanced user message with context`);
        } else {
          // Fallback to basic system prompt based on entity type
          if (isContact) {
            system = `You are the Sales Coach AI, a master relationship builder with 20+ years of experience in B2B sales and account management. You specialize in building and nurturing relationships with key contacts and decision makers.

SALES COACHING EXPERTISE:
- Relationship building and trust development
- Communication strategies and messaging
- Contact engagement and follow-up tactics
- Account expansion and cross-selling opportunities
- Executive relationship management
- Networking and referral strategies

FOCUS AREAS:
- Understanding contact's role and influence
- Building rapport and credibility
- Identifying pain points and opportunities
- Creating value through insights and solutions
- Maintaining consistent engagement
- Leveraging relationships for business growth`;
          } else if (isCompany) {
            system = `You are the Company Coach AI, a master business development strategist with 20+ years of experience in B2B sales and account management. You specialize in company-level relationship building, partnership development, and strategic account growth.

COMPANY COACHING EXPERTISE:
- Strategic account management and growth
- Business development and partnership strategies
- Company-wide relationship building
- Multi-location and division engagement
- Executive relationship development
- Account expansion and revenue growth

FOCUS AREAS:
- Understanding company structure and decision-making
- Building relationships across multiple stakeholders
- Identifying company-wide opportunities
- Strategic partnership development
- Account expansion and cross-selling
- Long-term relationship building and retention`;
          } else {
            system = `You are the Deal Coach AI, a master sales wizard with 20+ years of enterprise and SMB sales experience, trained in all major sales methodologies including SPIN Selling, Challenger Sale, Solution Selling, Sandler, and MEDDIC.

SALES EXPERTISE & METHODOLOGIES:

SPIN SELLING (Neil Rackham):
- Situation Questions: Understand current state and processes
- Problem Questions: Uncover pain points and challenges
- Implication Questions: Explore consequences of problems
- Need-Payoff Questions: Link solutions to business value

CHALLENGER SALE (Dixon & Adamson):
- Teach: Provide unique insights about customer's business
- Tailor: Customize message to customer's specific situation
- Take Control: Guide the sales process assertively

SOLUTION SELLING (Bosworth):
- Pain Chain: Identify root causes and business impact
- Vision: Create compelling future state
- Value Proposition: Quantify ROI and business benefits

MEDDIC (Dick Dunkel):
- Metrics: Quantify business impact and ROI
- Economic Buyer: Identify true decision maker
- Decision Criteria: Understand evaluation process
- Decision Process: Map approval workflow
- Identify Pain: Uncover critical business problems
- Champion: Find internal advocate

ENTERPRISE SALES BEST PRACTICES:
- Multi-threaded selling across decision makers
- Executive sponsorship and C-level relationships
- Complex procurement processes and vendor management
- ROI quantification and business case development
- Risk mitigation and compliance considerations
- Long sales cycles with multiple stakeholders

SMB SALES BEST PRACTICES:
- Owner-operated decision making
- Budget constraints and cash flow considerations
- Quick implementation and immediate value
- Personal relationships and trust building
- Competitive pricing and flexible terms
- Hands-on support and training needs

STAGE-SPECIFIC EXPERTISE:

DISCOVERY (Enterprise):
- Executive sponsor identification and relationship building
- Business problem validation and quantification
- Stakeholder mapping and influence analysis
- Competitive landscape and incumbent assessment
- Budget authority and approval process understanding

DISCOVERY (SMB):
- Owner pain points and business challenges
- Current solution limitations and frustrations
- Decision-making process and timeline
- Budget constraints and payment preferences
- Implementation timeline and resource availability

QUALIFICATION (Enterprise):
- Economic buyer identification and access
- Decision criteria and evaluation process
- Budget allocation and approval workflow
- Competitive positioning and differentiation
- Risk assessment and mitigation strategies

QUALIFICATION (SMB):
- Decision maker authority and influence
- Budget availability and payment terms
- Timeline constraints and urgency factors
- Competitive alternatives and pricing sensitivity
- Implementation readiness and resource availability

SCOPING (Enterprise):
- Detailed requirements gathering and prioritization
- Success criteria definition and measurement
- Implementation timeline and resource planning
- Integration requirements and technical specifications
- Risk assessment and mitigation planning

SCOPING (SMB):
- Core requirements identification and prioritization
- Success metrics and ROI definition
- Implementation timeline and resource allocation
- Technical requirements and integration needs
- Risk assessment and contingency planning

PROPOSAL (Enterprise):
- Executive summary and business case development
- Detailed technical specifications and architecture
- Implementation timeline and resource requirements
- Risk assessment and mitigation strategies
- Competitive positioning and differentiation

PROPOSAL (SMB):
- Clear value proposition and ROI demonstration
- Technical specifications and implementation plan
- Timeline and resource requirements
- Competitive advantages and differentiation
- Risk assessment and mitigation

NEGOTIATION (Enterprise):
- Executive-level relationship building and trust
- Complex contract terms and conditions
- Risk mitigation and compliance requirements
- Implementation planning and resource allocation
- Competitive positioning and differentiation

NEGOTIATION (SMB):
- Relationship building and trust development
- Contract terms and payment structure
- Implementation timeline and resource allocation
- Risk assessment and mitigation
- Competitive positioning and value demonstration

CLOSING (Enterprise):
- Executive sponsorship and approval process
- Contract finalization and legal review
- Implementation planning and resource allocation
- Risk mitigation and compliance requirements
- Success metrics and measurement planning

CLOSING (SMB):
- Decision maker approval and commitment
- Contract finalization and payment terms
- Implementation planning and resource allocation
- Success metrics and measurement planning
- Risk assessment and mitigation

DEAL CONTEXT:
- Deal Stage: ${stageKey}
- Deal Data: ${JSON.stringify(dealContext.deal)}
- Company: ${JSON.stringify(dealContext.company)}
- Contacts: ${JSON.stringify(dealContext.contacts)}
- Salespeople: ${JSON.stringify(dealContext.salespeople)}
- Recent Activity: ${JSON.stringify(dealContext.activities)}
- Learning Insights: ${JSON.stringify(dealContext.learningInsights)}

INSTRUCTIONS:
1. Analyze the current deal stage and provide specific, actionable advice
2. Consider the deal context, company information, and contact details
3. Reference recent activity and learning insights when relevant
4. Provide clear next steps and specific actions the salesperson can take
5. Consider the unique dynamics of this specific deal
6. Use appropriate sales methodology based on the situation
7. Be conversational, helpful, and specific
8. Focus on practical, implementable advice

RESPONSE FORMAT:
- Provide a brief analysis of the current situation
- Suggest specific next steps and actions
- Reference relevant context when making recommendations
- Be specific about which contacts to engage and how
- Consider the salesperson's strengths and the deal's unique dynamics`;
          }
        }
        
        // Make OpenAI API call
        const userMessage = enhancedMessage || message;
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                  body: JSON.stringify({
          model: 'gpt-5-mini',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.7,
          max_completion_tokens: 1000
        })
        });
        
        const data: any = await r.json();
        const response = data?.choices?.[0]?.message?.content;
        
        if (response) {
          payload = { text: response };
        } else {
          payload = { text: 'I apologize, but I encountered an issue processing your request. Please try again.' };
        }
        
      } catch (e: any) {
        console.error('OpenAI API error:', e);
        payload = { text: 'I apologize, but I encountered an issue processing your request. Please try again.' };
      }
    }
    
    // Log AI action
    try { 
      await logAIAction({ 
        eventType: 'dealCoach.chat', 
        targetType: 'deal', 
        targetId: dealId, 
        reason: 'chat', 
        contextType: 'dealCoach', 
        aiTags: ['dealCoach'], 
        urgencyScore: 5, 
        tenantId, 
        userId: userId || '', 
        aiResponse: payload.text 
      }); 
    } catch {}
    
    try { 
      await logAIAction({ 
        eventType: 'ai_log.enqueue', 
        targetType: 'deal', 
        targetId: dealId, 
        reason: 'Deal Coach chat message logged', 
        contextType: 'dealCoach', 
        aiTags: ['dealCoach','chat'], 
        urgencyScore: 3, 
        tenantId, 
        userId: userId || '', 
        aiResponse: payload.text 
      }); 
    } catch {}
    
    return payload;
  } catch (e: any) {
    throw new Error(e?.message || 'Server error');
  }
});

export const dealCoachActionCallable = onCall({ cors: true }, async (request) => {
  try {
    const { tenantId, dealId, action, userId } = request.data || {};
    if (!tenantId || !action) throw new Error('Missing fields');
    let result: any = { ok: true };
    if (action?.type === 'createTask') {
      const task = {
        title: action.title,
        status: 'upcoming',
        priority: 'medium',
        classification: 'todo',
        scheduledDate: new Date().toISOString().slice(0,10),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        associations: dealId ? { deals: [dealId] } : {}
      };
      const ref = await db.collection('tenants').doc(tenantId).collection('crm_tasks').add(task);
      result.taskId = ref.id;
      try { await logAIAction({ eventType: 'dealCoach.action.createTask', targetType: 'deal', targetId: (dealId || ''), reason: 'action', contextType: 'dealCoach', aiTags: ['dealCoach'], urgencyScore: 5, tenantId, userId: userId || '', aiResponse: JSON.stringify({ taskId: ref.id }) }); } catch {}
    } else if (action?.type === 'draftEmail') {
      const draft = {
        dealId: dealId || null,
        toContactId: action.toContactId || null,
        subjectHint: action.subjectHint || null,
        goal: action.goal,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };
      const ref = await db.collection('tenants').doc(tenantId).collection('email_drafts').add(draft);
      result.draftId = ref.id;
      try { await logAIAction({ eventType: 'dealCoach.action.draftEmail', targetType: 'deal', targetId: (dealId || ''), reason: 'action', contextType: 'dealCoach', aiTags: ['dealCoach'], urgencyScore: 5, tenantId, userId: userId || '', aiResponse: JSON.stringify({ dealId: ref.id }) }); } catch {}
    } else if (action?.type === 'draftCall') {
      const script = {
        dealId: dealId || null,
        scriptGoal: action.scriptGoal,
        objectionsFocus: action.objectionsFocus || [],
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };
      const ref = await db.collection('tenants').doc(tenantId).collection('call_scripts').add(script);
      result.scriptId = ref.id;
      try { await logAIAction({ eventType: 'dealCoach.action.draftCall', targetType: 'deal', targetId: (dealId || ''), reason: 'action', contextType: 'dealCoach', aiTags: ['dealCoach'], urgencyScore: 5, tenantId, userId: userId || '', aiResponse: JSON.stringify({ scriptId: ref.id }) }); } catch {}
    } else if (action?.type === 'askQuestion') {
      const note = {
        dealId: dealId || null,
        type: 'coach_question',
        text: action.question,
        target: action.target || 'buyer',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };
      const ref = await db.collection('tenants').doc(tenantId).collection('activity_logs').add(note);
      result.noteId = ref.id;
      try { await logAIAction({ eventType: 'dealCoach.action.askQuestion', targetType: 'deal', targetId: (dealId || ''), reason: 'action', contextType: 'dealCoach', aiTags: ['dealCoach'], urgencyScore: 5, tenantId, userId: userId || '', aiResponse: JSON.stringify({ noteId: ref.id }) }); } catch {}
    }
    return result;
  } catch (e: any) {
    throw new Error(e?.message || 'Server error');
  }
});

// Learning and feedback system
export const dealCoachFeedbackCallable = onCall({ cors: true }, async (request) => {
  try {
    const { tenantId, dealId, feedback, userId, stageKey, adviceGiven, outcome } = request.data || {};
    if (!tenantId || !feedback) throw new Error('Missing fields');
    
    // Record feedback for learning
    const feedbackData = {
      dealId,
      userId,
      stageKey,
      adviceGiven,
      outcome, // 'success', 'partial', 'failure'
      feedback,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await db.collection(`tenants/${tenantId}/ai_learning/feedback`).add(feedbackData);
    
    // Update learning patterns based on outcome
    const learningRef = db.doc(`tenants/${tenantId}/ai_learning`);
    const learningSnap = await learningRef.get();
    let learningData = learningSnap.exists ? learningSnap.data() : {
      successfulPatterns: [],
      failedPatterns: [],
      salespersonPerformance: {},
      stageSuccessRates: {},
      commonObjections: [],
      effectiveQuestions: []
    };
    
    // Update success rates for this stage
    if (stageKey && outcome) {
      if (!learningData.stageSuccessRates[stageKey]) {
        learningData.stageSuccessRates[stageKey] = { success: 0, total: 0 };
      }
      learningData.stageSuccessRates[stageKey].total++;
      if (outcome === 'success') {
        learningData.stageSuccessRates[stageKey].success++;
      }
    }
    
    // Update salesperson performance
    if (userId && outcome) {
      if (!learningData.salespersonPerformance[userId]) {
        learningData.salespersonPerformance[userId] = { success: 0, total: 0, preferences: [] };
      }
      learningData.salespersonPerformance[userId].total++;
      if (outcome === 'success') {
        learningData.salespersonPerformance[userId].success++;
      }
    }
    
    // Store successful patterns
    if (outcome === 'success' && adviceGiven) {
      learningData.successfulPatterns.push({
        stage: stageKey,
        advice: adviceGiven,
        context: feedback,
        timestamp: new Date()
      });
    }
    
    // Store failed patterns for learning
    if (outcome === 'failure' && adviceGiven) {
      learningData.failedPatterns.push({
        stage: stageKey,
        advice: adviceGiven,
        context: feedback,
        timestamp: new Date()
      });
    }
    
    // Keep only recent patterns (last 100)
    learningData.successfulPatterns = learningData.successfulPatterns.slice(-100);
    learningData.failedPatterns = learningData.failedPatterns.slice(-100);
    
    await learningRef.set(learningData, { merge: true });
    
    return { success: true, message: 'Feedback recorded for learning' };
  } catch (e: any) {
    throw new Error(e?.message || 'Server error');
  }
});

// Analyze deal outcomes and update learning
export const analyzeDealOutcomeCallable = onCall({ cors: true }, async (request) => {
  try {
    const { tenantId, dealId, outcome, stageKey, userId } = request.data || {};
    if (!tenantId || !dealId || !outcome) throw new Error('Missing fields');
    
    // Get deal data to analyze what worked
    const dealRef = db.doc(`tenants/${tenantId}/crm_deals/${dealId}`);
    const dealSnap = await dealRef.get();
    const dealData = dealSnap.exists ? dealSnap.data() : {};
    
    // Get activities and notes for this deal
    const activitiesQuery = db.collection(`tenants/${tenantId}/activities`)
      .where('dealId', '==', dealId)
      .orderBy('createdAt', 'desc');
    const activitiesSnap = await activitiesQuery.get();
    const activities = activitiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Analyze successful patterns
    if (outcome === 'won') {
      const learningRef = db.doc(`tenants/${tenantId}/ai_learning`);
      const learningSnap = await learningRef.get();
      let learningData = learningSnap.exists ? learningSnap.data() : {
        successfulPatterns: [],
        stageSuccessRates: {},
        salespersonPerformance: {}
      };
      
      // Extract successful patterns from activities
      const successfulPatterns = activities
        .filter((activity: any) => activity.type === 'coach_advice' || activity.type === 'task_completed')
        .map((activity: any) => ({
          stage: stageKey,
          action: activity.description,
          result: 'success',
          timestamp: activity.createdAt
        }));
      
      learningData.successfulPatterns.push(...successfulPatterns);
      learningData.successfulPatterns = learningData.successfulPatterns.slice(-100); // Keep recent
      
      await learningRef.set(learningData, { merge: true });
    }
    
    return { success: true, patternsAnalyzed: activities.length };
  } catch (e: any) {
    throw new Error(e?.message || 'Server error');
  }
});

// Proactive Deal Coach - initiates conversations based on deal status
export const dealCoachProactiveCallable = onCall({ cors: true }, async (request) => {
  try {
    const { tenantId, dealId, trigger } = request.data || {};
    if (!tenantId || !dealId) throw new Error('Missing fields');
    
    // Get deal data
    const dealRef = db.doc(`tenants/${tenantId}/crm_deals/${dealId}`);
    const dealSnap = await dealRef.get();
    const dealData = dealSnap.exists ? dealSnap.data() : {};
    
    if (!dealData) {
      throw new Error('Deal not found');
    }
    
    // Get recent activities for this deal
    const activitiesQuery = db.collection(`tenants/${tenantId}/activities`)
      .where('dealId', '==', dealId)
      .orderBy('createdAt', 'desc')
      .limit(10);
    const activitiesSnap = await activitiesQuery.get();
    const recentActivities = activitiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Get deal stage data
    const stageData = dealData.stageData || {};
    const currentStage = dealData.currentStage || 'discovery';
    const lastActivity = recentActivities[0];
    const daysSinceLastActivity = lastActivity ? 
      Math.floor((Date.now() - (lastActivity as any).createdAt.toDate().getTime()) / (1000 * 60 * 60 * 24)) : 
      999;
    
    // Determine proactive message based on trigger and deal status
    let proactiveMessage = '';
    let urgency = 'low';
    
    if (trigger === 'auto_check') {
      // Intelligent auto-check that ramps up based on deal status
      const stageRequirements = getStageRequirements(currentStage);
      const completedFields = Object.keys(stageData[currentStage] || {}).filter(field => 
        stageData[currentStage][field] && stageData[currentStage][field] !== ''
      );
      const completionRate = completedFields.length / stageRequirements.length;
      
      // Check for different urgency levels
      if (daysSinceLastActivity > 14) {
        urgency = 'high';
        proactiveMessage = `I notice this deal hasn't had any activity in ${daysSinceLastActivity} days. This is a critical time to re-engage! Here are some immediate steps we could take:\n\n1. **Reach out to key contacts** - Check in on their timeline and any new developments\n2. **Review stage requirements** - Let's make sure we have all the information needed to move forward\n3. **Schedule a discovery call** - If we're still in early stages, this could unlock new opportunities\n4. **Send a value-add email** - Share relevant industry insights or case studies\n\nWhat would you like to focus on to get this deal moving again?`;
      } else if (daysSinceLastActivity > 7) {
        urgency = 'medium';
        proactiveMessage = `I see this deal hasn't had activity in ${daysSinceLastActivity} days. This is a good opportunity to check in and keep momentum going. What would you like to focus on?`;
      } else if (completionRate < 0.3) {
        urgency = 'medium';
        proactiveMessage = `I see we're in the ${currentStage} stage, but we're missing quite a bit of key information that could help move this deal forward. Here's what we still need:\n\n${stageRequirements.filter(req => !completedFields.includes(req)).slice(0, 3).map(req => `• ${req}`).join('\n')}\n\nWould you like me to help you gather this information or suggest some questions to ask the prospect?`;
      } else if (completionRate < 0.6) {
        urgency = 'low';
        proactiveMessage = `I see we're making good progress in the ${currentStage} stage, but there's still some information we could gather to strengthen our position. What would you like to focus on next?`;
      } else {
        // Deal is progressing well, no proactive message needed
        return { success: true, message: '', urgency: 'low' };
      }
    } else if (trigger === 'inactivity' || daysSinceLastActivity > 7) {
      urgency = 'high';
      proactiveMessage = `I notice this deal hasn't had any activity in ${daysSinceLastActivity} days. This is a good opportunity to re-engage! Here are some proactive steps we could take:\n\n1. **Reach out to key contacts** - Check in on their timeline and any new developments\n2. **Review stage requirements** - Let's make sure we have all the information needed to move forward\n3. **Schedule a discovery call** - If we're still in early stages, this could unlock new opportunities\n4. **Send a value-add email** - Share relevant industry insights or case studies\n\nWhat would you like to focus on to get this deal moving again?`;
    } else if (trigger === 'stage_stuck') {
      const stageRequirements = getStageRequirements(currentStage);
      const completedFields = Object.keys(stageData[currentStage] || {}).filter(field => 
        stageData[currentStage][field] && stageData[currentStage][field] !== ''
      );
      const completionRate = completedFields.length / stageRequirements.length;
      
      if (completionRate < 0.5) {
        urgency = 'medium';
        proactiveMessage = `I see we're in the ${currentStage} stage, but we're missing some key information that could help move this deal forward. Here's what we still need:\n\n${stageRequirements.filter(req => !completedFields.includes(req)).map(req => `• ${req}`).join('\n')}\n\nWould you like me to help you gather this information or suggest some questions to ask the prospect?`;
      }
    } else if (trigger === 'no_contacts') {
      urgency = 'medium';
      proactiveMessage = `I notice this deal doesn't have any associated contacts yet. Having the right people involved is crucial for deal success. Here are some suggestions:\n\n1. **Identify decision makers** - Who has the authority to make this purchase?\n2. **Find champions** - Who will advocate for your solution internally?\n3. **Map the buying committee** - Who else influences this decision?\n4. **Research on LinkedIn** - Look for key personnel at the company\n\nWould you like help identifying and reaching out to the right contacts?`;
    } else if (trigger === 'low_engagement') {
      urgency = 'medium';
      proactiveMessage = `I see the prospect's engagement level might be cooling off. This is a perfect time to re-ignite their interest. Here are some strategies:\n\n1. **Share a relevant case study** - Show how you've solved similar problems\n2. **Offer a free consultation** - Provide immediate value\n3. **Send industry insights** - Position yourself as a thought leader\n4. **Propose a different approach** - Maybe they need a different solution angle\n\nWhat type of re-engagement strategy would work best for this prospect?`;
    } else if (trigger === 'approaching_deadline') {
      urgency = 'high';
      proactiveMessage = `I notice this deal is approaching important deadlines. Let's make sure we're doing everything possible to move it forward:\n\n1. **Review the timeline** - What are the critical milestones?\n2. **Check for blockers** - What might be holding this up?\n3. **Escalate if needed** - Should we involve senior management?\n4. **Prepare for objections** - What concerns might arise?\n\nWhat's the most critical action we need to take right now?`;
    }
    
    // Create proactive activity log
    if (proactiveMessage) {
      const activityData = {
        dealId,
        type: 'coach_proactive',
        description: 'Deal Coach initiated conversation',
        details: proactiveMessage,
        urgency,
        trigger,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      await db.collection(`tenants/${tenantId}/activities`).add(activityData);
      
      // Log AI action
      try { 
        await logAIAction({ 
          eventType: 'dealCoach.proactive', 
          targetType: 'deal', 
          targetId: dealId, 
          reason: 'proactive_engagement', 
          contextType: 'dealCoach', 
          aiTags: ['dealCoach', 'proactive'], 
          urgencyScore: urgency === 'high' ? 8 : urgency === 'medium' ? 5 : 3, 
          tenantId, 
          userId: '', 
          aiResponse: JSON.stringify({ message: proactiveMessage, trigger, urgency }) 
        }); 
      } catch {}
    }
    
    return { 
      success: true, 
      message: proactiveMessage,
      urgency,
      trigger,
      daysSinceLastActivity
    };
  } catch (e: any) {
    throw new Error(e?.message || 'Server error');
  }
});

// Helper function to get stage requirements
function getStageRequirements(stage: string): string[] {
  const requirements: { [key: string]: string[] } = {
    discovery: [
      'Company pain points',
      'Current staffing situation',
      'Decision timeline',
      'Budget range',
      'Key decision makers'
    ],
    qualification: [
      'Must-have requirements',
      'Must-avoid criteria',
      'Budget approval process',
      'Technical requirements',
      'Implementation timeline'
    ],
    scoping: [
      'Detailed requirements',
      'Scope of work',
      'Resource requirements',
      'Success criteria',
      'Risk assessment'
    ],
    proposalReview: [
      'Proposal feedback',
      'Objection handling',
      'Competitive analysis',
      'Value proposition',
      'Next steps'
    ],
    negotiation: [
      'Pricing discussion',
      'Contract terms',
      'Service level agreements',
      'Implementation plan',
      'Success metrics'
    ]
  };
  
  return requirements[stage] || [];
}


