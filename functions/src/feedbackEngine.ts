import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { OpenAI } from 'openai';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || (process.env.FUNCTIONS_EMULATOR ? 'test' : ''),
});

export const createFeedbackCampaign = onCall(async (request) => {
  const data = request.data;
  const start = Date.now();
  let success = false;
  let errorMessage = '';
  let ref = null;
  try {
    const campaign = {
      name: data.name,
      createdBy: request.auth?.uid,
      audience: data.audience,
      promptSet: data.promptSet,
      scoring: data.scoring,
      managerAccess: data.managerAccess,
      followUpLogic: data.followUpLogic,
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      // New fields
      startDate: data.startDate || null,
      endDate: data.endDate || null,
      recurrence: data.recurrence || null,
      reminderInterval: data.reminderInterval || null,
      anonymity: data.anonymity || false,
      hrReviewOnly: data.hrReviewOnly || false,
      managerAccessOptIn: data.managerAccessOptIn || false,
      aiFollowUp: data.aiFollowUp || false,
      phase2Logic: data.phase2Logic || null,
      isTemplate: data.isTemplate || false,
      templateName: data.templateName || '',
    };
    ref = await db.collection('feedbackCampaigns').add(campaign);
    success = true;
    return { id: ref.id };
  } catch (error: any) {
    errorMessage = error.message || 'Unknown error';
    throw error;
  } finally {
    const latencyMs = Date.now() - start;
    // AI LOG: Feedback campaign creation event
    await logAIAction({
      userId: request.auth?.uid || 'unknown',
      actionType: 'feedback_campaign_create',
      sourceModule: 'FeedbackEngine',
      inputPrompt: data.promptSet || null,
      composedPrompt: data.promptSet || null,
      aiResponse: ref ? ref.id : '',
      success,
      errorMessage,
      latencyMs,
      versionTag: 'v1',
      scenarioContext: data.scenarioContext || null,
      customerId: data.customerId || null,
      tenantId: data.tenantId || null,
      globalContextUsed: data.globalContextUsed || null,
      scenarioContextUsed: data.scenarioContextUsed || null,
      customerContextUsed: data.customerContextUsed || null,
      weightsApplied: data.weightsApplied || null,
      traitsActive: data.traitsActive || null,
      vectorChunksUsed: data.vectorChunksUsed || null,
      vectorSimilarityScores: data.vectorSimilarityScores || null,
      dryRun: data.dryRun || false,
      manualOverride: data.manualOverride || false,
      feedbackGiven: data.feedbackGiven || null,
      reason: success ? `Campaign "${data.name}" created` : errorMessage,
      // --- New schema fields ---
      eventType: 'feedback.campaign.created',
      targetType: 'campaign',
      ...(ref ? { targetId: ref.id } : {}),
      aiRelevant: true,
      contextType: 'feedback',
      traitsAffected: null,
      aiTags: data.aiTags || null,
      urgencyScore: null
    });
  }
});

