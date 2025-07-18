import { getFirestore } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logAIAction } from '../feedbackEngine';

const db = getFirestore();

// Professional Growth interfaces
interface CareerGoal {
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
  category: 'skill_development' | 'role_advancement' | 'certification' | 'education' | 'leadership' | 'personal_growth';
  timeline: '30_day' | '6_month' | '1_year' | 'long_term';
  targetDate?: Date;
  status: 'active' | 'in_progress' | 'completed' | 'paused' | 'abandoned';
  priority: 'low' | 'medium' | 'high';
  progress: number; // 0-100
  milestones: GoalMilestone[];
  actionSteps: ActionStep[];
  createdAt: Date;
  updatedAt: Date;
}

interface GoalMilestone {
  id: string;
  title: string;
  description: string;
  targetDate: Date;
  status: 'pending' | 'in_progress' | 'completed';
  completedAt?: Date;
  progress: number; // 0-100
}

interface ActionStep {
  id: string;
  title: string;
  description: string;
  dueDate?: Date;
  status: 'pending' | 'in_progress' | 'completed';
  completedAt?: Date;
  priority: 'low' | 'medium' | 'high';
}

interface CareerJournal {
  id: string;
  userId: string;
  customerId: string;
  agencyId?: string;
  regionId?: string;
  divisionId?: string;
  departmentId?: string;
  locationId?: string;
  entryType: 'weekly_reflection' | 'goal_update' | 'achievement' | 'challenge' | 'learning';
  title: string;
  content: string;
  mood: number; // 1-10
  energy: number; // 1-10
  confidence: number; // 1-10
  goalsReferenced: string[]; // Goal IDs
  skillsMentioned: string[];
  aiInsights?: string[];
  aiSuggestions?: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface SkillsInventory {
  id: string;
  userId: string;
  customerId: string;
  agencyId?: string;
  regionId?: string;
  divisionId?: string;
  departmentId?: string;
  locationId?: string;
  currentSkills: Skill[];
  desiredSkills: Skill[];
  skillGaps: SkillGap[];
  lastUpdated: Date;
  createdAt: Date;
}

interface Skill {
  id: string;
  name: string;
  category: string;
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  confidence: number; // 0-1
  yearsOfExperience?: number;
  lastUsed?: Date;
  isDesired: boolean;
}

interface SkillGap {
  id: string;
  skillName: string;
  currentLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  targetLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  priority: 'low' | 'medium' | 'high';
  estimatedTimeToAchieve: number; // weeks
  resources: string[];
  actionPlan: string[];
}

// GrowthMetrics interface removed as it's not used

/**
 * Create a new career goal
 */
export const createCareerGoal = onCall(async (request) => {
  const { title, description, category, timeline, targetDate, priority = 'medium' } = request.data;
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

    // Create goal
    const goalId = `goal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const goal: CareerGoal = {
      id: goalId,
      userId,
      customerId,
      agencyId,
      regionId,
      divisionId,
      departmentId,
      locationId,
      title,
      description,
      category,
      timeline,
      targetDate: targetDate ? new Date(targetDate) : undefined,
      status: 'active',
      priority,
      progress: 0,
      milestones: [],
      actionSteps: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('careerGoals').doc(goalId).set(goal);

    // Generate AI insights and suggestions
    const aiInsights = await generateGoalInsights(goal);
    const aiSuggestions = await generateActionSteps(goal);

    // Update goal with AI suggestions
    await db.collection('careerGoals').doc(goalId).update({
      actionSteps: aiSuggestions,
      updatedAt: new Date()
    });

    // Log AI action
    await logAIAction({
      userId,
      actionType: 'career_goal_created',
      sourceModule: 'ProfessionalGrowth',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Career goal created: ${title}`,
      eventType: 'growth.goal_created',
      targetType: 'career_goal',
      targetId: goalId,
      aiRelevant: true,
      contextType: 'growth',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return {
      success: true,
      goalId,
      goal,
      aiInsights,
      aiSuggestions
    };

  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'career_goal_created',
      sourceModule: 'ProfessionalGrowth',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to create career goal: ${error.message}`,
      eventType: 'growth.goal_creation_failed',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'growth',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Update a career goal
 */
export const updateCareerGoal = onCall(async (request) => {
  const { goalId, updates } = request.data;
  const userId = request.auth?.uid || 'unknown';
  const start = Date.now();

  try {
    const goalDoc = await db.collection('careerGoals').doc(goalId).get();
    if (!goalDoc.exists) {
      throw new Error('Career goal not found');
    }

    const goal = goalDoc.data() as CareerGoal;
    if (goal.userId !== userId) {
      throw new Error('Unauthorized access to career goal');
    }

    // Update goal
    const updateData = {
      ...updates,
      updatedAt: new Date()
    };

    await db.collection('careerGoals').doc(goalId).update(updateData);

    // If status changed to completed, generate achievement insights
    if (updates.status === 'completed') {
      const achievementInsights = await generateAchievementInsights(goal);
      
      // Create journal entry for achievement
      await createAchievementJournalEntry(userId, goal, achievementInsights);
    }

    // Log AI action
    await logAIAction({
      userId,
      actionType: 'career_goal_updated',
      sourceModule: 'ProfessionalGrowth',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Career goal updated: ${goal.title}`,
      eventType: 'growth.goal_updated',
      targetType: 'career_goal',
      targetId: goalId,
      aiRelevant: true,
      contextType: 'growth',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return { success: true };

  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'career_goal_updated',
      sourceModule: 'ProfessionalGrowth',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to update career goal: ${error.message}`,
      eventType: 'growth.goal_update_failed',
      targetType: 'career_goal',
      targetId: goalId,
      aiRelevant: true,
      contextType: 'growth',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Create a career journal entry
 */
export const createCareerJournalEntry = onCall(async (request) => {
  const { entryType, title, content, mood, energy, confidence, goalsReferenced = [] } = request.data;
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

    // Extract skills mentioned in content
    const skillsMentioned = extractSkillsFromContent(content);

    // Generate AI insights and suggestions
    const aiInsights = await generateJournalInsights(content, mood, energy, confidence);
    const aiSuggestions = await generateJournalSuggestions(content, goalsReferenced);

    // Create journal entry
    const entryId = `journal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const entry: CareerJournal = {
      id: entryId,
      userId,
      customerId,
      agencyId,
      entryType,
      title,
      content,
      mood,
      energy,
      confidence,
      goalsReferenced,
      skillsMentioned,
      aiInsights,
      aiSuggestions,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('careerJournal').doc(entryId).set(entry);

    // Log AI action
    await logAIAction({
      userId,
      actionType: 'career_journal_entry_created',
      sourceModule: 'ProfessionalGrowth',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Career journal entry created: ${title}`,
      eventType: 'growth.journal_entry_created',
      targetType: 'career_journal',
      targetId: entryId,
      aiRelevant: true,
      contextType: 'growth',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return {
      success: true,
      entryId,
      entry,
      aiInsights,
      aiSuggestions
    };

  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'career_journal_entry_created',
      sourceModule: 'ProfessionalGrowth',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to create journal entry: ${error.message}`,
      eventType: 'growth.journal_entry_failed',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'growth',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Update skills inventory
 */
export const updateSkillsInventory = onCall(async (request) => {
  const { currentSkills, desiredSkills } = request.data;
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

    // Analyze skill gaps
    const skillGaps = analyzeSkillGaps(currentSkills, desiredSkills);

    // Create or update skills inventory
    const inventory: SkillsInventory = {
      id: userId,
      userId,
      customerId,
      agencyId,
      currentSkills,
      desiredSkills,
      skillGaps,
      lastUpdated: new Date(),
      createdAt: new Date()
    };

    await db.collection('skillsInventory').doc(userId).set(inventory, { merge: true });

    // Generate skill development roadmap
    const roadmap = await generateSkillRoadmap(skillGaps);

    // Log AI action
    await logAIAction({
      userId,
      actionType: 'skills_inventory_updated',
      sourceModule: 'ProfessionalGrowth',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Skills inventory updated with ${currentSkills.length} current and ${desiredSkills.length} desired skills`,
      eventType: 'growth.skills_updated',
      targetType: 'skills_inventory',
      targetId: userId,
      aiRelevant: true,
      contextType: 'growth',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return {
      success: true,
      skillGaps,
      roadmap
    };

  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'skills_inventory_updated',
      sourceModule: 'ProfessionalGrowth',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to update skills inventory: ${error.message}`,
      eventType: 'growth.skills_update_failed',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'growth',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Get user's professional growth dashboard
 */
export const getUserGrowthDashboard = onCall(async (request) => {
  const userId = request.auth?.uid || 'unknown';
  const start = Date.now();

  try {
    // Get user's goals
    const goalsSnapshot = await db.collection('careerGoals')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const goals = goalsSnapshot.docs.map(doc => doc.data());

    // Get recent journal entries
    const journalSnapshot = await db.collection('careerJournal')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const journalEntries = journalSnapshot.docs.map(doc => doc.data());

    // Get skills inventory
    const skillsDoc = await db.collection('skillsInventory').doc(userId).get();
    const skillsInventory = skillsDoc.exists ? skillsDoc.data() : null;

    // Get growth metrics
    const metricsSnapshot = await db.collection('growthMetrics')
      .where('userId', '==', userId)
      .orderBy('endDate', 'desc')
      .limit(1)
      .get();

    const latestMetrics = metricsSnapshot.empty ? null : metricsSnapshot.docs[0].data();

    // Calculate current stats
    const stats = {
      activeGoals: goals.filter(g => g.status === 'active').length,
      completedGoals: goals.filter(g => g.status === 'completed').length,
      inProgressGoals: goals.filter(g => g.status === 'in_progress').length,
      totalJournalEntries: journalEntries.length,
      averageMood: journalEntries.length > 0 
        ? journalEntries.reduce((sum, e) => sum + e.mood, 0) / journalEntries.length 
        : 0,
      averageEnergy: journalEntries.length > 0 
        ? journalEntries.reduce((sum, e) => sum + e.energy, 0) / journalEntries.length 
        : 0,
      averageConfidence: journalEntries.length > 0 
        ? journalEntries.reduce((sum, e) => sum + e.confidence, 0) / journalEntries.length 
        : 0
    };

    // Log AI action
    await logAIAction({
      userId,
      actionType: 'growth_dashboard_viewed',
      sourceModule: 'ProfessionalGrowth',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Professional growth dashboard viewed`,
      eventType: 'growth.dashboard_viewed',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'growth',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return {
      success: true,
      goals,
      journalEntries,
      skillsInventory,
      latestMetrics,
      stats
    };

  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'growth_dashboard_viewed',
      sourceModule: 'ProfessionalGrowth',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to load growth dashboard: ${error.message}`,
      eventType: 'growth.dashboard_failed',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'growth',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Get admin professional growth dashboard
 */
export const getAdminGrowthDashboard = onCall(async (request) => {
  const { customerId, agencyId, regionId, divisionId, departmentId, locationId, timeRange = 30 } = request.data; // days
  const adminUserId = request.auth?.uid || 'system';
  const start = Date.now();

  try {
    const startDate = new Date(Date.now() - timeRange * 24 * 60 * 60 * 1000);

    // Get goals with organizational filtering
    let goalsQuery = db.collection('careerGoals')
      .where('customerId', '==', customerId)
      .where('createdAt', '>=', startDate);

    if (agencyId) {
      goalsQuery = goalsQuery.where('agencyId', '==', agencyId);
    }
    if (regionId) {
      goalsQuery = goalsQuery.where('regionId', '==', regionId);
    }
    if (divisionId) {
      goalsQuery = goalsQuery.where('divisionId', '==', divisionId);
    }
    if (departmentId) {
      goalsQuery = goalsQuery.where('departmentId', '==', departmentId);
    }
    if (locationId) {
      goalsQuery = goalsQuery.where('locationId', '==', locationId);
    }

    const goalsSnapshot = await goalsQuery.get();
    const goals = goalsSnapshot.docs.map(doc => doc.data());

    // Get journal entries with organizational filtering
    let journalQuery = db.collection('careerJournal')
      .where('customerId', '==', customerId)
      .where('createdAt', '>=', startDate);

    if (agencyId) {
      journalQuery = journalQuery.where('agencyId', '==', agencyId);
    }
    if (regionId) {
      journalQuery = journalQuery.where('regionId', '==', regionId);
    }
    if (divisionId) {
      journalQuery = journalQuery.where('divisionId', '==', divisionId);
    }
    if (departmentId) {
      journalQuery = journalQuery.where('departmentId', '==', departmentId);
    }
    if (locationId) {
      journalQuery = journalQuery.where('locationId', '==', locationId);
    }

    const journalSnapshot = await journalQuery.get();
    const journalEntries = journalSnapshot.docs.map(doc => doc.data());

    // Get growth metrics with organizational filtering
    let metricsQuery = db.collection('growthMetrics')
      .where('customerId', '==', customerId)
      .where('endDate', '>=', startDate);

    if (agencyId) {
      metricsQuery = metricsQuery.where('agencyId', '==', agencyId);
    }
    if (regionId) {
      metricsQuery = metricsQuery.where('regionId', '==', regionId);
    }
    if (divisionId) {
      metricsQuery = metricsQuery.where('divisionId', '==', divisionId);
    }
    if (departmentId) {
      metricsQuery = metricsQuery.where('departmentId', '==', departmentId);
    }
    if (locationId) {
      metricsQuery = metricsQuery.where('locationId', '==', locationId);
    }

    const metricsSnapshot = await metricsQuery.get();
    const metrics = metricsSnapshot.docs.map(doc => doc.data());

    // Calculate aggregate metrics
    const aggregateMetrics = {
      totalGoalsCreated: goals.length,
      totalGoalsCompleted: goals.filter(g => g.status === 'completed').length,
      totalGoalsInProgress: goals.filter(g => g.status === 'in_progress').length,
      averageGoalProgress: goals.length > 0 
        ? goals.reduce((sum, g) => sum + g.progress, 0) / goals.length 
        : 0,
      totalJournalEntries: journalEntries.length,
      averageMood: journalEntries.length > 0 
        ? journalEntries.reduce((sum, e) => sum + e.mood, 0) / journalEntries.length 
        : 0,
      averageEnergy: journalEntries.length > 0 
        ? journalEntries.reduce((sum, e) => sum + e.energy, 0) / journalEntries.length 
        : 0,
      averageConfidence: journalEntries.length > 0 
        ? journalEntries.reduce((sum, e) => sum + e.confidence, 0) / journalEntries.length 
        : 0,
      averageRetentionSignal: metrics.length > 0 
        ? metrics.reduce((sum, m) => sum + m.retentionSignal, 0) / metrics.length 
        : 0,
      averageGrowthAlignment: metrics.length > 0 
        ? metrics.reduce((sum, m) => sum + m.growthAlignment, 0) / metrics.length 
        : 0
    };

    // Identify retention signals
    const retentionSignals = identifyRetentionSignals(goals, journalEntries, metrics);

    // Calculate organizational breakdown
    const organizationalBreakdown = {
      byRegion: calculateGrowthBreakdown(goals, journalEntries, 'regionId'),
      byDivision: calculateGrowthBreakdown(goals, journalEntries, 'divisionId'),
      byDepartment: calculateGrowthBreakdown(goals, journalEntries, 'departmentId'),
      byLocation: calculateGrowthBreakdown(goals, journalEntries, 'locationId')
    };

    // Log AI action
    await logAIAction({
      userId: adminUserId,
      actionType: 'admin_growth_dashboard_viewed',
      sourceModule: 'ProfessionalGrowth',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Admin growth dashboard viewed for customer ${customerId}`,
      eventType: 'growth.admin_dashboard_viewed',
      targetType: 'customer',
      targetId: customerId,
      aiRelevant: true,
      contextType: 'growth',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return {
      success: true,
      aggregateMetrics,
      retentionSignals,
      organizationalBreakdown
    };

  } catch (error: any) {
    await logAIAction({
      userId: adminUserId,
      actionType: 'admin_growth_dashboard_viewed',
      sourceModule: 'ProfessionalGrowth',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Failed to load admin growth dashboard: ${error.message}`,
      eventType: 'growth.admin_dashboard_failed',
      targetType: 'customer',
      targetId: customerId,
      aiRelevant: true,
      contextType: 'growth',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Scheduled function to send weekly growth prompts
 */
export const sendWeeklyGrowthPrompts = onSchedule({
  schedule: '0 10 * * 1', // Every Monday at 10 AM
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

        // Check if user should receive growth prompts
        const shouldReceivePrompt = await checkUserEligibilityForGrowthPrompt(userId, userData);
        
        if (shouldReceivePrompt) {
          await sendGrowthPrompt(userId, userData);
          sentCount++;
        }
      } catch (error) {
        console.error(`Failed to send growth prompt to user ${userDoc.id}:`, error);
        errorCount++;
      }
    }

    console.log(`Weekly growth prompts completed: ${sentCount} sent, ${errorCount} errors`);

    // Log AI action
    await logAIAction({
      userId: 'system',
      actionType: 'weekly_growth_prompts_sent',
      sourceModule: 'ProfessionalGrowth',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Weekly growth prompts sent: ${sentCount} successful, ${errorCount} failed`,
      eventType: 'growth.weekly_prompts',
      targetType: 'system',
      targetId: 'weekly_prompts',
      aiRelevant: true,
      contextType: 'growth',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

  } catch (error: any) {
    console.error('Weekly growth prompts failed:', error);
    
    await logAIAction({
      userId: 'system',
      actionType: 'weekly_growth_prompts_sent',
      sourceModule: 'ProfessionalGrowth',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Weekly growth prompts failed: ${error.message}`,
      eventType: 'growth.weekly_prompts_failed',
      targetType: 'system',
      targetId: 'weekly_prompts',
      aiRelevant: true,
      contextType: 'growth',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
  }
});

// Helper functions
async function generateGoalInsights(goal: CareerGoal): Promise<string[]> {
  const insights = [];

  // Analyze goal characteristics
  if (goal.timeline === '30_day') {
    insights.push('This is a short-term goal that can be achieved quickly with focused effort');
  } else if (goal.timeline === '1_year') {
    insights.push('This is a long-term goal that will require sustained commitment and planning');
  }

  if (goal.category === 'skill_development') {
    insights.push('Consider breaking this down into smaller skill-building milestones');
  } else if (goal.category === 'role_advancement') {
    insights.push('This goal may benefit from mentorship and networking opportunities');
  }

  return insights;
}

async function generateActionSteps(goal: CareerGoal): Promise<ActionStep[]> {
  const actionSteps: ActionStep[] = [];

  // Generate action steps based on goal type
  switch (goal.category) {
    case 'skill_development':
      actionSteps.push({
        id: `step_${Date.now()}_1`,
        title: 'Research learning resources',
        description: 'Find courses, books, or mentors for this skill',
        status: 'pending',
        priority: 'high'
      });
      actionSteps.push({
        id: `step_${Date.now()}_2`,
        title: 'Create practice schedule',
        description: 'Set aside regular time for skill practice',
        status: 'pending',
        priority: 'medium'
      });
      break;

    case 'role_advancement':
      actionSteps.push({
        id: `step_${Date.now()}_1`,
        title: 'Update resume and LinkedIn',
        description: 'Highlight relevant experience and achievements',
        status: 'pending',
        priority: 'high'
      });
      actionSteps.push({
        id: `step_${Date.now()}_2`,
        title: 'Network with industry professionals',
        description: 'Attend events and connect with people in target roles',
        status: 'pending',
        priority: 'medium'
      });
      break;

    default:
      actionSteps.push({
        id: `step_${Date.now()}_1`,
        title: 'Break down the goal',
        description: 'Divide this goal into smaller, manageable tasks',
        status: 'pending',
        priority: 'high'
      });
  }

  return actionSteps;
}

async function generateAchievementInsights(goal: CareerGoal): Promise<string[]> {
  const insights = [];

  insights.push(`Congratulations on completing your goal: "${goal.title}"!`);
  insights.push('This achievement demonstrates your commitment to professional growth');
  
  if (goal.category === 'skill_development') {
    insights.push('Consider how this new skill can be applied in your current role');
  } else if (goal.category === 'role_advancement') {
    insights.push('This milestone brings you closer to your career advancement goals');
  }

  return insights;
}

async function createAchievementJournalEntry(userId: string, goal: CareerGoal, insights: string[]): Promise<void> {
  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.data();
  const customerId = userData?.customerId;
  const agencyId = userData?.agencyId;

  const entry: CareerJournal = {
    id: `achievement_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    userId,
    customerId,
    agencyId,
    entryType: 'achievement',
    title: `Goal Achieved: ${goal.title}`,
    content: `I successfully completed my goal: "${goal.title}". ${insights.join(' ')}`,
    mood: 9,
    energy: 8,
    confidence: 9,
    goalsReferenced: [goal.id],
    skillsMentioned: [],
    aiInsights: insights,
    aiSuggestions: ['Consider setting your next goal', 'Share this achievement with your network'],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  await db.collection('careerJournal').doc(entry.id).set(entry);
}

async function generateJournalInsights(content: string, mood: number, energy: number, confidence: number): Promise<string[]> {
  const insights = [];

  // Analyze mood patterns
  if (mood < 5) {
    insights.push('Your mood seems lower than usual - consider what might be contributing to this');
  } else if (mood > 8) {
    insights.push('You seem to be in a positive state - great time to tackle challenging goals');
  }

  // Analyze energy levels
  if (energy < 5) {
    insights.push('Your energy is low - consider taking breaks and focusing on self-care');
  }

  // Analyze confidence
  if (confidence < 5) {
    insights.push('Your confidence seems lower - remember your past achievements and strengths');
  }

  // Content analysis
  if (content.includes('challenge') || content.includes('difficult')) {
    insights.push('Challenges are opportunities for growth - you\'re building resilience');
  }

  if (content.includes('learn') || content.includes('improve')) {
    insights.push('Your focus on learning and improvement shows great growth mindset');
  }

  return insights;
}

async function generateJournalSuggestions(content: string, goalsReferenced: string[]): Promise<string[]> {
  const suggestions = [];

  if (goalsReferenced.length === 0) {
    suggestions.push('Consider connecting this reflection to your career goals');
  }

  if (content.includes('stuck') || content.includes('blocked')) {
    suggestions.push('When feeling stuck, try breaking tasks into smaller steps');
  }

  if (content.includes('success') || content.includes('achieved')) {
    suggestions.push('Celebrate this success and consider what made it possible');
  }

  suggestions.push('Reflect on what you learned from this experience');

  return suggestions;
}

function extractSkillsFromContent(content: string): string[] {
  // This would use NLP to extract skill mentions
  // For now, return empty array
  return [];
}

function analyzeSkillGaps(currentSkills: Skill[], desiredSkills: Skill[]): SkillGap[] {
  const gaps: SkillGap[] = [];

  desiredSkills.forEach(desired => {
    const current = currentSkills.find(c => c.name === desired.name);
    
    if (!current) {
      // Skill doesn't exist - need to acquire
      gaps.push({
        id: `gap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        skillName: desired.name,
        currentLevel: 'beginner',
        targetLevel: desired.level,
        priority: desired.level === 'expert' ? 'high' : 'medium',
        estimatedTimeToAchieve: estimateTimeToAchieve('beginner', desired.level),
        resources: generateSkillResources(desired.name),
        actionPlan: generateSkillActionPlan(desired.name, desired.level)
      });
    } else if (getLevelValue(current.level) < getLevelValue(desired.level)) {
      // Skill exists but needs improvement
      gaps.push({
        id: `gap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        skillName: desired.name,
        currentLevel: current.level,
        targetLevel: desired.level,
        priority: desired.level === 'expert' ? 'high' : 'medium',
        estimatedTimeToAchieve: estimateTimeToAchieve(current.level, desired.level),
        resources: generateSkillResources(desired.name),
        actionPlan: generateSkillActionPlan(desired.name, desired.level)
      });
    }
  });

  return gaps;
}

function getLevelValue(level: string): number {
  switch (level) {
    case 'beginner': return 1;
    case 'intermediate': return 2;
    case 'advanced': return 3;
    case 'expert': return 4;
    default: return 0;
  }
}

function estimateTimeToAchieve(currentLevel: string, targetLevel: string): number {
  const levelDiff = getLevelValue(targetLevel) - getLevelValue(currentLevel);
  return levelDiff * 8; // 8 weeks per level
}

function generateSkillResources(skillName: string): string[] {
  return [
    `Online courses for ${skillName}`,
    `Books on ${skillName}`,
    `Practice exercises for ${skillName}`,
    `Mentorship opportunities in ${skillName}`
  ];
}

function generateSkillActionPlan(skillName: string, targetLevel: string): string[] {
  return [
    `Research best practices for ${skillName}`,
    `Find a mentor or coach in ${skillName}`,
    `Practice ${skillName} regularly`,
    `Seek feedback on your ${skillName} progress`
  ];
}

async function generateSkillRoadmap(skillGaps: SkillGap[]): Promise<any> {
  // Sort gaps by priority and estimated time
  const sortedGaps = skillGaps.sort((a, b) => {
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    return priorityOrder[b.priority] - priorityOrder[a.priority];
  });

  return {
    recommendedOrder: sortedGaps.map(gap => gap.skillName),
    estimatedTimeline: sortedGaps.reduce((sum, gap) => sum + gap.estimatedTimeToAchieve, 0),
    highPrioritySkills: sortedGaps.filter(gap => gap.priority === 'high').map(gap => gap.skillName)
  };
}

async function checkUserEligibilityForGrowthPrompt(userId: string, userData: any): Promise<boolean> {
  // Check if user is in reset mode
  const resetModeSnapshot = await db.collection('resetMode')
    .where('userId', '==', userId)
    .where('isActive', '==', true)
    .limit(1)
    .get();

  if (!resetModeSnapshot.empty) {
    return false; // Don't send prompts during reset mode
  }

  // Check if user has recent journal entries
  const recentJournalSnapshot = await db.collection('careerJournal')
    .where('userId', '==', userId)
    .where('createdAt', '>=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
    .limit(1)
    .get();

  if (!recentJournalSnapshot.empty) {
    return false; // User has recent activity
  }

  return true;
}

async function sendGrowthPrompt(userId: string, userData: any): Promise<void> {
  // This would integrate with your notification system
  console.log(`Sending growth prompt to user ${userId}`);
}

function identifyRetentionSignals(goals: any[], journalEntries: any[], metrics: any[]): any[] {
  const signals = [];

  // Users with active goals are more likely to stay
  const usersWithActiveGoals = new Set(goals.filter(g => g.status === 'active').map(g => g.userId));
  signals.push({
    type: 'active_goals',
    count: usersWithActiveGoals.size,
    description: 'Users with active career goals'
  });

  // Users with high confidence are more likely to stay
  const highConfidenceUsers = new Set(
    journalEntries
      .filter(e => e.confidence > 7)
      .map(e => e.userId)
  );
  signals.push({
    type: 'high_confidence',
    count: highConfidenceUsers.size,
    description: 'Users showing high confidence in journal entries'
  });

  // Users with recent activity are more likely to stay
  const recentActivityUsers = new Set(
    journalEntries
      .filter(e => e.createdAt.toDate() >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
      .map(e => e.userId)
  );
  signals.push({
    type: 'recent_activity',
    count: recentActivityUsers.size,
    description: 'Users with recent professional growth activity'
  });

  return signals;
}

/**
 * Calculate organizational breakdown for growth analytics
 */
function calculateGrowthBreakdown(goals: any[], journalEntries: any[], field: string): any[] {
  const breakdown = new Map<string, { 
    goalsCreated: number; 
    goalsCompleted: number; 
    goalsInProgress: number;
    averageProgress: number;
    journalEntries: number;
    averageMood: number;
    averageConfidence: number;
    moods: number[];
    confidences: number[];
    progresses: number[];
  }>();
  
  // Process goals
  goals.forEach(goal => {
    const value = goal[field] || 'Unknown';
    if (!breakdown.has(value)) {
      breakdown.set(value, { 
        goalsCreated: 0, 
        goalsCompleted: 0, 
        goalsInProgress: 0,
        averageProgress: 0,
        journalEntries: 0,
        averageMood: 0,
        averageConfidence: 0,
        moods: [],
        confidences: [],
        progresses: []
      });
    }
    
    const entry = breakdown.get(value)!;
    entry.goalsCreated++;
    entry.progresses.push(goal.progress);
    
    if (goal.status === 'completed') {
      entry.goalsCompleted++;
    } else if (goal.status === 'in_progress') {
      entry.goalsInProgress++;
    }
  });
  
  // Process journal entries
  journalEntries.forEach(entry => {
    const value = entry[field] || 'Unknown';
    if (!breakdown.has(value)) {
      breakdown.set(value, { 
        goalsCreated: 0, 
        goalsCompleted: 0, 
        goalsInProgress: 0,
        averageProgress: 0,
        journalEntries: 0,
        averageMood: 0,
        averageConfidence: 0,
        moods: [],
        confidences: [],
        progresses: []
      });
    }
    
    const breakdownEntry = breakdown.get(value)!;
    breakdownEntry.journalEntries++;
    breakdownEntry.moods.push(entry.mood);
    breakdownEntry.confidences.push(entry.confidence);
  });
  
  return Array.from(breakdown.entries()).map(([name, stats]) => ({
    name,
    goalsCreated: stats.goalsCreated,
    goalsCompleted: stats.goalsCompleted,
    goalsInProgress: stats.goalsInProgress,
    completionRate: stats.goalsCreated > 0 ? stats.goalsCompleted / stats.goalsCreated : 0,
    averageProgress: stats.progresses.length > 0 ? stats.progresses.reduce((a, b) => a + b, 0) / stats.progresses.length : 0,
    journalEntries: stats.journalEntries,
    averageMood: stats.moods.length > 0 ? stats.moods.reduce((a, b) => a + b, 0) / stats.moods.length : 0,
    averageConfidence: stats.confidences.length > 0 ? stats.confidences.reduce((a, b) => a + b, 0) / stats.confidences.length : 0,
    percentage: ((stats.goalsCreated + stats.journalEntries) / (goals.length + journalEntries.length)) * 100
  }));
} 