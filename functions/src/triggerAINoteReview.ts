import { onCall, onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { corsOriginFor } from './config/appOrigin';

export const triggerAINoteReview = onCall({
  cors: true,
  maxInstances: 10,
  timeoutSeconds: 60,
  memory: '256MiB'
}, async (request) => {
  try {
    const { noteId, entityType, tenantId, content, category, priority, tags } = request.data;

    if (!noteId || !entityType || !tenantId || !content) {
      throw new Error('Missing required parameters');
    }

    console.log(`🤖 Starting AI review for ${entityType} note: ${noteId}`);

    const db = admin.firestore();
    const noteRef = db.doc(`tenants/${tenantId}/${entityType}_notes/${noteId}`);

    // Idempotency + debounce: skip if already reviewed recently or processing
    const noteSnap = await noteRef.get();
    const data = noteSnap.exists ? noteSnap.data() as any : {};
    if (data?.aiReviewed === true) {
      return { success: true, skipped: true, reason: 'already_reviewed' };
    }
    if (data?._aiReviewProcessing === true && data?._aiReviewProcessingAt && (Date.now() - data._aiReviewProcessingAt.toMillis?.() || 0) < 60000) {
      return { success: true, skipped: true, reason: 'in_progress' };
    }

    // Mark processing (best-effort)
    await noteRef.set({
      _aiReviewProcessing: true,
      _aiReviewProcessingAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Generate AI insights based on note content and context
    const aiInsights = await generateAINoteInsights(content, category, priority, tags, entityType);

    // Update the note with AI insights
    await noteRef.update({
      aiReviewed: true,
      aiInsights: aiInsights,
      aiReviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      _aiReviewProcessing: false
    });

    console.log(`✅ AI review completed for note: ${noteId}`);

    return {
      success: true,
      message: 'AI review completed successfully',
      insights: aiInsights
    };

  } catch (error: any) {
    console.error('❌ Error in AI note review:', error);
    throw new Error(`AI review failed: ${error.message || 'Unknown error'}`);
  }
});

// HTTP wrapper (supports direct fetch with proper CORS)
export const triggerAINoteReviewHttp = onRequest({
  cors: true,
  maxInstances: 10,
  timeoutSeconds: 60,
  memory: '256MiB'
}, async (req, res) => {
  try {
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', corsOriginFor(req.headers.origin));
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.status(204).send('');
      return;
    }

    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { noteId, entityType, tenantId, content, category, priority, tags } = payload || {};

    if (!noteId || !entityType || !tenantId || !content) {
      res.set('Access-Control-Allow-Origin', corsOriginFor(req.headers.origin));
      res.set('Vary', 'Origin');
      res.status(400).json({
        success: false,
        message: 'Missing required parameters'
      });
      return;
    }

    console.log(`🤖 Starting AI review for ${entityType} note: ${noteId}`);

    const db = admin.firestore();
    const noteRef = db.doc(`tenants/${tenantId}/${entityType}_notes/${noteId}`);

    // Idempotency + debounce for HTTP path as well
    const snap = await noteRef.get();
    const d = snap.exists ? snap.data() as any : {};
    if (d?.aiReviewed === true) {
      res.set('Access-Control-Allow-Origin', corsOriginFor(req.headers.origin));
      res.set('Vary', 'Origin');
      res.status(200).json({ success: true, skipped: true, reason: 'already_reviewed' });
      return;
    }
    if (d?._aiReviewProcessing === true && d?._aiReviewProcessingAt && (Date.now() - d._aiReviewProcessingAt.toMillis?.() || 0) < 60000) {
      res.set('Access-Control-Allow-Origin', corsOriginFor(req.headers.origin));
      res.set('Vary', 'Origin');
      res.status(200).json({ success: true, skipped: true, reason: 'in_progress' });
      return;
    }
    await noteRef.set({
      _aiReviewProcessing: true,
      _aiReviewProcessingAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Generate AI insights based on note content and context
    const aiInsights = await generateAINoteInsights(content, category, priority, tags, entityType);

    // Update the note with AI insights
    await noteRef.update({
      aiReviewed: true,
      aiInsights: aiInsights,
      aiReviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      _aiReviewProcessing: false
    });

    console.log(`✅ AI review completed for note: ${noteId}`);

    const result = {
      success: true,
      message: 'AI review completed successfully',
      insights: aiInsights
    };

    res.set('Access-Control-Allow-Origin', corsOriginFor(req.headers.origin));
      res.set('Vary', 'Origin');
    res.status(200).json(result);

  } catch (error: any) {
    console.error('❌ Error in AI note review:', error);
    res.set('Access-Control-Allow-Origin', corsOriginFor(req.headers.origin));
      res.set('Vary', 'Origin');
    res.status(500).json({
      success: false,
      message: `AI review failed: ${error.message || 'Unknown error'}`
    });
  }
});

async function generateAINoteInsights(
  content: string, 
  category: string, 
  priority: string, 
  tags: string[], 
  entityType: string
): Promise<string> {
  try {
    // This is a simplified AI insight generation
    // In a real implementation, you would call an AI service like OpenAI, Claude, etc.
    
    const insights: string[] = [];
    
    // Analyze content sentiment and urgency
    const urgencyWords = ['urgent', 'asap', 'immediate', 'critical', 'emergency'];
    const positiveWords = ['great', 'excellent', 'good', 'positive', 'success'];
    const negativeWords = ['problem', 'issue', 'concern', 'difficult', 'challenge'];
    
    const contentLower = content.toLowerCase();
    const hasUrgency = urgencyWords.some(word => contentLower.includes(word));
    const hasPositive = positiveWords.some(word => contentLower.includes(word));
    const hasNegative = negativeWords.some(word => contentLower.includes(word));
    
    // Priority analysis
    if (priority === 'urgent' || hasUrgency) {
      insights.push('🔴 High urgency detected - immediate attention recommended');
    }
    
    // Sentiment analysis
    if (hasPositive && !hasNegative) {
      insights.push('✅ Positive sentiment detected - relationship appears strong');
    } else if (hasNegative && !hasPositive) {
      insights.push('⚠️ Negative sentiment detected - may require relationship management');
    }
    
    // Category-specific insights
    switch (category) {
      case 'sales':
        insights.push('💼 Sales activity noted - consider updating pipeline stage');
        break;
      case 'meeting':
        insights.push('📅 Meeting recorded - schedule follow-up if needed');
        break;
      case 'proposal':
        insights.push('📋 Proposal activity - track response timeline');
        break;
      case 'negotiation':
        insights.push('🤝 Negotiation in progress - monitor for decision signals');
        break;
      case 'closing':
        insights.push('🎯 Closing activity - high conversion potential');
        break;
    }
    
    // Tag-based insights
    if (tags.includes('Decision Maker')) {
      insights.push('👑 Decision maker involved - prioritize this relationship');
    }
    if (tags.includes('Objection')) {
      insights.push('🚫 Objection noted - prepare response strategy');
    }
    if (tags.includes('Competitor')) {
      insights.push('⚔️ Competitor mentioned - monitor competitive landscape');
    }
    if (tags.includes('Budget')) {
      insights.push('💰 Budget discussion - qualify financial capacity');
    }
    
    // Content length analysis
    if (content.length > 200) {
      insights.push('📝 Detailed note - contains valuable relationship context');
    }
    
    // Entity type specific insights
    if (entityType === 'contact') {
      insights.push('👤 Contact note - consider updating contact profile');
    } else if (entityType === 'company') {
      insights.push('🏢 Company note - may impact multiple opportunities');
    }
    
    // Action recommendations
    const recommendations: string[] = [];
    if (priority === 'high' || priority === 'urgent') {
      recommendations.push('Schedule immediate follow-up');
    }
    if (category === 'follow_up') {
      recommendations.push('Set reminder for follow-up action');
    }
    if (tags.includes('Proposal')) {
      recommendations.push('Track proposal response timeline');
    }
    
    if (recommendations.length > 0) {
      insights.push(`📋 Recommended actions: ${recommendations.join(', ')}`);
    }
    
    return insights.length > 0 ? insights.join('\n\n') : '📊 Note analyzed - no specific insights detected';
    
  } catch (error) {
    console.error('Error generating AI insights:', error);
    return '🤖 AI analysis completed - insights generation failed';
  }
} 