export const submitFeedbackResponse = onCall(async (request) => {
  const data = request.data;
  const start = Date.now();
  let success = false;
  let errorMessage = '';
  let aiResponse = '';
  
  try {
    // TODO: Add auth/role checks
    const campaignSnap = await db.collection('feedbackCampaigns').doc(data.campaignId).get();
    if (!campaignSnap.exists) throw new Error('Campaign not found');
    const campaign = campaignSnap.data();
    const responses = await Promise.all(data.responses.map(async (resp: any) => {
      if (campaign && campaign.scoring && resp.type === 'text') {
        // Run sentiment analysis
        const aiRes = await openai.chat.completions.create({
          model: 'gpt-5',
          messages: [{ role: 'system', content: 'Analyze sentiment (scale -1 to 1): ' + resp.answer }],
          max_completion_tokens: 10,
        });
        const content = aiRes.choices?.[0]?.message?.content || '';
        const match = content.match(/-?\d+(\.\d+)?/);
        const sentimentScore = match ? parseFloat(match[0]) : 0;
        return { ...resp, sentimentScore };
      }
      return resp;
    }));
    
    await db.collection('feedbackResponses').add({
      campaignId: data.campaignId,
      workerId: request.auth?.uid,
      responses,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    
    success = true;
    aiResponse = `Submitted ${responses.length} responses for campaign ${data.campaignId}`;
    return { success: true };
  } catch (error: any) {
    errorMessage = error.message || 'Unknown error';
    throw error;
  } finally {
    const latencyMs = Date.now() - start;
    await logAIAction({
      userId: request.auth?.uid || 'unknown',
      actionType: 'feedback_response_submit',
      sourceModule: 'FeedbackEngine',
      inputPrompt: data.responses?.map((r: any) => r.answer).join(' | ') || null,
      composedPrompt: data.responses?.map((r: any) => r.answer).join(' | ') || null,
      aiResponse,
      success,
      errorMessage,
      latencyMs,
      versionTag: 'v1',
      scenarioContext: data.scenarioContext || null,
      customerId: data.customerId || null,
      tenantId: data.tenantId || null,
      globalContextUsed: data.globalContextUsed || null,
      scenarioContextUsed: data.scenarioContextUsed || null,
      customerContextUsed: data.customerContextUsed || null,
      weightsApplied: data.weightsApplied || null,
      traitsActive: data.traitsActive || null,
      vectorChunksUsed: data.vectorChunksUsed || null,
      vectorSimilarityScores: data.vectorSimilarityScores || null,
      dryRun: data.dryRun || false,
      manualOverride: data.manualOverride || false,
      feedbackGiven: data.feedbackGiven || null,
      reason: success ? `Feedback response submitted for campaign ${data.campaignId}` : errorMessage
    });
  }
});

export const getFeedbackResults = onCall(async (request) => {
  const { campaignId } = request.data;
  // TODO: Add auth/role checks for manager access
  const snap = await db.collection('feedbackResponses').where('campaignId', '==', campaignId).get();
  const results = snap.docs.map(doc => doc.data());
  return { results };
});

export const generateFeedbackPrompts = onCall(async (request) => {
  const { topic } = request.data;
  const start = Date.now();
  let success = false;
  let errorMessage = '';
  let aiResponse = '';
  
  try {
    // TODO: Use OpenAI to generate prompt suggestions based on topic
    const aiRes = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: [{ role: 'system', content: `Suggest 3 feedback prompts for: ${topic}` }],
      max_completion_tokens: 200,
    });
    
    aiResponse = aiRes.choices[0].message.content || '';
    success = true;
    return { prompts: aiResponse };
  } catch (error: any) {
    errorMessage = error.message || 'Unknown error';
    throw error;
  } finally {
    const latencyMs = Date.now() - start;
    await logAIAction({
      userId: request.auth?.uid || 'unknown',
      actionType: 'feedback_prompts_generate',
      sourceModule: 'FeedbackEngine',
      inputPrompt: topic || null,
      composedPrompt: `Suggest 3 feedback prompts for: ${topic}`,
      aiResponse,
      success,
      errorMessage,
      latencyMs,
      versionTag: 'v1',
      scenarioContext: request.data.scenarioContext || null,
      customerId: request.data.customerId || null,
      tenantId: request.data.tenantId || null,
      globalContextUsed: request.data.globalContextUsed || null,
      scenarioContextUsed: request.data.scenarioContextUsed || null,
      customerContextUsed: request.data.customerContextUsed || null,
      weightsApplied: request.data.weightsApplied || null,
      traitsActive: request.data.traitsActive || null,
      vectorChunksUsed: request.data.vectorChunksUsed || null,
      vectorSimilarityScores: request.data.vectorSimilarityScores || null,
      dryRun: request.data.dryRun || false,
      manualOverride: request.data.manualOverride || false,
      feedbackGiven: request.data.feedbackGiven || null,
      reason: success ? `Generated feedback prompts for topic: ${topic}` : errorMessage
    });
  }
});

