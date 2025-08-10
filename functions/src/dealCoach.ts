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
        model: 'gpt-4o-mini',
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
          model: 'gpt-4o-mini',
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
          model: 'gpt-4o-mini',
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
      model: 'gpt-4o-mini',
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
export const dealCoachAnalyzeCallable = onCall({ cors: true }, async (request) => {
  try {
    const { dealId, stageKey, tenantId } = request.data || {};
    if (!dealId || !stageKey || !tenantId) throw new Error('Missing dealId, stageKey or tenantId');

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
          return { ...parsed, threadId: dealId, cacheHit: true };
        } catch {}
      }
    }

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

    // Get deal data
    const dealRef = db.doc(`tenants/${tenantId}/crm_deals/${dealId}`);
    const dealSnap = await dealRef.get();
    if (!dealSnap.exists) throw new Error('Deal not found');
    const dealData = dealSnap.data() as any;

    // Build snapshot
    const snapshot = {
      deal: dealData,
      stage: stageKey,
      messages: existingMessages.slice(-10) // last 10 messages for context
    };

    // Call OpenAI
    const apiKey = OPENAI_KEY;
    let result: any = { summary: `Summary for ${stageKey}.`, suggestions: [] };
    if (apiKey) {
      const system = 'You are the Deal Coach AI. Analyze the current deal stage and provide actionable suggestions. Focus on next steps, potential roadblocks, and specific actions the salesperson can take. Keep suggestions practical and specific to the staffing industry.';
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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
    } else {
      result = { summary: `Summary for ${stageKey}.`, suggestions: [] };
    }

    // Validate via zod
    const parsed = AnalyzeResponse.parse(result);

    // Persist cache
    await cacheRef.set({ payload: parsed, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    // Log telemetry (best-effort)
    try { await logAIAction({ eventType: 'dealCoach.analyze', targetType: 'deal', targetId: dealId, reason: 'analyze', contextType: 'dealCoach', aiTags: ['dealCoach'], urgencyScore: 5, tenantId, aiResponse: JSON.stringify(parsed) }); } catch {}

    return { ...parsed, threadId: dealId, cacheHit: false };
  } catch (e: any) {
    throw new Error(e?.message || 'Server error');
  }
});

export const dealCoachChatCallable = onCall({ cors: true }, async (request) => {
  try {
    const { dealId, stageKey, tenantId, userId, message } = request.data || {};
    if (!dealId || !stageKey || !tenantId || !message) throw new Error('Missing fields');
    const apiKey = process.env.OPENAI_API_KEY;
    let payload: any = { text: 'Okay — here are next steps.' };
    
    // 🎯 ENHANCED DEAL CONTEXT GATHERING
    let dealContext: any;
    let enhancedMessage: string | undefined;
    
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
          // Fallback to basic system prompt
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
        
        // Make OpenAI API call
        const userMessage = enhancedMessage || message;
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: userMessage }
            ],
            temperature: 0.7,
            max_tokens: 1000
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


