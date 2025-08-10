import { getFirestore } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logAIAction } from '../feedbackEngine';

const db = getFirestore();



// Reset Mode interfaces
interface ResetModeState {
  id: string;
  userId: string;
  customerId: string;
  agencyId?: string;
  regionId?: string;
  divisionId?: string;
  departmentId?: string;
  locationId?: string;
  isActive: boolean;
  activatedAt: Date;
  deactivatedAt?: Date;
  triggerType: 'manual' | 'ai_detected' | 'manager_suggested';
  triggerReason: string;
  duration: number; // days
  mindfulnessEnabled: boolean;
  ambientFeaturesEnabled: boolean;
  lastCheckIn?: Date;
  checkInCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface ResetModeTrigger {
  id: string;
  userId: string;
  customerId: string;
  agencyId?: string;
  regionId?: string;
  divisionId?: string;
  departmentId?: string;
  locationId?: string;
  triggerType: 'manual' | 'ai_detected' | 'manager_suggested';
  triggerReason: string;
  severity: 'low' | 'medium' | 'high';
  aiConfidence: number; // 0-1
  toneAnalysis?: {
    distressLevel: number; // 0-1
    emotionType: string;
    keywords: string[];
  };
  engagementMetrics?: {
    responseRate: number;
    averageResponseTime: number;
    interactionFrequency: number;
  };
  burnoutRiskScore?: number; // 0-1
  createdAt: Date;
  processed: boolean;
}

interface ResetModeCheckIn {
  id: string;
  userId: string;
  resetModeId: string;
  regionId?: string;
  divisionId?: string;
  departmentId?: string;
  locationId?: string;
  checkInType: 'daily' | 'wellness' | 'mindfulness';
  mood: number; // 1-10
  energy: number; // 1-10
  stress: number; // 1-10
  reflection?: string;
  suggestions?: string[];
  createdAt: Date;
}

/**
 * Activate Reset Mode for a user
 */
export const activateResetMode = onCall(async (request) => {
  const { userId, triggerType, triggerReason, duration = 2, mindfulnessEnabled = true, ambientFeaturesEnabled = true } = request.data;
  const adminUserId = request.auth?.uid || 'system';
  const start = Date.now();

  try {
    // Get user info
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }
    const userData = userDoc.data();
    const customerId = userData?.customerId;
    const agencyId = userData?.agencyId;
    
    // Get user's organizational data
    const regionId = userData?.regionId;
    const divisionId = userData?.divisionId;
    const departmentId = userData?.departmentId;
    const locationId = userData?.locationId;

    // Check if user is already in reset mode
    const existingReset = await db.collection('resetMode')
      .where('userId', '==', userId)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (!existingReset.empty) {
      throw new Error('User is already in reset mode');
    }

    // Create reset mode state
    const resetModeId = `reset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const resetMode: ResetModeState = {
      id: resetModeId,
      userId,
      customerId,
      agencyId,
      regionId,
      divisionId,
      departmentId,
      locationId,
      isActive: true,
      activatedAt: new Date(),
      triggerType,
      triggerReason,
      duration,
      mindfulnessEnabled,
      ambientFeaturesEnabled,
      checkInCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Save reset mode state
    await db.collection('resetMode').doc(resetModeId).set(resetMode);

    // Create trigger record
    const trigger: ResetModeTrigger = {
      id: `trigger_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      customerId,
      agencyId,
      regionId,
      divisionId,
      departmentId,
      locationId,
      triggerType,
      triggerReason,
      severity: triggerType === 'ai_detected' ? 'medium' : 'low',
      aiConfidence: triggerType === 'ai_detected' ? 0.8 : 1.0,
      createdAt: new Date(),
      processed: true
    };

    await db.collection('resetModeTriggers').doc(trigger.id).set(trigger);

    // Log AI action
    await logAIAction({
      userId: adminUserId,
      actionType: 'reset_mode_activated',
      sourceModule: 'ResetMode',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Reset mode activated for user ${userId} due to ${triggerType}: ${triggerReason}`,
      eventType: 'reset.activated',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'reset',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    // Send gentle activation message
    await sendResetModeActivationMessage(userId, resetMode);

    return {
      success: true,
      resetModeId,
      message: 'Reset mode activated successfully'
    };

  } catch (error: any) {
    await logAIAction({
      userId: adminUserId,
      actionType: 'reset_mode_activated',
      sourceModule: 'ResetMode',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to activate reset mode: ${error.message}`,
      eventType: 'reset.activation_failed',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'reset',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Deactivate Reset Mode for a user
 */
export const deactivateResetMode = onCall(async (request) => {
  const { userId, reason = 'manual_deactivation' } = request.data;
  const adminUserId = request.auth?.uid || 'system';
  const start = Date.now();

  try {
    // Find active reset mode
    const resetModeSnapshot = await db.collection('resetMode')
      .where('userId', '==', userId)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (resetModeSnapshot.empty) {
      throw new Error('No active reset mode found for user');
    }

    const resetModeDoc = resetModeSnapshot.docs[0];
    const resetMode = resetModeDoc.data() as ResetModeState;

    // Update reset mode state
    await db.collection('resetMode').doc(resetMode.id).update({
      isActive: false,
      deactivatedAt: new Date(),
      updatedAt: new Date()
    });

    // Log AI action
    await logAIAction({
      userId: adminUserId,
      actionType: 'reset_mode_deactivated',
      sourceModule: 'ResetMode',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Reset mode deactivated for user ${userId}: ${reason}`,
      eventType: 'reset.deactivated',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'reset',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    // Send deactivation message
    await sendResetModeDeactivationMessage(userId, resetMode);

    return {
      success: true,
      message: 'Reset mode deactivated successfully'
    };

  } catch (error: any) {
    await logAIAction({
      userId: adminUserId,
      actionType: 'reset_mode_deactivated',
      sourceModule: 'ResetMode',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to deactivate reset mode: ${error.message}`,
      eventType: 'reset.deactivation_failed',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'reset',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Submit a check-in during reset mode
 */
export const submitResetModeCheckIn = onCall(async (request) => {
  const { userId, mood, energy, stress, reflection, checkInType = 'daily' } = request.data;
  const start = Date.now();

  try {
    // Find active reset mode
    const resetModeSnapshot = await db.collection('resetMode')
      .where('userId', '==', userId)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (resetModeSnapshot.empty) {
      throw new Error('No active reset mode found for user');
    }

    const resetMode = resetModeSnapshot.docs[0].data() as ResetModeState;

    // Create check-in with organizational data
    const checkInId = `checkin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const checkIn: ResetModeCheckIn = {
      id: checkInId,
      userId,
      resetModeId: resetMode.id,
      ...(resetMode.regionId ? { regionId: resetMode.regionId } : {}),
      ...(resetMode.divisionId ? { divisionId: resetMode.divisionId } : {}),
      ...(resetMode.departmentId ? { departmentId: resetMode.departmentId } : {}),
      ...(resetMode.locationId ? { locationId: resetMode.locationId } : {}),
      checkInType,
      mood,
      energy,
      stress,
      reflection,
      suggestions: generateCheckInSuggestions(mood, energy, stress),
      createdAt: new Date()
    };

    await db.collection('resetModeCheckIns').doc(checkInId).set(checkIn);

    // Update reset mode with check-in info
    await db.collection('resetMode').doc(resetMode.id).update({
      lastCheckIn: new Date(),
      checkInCount: resetMode.checkInCount + 1,
      updatedAt: new Date()
    });

    // Log AI action
    await logAIAction({
      userId,
      actionType: 'reset_mode_checkin',
      sourceModule: 'ResetMode',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Reset mode check-in submitted: mood=${mood}, energy=${energy}, stress=${stress}`,
      eventType: 'reset.checkin',
      targetType: 'reset_mode',
      targetId: resetMode.id,
      aiRelevant: true,
      contextType: 'reset',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return {
      success: true,
      checkInId,
      suggestions: checkIn.suggestions
    };

  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'reset_mode_checkin',
      sourceModule: 'ResetMode',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to submit reset mode check-in: ${error.message}`,
      eventType: 'reset.checkin_failed',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'reset',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Get reset mode dashboard data for HR/Admin
 */
export const getResetModeDashboard = onCall(async (request) => {
  const { customerId, agencyId, regionId, divisionId, departmentId, locationId, timeRange = 30 } = request.data; // days
  const adminUserId = request.auth?.uid || 'system';
  const start = Date.now();

  try {
    const startDate = new Date(Date.now() - timeRange * 24 * 60 * 60 * 1000);

    // Get active reset modes with organizational filtering
    let activeResetQuery = db.collection('resetMode')
      .where('customerId', '==', customerId)
      .where('isActive', '==', true);

    if (agencyId) {
      activeResetQuery = activeResetQuery.where('agencyId', '==', agencyId);
    }
    if (regionId) {
      activeResetQuery = activeResetQuery.where('regionId', '==', regionId);
    }
    if (divisionId) {
      activeResetQuery = activeResetQuery.where('divisionId', '==', divisionId);
    }
    if (departmentId) {
      activeResetQuery = activeResetQuery.where('departmentId', '==', departmentId);
    }
    if (locationId) {
      activeResetQuery = activeResetQuery.where('locationId', '==', locationId);
    }

    const activeResetSnapshot = await activeResetQuery.get();

    // Get recent triggers with organizational filtering
    let triggersQuery = db.collection('resetModeTriggers')
      .where('customerId', '==', customerId)
      .where('createdAt', '>=', startDate);

    if (agencyId) {
      triggersQuery = triggersQuery.where('agencyId', '==', agencyId);
    }
    if (regionId) {
      triggersQuery = triggersQuery.where('regionId', '==', regionId);
    }
    if (divisionId) {
      triggersQuery = triggersQuery.where('divisionId', '==', divisionId);
    }
    if (departmentId) {
      triggersQuery = triggersQuery.where('departmentId', '==', departmentId);
    }
    if (locationId) {
      triggersQuery = triggersQuery.where('locationId', '==', locationId);
    }

    const triggersSnapshot = await triggersQuery.get();

    // Get check-ins
    const checkInsQuery = db.collection('resetModeCheckIns')
      .where('createdAt', '>=', startDate);

    const checkInsSnapshot = await checkInsQuery.get();

    // Process data
    const activeResets = activeResetSnapshot.docs.map(doc => doc.data());
    const triggers = triggersSnapshot.docs.map(doc => doc.data());
    const checkIns = checkInsSnapshot.docs.map(doc => doc.data());

    // Calculate metrics
    const metrics = {
      activeResets: activeResets.length,
      totalTriggers: triggers.length,
      triggerTypes: {
        manual: triggers.filter(t => t.triggerType === 'manual').length,
        ai_detected: triggers.filter(t => t.triggerType === 'ai_detected').length,
        manager_suggested: triggers.filter(t => t.triggerType === 'manager_suggested').length
      },
      averageDuration: activeResets.length > 0 
        ? activeResets.reduce((sum, r) => sum + r.duration, 0) / activeResets.length 
        : 0,
      totalCheckIns: checkIns.length,
      averageMood: checkIns.length > 0 
        ? checkIns.reduce((sum, c) => sum + c.mood, 0) / checkIns.length 
        : 0,
      averageEnergy: checkIns.length > 0 
        ? checkIns.reduce((sum, c) => sum + c.energy, 0) / checkIns.length 
        : 0,
      averageStress: checkIns.length > 0 
        ? checkIns.reduce((sum, c) => sum + c.stress, 0) / checkIns.length 
        : 0
    };

    // Identify patterns
    const patterns = analyzeResetPatterns(triggers, checkIns);

    // Calculate organizational breakdown
    const organizationalBreakdown = {
      byRegion: calculateOrganizationalBreakdown(triggers, 'regionId'),
      byDivision: calculateOrganizationalBreakdown(triggers, 'divisionId'),
      byDepartment: calculateOrganizationalBreakdown(triggers, 'departmentId'),
      byLocation: calculateOrganizationalBreakdown(triggers, 'locationId')
    };

    // Log AI action
    await logAIAction({
      userId: adminUserId,
      actionType: 'reset_mode_dashboard_viewed',
      sourceModule: 'ResetMode',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Reset mode dashboard viewed for customer ${customerId}`,
      eventType: 'reset.dashboard_viewed',
      targetType: 'customer',
      targetId: customerId,
      aiRelevant: true,
      contextType: 'reset',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return {
      success: true,
      metrics,
      patterns,
      organizationalBreakdown,
      activeResets: activeResets.map(r => ({
        userId: r.userId,
        activatedAt: r.activatedAt,
        triggerType: r.triggerType,
        duration: r.duration,
        checkInCount: r.checkInCount
      }))
    };

  } catch (error: any) {
    await logAIAction({
      userId: adminUserId,
      actionType: 'reset_mode_dashboard_viewed',
      sourceModule: 'ResetMode',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to load reset mode dashboard: ${error.message}`,
      eventType: 'reset.dashboard_failed',
      targetType: 'customer',
      targetId: customerId,
      aiRelevant: true,
      contextType: 'reset',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * AI-detected reset mode trigger
 */
export const detectResetModeTrigger = onCall(async (request) => {
  const { userId, toneAnalysis, engagementMetrics, burnoutRiskScore } = request.data;
  const start = Date.now();

  try {
    // Get user info
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }
    const userData = userDoc.data();
    const customerId = userData?.customerId;
    const agencyId = userData?.agencyId;
    
    // Get user's organizational data
    const regionId = userData?.regionId;
    const divisionId = userData?.divisionId;
    const departmentId = userData?.departmentId;
    const locationId = userData?.locationId;

    // Check if user is already in reset mode
    const existingReset = await db.collection('resetMode')
      .where('userId', '==', userId)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (!existingReset.empty) {
      return { success: true, message: 'User already in reset mode' };
    }

    // Determine trigger severity
    const severity = determineTriggerSeverity(toneAnalysis, engagementMetrics, burnoutRiskScore);
    
    // Only trigger if severity is medium or high
    if (severity === 'low') {
      return { success: true, message: 'No reset mode trigger needed' };
    }

    // Create trigger record
    const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const trigger: ResetModeTrigger = {
      id: triggerId,
      userId,
      customerId,
      agencyId,
      regionId,
      divisionId,
      departmentId,
      locationId,
      triggerType: 'ai_detected',
      triggerReason: generateTriggerReason(toneAnalysis, engagementMetrics, burnoutRiskScore),
      severity,
      aiConfidence: calculateAIConfidence(toneAnalysis, engagementMetrics, burnoutRiskScore),
      toneAnalysis,
      engagementMetrics,
      burnoutRiskScore,
      createdAt: new Date(),
      processed: false
    };

    await db.collection('resetModeTriggers').doc(triggerId).set(trigger);

    // Log AI action
    await logAIAction({
      userId,
      actionType: 'reset_mode_trigger_detected',
      sourceModule: 'ResetMode',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `AI detected reset mode trigger: ${trigger.triggerReason}`,
      eventType: 'reset.trigger_detected',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'reset',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return {
      success: true,
      triggerId,
      severity,
      triggerReason: trigger.triggerReason
    };

  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'reset_mode_trigger_detected',
      sourceModule: 'ResetMode',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to detect reset mode trigger: ${error.message}`,
      eventType: 'reset.trigger_failed',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'reset',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Scheduled function to check for reset mode expiration
 */
export const checkResetModeExpiration = onSchedule({
  schedule: '0 */6 * * *', // Every 6 hours
  timeZone: 'America/New_York'
}, async (event) => {
  const start = Date.now();
  
  try {
    const now = new Date();
    
    // Find expired reset modes
    const expiredResetsSnapshot = await db.collection('resetMode')
      .where('isActive', '==', true)
      .get();

    const expiredResets = expiredResetsSnapshot.docs.filter(doc => {
      const reset = doc.data() as ResetModeState;
      const expirationDate = new Date(reset.activatedAt.getTime() + reset.duration * 24 * 60 * 60 * 1000);
      return now >= expirationDate;
    });

    // Deactivate expired resets
    for (const doc of expiredResets) {
      const reset = doc.data() as ResetModeState;
      
      await db.collection('resetMode').doc(reset.id).update({
        isActive: false,
        deactivatedAt: now,
        updatedAt: now
      });

      // Send expiration message
      await sendResetModeExpirationMessage(reset.userId, reset);

      // Log AI action
      await logAIAction({
        userId: 'system',
        actionType: 'reset_mode_expired',
        sourceModule: 'ResetMode',
        success: true,
        latencyMs: Date.now() - start,
        versionTag: 'v1',
        reason: `Reset mode expired for user ${reset.userId}`,
        eventType: 'reset.expired',
        targetType: 'user',
        targetId: reset.userId,
        aiRelevant: true,
        contextType: 'reset',
        traitsAffected: null,
        aiTags: null,
        urgencyScore: null
      });
    }

    console.log(`Reset mode expiration check completed: ${expiredResets.length} resets expired`);

  } catch (error: any) {
    console.error('Reset mode expiration check failed:', error);
    
    await logAIAction({
      userId: 'system',
      actionType: 'reset_mode_expiration_check',
      sourceModule: 'ResetMode',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Reset mode expiration check failed: ${error.message}`,
      eventType: 'reset.expiration_check_failed',
      targetType: 'system',
      targetId: 'expiration_check',
      aiRelevant: true,
      contextType: 'reset',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
  }
});

// Helper functions
function generateCheckInSuggestions(mood: number, energy: number, stress: number): string[] {
  const suggestions = [];

  if (mood < 5) {
    suggestions.push('Consider taking a short walk outside');
    suggestions.push('Try a 5-minute breathing exercise');
  }

  if (energy < 5) {
    suggestions.push('Take a 10-minute break to recharge');
    suggestions.push('Consider a light snack or hydration');
  }

  if (stress > 7) {
    suggestions.push('Practice progressive muscle relaxation');
    suggestions.push('Consider talking to a trusted colleague');
  }

  if (suggestions.length === 0) {
    suggestions.push('You\'re doing great! Keep up the positive momentum');
  }

  return suggestions;
}

function determineTriggerSeverity(toneAnalysis: any, engagementMetrics: any, burnoutRiskScore: number): 'low' | 'medium' | 'high' {
  let score = 0;

  if (toneAnalysis?.distressLevel > 0.7) score += 3;
  else if (toneAnalysis?.distressLevel > 0.4) score += 2;

  if (engagementMetrics?.responseRate < 0.3) score += 2;
  else if (engagementMetrics?.responseRate < 0.6) score += 1;

  if (burnoutRiskScore > 0.8) score += 3;
  else if (burnoutRiskScore > 0.5) score += 2;

  if (score >= 6) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

function generateTriggerReason(toneAnalysis: any, engagementMetrics: any, burnoutRiskScore: number): string {
  const reasons = [];

  if (toneAnalysis?.distressLevel > 0.7) {
    reasons.push('high distress detected in communication');
  }

  if (engagementMetrics?.responseRate < 0.3) {
    reasons.push('low engagement and response rate');
  }

  if (burnoutRiskScore > 0.8) {
    reasons.push('elevated burnout risk score');
  }

  return reasons.join(', ');
}

function calculateAIConfidence(toneAnalysis: any, engagementMetrics: any, burnoutRiskScore: number): number {
  let confidence = 0.5; // Base confidence

  if (toneAnalysis?.distressLevel > 0.7) confidence += 0.2;
  if (engagementMetrics?.responseRate < 0.3) confidence += 0.2;
  if (burnoutRiskScore > 0.8) confidence += 0.2;

  return Math.min(confidence, 1.0);
}

function analyzeResetPatterns(triggers: any[], checkIns: any[]): any {
  const patterns = {
    frequentResets: triggers.filter(t => {
      // Check if user has 3+ resets in last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const userTriggers = triggers.filter(ut => ut.userId === t.userId && ut.createdAt.toDate() >= thirtyDaysAgo);
      return userTriggers.length >= 3;
    }).length,
    improvingTrends: checkIns.filter(c => c.mood > 7 && c.stress < 4).length,
    concerningTrends: checkIns.filter(c => c.mood < 4 && c.stress > 7).length
  };

  return patterns;
}

async function sendResetModeActivationMessage(userId: string, resetMode: ResetModeState): Promise<void> {
  // This would integrate with your notification system
  console.log(`Sending reset mode activation message to user ${userId}`);
}

async function sendResetModeDeactivationMessage(userId: string, resetMode: ResetModeState): Promise<void> {
  // This would integrate with your notification system
  console.log(`Sending reset mode deactivation message to user ${userId}`);
}

async function sendResetModeExpirationMessage(userId: string, resetMode: ResetModeState): Promise<void> {
  // This would integrate with your notification system
  console.log(`Sending reset mode expiration message to user ${userId}`);
}

/**
 * Calculate organizational breakdown for reset mode analytics
 */
function calculateOrganizationalBreakdown(data: any[], field: string): any[] {
  const breakdown = new Map<string, { count: number; severity: { low: number; medium: number; high: number } }>();
  
  data.forEach(item => {
    const value = item[field] || 'Unknown';
    if (!breakdown.has(value)) {
      breakdown.set(value, { count: 0, severity: { low: 0, medium: 0, high: 0 } });
    }
    
    const entry = breakdown.get(value)!;
    entry.count++;
    
    if (item.severity) {
      entry.severity[item.severity as keyof typeof entry.severity]++;
    }
  });
  
  return Array.from(breakdown.entries()).map(([name, stats]) => ({
    name,
    count: stats.count,
    severity: stats.severity,
    percentage: (stats.count / data.length) * 100
  }));
} 