export const getFeedbackAISummary = onCall(async (request) => {
  const { campaignId } = request.data;
  const start = Date.now();
  let success = false;
  let errorMessage = '';
  let aiResponse = '';
  let summaryResponse = '';
  let themesResponse = '';
  let insightsResponse = '';
  
  try {
    // TODO: Add auth/role checks for manager access
    
    // Get campaign details
    const campaignSnap = await db.collection('feedbackCampaigns').doc(campaignId).get();
    if (!campaignSnap.exists) throw new Error('Campaign not found');
    // const campaign = campaignSnap.data(); // Not used yet but may be needed for future features
    
    // Get all responses for this campaign
    const responsesSnap = await db.collection('feedbackResponses').where('campaignId', '==', campaignId).get();
    const responses = responsesSnap.docs.map(doc => doc.data());
    
    if (responses.length === 0) {
      success = true;
      aiResponse = 'No responses yet for this campaign.';
      return {
        summary: 'No responses yet for this campaign.',
        keyThemes: [],
        sentimentTrend: [],
        actionableInsights: [],
        responseCount: 0,
        avgSentiment: 0
      };
    }
    
    // Extract text responses for AI analysis
    const textResponses = responses.flatMap(r => 
      r.responses.filter((resp: any) => resp.type === 'text').map((resp: any) => resp.answer)
    ).filter(text => text && text.trim().length > 10);
    
    if (textResponses.length === 0) {
      success = true;
      aiResponse = 'No text responses available for analysis.';
      return {
        summary: 'No text responses available for analysis.',
        keyThemes: [],
        sentimentTrend: [],
        actionableInsights: [],
        responseCount: responses.length,
        avgSentiment: 0
      };
    }
    
    // Generate AI summary
    const summaryPrompt = `Analyze these feedback responses and provide a concise summary (2-3 sentences):
    
    Responses: ${textResponses.slice(0, 20).join('\n\n')}
    
    Focus on overall sentiment, common themes, and key insights.`;
    
    const summaryRes = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: summaryPrompt }],
      max_completion_tokens: 150,
    });
    
    summaryResponse = summaryRes.choices[0].message.content || '';
    
    // Extract key themes
    const themesPrompt = `Identify 3-5 key themes from these feedback responses. Return as a JSON array of objects with "theme" and "frequency" fields:
    
    Responses: ${textResponses.slice(0, 15).join('\n\n')}`;
    
    const themesRes = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: themesPrompt }],
      max_completion_tokens: 200,
    });
    
    themesResponse = themesRes.choices[0].message.content || '';
    
         let keyThemes = [];
     try {
       const themesContent = themesRes.choices[0].message.content || '';
       const themesMatch = themesContent.match(/\[.*\]/);
       if (themesMatch) {
         keyThemes = JSON.parse(themesMatch[0]);
       }
     } catch (e) {
      keyThemes = [
        { theme: 'Communication', frequency: 'High' },
        { theme: 'Work Environment', frequency: 'Medium' },
        { theme: 'Support', frequency: 'Medium' }
      ];
    }
    
    // Generate actionable insights
    const insightsPrompt = `Based on these feedback responses, provide 2-3 actionable insights for management. Focus on specific, implementable recommendations:
    
    Responses: ${textResponses.slice(0, 15).join('\n\n')}`;
    
    const insightsRes = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: insightsPrompt }],
      max_completion_tokens: 200,
    });
    
    insightsResponse = insightsRes.choices[0].message.content || '';
    
    const actionableInsights = (insightsRes.choices[0].message.content || '')
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => line.replace(/^\d+\.\s*/, '').trim());
    
    // Calculate sentiment trends
    const sentimentScores = responses.flatMap(r => 
      r.responses.filter((resp: any) => resp.sentimentScore !== undefined).map((resp: any) => resp.sentimentScore)
    );
    
    const avgSentiment = sentimentScores.length > 0 
      ? sentimentScores.reduce((sum, score) => sum + score, 0) / sentimentScores.length 
      : 0;
    
    // Create sentiment trend data (last 7 days)
    const sentimentTrend = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayResponses = responses.filter(r => {
        const responseDate = r.submittedAt?.toDate?.() || new Date(r.submittedAt);
        return responseDate.toDateString() === date.toDateString();
      });
      
      const daySentiments = dayResponses.flatMap(r => 
        r.responses.filter((resp: any) => resp.sentimentScore !== undefined).map((resp: any) => resp.sentimentScore)
      );
      
      sentimentTrend.push({
        date: date.toISOString().split('T')[0],
        avgSentiment: daySentiments.length > 0 
          ? daySentiments.reduce((sum, score) => sum + score, 0) / daySentiments.length 
          : null,
        responseCount: dayResponses.length
      });
    }
    
    success = true;
    aiResponse = `Summary: ${summaryResponse} | Themes: ${themesResponse} | Insights: ${insightsResponse}`;
    
    return {
      summary: summaryRes.choices[0].message.content || 'Analysis completed.',
      keyThemes,
      sentimentTrend,
      actionableInsights,
      responseCount: responses.length,
      avgSentiment: Math.round(avgSentiment * 100) / 100
    };
    
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error generating AI summary:', error);
    throw new Error('Failed to generate AI summary');
  } finally {
    const latencyMs = Date.now() - start;
    await logAIAction({
      userId: request.auth?.uid || 'unknown',
      actionType: 'feedback_ai_summary',
      sourceModule: 'FeedbackEngine',
      inputPrompt: `Campaign ID: ${campaignId}`,
      composedPrompt: `Generate AI summary for feedback campaign ${campaignId}`,
      aiResponse,
      success,
      errorMessage,
      latencyMs,
      versionTag: 'v1',
      scenarioContext: request.data.scenarioContext || null,
      customerId: request.data.customerId || null,
      tenantId: request.data.tenantId || null,
      globalContextUsed: request.data.globalContextUsed || null,
      scenarioContextUsed: request.data.scenarioContextUsed || null,
      customerContextUsed: request.data.customerContextUsed || null,
      weightsApplied: request.data.weightsApplied || null,
      traitsActive: request.data.traitsActive || null,
      vectorChunksUsed: request.data.vectorChunksUsed || null,
      vectorSimilarityScores: request.data.vectorSimilarityScores || null,
      dryRun: request.data.dryRun || false,
      manualOverride: request.data.manualOverride || false,
      feedbackGiven: request.data.feedbackGiven || null,
      reason: success ? `Generated AI summary for campaign ${campaignId}` : errorMessage
    });
  }
});

