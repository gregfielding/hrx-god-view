import { getFirestore } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logAIAction } from '../feedbackEngine';

const db = getFirestore();

// Mini-Learning Boosts interfaces
interface LearningBoost {
  id: string;
  userId: string;
  customerId: string;
  agencyId?: string;
  regionId?: string;
  divisionId?: string;
  departmentId?: string;
  locationId?: string;
  title: string;
  description: string;
  contentType: 'video' | 'podcast' | 'infographic' | 'tip' | 'article';
  contentUrl: string;
  duration: number; // minutes
  category: string;
  tags: string[];
  roleAlignment: string[];
  skillFocus: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  source: 'internal' | 'external';
  isActive: boolean;
  viewCount: number;
  averageRating: number;
  totalRatings: number;
  createdAt: Date;
  updatedAt: Date;
}

interface UserLearningBoost {
  id: string;
  userId: string;
  boostId: string;
  customerId: string;
  agencyId?: string;
  regionId?: string;
  divisionId?: string;
  departmentId?: string;
  locationId?: string;
  deliveryMode: 'scheduled' | 'event_triggered';
  triggerEvent?: string;
  status: 'pending' | 'delivered' | 'viewed' | 'completed' | 'skipped';
  deliveredAt?: Date;
  viewedAt?: Date;
  completedAt?: Date;
  skippedAt?: Date;
  rating?: number; // 1-5
  feedback?: string;
  timeSpent?: number; // seconds
  createdAt: Date;
  updatedAt: Date;
}

// LearningContent interface removed as it's not used

