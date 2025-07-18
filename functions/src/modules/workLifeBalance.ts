import { getFirestore } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logAIAction } from '../feedbackEngine';

const db = getFirestore();

// Work-Life Balance interfaces
interface BalanceCheckIn {
  id: string;
  userId: string;
  customerId: string;
  agencyId?: string;
  regionId?: string;
  divisionId?: string;
  departmentId?: string;
  locationId?: string;
  checkInType: 'weekly_balance' | 'wellbeing_reflection' | 'burnout_assessment';
  balanceScore: number; // 0-100
  sleep: number; // 1-10
  stress: number; // 1-10
  energy: number; // 1-10
  familyTime: number; // 1-10
  personalTime: number; // 1-10
  health: number; // 1-10
  reflection?: string;
  aiInsights?: string[];
  aiSuggestions?: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface BurnoutRiskIndex {
  id: string;
  userId: string;
  customerId: string;
  agencyId?: string;
  regionId?: string;
  divisionId?: string;
  departmentId?: string;
  locationId?: string;
  period: 'weekly' | 'monthly';
  startDate: Date;
  endDate: Date;
  compositeScore: number; // 0-100, higher = higher risk
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  contributingFactors: string[];
  checkInScore: number; // 0-100
  chatToneScore: number; // 0-100
  jsiDropScore: number; // 0-100
  resetModeScore: number; // 0-100
  recommendations: string[];
  createdAt: Date;
}

interface WellbeingReflection {
  id: string;
  userId: string;
  customerId: string;
  agencyId?: string;
  regionId?: string;
  divisionId?: string;
  departmentId?: string;
  locationId?: string;
  topic: 'sleep' | 'stress' | 'energy' | 'family' | 'personal' | 'health';
  question: string;
  response: string;
  mood: number; // 1-10
  energy: number; // 1-10
  stress: number; // 1-10
  aiAnalysis?: string;
  aiSuggestions?: string[];
  createdAt: Date;
}

// BalanceTrends interface removed as it's not used

interface BalanceAlert {
  id: string;
  userId: string;
  customerId: string;
  agencyId?: string;
  regionId?: string;
  divisionId?: string;
  departmentId?: string;
  locationId?: string;
  alertType: 'low_balance' | 'high_stress' | 'burnout_risk' | 'sleep_concern' | 'family_time_low';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  triggerValue: number;
  threshold: number;
  recommendations: string[];
  acknowledged: boolean;
  acknowledgedAt?: Date;
  createdAt: Date;
}

/**
 * Submit a weekly balance check-in
 */
export const submitBalanceCheckIn = onCall(async (request) => {
  const { balanceScore, sleep, stress, energy, familyTime, personalTime, health, reflection } = request.data;
  const userId = request.auth?.uid || 'unknown';
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

    // Generate AI insights and suggestions
    const aiInsights = await generateBalanceInsights(balanceScore, sleep, stress, energy, familyTime, personalTime, health);
    const aiSuggestions = await generateBalanceSuggestions(balanceScore, sleep, stress, energy, familyTime, personalTime, health);

    // Create check-in
    const checkInId = `checkin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const checkIn: BalanceCheckIn = {
      id: checkInId,
      userId,
      customerId,
      agencyId,
      regionId,
      divisionId,
      departmentId,
      locationId,
      checkInType: 'weekly_balance',
      balanceScore,
      sleep,
      stress,
      energy,
      familyTime,
      personalTime,
      health,
      reflection,
      aiInsights,
      aiSuggestions,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('balanceCheckIns').doc(checkInId).set(checkIn);

    // Check for alerts
    await checkForBalanceAlerts(userId, checkIn);

    // Update balance trends
    await updateBalanceTrends(userId, checkIn);

    // Log AI action
    await logAIAction({
      userId,
      actionType: 'balance_checkin_submitted',
      sourceModule: 'WorkLifeBalance',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Balance check-in submitted with score ${balanceScore}`,
      eventType: 'balance.checkin_submitted',
      targetType: 'balance_checkin',
      targetId: checkInId,
      aiRelevant: true,
      contextType: 'balance',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return {
      success: true,
      checkInId,
      aiInsights,
      aiSuggestions
    };

  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'balance_checkin_submitted',
      sourceModule: 'WorkLifeBalance',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to submit balance check-in: ${error.message}`,
      eventType: 'balance.checkin_failed',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'balance',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Submit a wellbeing reflection
 */
export const submitWellbeingReflection = onCall(async (request) => {
  const { topic, question, response, mood, energy, stress } = request.data;
  const userId = request.auth?.uid || 'unknown';
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

    // Generate AI analysis and suggestions
    const aiAnalysis = await analyzeWellbeingResponse(topic, response, mood, energy, stress);
    const aiSuggestions = await generateWellbeingSuggestions(topic, response, mood, energy, stress);

    // Create reflection
    const reflectionId = `reflection_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const reflection: WellbeingReflection = {
      id: reflectionId,
      userId,
      customerId,
      agencyId,
      topic,
      question,
      response,
      mood,
      energy,
      stress,
      aiAnalysis,
      aiSuggestions,
      createdAt: new Date()
    };

    await db.collection('wellbeingReflections').doc(reflectionId).set(reflection);

    // Log AI action
    await logAIAction({
      userId,
      actionType: 'wellbeing_reflection_submitted',
      sourceModule: 'WorkLifeBalance',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Wellbeing reflection submitted for topic: ${topic}`,
      eventType: 'balance.reflection_submitted',
      targetType: 'wellbeing_reflection',
      targetId: reflectionId,
      aiRelevant: true,
      contextType: 'balance',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return {
      success: true,
      reflectionId,
      aiAnalysis,
      aiSuggestions
    };

  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'wellbeing_reflection_submitted',
      sourceModule: 'WorkLifeBalance',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to submit wellbeing reflection: ${error.message}`,
      eventType: 'balance.reflection_failed',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'balance',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Calculate burnout risk index
 */
export const calculateBurnoutRiskIndex = onCall(async (request) => {
  const { userId, period = 'weekly' } = request.data;
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

    // Calculate period dates
    const endDate = new Date();
    const startDate = new Date();
    if (period === 'weekly') {
      startDate.setDate(endDate.getDate() - 7);
    } else if (period === 'monthly') {
      startDate.setMonth(endDate.getMonth() - 1);
    }

    // Get recent check-ins
    const checkInsSnapshot = await db.collection('balanceCheckIns')
      .where('userId', '==', userId)
      .where('createdAt', '>=', startDate)
      .get();

    const checkIns = checkInsSnapshot.docs.map(doc => doc.data());

    // Get recent chat tone analysis
    const chatToneScore = await getChatToneScore(userId, startDate, endDate);

    // Get JSI drops
    const jsiDropScore = await getJSIDropScore(userId, startDate, endDate);

    // Get reset mode triggers
    const resetModeScore = await getResetModeScore(userId, startDate, endDate);

    // Calculate composite score
    const checkInScore = checkIns.length > 0 
      ? checkIns.reduce((sum, c) => sum + c.balanceScore, 0) / checkIns.length 
      : 50;

    const compositeScore = calculateCompositeBurnoutScore(checkInScore, chatToneScore, jsiDropScore, resetModeScore);
    const riskLevel = determineBurnoutRiskLevel(compositeScore);
    const contributingFactors = identifyContributingFactors(checkInScore, chatToneScore, jsiDropScore, resetModeScore);
    const recommendations = generateBurnoutRecommendations(riskLevel, contributingFactors);

    // Create burnout risk index
    const riskIndexId = `burnout_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const riskIndex: BurnoutRiskIndex = {
      id: riskIndexId,
      userId,
      customerId,
      agencyId,
      period,
      startDate,
      endDate,
      compositeScore,
      riskLevel,
      contributingFactors,
      checkInScore,
      chatToneScore,
      jsiDropScore,
      resetModeScore,
      recommendations,
      createdAt: new Date()
    };

    await db.collection('burnoutRiskIndex').doc(riskIndexId).set(riskIndex);

    // Log AI action
    await logAIAction({
      userId,
      actionType: 'burnout_risk_calculated',
      sourceModule: 'WorkLifeBalance',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Burnout risk calculated: ${riskLevel} (${compositeScore})`,
      eventType: 'balance.burnout_risk_calculated',
      targetType: 'burnout_risk_index',
      targetId: riskIndexId,
      aiRelevant: true,
      contextType: 'balance',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return {
      success: true,
      riskIndexId,
      riskIndex
    };

  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'burnout_risk_calculated',
      sourceModule: 'WorkLifeBalance',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to calculate burnout risk: ${error.message}`,
      eventType: 'balance.burnout_risk_failed',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'balance',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Get user's balance dashboard
 */
export const getUserBalanceDashboard = onCall(async (request) => {
  const userId = request.auth?.uid || 'unknown';
  const start = Date.now();

  try {
    // Get recent check-ins
    const checkInsSnapshot = await db.collection('balanceCheckIns')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const checkIns = checkInsSnapshot.docs.map(doc => doc.data());

    // Get recent reflections
    const reflectionsSnapshot = await db.collection('wellbeingReflections')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();

    const reflections = reflectionsSnapshot.docs.map(doc => doc.data());

    // Get latest burnout risk index
    const riskIndexSnapshot = await db.collection('burnoutRiskIndex')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    const latestRiskIndex = riskIndexSnapshot.empty ? null : riskIndexSnapshot.docs[0].data();

    // Get balance trends
    const trendsSnapshot = await db.collection('balanceTrends')
      .where('userId', '==', userId)
      .orderBy('endDate', 'desc')
      .limit(1)
      .get();

    const latestTrends = trendsSnapshot.empty ? null : trendsSnapshot.docs[0].data();

    // Get active alerts
    const alertsSnapshot = await db.collection('balanceAlerts')
      .where('userId', '==', userId)
      .where('acknowledged', '==', false)
      .orderBy('createdAt', 'desc')
      .get();

    const activeAlerts = alertsSnapshot.docs.map(doc => doc.data());

    // Calculate current stats
    const stats = {
      averageBalanceScore: checkIns.length > 0 
        ? checkIns.reduce((sum, c) => sum + c.balanceScore, 0) / checkIns.length 
        : 0,
      averageSleep: checkIns.length > 0 
        ? checkIns.reduce((sum, c) => sum + c.sleep, 0) / checkIns.length 
        : 0,
      averageStress: checkIns.length > 0 
        ? checkIns.reduce((sum, c) => sum + c.stress, 0) / checkIns.length 
        : 0,
      averageEnergy: checkIns.length > 0 
        ? checkIns.reduce((sum, c) => sum + c.energy, 0) / checkIns.length 
        : 0,
      totalCheckIns: checkIns.length,
      totalReflections: reflections.length,
      activeAlerts: activeAlerts.length
    };

    // Log AI action
    await logAIAction({
      userId,
      actionType: 'balance_dashboard_viewed',
      sourceModule: 'WorkLifeBalance',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Balance dashboard viewed`,
      eventType: 'balance.dashboard_viewed',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'balance',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return {
      success: true,
      checkIns,
      reflections,
      latestRiskIndex,
      latestTrends,
      activeAlerts,
      stats
    };

  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'balance_dashboard_viewed',
      sourceModule: 'WorkLifeBalance',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to load balance dashboard: ${error.message}`,
      eventType: 'balance.dashboard_failed',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'balance',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Get admin balance dashboard
 */
export const getAdminBalanceDashboard = onCall(async (request) => {
  const { customerId, agencyId, regionId, divisionId, departmentId, locationId, timeRange = 30 } = request.data; // days
  const adminUserId = request.auth?.uid || 'system';
  const start = Date.now();

  try {
    const startDate = new Date(Date.now() - timeRange * 24 * 60 * 60 * 1000);

    // Get check-ins with organizational filtering
    let checkInsQuery = db.collection('balanceCheckIns')
      .where('customerId', '==', customerId)
      .where('createdAt', '>=', startDate);

    if (agencyId) {
      checkInsQuery = checkInsQuery.where('agencyId', '==', agencyId);
    }
    if (regionId) {
      checkInsQuery = checkInsQuery.where('regionId', '==', regionId);
    }
    if (divisionId) {
      checkInsQuery = checkInsQuery.where('divisionId', '==', divisionId);
    }
    if (departmentId) {
      checkInsQuery = checkInsQuery.where('departmentId', '==', departmentId);
    }
    if (locationId) {
      checkInsQuery = checkInsQuery.where('locationId', '==', locationId);
    }

    const checkInsSnapshot = await checkInsQuery.get();
    const checkIns = checkInsSnapshot.docs.map(doc => doc.data());

    // Get burnout risk indices with organizational filtering
    let riskQuery = db.collection('burnoutRiskIndex')
      .where('customerId', '==', customerId)
      .where('createdAt', '>=', startDate);

    if (agencyId) {
      riskQuery = riskQuery.where('agencyId', '==', agencyId);
    }
    if (regionId) {
      riskQuery = riskQuery.where('regionId', '==', regionId);
    }
    if (divisionId) {
      riskQuery = riskQuery.where('divisionId', '==', divisionId);
    }
    if (departmentId) {
      riskQuery = riskQuery.where('departmentId', '==', departmentId);
    }
    if (locationId) {
      riskQuery = riskQuery.where('locationId', '==', locationId);
    }

    const riskSnapshot = await riskQuery.get();
    const riskIndices = riskSnapshot.docs.map(doc => doc.data());

    // Get alerts with organizational filtering
    let alertsQuery = db.collection('balanceAlerts')
      .where('customerId', '==', customerId)
      .where('createdAt', '>=', startDate);

    if (agencyId) {
      alertsQuery = alertsQuery.where('agencyId', '==', agencyId);
    }
    if (regionId) {
      alertsQuery = alertsQuery.where('regionId', '==', regionId);
    }
    if (divisionId) {
      alertsQuery = alertsQuery.where('divisionId', '==', divisionId);
    }
    if (departmentId) {
      alertsQuery = alertsQuery.where('departmentId', '==', departmentId);
    }
    if (locationId) {
      alertsQuery = alertsQuery.where('locationId', '==', locationId);
    }

    const alertsSnapshot = await alertsQuery.get();
    const alerts = alertsSnapshot.docs.map(doc => doc.data());

    // Calculate aggregate metrics
    const aggregateMetrics = {
      totalCheckIns: checkIns.length,
      averageBalanceScore: checkIns.length > 0 
        ? checkIns.reduce((sum, c) => sum + c.balanceScore, 0) / checkIns.length 
        : 0,
      averageSleep: checkIns.length > 0 
        ? checkIns.reduce((sum, c) => sum + c.sleep, 0) / checkIns.length 
        : 0,
      averageStress: checkIns.length > 0 
        ? checkIns.reduce((sum, c) => sum + c.stress, 0) / checkIns.length 
        : 0,
      averageEnergy: checkIns.length > 0 
        ? checkIns.reduce((sum, c) => sum + c.energy, 0) / checkIns.length 
        : 0,
      highBurnoutRisk: riskIndices.filter(r => r.riskLevel === 'high' || r.riskLevel === 'critical').length,
      totalAlerts: alerts.length,
      unacknowledgedAlerts: alerts.filter(a => !a.acknowledged).length
    };

    // Identify risk patterns
    const riskPatterns = identifyRiskPatterns(checkIns, riskIndices, alerts);

    // Calculate organizational breakdown
    const organizationalBreakdown = {
      byRegion: calculateBalanceBreakdown(checkIns, riskIndices, 'regionId'),
      byDivision: calculateBalanceBreakdown(checkIns, riskIndices, 'divisionId'),
      byDepartment: calculateBalanceBreakdown(checkIns, riskIndices, 'departmentId'),
      byLocation: calculateBalanceBreakdown(checkIns, riskIndices, 'locationId')
    };

    // Log AI action
    await logAIAction({
      userId: adminUserId,
      actionType: 'admin_balance_dashboard_viewed',
      sourceModule: 'WorkLifeBalance',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Admin balance dashboard viewed for customer ${customerId}`,
      eventType: 'balance.admin_dashboard_viewed',
      targetType: 'customer',
      targetId: customerId,
      aiRelevant: true,
      contextType: 'balance',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return {
      success: true,
      aggregateMetrics,
      riskPatterns,
      organizationalBreakdown
    };

  } catch (error: any) {
    await logAIAction({
      userId: adminUserId,
      actionType: 'admin_balance_dashboard_viewed',
      sourceModule: 'WorkLifeBalance',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to load admin balance dashboard: ${error.message}`,
      eventType: 'balance.admin_dashboard_failed',
      targetType: 'customer',
      targetId: customerId,
      aiRelevant: true,
      contextType: 'balance',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Acknowledge a balance alert
 */
export const acknowledgeBalanceAlert = onCall(async (request) => {
  const { alertId } = request.data;
  const userId = request.auth?.uid || 'unknown';
  const start = Date.now();

  try {
    const alertDoc = await db.collection('balanceAlerts').doc(alertId).get();
    if (!alertDoc.exists) {
      throw new Error('Balance alert not found');
    }

    const alert = alertDoc.data() as BalanceAlert;
    if (alert.userId !== userId) {
      throw new Error('Unauthorized access to balance alert');
    }

    // Update alert
    await db.collection('balanceAlerts').doc(alertId).update({
      acknowledged: true,
      acknowledgedAt: new Date()
    });

    // Log AI action
    await logAIAction({
      userId,
      actionType: 'balance_alert_acknowledged',
      sourceModule: 'WorkLifeBalance',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Balance alert acknowledged: ${alert.alertType}`,
      eventType: 'balance.alert_acknowledged',
      targetType: 'balance_alert',
      targetId: alertId,
      aiRelevant: true,
      contextType: 'balance',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return { success: true };

  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'balance_alert_acknowledged',
      sourceModule: 'WorkLifeBalance',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to acknowledge balance alert: ${error.message}`,
      eventType: 'balance.alert_acknowledge_failed',
      targetType: 'balance_alert',
      targetId: alertId,
      aiRelevant: true,
      contextType: 'balance',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Scheduled function to send weekly balance check-ins
 */
export const sendWeeklyBalanceCheckIns = onSchedule({
  schedule: '0 9 * * 1', // Every Monday at 9 AM
  timeZone: 'America/New_York'
}, async (event) => {
  const start = Date.now();
  
  try {
    // Get all active users
    const usersSnapshot = await db.collection('users')
      .where('isActive', '==', true)
      .get();

    let sentCount = 0;
    let errorCount = 0;

    for (const userDoc of usersSnapshot.docs) {
      try {
        const userId = userDoc.id;
        const userData = userDoc.data();

        // Check if user should receive balance check-in
        const shouldReceiveCheckIn = await checkUserEligibilityForBalanceCheckIn(userId, userData);
        
        if (shouldReceiveCheckIn) {
          await sendBalanceCheckInPrompt(userId, userData);
          sentCount++;
        }
      } catch (error) {
        console.error(`Failed to send balance check-in to user ${userDoc.id}:`, error);
        errorCount++;
      }
    }

    console.log(`Weekly balance check-ins completed: ${sentCount} sent, ${errorCount} errors`);

    // Log AI action
    await logAIAction({
      userId: 'system',
      actionType: 'weekly_balance_checkins_sent',
      sourceModule: 'WorkLifeBalance',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Weekly balance check-ins sent: ${sentCount} successful, ${errorCount} failed`,
      eventType: 'balance.weekly_checkins',
      targetType: 'system',
      targetId: 'weekly_checkins',
      aiRelevant: true,
      contextType: 'balance',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

  } catch (error: any) {
    console.error('Weekly balance check-ins failed:', error);
    
    await logAIAction({
      userId: 'system',
      actionType: 'weekly_balance_checkins_sent',
      sourceModule: 'WorkLifeBalance',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Weekly balance check-ins failed: ${error.message}`,
      eventType: 'balance.weekly_checkins_failed',
      targetType: 'system',
      targetId: 'weekly_checkins',
      aiRelevant: true,
      contextType: 'balance',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
  }
});

// Helper functions
async function generateBalanceInsights(balanceScore: number, sleep: number, stress: number, energy: number, familyTime: number, personalTime: number, health: number): Promise<string[]> {
  const insights = [];

  if (balanceScore < 50) {
    insights.push('Your work-life balance score is below optimal levels');
  } else if (balanceScore > 80) {
    insights.push('Excellent work-life balance! You\'re maintaining healthy boundaries');
  }

  if (sleep < 5) {
    insights.push('Your sleep quality seems low - consider establishing a better sleep routine');
  }

  if (stress > 7) {
    insights.push('Your stress levels are elevated - consider stress management techniques');
  }

  if (energy < 5) {
    insights.push('Your energy levels are low - focus on rest and recovery');
  }

  if (familyTime < 5) {
    insights.push('Consider carving out more time for family connections');
  }

  if (personalTime < 5) {
    insights.push('Personal time is important for wellbeing - try to prioritize it');
  }

  return insights;
}

async function generateBalanceSuggestions(balanceScore: number, sleep: number, stress: number, energy: number, familyTime: number, personalTime: number, health: number): Promise<string[]> {
  const suggestions = [];

  if (balanceScore < 50) {
    suggestions.push('Try setting clear boundaries between work and personal time');
    suggestions.push('Consider using the Reset Mode feature if feeling overwhelmed');
  }

  if (sleep < 5) {
    suggestions.push('Establish a consistent bedtime routine');
    suggestions.push('Limit screen time before bed');
  }

  if (stress > 7) {
    suggestions.push('Practice deep breathing exercises');
    suggestions.push('Consider mindfulness or meditation');
  }

  if (energy < 5) {
    suggestions.push('Take regular breaks throughout the day');
    suggestions.push('Ensure you\'re staying hydrated and eating well');
  }

  if (familyTime < 5) {
    suggestions.push('Schedule dedicated family time in your calendar');
    suggestions.push('Try to disconnect from work during family activities');
  }

  if (personalTime < 5) {
    suggestions.push('Block out time for hobbies or activities you enjoy');
    suggestions.push('Remember that personal time is not selfish - it\'s necessary');
  }

  return suggestions;
}

async function analyzeWellbeingResponse(topic: string, response: string, mood: number, energy: number, stress: number): Promise<string> {
  let analysis = '';

  switch (topic) {
    case 'sleep':
      if (mood < 5 || energy < 5) {
        analysis = 'Your sleep patterns may be affecting your mood and energy levels. Consider establishing a more consistent sleep schedule.';
      } else {
        analysis = 'Your sleep appears to be supporting your overall wellbeing.';
      }
      break;

    case 'stress':
      if (stress > 7) {
        analysis = 'You\'re experiencing high stress levels. Consider stress management techniques like deep breathing or taking regular breaks.';
      } else {
        analysis = 'Your stress levels appear manageable.';
      }
      break;

    case 'energy':
      if (energy < 5) {
        analysis = 'Your energy levels are low. Consider factors like sleep, nutrition, and taking regular breaks.';
      } else {
        analysis = 'Your energy levels are good, which supports productivity and wellbeing.';
      }
      break;

    default:
      analysis = 'Thank you for sharing your reflection. Consider how this area of your life impacts your overall work-life balance.';
  }

  return analysis;
}

async function generateWellbeingSuggestions(topic: string, response: string, mood: number, energy: number, stress: number): Promise<string[]> {
  const suggestions = [];

  switch (topic) {
    case 'sleep':
      suggestions.push('Try to go to bed and wake up at the same time each day');
      suggestions.push('Create a relaxing bedtime routine');
      suggestions.push('Keep your bedroom cool, dark, and quiet');
      break;

    case 'stress':
      suggestions.push('Practice deep breathing exercises');
      suggestions.push('Take regular breaks throughout the day');
      suggestions.push('Consider talking to a trusted colleague or friend');
      break;

    case 'energy':
      suggestions.push('Stay hydrated and eat regular meals');
      suggestions.push('Take short walks or stretch breaks');
      suggestions.push('Ensure you\'re getting enough sleep');
      break;

    case 'family':
      suggestions.push('Schedule dedicated family time');
      suggestions.push('Be fully present during family activities');
      suggestions.push('Communicate openly about work-life boundaries');
      break;

    case 'personal':
      suggestions.push('Make time for hobbies and interests');
      suggestions.push('Practice self-care activities');
      suggestions.push('Remember that personal time is important');
      break;

    case 'health':
      suggestions.push('Schedule regular check-ups');
      suggestions.push('Maintain a balanced diet and exercise routine');
      suggestions.push('Listen to your body\'s signals');
      break;
  }

  return suggestions;
}

async function checkForBalanceAlerts(userId: string, checkIn: BalanceCheckIn): Promise<void> {
  const alerts: Array<{
    alertType: 'low_balance' | 'high_stress' | 'burnout_risk' | 'sleep_concern' | 'family_time_low';
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    triggerValue: number;
    threshold: number;
    recommendations: string[];
  }> = [];

  // Check for low balance score
  if (checkIn.balanceScore < 40) {
    alerts.push({
      alertType: 'low_balance',
      severity: checkIn.balanceScore < 25 ? 'critical' : 'high',
      message: `Your work-life balance score is ${checkIn.balanceScore}/100`,
      triggerValue: checkIn.balanceScore,
      threshold: 40,
      recommendations: ['Consider using Reset Mode', 'Set clear work boundaries', 'Prioritize personal time']
    });
  }

  // Check for high stress
  if (checkIn.stress > 8) {
    alerts.push({
      alertType: 'high_stress',
      severity: 'high',
      message: `Your stress level is ${checkIn.stress}/10`,
      triggerValue: checkIn.stress,
      threshold: 8,
      recommendations: ['Practice stress management techniques', 'Consider taking a break', 'Talk to a supervisor or HR']
    });
  }

  // Check for sleep concerns
  if (checkIn.sleep < 4) {
    alerts.push({
      alertType: 'sleep_concern',
      severity: 'medium',
      message: `Your sleep quality is ${checkIn.sleep}/10`,
      triggerValue: checkIn.sleep,
      threshold: 4,
      recommendations: ['Establish a bedtime routine', 'Limit screen time before bed', 'Create a comfortable sleep environment']
    });
  }

  // Check for low family time
  if (checkIn.familyTime < 4) {
    alerts.push({
      alertType: 'family_time_low',
      severity: 'medium',
      message: `Your family time rating is ${checkIn.familyTime}/10`,
      triggerValue: checkIn.familyTime,
      threshold: 4,
      recommendations: ['Schedule dedicated family time', 'Set work boundaries', 'Plan family activities']
    });
  }

  // Create alerts
  for (const alert of alerts) {
    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const balanceAlert: BalanceAlert = {
      id: alertId,
      userId,
      customerId: checkIn.customerId,
      agencyId: checkIn.agencyId,
      ...alert,
      acknowledged: false,
      createdAt: new Date()
    };

    await db.collection('balanceAlerts').doc(alertId).set(balanceAlert);
  }
}

async function updateBalanceTrends(userId: string, checkIn: BalanceCheckIn): Promise<void> {
  // This would update or create balance trends
  // Implementation would aggregate data over time periods
  console.log(`Updating balance trends for user ${userId}`);
}

async function getChatToneScore(userId: string, startDate: Date, endDate: Date): Promise<number> {
  // This would analyze chat tone from AI logs
  // For now, return a placeholder
  return 50;
}

async function getJSIDropScore(userId: string, startDate: Date, endDate: Date): Promise<number> {
  // This would analyze JSI drops
  // For now, return a placeholder
  return 50;
}

async function getResetModeScore(userId: string, startDate: Date, endDate: Date): Promise<number> {
  // This would analyze reset mode usage
  // For now, return a placeholder
  return 50;
}

function calculateCompositeBurnoutScore(checkInScore: number, chatToneScore: number, jsiDropScore: number, resetModeScore: number): number {
  // Weighted average of different factors
  const weights = {
    checkIn: 0.4,
    chatTone: 0.2,
    jsiDrop: 0.2,
    resetMode: 0.2
  };

  return (
    checkInScore * weights.checkIn +
    chatToneScore * weights.chatTone +
    jsiDropScore * weights.jsiDrop +
    resetModeScore * weights.resetMode
  );
}

function determineBurnoutRiskLevel(compositeScore: number): 'low' | 'medium' | 'high' | 'critical' {
  if (compositeScore >= 80) return 'critical';
  if (compositeScore >= 60) return 'high';
  if (compositeScore >= 40) return 'medium';
  return 'low';
}

function identifyContributingFactors(checkInScore: number, chatToneScore: number, jsiDropScore: number, resetModeScore: number): string[] {
  const factors = [];

  if (checkInScore > 70) factors.push('Low work-life balance scores');
  if (chatToneScore > 70) factors.push('Negative communication patterns');
  if (jsiDropScore > 70) factors.push('Declining job satisfaction');
  if (resetModeScore > 70) factors.push('Frequent reset mode usage');

  return factors;
}

function generateBurnoutRecommendations(riskLevel: string, contributingFactors: string[]): string[] {
  const recommendations = [];

  if (riskLevel === 'critical' || riskLevel === 'high') {
    recommendations.push('Consider taking time off or using Reset Mode');
    recommendations.push('Speak with HR or a supervisor about workload');
    recommendations.push('Prioritize self-care and stress management');
  }

  if (contributingFactors.includes('Low work-life balance scores')) {
    recommendations.push('Set clear boundaries between work and personal time');
    recommendations.push('Schedule regular breaks and personal time');
  }

  if (contributingFactors.includes('Negative communication patterns')) {
    recommendations.push('Practice positive communication techniques');
    recommendations.push('Consider communication training or coaching');
  }

  if (contributingFactors.includes('Declining job satisfaction')) {
    recommendations.push('Identify what aspects of your job you enjoy');
    recommendations.push('Consider discussing role changes with your manager');
  }

  return recommendations;
}

async function checkUserEligibilityForBalanceCheckIn(userId: string, userData: any): Promise<boolean> {
  // Check if user is in reset mode
  const resetModeSnapshot = await db.collection('resetMode')
    .where('userId', '==', userId)
    .where('isActive', '==', true)
    .limit(1)
    .get();

  if (!resetModeSnapshot.empty) {
    return false; // Don't send check-ins during reset mode
  }

  // Check if user has recent check-ins
  const recentCheckInSnapshot = await db.collection('balanceCheckIns')
    .where('userId', '==', userId)
    .where('createdAt', '>=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
    .limit(1)
    .get();

  if (!recentCheckInSnapshot.empty) {
    return false; // User has recent activity
  }

  return true;
}

async function sendBalanceCheckInPrompt(userId: string, userData: any): Promise<void> {
  // This would integrate with your notification system
  console.log(`Sending balance check-in prompt to user ${userId}`);
}

function identifyRiskPatterns(checkIns: any[], riskIndices: any[], alerts: any[]): any[] {
  const patterns = [];

  // Users with consistently low balance scores
  const lowBalanceUsers = new Set(
    checkIns
      .filter(c => c.balanceScore < 40)
      .map(c => c.userId)
  );
  patterns.push({
    type: 'low_balance_pattern',
    count: lowBalanceUsers.size,
    description: 'Users with consistently low work-life balance scores'
  });

  // Users with high burnout risk
  const highBurnoutUsers = new Set(
    riskIndices
      .filter(r => r.riskLevel === 'high' || r.riskLevel === 'critical')
      .map(r => r.userId)
  );
  patterns.push({
    type: 'high_burnout_risk',
    count: highBurnoutUsers.size,
    description: 'Users at high risk of burnout'
  });

  // Users with multiple alerts
  const usersWithMultipleAlerts = new Set(
    alerts
      .filter(a => !a.acknowledged)
      .map(a => a.userId)
  );
  patterns.push({
    type: 'multiple_alerts',
    count: usersWithMultipleAlerts.size,
    description: 'Users with multiple unacknowledged balance alerts'
  });

  return patterns;
}

/**
 * Calculate organizational breakdown for balance analytics
 */
function calculateBalanceBreakdown(checkIns: any[], riskIndices: any[], field: string): any[] {
  const breakdown = new Map<string, { 
    checkIns: number; 
    averageBalanceScore: number; 
    averageStress: number;
    averageSleep: number;
    averageEnergy: number;
    highBurnoutRisk: number;
    balanceScores: number[];
    stressScores: number[];
    sleepScores: number[];
    energyScores: number[];
  }>();
  
  // Process check-ins
  checkIns.forEach(checkIn => {
    const value = checkIn[field] || 'Unknown';
    if (!breakdown.has(value)) {
      breakdown.set(value, { 
        checkIns: 0, 
        averageBalanceScore: 0, 
        averageStress: 0,
        averageSleep: 0,
        averageEnergy: 0,
        highBurnoutRisk: 0,
        balanceScores: [],
        stressScores: [],
        sleepScores: [],
        energyScores: []
      });
    }
    
    const entry = breakdown.get(value)!;
    entry.checkIns++;
    entry.balanceScores.push(checkIn.balanceScore);
    entry.stressScores.push(checkIn.stress);
    entry.sleepScores.push(checkIn.sleep);
    entry.energyScores.push(checkIn.energy);
  });
  
  // Process risk indices
  riskIndices.forEach(risk => {
    const value = risk[field] || 'Unknown';
    if (!breakdown.has(value)) {
      breakdown.set(value, { 
        checkIns: 0, 
        averageBalanceScore: 0, 
        averageStress: 0,
        averageSleep: 0,
        averageEnergy: 0,
        highBurnoutRisk: 0,
        balanceScores: [],
        stressScores: [],
        sleepScores: [],
        energyScores: []
      });
    }
    
    const entry = breakdown.get(value)!;
    if (risk.riskLevel === 'high' || risk.riskLevel === 'critical') {
      entry.highBurnoutRisk++;
    }
  });
  
  return Array.from(breakdown.entries()).map(([name, stats]) => ({
    name,
    checkIns: stats.checkIns,
    averageBalanceScore: stats.balanceScores.length > 0 ? stats.balanceScores.reduce((a, b) => a + b, 0) / stats.balanceScores.length : 0,
    averageStress: stats.stressScores.length > 0 ? stats.stressScores.reduce((a, b) => a + b, 0) / stats.stressScores.length : 0,
    averageSleep: stats.sleepScores.length > 0 ? stats.sleepScores.reduce((a, b) => a + b, 0) / stats.sleepScores.length : 0,
    averageEnergy: stats.energyScores.length > 0 ? stats.energyScores.reduce((a, b) => a + b, 0) / stats.energyScores.length : 0,
    highBurnoutRisk: stats.highBurnoutRisk,
    percentage: (stats.checkIns / checkIns.length) * 100
  }));
} 