export const saveFeedbackTemplate = onCall(async (request) => {
  // TODO: Save campaign as template for org
  return { success: true };
});

export const listFeedbackTemplates = onCall(async (request) => {
  // TODO: List available templates for org
  return { templates: [] };
});

export const listFeedbackCampaigns = onCall(async (request) => {
  // TODO: Add auth/role checks
  try {
    const campaignsSnap = await db.collection('feedbackCampaigns')
      .where('status', '==', 'active')
      .orderBy('createdAt', 'desc')
      .get();
    
    const campaigns = campaignsSnap.docs.map(doc => ({
      id: doc.id,
      ...(doc.data() as object)
    }));
    
    return { campaigns };
  } catch (error) {
    console.error('Error listing campaigns:', error);
    throw new Error('Failed to list campaigns');
  }
});

export const listCustomerToneOverrides = onCall(async (request) => {
  // TODO: Add auth/role checks
  const customersSnap = await db.collection('customers').get();
  const overrides = customersSnap.docs
    .map(doc => {
      const data = doc.data();
      if (data && data.tone) {
        return {
          id: doc.id,
          name: data.name || '',
          tone: data.tone
        };
      }
      return null;
    })
    .filter(Boolean);
  return { overrides };
});

export const getCustomerTone = onCall(async (request) => {
  const { customerId } = request.data;
  if (!customerId) throw new Error('customerId required');
  const doc = await db.collection('customers').doc(customerId).get();
  const data = doc.exists ? doc.data() : undefined;
  return { tone: data && data.tone ? data.tone : null };
});

export const setCustomerTone = onCall(async (request) => {
  const { customerId, tone } = request.data;
  const start = Date.now();
  let success = false;
  let errorMessage = '';
  
  if (!customerId || !tone) throw new Error('customerId and tone required');
  try {
    await db.collection('customers').doc(customerId).update({ tone });
    
    success = true;
    return { success: true };
  } catch (error: any) {
    errorMessage = error.message || 'Unknown error';
    throw error;
  } finally {
    const latencyMs = Date.now() - start;
    await logAIAction({
      userId: request.auth?.uid || 'unknown',
      actionType: 'customer_tone_set',
      sourceModule: 'CustomerToneOverrides',
      inputPrompt: JSON.stringify(tone),
      composedPrompt: `Set tone override for customer ${customerId}`,
      aiResponse: `Tone override set for customer ${customerId}`,
      success,
      errorMessage,
      latencyMs,
      versionTag: 'v1',
      scenarioContext: request.data.scenarioContext || null,
      customerId,
      tenantId: request.data.tenantId || null,
      globalContextUsed: request.data.globalContextUsed || null,
      scenarioContextUsed: request.data.scenarioContextUsed || null,
      customerContextUsed: request.data.customerContextUsed || null,
      weightsApplied: request.data.weightsApplied || null,
      traitsActive: request.data.traitsActive || null,
      vectorChunksUsed: request.data.vectorChunksUsed || null,
      vectorSimilarityScores: request.data.vectorSimilarityScores || null,
      dryRun: request.data.dryRun || false,
      manualOverride: request.data.manualOverride || false,
      feedbackGiven: request.data.feedbackGiven || null,
      reason: success ? `Tone override set for customer ${customerId}` : errorMessage
    });
  }
});