interface UserLearningProfile {
  id: string;
  userId: string;
  customerId: string;
  agencyId?: string;
  regionId?: string;
  divisionId?: string;
  departmentId?: string;
  locationId?: string;
  role: string;
  interests: string[];
  goals: string[];
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  preferredContentTypes: string[];
  averageTimeSpent: number; // minutes per session
  totalBoostsCompleted: number;
  totalTimeSpent: number; // minutes
  lastActivity: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Deliver a learning boost to a user
 */
export const deliverLearningBoost = onCall(async (request) => {
  const { userId, deliveryMode = 'scheduled', triggerEvent, boostId } = request.data;
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

    let selectedBoost: LearningBoost;

    if (boostId) {
      // Use specific boost
      const boostDoc = await db.collection('learningBoosts').doc(boostId).get();
      if (!boostDoc.exists) {
        throw new Error('Learning boost not found');
      }
      selectedBoost = boostDoc.data() as LearningBoost;
    } else {
      // Select boost based on user profile
      selectedBoost = await selectPersonalizedBoost(userId, customerId, agencyId);
    }

    // Create user learning boost record
    const userBoostId = `userboost_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const userBoost: UserLearningBoost = {
      id: userBoostId,
      userId,
      boostId: selectedBoost.id,
      customerId,
      agencyId,
      regionId,
      divisionId,
      departmentId,
      locationId,
      deliveryMode,
      triggerEvent,
      status: 'delivered',
      deliveredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('userLearningBoosts').doc(userBoostId).set(userBoost);

    // Log AI action
    await logAIAction({
      userId,
      actionType: 'learning_boost_delivered',
      sourceModule: 'MiniLearningBoosts',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Learning boost delivered: ${selectedBoost.title}`,
      eventType: 'learning.boost_delivered',
      targetType: 'learning_boost',
      targetId: selectedBoost.id,
      aiRelevant: true,
      contextType: 'learning',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return {
      success: true,
      userBoostId,
      boost: {
        id: selectedBoost.id,
        title: selectedBoost.title,
        description: selectedBoost.description,
        contentType: selectedBoost.contentType,
        contentUrl: selectedBoost.contentUrl,
        duration: selectedBoost.duration,
        category: selectedBoost.category,
        tags: selectedBoost.tags
      }
    };

  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'learning_boost_delivered',
      sourceModule: 'MiniLearningBoosts',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to deliver learning boost: ${error.message}`,
      eventType: 'learning.boost_delivery_failed',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'learning',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Mark a learning boost as viewed
 */
export const markBoostViewed = onCall(async (request) => {
  const { userBoostId } = request.data;
  const userId = request.auth?.uid || 'unknown';
  const start = Date.now();

  try {
    const userBoostDoc = await db.collection('userLearningBoosts').doc(userBoostId).get();
    if (!userBoostDoc.exists) {
      throw new Error('User learning boost not found');
    }

    const userBoost = userBoostDoc.data() as UserLearningBoost;
    
    if (userBoost.userId !== userId) {
      throw new Error('Unauthorized access to learning boost');
    }

    // Update status
    await db.collection('userLearningBoosts').doc(userBoostId).update({
      status: 'viewed',
      viewedAt: new Date(),
      updatedAt: new Date()
    });

    // Log AI action
    await logAIAction({
      userId,
      actionType: 'learning_boost_viewed',
      sourceModule: 'MiniLearningBoosts',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Learning boost marked as viewed`,
      eventType: 'learning.boost_viewed',
      targetType: 'user_learning_boost',
      targetId: userBoostId,
      aiRelevant: true,
      contextType: 'learning',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return { success: true };

  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'learning_boost_viewed',
      sourceModule: 'MiniLearningBoosts',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to mark boost as viewed: ${error.message}`,
      eventType: 'learning.boost_view_failed',
      targetType: 'user_learning_boost',
      targetId: userBoostId,
      aiRelevant: true,
      contextType: 'learning',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Complete a learning boost
 */
export const completeLearningBoost = onCall(async (request) => {
  const { userBoostId, rating, feedback, timeSpent } = request.data;
  const userId = request.auth?.uid || 'unknown';
  const start = Date.now();

  try {
    const userBoostDoc = await db.collection('userLearningBoosts').doc(userBoostId).get();
    if (!userBoostDoc.exists) {
      throw new Error('User learning boost not found');
    }

    const userBoost = userBoostDoc.data() as UserLearningBoost;
    
    if (userBoost.userId !== userId) {
      throw new Error('Unauthorized access to learning boost');
    }

    // Update status and feedback
    await db.collection('userLearningBoosts').doc(userBoostId).update({
      status: 'completed',
      completedAt: new Date(),
      rating,
      feedback,
      timeSpent,
      updatedAt: new Date()
    });

    // Update learning content stats
    const boostDoc = await db.collection('learningBoosts').doc(userBoost.boostId).get();
    if (boostDoc.exists) {
      const boost = boostDoc.data() as LearningBoost;
      const newViewCount = boost.viewCount + 1;
      const newTotalRatings = boost.totalRatings + 1;
      const newAverageRating = ((boost.averageRating * boost.totalRatings) + rating) / newTotalRatings;

      await db.collection('learningBoosts').doc(userBoost.boostId).update({
        viewCount: newViewCount,
        totalRatings: newTotalRatings,
        averageRating: newAverageRating,
        updatedAt: new Date()
      });
    }

    // Update user learning profile
    await updateUserLearningProfile(userId, timeSpent || 0);

    // Log AI action
    await logAIAction({
      userId,
      actionType: 'learning_boost_completed',
      sourceModule: 'MiniLearningBoosts',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Learning boost completed with rating ${rating}`,
      eventType: 'learning.boost_completed',
      targetType: 'user_learning_boost',
      targetId: userBoostId,
      aiRelevant: true,
      contextType: 'learning',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return { success: true };

  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'learning_boost_completed',
      sourceModule: 'MiniLearningBoosts',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to complete learning boost: ${error.message}`,
      eventType: 'learning.boost_completion_failed',
      targetType: 'user_learning_boost',
      targetId: userBoostId,
      aiRelevant: true,
      contextType: 'learning',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Skip a learning boost
 */
export const skipLearningBoost = onCall(async (request) => {
  const { userBoostId, reason } = request.data;
  const userId = request.auth?.uid || 'unknown';
  const start = Date.now();

  try {
    const userBoostDoc = await db.collection('userLearningBoosts').doc(userBoostId).get();
    if (!userBoostDoc.exists) {
      throw new Error('User learning boost not found');
    }

    const userBoost = userBoostDoc.data() as UserLearningBoost;
    
    if (userBoost.userId !== userId) {
      throw new Error('Unauthorized access to learning boost');
    }

    // Update status
    await db.collection('userLearningBoosts').doc(userBoostId).update({
      status: 'skipped',
      skippedAt: new Date(),
      feedback: reason,
      updatedAt: new Date()
    });

    // Log AI action
    await logAIAction({
      userId,
      actionType: 'learning_boost_skipped',
      sourceModule: 'MiniLearningBoosts',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Learning boost skipped: ${reason}`,
      eventType: 'learning.boost_skipped',
      targetType: 'user_learning_boost',
      targetId: userBoostId,
      aiRelevant: true,
      contextType: 'learning',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return { success: true };

  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'learning_boost_skipped',
      sourceModule: 'MiniLearningBoosts',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to skip learning boost: ${error.message}`,
      eventType: 'learning.boost_skip_failed',
      targetType: 'user_learning_boost',
      targetId: userBoostId,
      aiRelevant: true,
      contextType: 'learning',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Get user's learning dashboard
 */
export const getUserLearningDashboard = onCall(async (request) => {
  const userId = request.auth?.uid || 'unknown';
  const start = Date.now();

  try {
    // Get user learning profile
    const profileDoc = await db.collection('userLearningProfiles').doc(userId).get();
    let profile = profileDoc.exists ? profileDoc.data() as UserLearningProfile : null;

    if (!profile) {
      // Create default profile
      profile = await createDefaultLearningProfile(userId);
    }

    // Get recent boosts
    const recentBoostsSnapshot = await db.collection('userLearningBoosts')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const recentBoosts = recentBoostsSnapshot.docs.map(doc => doc.data());

    // Get pending boosts
    const pendingBoostsSnapshot = await db.collection('userLearningBoosts')
      .where('userId', '==', userId)
      .where('status', '==', 'delivered')
      .orderBy('deliveredAt', 'desc')
      .limit(5)
      .get();

    const pendingBoosts = pendingBoostsSnapshot.docs.map(doc => doc.data());

    // Calculate stats
    const stats = {
      totalBoostsCompleted: profile.totalBoostsCompleted,
      totalTimeSpent: profile.totalTimeSpent,
      averageTimeSpent: profile.averageTimeSpent,
      completionRate: recentBoosts.length > 0 
        ? recentBoosts.filter(b => b.status === 'completed').length / recentBoosts.length 
        : 0
    };

    // Log AI action
    await logAIAction({
      userId,
      actionType: 'learning_dashboard_viewed',
      sourceModule: 'MiniLearningBoosts',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Learning dashboard viewed`,
      eventType: 'learning.dashboard_viewed',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'learning',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return {
      success: true,
      profile,
      recentBoosts,
      pendingBoosts,
      stats
    };

  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'learning_dashboard_viewed',
      sourceModule: 'MiniLearningBoosts',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to load learning dashboard: ${error.message}`,
      eventType: 'learning.dashboard_failed',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'learning',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Get admin learning dashboard
 */
export const getAdminLearningDashboard = onCall(async (request) => {
  const { customerId, agencyId, regionId, divisionId, departmentId, locationId, timeRange = 30 } = request.data; // days
  const adminUserId = request.auth?.uid || 'system';
  const start = Date.now();

  try {
    const startDate = new Date(Date.now() - timeRange * 24 * 60 * 60 * 1000);

    // Get user learning boosts with organizational filtering
    let boostsQuery = db.collection('userLearningBoosts')
      .where('customerId', '==', customerId)
      .where('createdAt', '>=', startDate);

    if (agencyId) {
      boostsQuery = boostsQuery.where('agencyId', '==', agencyId);
    }
    if (regionId) {
      boostsQuery = boostsQuery.where('regionId', '==', regionId);
    }
    if (divisionId) {
      boostsQuery = boostsQuery.where('divisionId', '==', divisionId);
    }
    if (departmentId) {
      boostsQuery = boostsQuery.where('departmentId', '==', departmentId);
    }
    if (locationId) {
      boostsQuery = boostsQuery.where('locationId', '==', locationId);
    }

    const boostsSnapshot = await boostsQuery.get();
    const boosts = boostsSnapshot.docs.map(doc => doc.data());

    // Get learning content stats
    const contentSnapshot = await db.collection('learningBoosts')
      .where('isActive', '==', true)
      .get();

    const content = contentSnapshot.docs.map(doc => doc.data());

    // Calculate metrics
    const metrics = {
      totalBoostsDelivered: boosts.length,
      totalBoostsCompleted: boosts.filter(b => b.status === 'completed').length,
      totalBoostsSkipped: boosts.filter(b => b.status === 'skipped').length,
      averageRating: content.length > 0 
        ? content.reduce((sum, c) => sum + c.averageRating, 0) / content.length 
        : 0,
      averageTimeSpent: boosts.filter(b => b.timeSpent).length > 0
        ? boosts.filter(b => b.timeSpent).reduce((sum, b) => sum + b.timeSpent, 0) / boosts.filter(b => b.timeSpent).length
        : 0,
      completionRate: boosts.length > 0 
        ? boosts.filter(b => b.status === 'completed').length / boosts.length 
        : 0
    };

    // Get top performing content
    const topContent = content
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, 10);

    // Get engagement trends
    const trends = analyzeEngagementTrends(boosts);

    // Calculate organizational breakdown
    const organizationalBreakdown = {
      byRegion: calculateLearningBreakdown(boosts, 'regionId'),
      byDivision: calculateLearningBreakdown(boosts, 'divisionId'),
      byDepartment: calculateLearningBreakdown(boosts, 'departmentId'),
      byLocation: calculateLearningBreakdown(boosts, 'locationId')
    };

    // Log AI action
    await logAIAction({
      userId: adminUserId,
      actionType: 'admin_learning_dashboard_viewed',
      sourceModule: 'MiniLearningBoosts',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Admin learning dashboard viewed for customer ${customerId}`,
      eventType: 'learning.admin_dashboard_viewed',
      targetType: 'customer',
      targetId: customerId,
      aiRelevant: true,
      contextType: 'learning',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return {
      success: true,
      metrics,
      topContent,
      trends,
      organizationalBreakdown
    };

  } catch (error: any) {
    await logAIAction({
      userId: adminUserId,
      actionType: 'admin_learning_dashboard_viewed',
      sourceModule: 'MiniLearningBoosts',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to load admin learning dashboard: ${error.message}`,
      eventType: 'learning.admin_dashboard_failed',
      targetType: 'customer',
      targetId: customerId,
      aiRelevant: true,
      contextType: 'learning',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Scheduled function to deliver weekly learning boosts
 */
export const deliverWeeklyLearningBoosts = onSchedule({
  schedule: '0 9 * * 1', // Every Monday at 9 AM
  timeZone: 'America/New_York'
}, async (event) => {
  const start = Date.now();
  
  try {
    // Get all active users
    const usersSnapshot = await db.collection('users')
      .where('isActive', '==', true)
      .get();

    let deliveredCount = 0;
    let errorCount = 0;

    for (const userDoc of usersSnapshot.docs) {
      try {
        const userId = userDoc.id;
        const userData = userDoc.data();

        // Check if user should receive a boost (not in reset mode, etc.)
        const shouldReceiveBoost = await checkUserEligibilityForBoost(userId, userData);
        
        if (shouldReceiveBoost) {
          // Create boost directly instead of calling the function
          const boost = await selectPersonalizedBoost(userId, userData.customerId, userData.agencyId);
          const userBoostId = `userboost_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const userBoost: UserLearningBoost = {
            id: userBoostId,
            userId,
            boostId: boost.id,
            customerId: userData.customerId,
            agencyId: userData.agencyId,
            deliveryMode: 'scheduled',
            triggerEvent: 'weekly_schedule',
            status: 'delivered',
            deliveredAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          };
          
          await db.collection('userLearningBoosts').doc(userBoostId).set(userBoost);
          deliveredCount++;
        }
      } catch (error) {
        console.error(`Failed to deliver boost to user ${userDoc.id}:`, error);
        errorCount++;
      }
    }

    console.log(`Weekly learning boosts completed: ${deliveredCount} delivered, ${errorCount} errors`);

    // Log AI action
    await logAIAction({
      userId: 'system',
      actionType: 'weekly_learning_boosts_delivered',
      sourceModule: 'MiniLearningBoosts',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Weekly learning boosts delivered: ${deliveredCount} successful, ${errorCount} failed`,
      eventType: 'learning.weekly_delivery',
      targetType: 'system',
      targetId: 'weekly_delivery',
      aiRelevant: true,
      contextType: 'learning',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

  } catch (error: any) {
    console.error('Weekly learning boosts delivery failed:', error);
    
    await logAIAction({
      userId: 'system',
      actionType: 'weekly_learning_boosts_delivered',
      sourceModule: 'MiniLearningBoosts',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Weekly learning boosts delivery failed: ${error.message}`,
      eventType: 'learning.weekly_delivery_failed',
      targetType: 'system',
      targetId: 'weekly_delivery',
      aiRelevant: true,
      contextType: 'learning',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
  }
});

// Helper functions
async function selectPersonalizedBoost(userId: string, customerId: string, agencyId?: string): Promise<LearningBoost> {
  // Get user learning profile
  const profileDoc = await db.collection('userLearningProfiles').doc(userId).get();
  const profile = profileDoc.exists ? profileDoc.data() as UserLearningProfile : null;

  // Get user's recent boosts to avoid repetition
  const recentBoostsSnapshot = await db.collection('userLearningBoosts')
    .where('userId', '==', userId)
    .orderBy('createdAt', 'desc')
    .limit(5)
    .get();

  const recentBoostIds = recentBoostsSnapshot.docs.map(doc => doc.data().boostId);

  // Build query for available boosts
  let boostsQuery = db.collection('learningBoosts')
    .where('isActive', '==', true)
    .where('customerId', '==', customerId);

  if (agencyId) {
    boostsQuery = boostsQuery.where('agencyId', '==', agencyId);
  }

  const boostsSnapshot = await boostsQuery.get();
  const availableBoosts = boostsSnapshot.docs
    .map(doc => doc.data() as LearningBoost)
    .filter(boost => !recentBoostIds.includes(boost.id));

  if (availableBoosts.length === 0) {
    throw new Error('No available learning boosts found');
  }

  // Score boosts based on user profile
  const scoredBoosts = availableBoosts.map(boost => ({
    boost,
    score: calculateBoostScore(boost, profile)
  }));

  // Return highest scored boost
  scoredBoosts.sort((a, b) => b.score - a.score);
  return scoredBoosts[0].boost;
}

function calculateBoostScore(boost: LearningBoost, profile: UserLearningProfile | null): number {
  let score = 0;

  if (!profile) {
    return Math.random(); // Random selection for new users
  }

  // Role alignment
  if (boost.roleAlignment.includes(profile.role)) {
    score += 3;
  }

  // Interest alignment
  const interestMatches = boost.tags.filter(tag => profile.interests.includes(tag)).length;
  score += interestMatches * 2;

  // Skill level alignment
  if (boost.difficulty === profile.skillLevel) {
    score += 2;
  }

  // Content type preference
  if (profile.preferredContentTypes.includes(boost.contentType)) {
    score += 1;
  }

  // Duration preference (shorter content preferred)
  if (boost.duration <= 3) {
    score += 1;
  }

  // Add some randomness
  score += Math.random() * 0.5;

  return score;
}

async function updateUserLearningProfile(userId: string, timeSpent: number): Promise<void> {
  const profileRef = db.collection('userLearningProfiles').doc(userId);
  
  await db.runTransaction(async (transaction) => {
    const profileDoc = await transaction.get(profileRef);
    
    if (profileDoc.exists) {
      const profile = profileDoc.data() as UserLearningProfile;
      const newTotalBoosts = profile.totalBoostsCompleted + 1;
      const newTotalTime = profile.totalTimeSpent + timeSpent;
      const newAverageTime = newTotalTime / newTotalBoosts;

      transaction.update(profileRef, {
        totalBoostsCompleted: newTotalBoosts,
        totalTimeSpent: newTotalTime,
        averageTimeSpent: newAverageTime,
        lastActivity: new Date(),
        updatedAt: new Date()
      });
    }
  });
}

async function createDefaultLearningProfile(userId: string): Promise<UserLearningProfile> {
  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.data();

  const profile: UserLearningProfile = {
    id: userId,
    userId,
    customerId: userData?.customerId || '',
    agencyId: userData?.agencyId,
    role: userData?.role || 'general',
    interests: [],
    goals: [],
    skillLevel: 'beginner',
    preferredContentTypes: ['tip', 'infographic'],
    averageTimeSpent: 0,
    totalBoostsCompleted: 0,
    totalTimeSpent: 0,
    lastActivity: new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  };

  await db.collection('userLearningProfiles').doc(userId).set(profile);
  return profile;
}

async function checkUserEligibilityForBoost(userId: string, userData: any): Promise<boolean> {
  // Check if user is in reset mode
  const resetModeSnapshot = await db.collection('resetMode')
    .where('userId', '==', userId)
    .where('isActive', '==', true)
    .limit(1)
    .get();

  if (!resetModeSnapshot.empty) {
    return false; // Don't send boosts during reset mode
  }

  // Check if user has too many pending boosts
  const pendingBoostsSnapshot = await db.collection('userLearningBoosts')
    .where('userId', '==', userId)
    .where('status', '==', 'delivered')
    .get();

  if (pendingBoostsSnapshot.size >= 3) {
    return false; // Too many pending boosts
  }

  return true;
}

function analyzeEngagementTrends(boosts: any[]): any {
  const trends = {
    dailyEngagement: {},
    weeklyEngagement: {},
    contentTypePreference: {},
    completionRateByCategory: {}
  };

  // Group by date
  boosts.forEach(boost => {
    const date = boost.createdAt.toDate().toDateString();
    (trends.dailyEngagement as any)[date] = ((trends.dailyEngagement as any)[date] || 0) + 1;
  });

  // Group by content type
  boosts.forEach(boost => {
    const contentType = boost.contentType || 'unknown';
    (trends.contentTypePreference as any)[contentType] = ((trends.contentTypePreference as any)[contentType] || 0) + 1;
  });

  return trends;
}

/**
 * Calculate organizational breakdown for learning analytics
 */
function calculateLearningBreakdown(data: any[], field: string): any[] {
  const breakdown = new Map<string, { 
    delivered: number; 
    completed: number; 
    skipped: number; 
    averageRating: number;
    totalTimeSpent: number;
    ratings: number[];
  }>();
  
  data.forEach(item => {
    const value = item[field] || 'Unknown';
    if (!breakdown.has(value)) {
      breakdown.set(value, { 
        delivered: 0, 
        completed: 0, 
        skipped: 0, 
        averageRating: 0,
        totalTimeSpent: 0,
        ratings: []
      });
    }
    
    const entry = breakdown.get(value)!;
    entry.delivered++;
    
    if (item.status === 'completed') {
      entry.completed++;
    } else if (item.status === 'skipped') {
      entry.skipped++;
    }
    
    if (item.rating) {
      entry.ratings.push(item.rating);
    }
    
    if (item.timeSpent) {
      entry.totalTimeSpent += item.timeSpent;
    }
  });
  
  return Array.from(breakdown.entries()).map(([name, stats]) => ({
    name,
    delivered: stats.delivered,
    completed: stats.completed,
    skipped: stats.skipped,
    completionRate: stats.delivered > 0 ? stats.completed / stats.delivered : 0,
    averageRating: stats.ratings.length > 0 ? stats.ratings.reduce((a, b) => a + b, 0) / stats.ratings.length : 0,
    averageTimeSpent: stats.completed > 0 ? stats.totalTimeSpent / stats.completed : 0,
    percentage: (stats.delivered / data.length) * 100
  }));
} 