export const resetCustomerTone = onCall(async (request) => {
  const { customerId } = request.data;
  const start = Date.now();
  let success = false;
  let errorMessage = '';
  
  if (!customerId) throw new Error('customerId required');
  try {
    await db.collection('customers').doc(customerId).update({ tone: admin.firestore.FieldValue.delete() });
    
    success = true;
    return { success: true };
  } catch (error: any) {
    errorMessage = error.message || 'Unknown error';
    throw error;
  } finally {
    const latencyMs = Date.now() - start;
    await logAIAction({
      userId: request.auth?.uid || 'unknown',
      actionType: 'customer_tone_reset',
      sourceModule: 'CustomerToneOverrides',
      inputPrompt: `Reset tone for customer ${customerId}`,
      composedPrompt: `Reset tone override for customer ${customerId}`,
      aiResponse: `Tone override reset for customer ${customerId}`,
      success,
      errorMessage,
      latencyMs,
      versionTag: 'v1',
      scenarioContext: request.data.scenarioContext || null,
      customerId,
      tenantId: request.data.tenantId || null,
      globalContextUsed: request.data.globalContextUsed || null,
      scenarioContextUsed: request.data.scenarioContextUsed || null,
      customerContextUsed: request.data.customerContextUsed || null,
      weightsApplied: request.data.weightsApplied || null,
      traitsActive: request.data.traitsActive || null,
      vectorChunksUsed: request.data.vectorChunksUsed || null,
      vectorSimilarityScores: request.data.vectorSimilarityScores || null,
      dryRun: request.data.dryRun || false,
      manualOverride: request.data.manualOverride || false,
      feedbackGiven: request.data.feedbackGiven || null,
      reason: success ? `Tone override reset for customer ${customerId}` : errorMessage
    });
  }
});

// Context Engine functions
export const getGlobalContext = onCall(async (request) => {
  const doc = await db.collection('settings').doc('contextGlobal').get();
  return { context: doc.exists ? doc.data() : null };
});

export const setGlobalContext = onCall(async (request) => {
  const { context, userId } = request.data;
  const start = Date.now();
  let success = false;
  let errorMessage = '';
  
  try {
    await db.collection('settings').doc('contextGlobal').set({ ...context, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: userId });
    await db.collection('context_versions').add({
      type: 'global',
      context,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId
    });
    await db.collection('context_audit').add({
      type: 'global',
      action: 'update',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId,
      context
    });
    
    success = true;
    return { success: true };
  } catch (error: any) {
    errorMessage = error.message || 'Unknown error';
    throw error;
  } finally {
    const latencyMs = Date.now() - start;
    await logAIAction({
      userId: userId || 'unknown',
      actionType: 'global_context_set',
      sourceModule: 'ContextEngine',
      inputPrompt: JSON.stringify(context),
      composedPrompt: 'Update global context settings',
      aiResponse: 'Global context settings updated',
      success,
      errorMessage,
      latencyMs,
      versionTag: 'v1',
      scenarioContext: request.data.scenarioContext || null,
      customerId: request.data.customerId || null,
      tenantId: request.data.tenantId || null,
      globalContextUsed: context,
      scenarioContextUsed: request.data.scenarioContextUsed || null,
      customerContextUsed: request.data.customerContextUsed || null,
      weightsApplied: request.data.weightsApplied || null,
      traitsActive: request.data.traitsActive || null,
      vectorChunksUsed: request.data.vectorChunksUsed || null,
      vectorSimilarityScores: request.data.vectorSimilarityScores || null,
      dryRun: request.data.dryRun || false,
      manualOverride: request.data.manualOverride || false,
      feedbackGiven: request.data.feedbackGiven || null,
      reason: success ? 'Global context settings updated' : errorMessage
    });
  }
});

export const listScenarios = onCall(async (request) => {
  const snap = await db.collection('settings/context/scenarios').get();
  const scenarios = snap.docs.map(doc => ({ id: doc.id, ...(doc.data() as object) }));
  return { scenarios };
});

export const getScenario = onCall(async (request) => {
  const { scenarioId } = request.data;
  const doc = await db.collection('settings/context/scenarios').doc(scenarioId).get();
  return { scenario: doc.exists ? { id: doc.id, ...doc.data() } : null };
});

export const setScenario = onCall(async (request) => {
  const { scenarioId, scenario, userId } = request.data;
  const start = Date.now();
  let success = false;
  let errorMessage = '';
  
  try {
    await db.collection('settings/context/scenarios').doc(scenarioId).set({ ...scenario, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: userId });
    await db.collection('context_versions').add({
      type: 'scenario',
      scenarioId,
      scenario,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId
    });
    await db.collection('context_audit').add({
      type: 'scenario',
      scenarioId,
      action: 'update',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId,
      scenario
    });
    
    success = true;
    return { success: true };
  } catch (error: any) {
    errorMessage = error.message || 'Unknown error';
    throw error;
  } finally {
    const latencyMs = Date.now() - start;
    await logAIAction({
      userId: userId || 'unknown',
      actionType: 'scenario_set',
      sourceModule: 'ContextEngine',
      inputPrompt: JSON.stringify(scenario),
      composedPrompt: `Update scenario ${scenarioId}`,
      aiResponse: `Scenario ${scenarioId} updated`,
      success,
      errorMessage,
      latencyMs,
      versionTag: 'v1',
      scenarioContext: scenarioId,
      customerId: request.data.customerId || null,
      tenantId: request.data.tenantId || null,
      globalContextUsed: request.data.globalContextUsed || null,
      scenarioContextUsed: scenario,
      customerContextUsed: request.data.customerContextUsed || null,
      weightsApplied: request.data.weightsApplied || null,
      traitsActive: request.data.traitsActive || null,
      vectorChunksUsed: request.data.vectorChunksUsed || null,
      vectorSimilarityScores: request.data.vectorSimilarityScores || null,
      dryRun: request.data.dryRun || false,
      manualOverride: request.data.manualOverride || false,
      feedbackGiven: request.data.feedbackGiven || null,
      reason: success ? `Scenario ${scenarioId} updated` : errorMessage
    });
  }
});

export const deleteScenario = onCall(async (request) => {
  const { scenarioId, userId } = request.data;
  const start = Date.now();
  let success = false;
  let errorMessage = '';
  
  try {
    await db.collection('settings/context/scenarios').doc(scenarioId).delete();
    await db.collection('context_audit').add({
      type: 'scenario',
      scenarioId,
      action: 'delete',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId
    });
    
    success = true;
    return { success: true };
  } catch (error: any) {
    errorMessage = error.message || 'Unknown error';
    throw error;
  } finally {
    const latencyMs = Date.now() - start;
    await logAIAction({
      userId: userId || 'unknown',
      actionType: 'scenario_delete',
      sourceModule: 'ContextEngine',
      inputPrompt: `Delete scenario ${scenarioId}`,
      composedPrompt: `Delete scenario ${scenarioId}`,
      aiResponse: `Scenario ${scenarioId} deleted`,
      success,
      errorMessage,
      latencyMs,
      versionTag: 'v1',
      scenarioContext: scenarioId,
      customerId: request.data.customerId || null,
      tenantId: request.data.tenantId || null,
      globalContextUsed: request.data.globalContextUsed || null,
      scenarioContextUsed: request.data.scenarioContextUsed || null,
      customerContextUsed: request.data.customerContextUsed || null,
      weightsApplied: request.data.weightsApplied || null,
      traitsActive: request.data.traitsActive || null,
      vectorChunksUsed: request.data.vectorChunksUsed || null,
      vectorSimilarityScores: request.data.vectorSimilarityScores || null,
      dryRun: request.data.dryRun || false,
      manualOverride: request.data.manualOverride || false,
      feedbackGiven: request.data.feedbackGiven || null,
      reason: success ? `Scenario ${scenarioId} deleted` : errorMessage
    });
  }
});

export const listContextVersions = onCall(async (request) => {
  const snap = await db.collection('context_versions').orderBy('updatedAt', 'desc').limit(20).get();
  const versions = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return { versions };
});

export const restoreContextVersion = onCall(async (request) => {
  const { versionId, userId } = request.data;
  const start = Date.now();
  let success = false;
  let errorMessage = '';
  
  try {
    const doc = await db.collection('context_versions').doc(versionId).get();
    if (!doc.exists) throw new Error('Version not found');
    const data = doc.data();
    if (!data) throw new Error('Version data missing');
    if (data.type === 'global') {
      await db.collection('settings').doc('contextGlobal').set({ ...data.context, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: userId });
    } else if (data.type === 'scenario') {
      await db.collection('settings/context/scenarios').doc(data.scenarioId).set({ ...data.scenario, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: userId });
    }
    await db.collection('context_audit').add({
      type: data.type,
      scenarioId: data.scenarioId || null,
      action: 'restore',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId,
      data
    });
    
    success = true;
    return { success: true };
  } catch (error: any) {
    errorMessage = error.message || 'Unknown error';
    throw error;
  } finally {
    const latencyMs = Date.now() - start;
    await logAIAction({
      userId: userId || 'unknown',
      actionType: 'context_version_restore',
      sourceModule: 'ContextEngine',
      inputPrompt: `Restore version ${versionId}`,
      composedPrompt: `Restore context version ${versionId}`,
      aiResponse: `Version ${versionId} restored`,
      success,
      errorMessage,
      latencyMs,
      versionTag: 'v1',
      scenarioContext: request.data.scenarioContext || null,
      customerId: request.data.customerId || null,
      tenantId: request.data.tenantId || null,
      globalContextUsed: request.data.globalContextUsed || null,
      scenarioContextUsed: request.data.scenarioContextUsed || null,
      customerContextUsed: request.data.customerContextUsed || null,
      weightsApplied: request.data.weightsApplied || null,
      traitsActive: request.data.traitsActive || null,
      vectorChunksUsed: request.data.vectorChunksUsed || null,
      vectorSimilarityScores: request.data.vectorSimilarityScores || null,
      dryRun: request.data.dryRun || false,
      manualOverride: request.data.manualOverride || false,
      feedbackGiven: request.data.feedbackGiven || null,
      reason: success ? `Version ${versionId} restored` : errorMessage
    });
  }
});

export const setWeightsConfig = onCall(async (request) => {
  const { weights, userId } = request.data;
  const start = Date.now();
  let success = false;
  let errorMessage = '';
  
  try {
    // Save to a test document in Firestore
    await db.collection('test_weights').doc('global').set({
      weights,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId || 'test-admin'
    });
    
    success = true;
    return { success: true };
  } catch (error: any) {
    errorMessage = error.message || 'Unknown error';
    throw error;
  } finally {
    const latencyMs = Date.now() - start;
    await logAIAction({
      userId: userId || 'test-admin',
      actionType: 'weights_config_set',
      sourceModule: 'WeightsEngine',
      inputPrompt: JSON.stringify(weights),
      composedPrompt: 'Update weights configuration',
      aiResponse: 'Weights updated for testing',
      success,
      errorMessage,
      latencyMs,
      versionTag: 'v1',
      scenarioContext: request.data.scenarioContext || null,
      customerId: request.data.customerId || null,
      tenantId: request.data.tenantId || null,
      globalContextUsed: request.data.globalContextUsed || null,
      scenarioContextUsed: request.data.scenarioContextUsed || null,
      customerContextUsed: request.data.customerContextUsed || null,
      weightsApplied: weights,
      traitsActive: request.data.traitsActive || null,
      vectorChunksUsed: request.data.vectorChunksUsed || null,
      vectorSimilarityScores: request.data.vectorSimilarityScores || null,
      dryRun: request.data.dryRun || false,
      manualOverride: request.data.manualOverride || false,
      feedbackGiven: request.data.feedbackGiven || null,
      reason: success ? 'Weights updated for testing' : errorMessage
    });
  }
});

/**
 * Logs a comprehensive AI action for auditing, debugging, and analytics.
 * Accepts a superset of all possible fields for any AI activity.
 * Backward compatible: old usages with {workerId, module, ...} still work.
 */
export async function logAIAction(log: {
  // Core fields
  timestamp?: any,
  userId?: string,
  workerId?: string, // alias for userId
  actionType?: string,
  sourceModule?: string,
  module?: string, // alias for sourceModule
  trigger?: string,
  action?: string,
  scenarioContext?: string,
  customerId?: string,
  tenantId?: string,
  inputPrompt?: string,
  composedPrompt?: string,
  aiResponse?: string,
  success?: boolean,
  outcome?: string, // alias for success
  reason?: string,
  errorMessage?: string,
  // Advanced context fields
  globalContextUsed?: any,
  scenarioContextUsed?: any,
  customerContextUsed?: any,
  weightsApplied?: any,
  traitsActive?: any,
  vectorChunksUsed?: any,
  vectorSimilarityScores?: any,
  // Optional/QA fields
  latencyMs?: number,
  versionTag?: string,
  dryRun?: boolean,
  manualOverride?: boolean,
  feedbackGiven?: any,
  // New schema fields
  eventType?: string,
  targetType?: string,
  targetId?: string,
  aiRelevant?: boolean,
  contextType?: string,
  traitsAffected?: any,
  aiTags?: any,
  urgencyScore?: any,
  [key: string]: any
}) {
  // Backward compatibility: map old fields to new schema
  const data: any = {
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    timestampIso: new Date().toISOString(),
    userId: log.userId || log.workerId || null,
    actionType: log.actionType || log.action || null,
    sourceModule: log.sourceModule || log.module || null,
    trigger: log.trigger || null,
    scenarioContext: log.scenarioContext || null,
    customerId: log.customerId || null,
    tenantId: log.tenantId || null,
    inputPrompt: log.inputPrompt || null,
    composedPrompt: log.composedPrompt || null,
    aiResponse: log.aiResponse || null,
    success: typeof log.success === 'boolean' ? log.success : (log.outcome ? log.outcome === 'Success' : null),
    reason: log.reason || null,
    errorMessage: log.errorMessage || null,
    globalContextUsed: log.globalContextUsed || null,
    scenarioContextUsed: log.scenarioContextUsed || null,
    customerContextUsed: log.customerContextUsed || null,
    weightsApplied: log.weightsApplied || null,
    traitsActive: log.traitsActive || null,
    vectorChunksUsed: log.vectorChunksUsed || null,
    vectorSimilarityScores: log.vectorSimilarityScores || null,
    latencyMs: log.latencyMs || null,
    versionTag: log.versionTag || null,
    dryRun: typeof log.dryRun === 'boolean' ? log.dryRun : null,
    manualOverride: typeof log.manualOverride === 'boolean' ? log.manualOverride : null,
    feedbackGiven: log.feedbackGiven || null,
    eventType: log.eventType || null,
    targetType: log.targetType || null,
    targetId: log.targetId || null,
    aiRelevant: typeof log.aiRelevant === 'boolean' ? log.aiRelevant : null,
    contextType: log.contextType || null,
    traitsAffected: log.traitsAffected || null,
    aiTags: log.aiTags || null,
    urgencyScore: log.urgencyScore || null
  };
  // Include any extra fields
  for (const key in log) {
    if (!(key in data)) data[key] = log[key];
  }
  // Debug: print the log data
  console.log('AI LOG ENTRY:', JSON.stringify(data, null, 2));
  const ref = await db.collection('ai_logs').add(data);
  console.log('AI LOG WRITTEN, DOC ID:', ref.id);
}

export const listAILogs = onCall(async (request) => {
  const { module, outcome, workerId, startDate, endDate, limit = 50 } = request.data || {};
  let query = db.collection('ai_logs').orderBy('timestamp', 'desc');
  if (module) query = query.where('module', '==', module);
  if (outcome) query = query.where('outcome', '==', outcome);
  if (workerId) query = query.where('workerId', '==', workerId);
  if (startDate) query = query.where('timestamp', '>=', new Date(startDate));
  if (endDate) query = query.where('timestamp', '<=', new Date(endDate));
  const snap = await query.limit(limit).get();
  const logs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return { logs };
}); 