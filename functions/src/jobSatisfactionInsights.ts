import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// JSI Score Interface
interface JSIScore {
  id: string;
  userId: string;
  customerId: string;
  agencyId?: string;
  userName?: string;
  department?: string;
  location?: string;
  overallScore: number;
  workEngagement: number;
  careerAlignment: number;
  managerRelationship: number;
  personalWellbeing: number;
  jobMobility: number;
  lastUpdated: admin.firestore.Timestamp;
  trend: 'up' | 'down' | 'stable';
  riskLevel: 'low' | 'medium' | 'high';
  flags: string[];
  supervisor?: string;
  team?: string;
  aiSummary?: string;
  lastSurveyResponse?: string;
  recommendedAction?: string;
}

// JSI Baseline Interface
interface JSIBaseline {
  customerId: string;
  department?: string;
  location?: string;
  overallScore: number;
  workEngagement: number;
  careerAlignment: number;
  managerRelationship: number;
  personalWellbeing: number;
  jobMobility: number;
  dateRange: {
    start: string;
    end: string;
  };
  workerCount: number;
  calculatedAt: string;
}

// JSI Benchmark Interface
interface JSIBenchmark {
  type: 'global' | 'industry';
  industryCode?: string;
  industryName?: string;
  overallScore: number;
  workEngagement: number;
  careerAlignment: number;
  managerRelationship: number;
  personalWellbeing: number;
  jobMobility: number;
  workerCount: number;
  customerCount: number;
  calculatedAt: string;
  dateRange: {
    start: string;
    end: string;
  };
  percentiles: {
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
}

// JSI Trend Data Interface
interface JSITrendData {
  date: string;
  overall: number;
  engagement: number;
  career: number;
  manager: number;
  wellbeing: number;
  mobility: number;
  workerCount: number;
}

// JSI Settings Interface
interface JSISettings {
  customerId: string;
  agencyId?: string;
  isEnabled: boolean;
  scoringWeights: {
    workEngagement: number;
    careerAlignment: number;
    managerRelationship: number;
    personalWellbeing: number;
    jobMobility: number;
  };
  alertThresholds: {
    lowScoreThreshold: number;
    rapidDropThreshold: number;
    rapidDropDays: number;
    riskFlagThreshold: number;
  };
}

// Default JSI Settings
const defaultJSISettings: JSISettings = {
  customerId: '',
  isEnabled: true,
  scoringWeights: {
    workEngagement: 0.3,
    careerAlignment: 0.2,
    managerRelationship: 0.2,
    personalWellbeing: 0.2,
    jobMobility: 0.1,
  },
  alertThresholds: {
    lowScoreThreshold: 50,
    rapidDropThreshold: 20,
    rapidDropDays: 30,
    riskFlagThreshold: 30,
  },
};

// JSI Messaging Topics Interface
interface JSIMessagingTopic {
  id: string;
  name: string;
  description: string;
  isEnabled: boolean;
  priority: 'high' | 'medium' | 'low';
  frequency: 'weekly' | 'monthly' | 'quarterly';
  samplePrompts: string[];
  category: 'wellbeing' | 'engagement' | 'career' | 'relationships' | 'custom';
  createdAt: string;
  updatedAt: string;
}

// JSI Messaging Configuration Interface
interface JSIMessagingConfig {
  customerId: string;
  agencyId?: string;
  topics: JSIMessagingTopic[];
  globalSettings: {
    enableCustomTopics: boolean;
    maxTopicsPerPrompt: number;
    topicRotationStrategy: 'random' | 'priority' | 'frequency';
    defaultFrequency: 'weekly' | 'monthly' | 'quarterly';
  };
  createdAt: string;
  updatedAt: string;
}

// Default messaging topics
const defaultJSITopics: JSIMessagingTopic[] = [
  {
    id: 'work_life_balance',
    name: 'Work-Life Balance',
    description: 'Explore how work fits into overall life satisfaction',
    isEnabled: true,
    priority: 'high',
    frequency: 'weekly',
    samplePrompts: [
      'How are you feeling about your work-life balance lately?',
      'Are you able to disconnect from work when you\'re off the clock?',
      'How does your current schedule work with your personal life?'
    ],
    category: 'wellbeing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'mental_health',
    name: 'Mental Health',
    description: 'Check in on emotional wellbeing and stress',
    isEnabled: true,
    priority: 'high',
    frequency: 'weekly',
    samplePrompts: [
      'How has your stress level been this week?',
      'Are you feeling supported in managing work-related stress?',
      'How are you doing emotionally with everything going on?'
    ],
    category: 'wellbeing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'career_growth',
    name: 'Career Growth',
    description: 'Ask about long-term goals, skills growth, and mentorship desires',
    isEnabled: true,
    priority: 'medium',
    frequency: 'monthly',
    samplePrompts: [
      'What skills would you like to develop in your role?',
      'How do you see your career progressing here?',
      'Are you getting the opportunities you need to grow professionally?'
    ],
    category: 'career',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'vibe_check',
    name: 'Vibe Check / Daily Mood',
    description: 'Lightweight rapport and engagement questions',
    isEnabled: true,
    priority: 'medium',
    frequency: 'weekly',
    samplePrompts: [
      'How\'s your day going so far?',
      'What\'s been the highlight of your week?',
      'How are you feeling about work today?'
    ],
    category: 'engagement',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'manager_relationship',
    name: 'Relationship with Manager',
    description: 'Questions about clarity, trust, communication',
    isEnabled: true,
    priority: 'high',
    frequency: 'monthly',
    samplePrompts: [
      'How would you describe your relationship with your manager?',
      'Do you feel you get clear direction and feedback?',
      'How comfortable are you approaching your manager with concerns?'
    ],
    category: 'relationships',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'job_role_clarity',
    name: 'Job Role Clarity',
    description: 'Does the worker understand what\'s expected of them?',
    isEnabled: true,
    priority: 'medium',
    frequency: 'monthly',
    samplePrompts: [
      'How clear are you about your role and responsibilities?',
      'Do you feel you have the information you need to do your job well?',
      'Are there any aspects of your role that feel unclear?'
    ],
    category: 'engagement',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'recognition_appreciation',
    name: 'Recognition & Appreciation',
    description: 'Do they feel valued at work?',
    isEnabled: true,
    priority: 'medium',
    frequency: 'monthly',
    samplePrompts: [
      'Do you feel your contributions are recognized?',
      'How often do you receive positive feedback?',
      'Do you feel appreciated for the work you do?'
    ],
    category: 'engagement',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'burnout_fatigue',
    name: 'Burnout & Fatigue',
    description: 'Are they mentally or physically exhausted?',
    isEnabled: true,
    priority: 'high',
    frequency: 'weekly',
    samplePrompts: [
      'How would you rate your energy level lately?',
      'Are you feeling mentally or physically exhausted?',
      'Do you feel like you need a break?'
    ],
    category: 'wellbeing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'job_search_behavior',
    name: 'Looking for Other Work',
    description: 'Subtle detection of job search behavior',
    isEnabled: true,
    priority: 'high',
    frequency: 'monthly',
    samplePrompts: [
      'How satisfied are you with your current role?',
      'Do you see yourself staying here long-term?',
      'What would make you consider other opportunities?'
    ],
    category: 'career',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'happiness_outside_work',
    name: 'Happiness Outside of Work',
    description: 'Family, finances, housing, etc. as long-term risk flags',
    isEnabled: true,
    priority: 'low',
    frequency: 'quarterly',
    samplePrompts: [
      'How are things going outside of work?',
      'Are there any personal challenges affecting your work?',
      'How would you rate your overall life satisfaction?'
    ],
    category: 'wellbeing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

// JSI Scoring Algorithm
export const generateJSIScore = onCall(async (request) => {
  try {
    const { userId, customerId, agencyId } = request.data;
    
    if (!userId || !customerId) {
      throw new Error('Missing required parameters: userId, customerId');
    }

    logger.info(`Generating JSI score for user ${userId} in customer ${customerId}`);

    // Get user's JSI settings
    const settingsDoc = await db.collection('jsiSettings').doc(customerId).get();
    const settings: JSISettings = settingsDoc.exists 
      ? { ...defaultJSISettings, ...settingsDoc.data() }
      : defaultJSISettings;

    if (!settings.isEnabled) {
      throw new Error('JSI is not enabled for this customer');
    }

    // Calculate dimension scores (simplified for now)
    const workEngagement = Math.floor(Math.random() * 40) + 30; // 30-70
    const careerAlignment = Math.floor(Math.random() * 40) + 30;
    const managerRelationship = Math.floor(Math.random() * 40) + 30;
    const personalWellbeing = Math.floor(Math.random() * 40) + 30;
    const jobMobility = Math.floor(Math.random() * 40) + 30;

    // Calculate overall score using weights
    const overallScore = 
      workEngagement * settings.scoringWeights.workEngagement +
      careerAlignment * settings.scoringWeights.careerAlignment +
      managerRelationship * settings.scoringWeights.managerRelationship +
      personalWellbeing * settings.scoringWeights.personalWellbeing +
      jobMobility * settings.scoringWeights.jobMobility;

    // Determine trend
    const trend = await calculateTrend(userId, overallScore);

    // Determine risk level
    const riskLevel = determineRiskLevel(overallScore, settings.alertThresholds);

    // Generate flags
    const flags = generateFlags({
      workEngagement,
      careerAlignment,
      managerRelationship,
      personalWellbeing,
      jobMobility
    }, overallScore, settings.alertThresholds);

    // Create JSI score object
    const jsiScore: JSIScore = {
      id: `${userId}_${customerId}`,
      userId,
      customerId,
      agencyId,
      overallScore: Math.round(overallScore),
      workEngagement,
      careerAlignment,
      managerRelationship,
      personalWellbeing,
      jobMobility,
      lastUpdated: admin.firestore.Timestamp.now(),
      trend,
      riskLevel,
      flags,
    };

    // Save to Firestore
    await db.collection('jsiScores').doc(jsiScore.id).set(jsiScore);

    // Log the score generation
    await db.collection('jsiLogs').add({
      userId,
      customerId,
      agencyId,
      action: 'score_generated',
      overallScore: jsiScore.overallScore,
      riskLevel: jsiScore.riskLevel,
      flags: jsiScore.flags,
      timestamp: admin.firestore.Timestamp.now(),
    });

    // Log AI action for analytics
    await db.collection('aiActions').add({
      userId: 'system',
      actionType: 'jsi_score_generated',
      sourceModule: 'JobSatisfactionInsights',
      customerId,
      success: true,
      latencyMs: 0,
      versionTag: 'v1.0',
      reason: `JSI score generated for user ${userId}`,
      eventType: 'jsi.score_generated',
      targetType: 'worker',
      targetId: userId,
      aiRelevant: true,
      contextType: 'jsi_scoring',
      traitsAffected: null,
      aiTags: ['jsi', 'satisfaction', 'scoring'],
      urgencyScore: riskLevel === 'high' ? 0.8 : riskLevel === 'medium' ? 0.5 : 0.2
    });

    // Trigger risk alerts if needed
    if (riskLevel === 'high' || flags.length > 0) {
      await triggerRiskAlerts(jsiScore, settings);
    }

    logger.info(`JSI score generated for user ${userId}: ${overallScore} (${riskLevel} risk)`);

    return {
      success: true,
      score: jsiScore,
    };

  } catch (error: any) {
    logger.error('Error generating JSI score:', error);
    
    // Log failed AI action
    try {
      await db.collection('aiActions').add({
        userId: 'system',
        actionType: 'jsi_score_generation_failed',
        sourceModule: 'JobSatisfactionInsights',
        customerId: request.data?.customerId || 'unknown',
        success: false,
        latencyMs: 0,
        versionTag: 'v1.0',
        reason: `Failed to generate JSI score: ${error.message}`,
        eventType: 'jsi.score_generation_failed',
        targetType: 'worker',
        targetId: request.data?.userId || 'unknown',
        aiRelevant: true,
        contextType: 'jsi_scoring',
        traitsAffected: null,
        aiTags: ['jsi', 'satisfaction', 'error'],
        urgencyScore: 0.9
      });
    } catch (logError) {
      logger.error('Failed to log AI action:', logError);
    }
    
    throw new Error(`Failed to generate JSI score: ${error.message}`);
  }
});

// Calculate trend based on historical scores
async function calculateTrend(userId: string, currentScore: number): Promise<'up' | 'down' | 'stable'> {
  try {
    // Get previous scores
    const scoresSnapshot = await db.collection('jsiScores')
      .where('userId', '==', userId)
      .orderBy('lastUpdated', 'desc')
      .limit(3)
      .get();
    
    const scores = scoresSnapshot.docs.map(doc => doc.data() as JSIScore);

    if (scores.length < 2) {
      return 'stable';
    }

    const previousScore = scores[1].overallScore;
    const difference = currentScore - previousScore;

    if (difference > 5) return 'up';
    if (difference < -5) return 'down';
    return 'stable';

  } catch (error) {
    logger.error('Error calculating trend:', error);
    return 'stable';
  }
}

// Determine risk level based on score and thresholds
function determineRiskLevel(score: number, thresholds: JSISettings['alertThresholds']): 'low' | 'medium' | 'high' {
  if (score <= thresholds.riskFlagThreshold) return 'high';
  if (score <= thresholds.lowScoreThreshold) return 'medium';
  return 'low';
}

// Generate risk flags
function generateFlags(
  dimensionScores: {
    workEngagement: number;
    careerAlignment: number;
    managerRelationship: number;
    personalWellbeing: number;
    jobMobility: number;
  }, 
  overallScore: number, 
  thresholds: JSISettings['alertThresholds']
): string[] {
  const flags: string[] = [];

  if (overallScore <= thresholds.lowScoreThreshold) {
    flags.push('low_overall_score');
  }

  if (dimensionScores.workEngagement <= 40) {
    flags.push('low_engagement');
  }

  if (dimensionScores.careerAlignment <= 40) {
    flags.push('career_misalignment');
  }

  if (dimensionScores.managerRelationship <= 40) {
    flags.push('manager_issues');
  }

  if (dimensionScores.jobMobility <= 30) {
    flags.push('mobility_risk');
  }

  if (dimensionScores.personalWellbeing <= 40) {
    flags.push('wellbeing_concern');
  }

  return flags;
}

// Trigger risk alerts
async function triggerRiskAlerts(score: JSIScore, settings: JSISettings) {
  try {
    // Create alert document
    await db.collection('jsiAlerts').add({
      userId: score.userId,
      customerId: score.customerId,
      agencyId: score.agencyId,
      riskLevel: score.riskLevel,
      overallScore: score.overallScore,
      flags: score.flags,
      createdAt: admin.firestore.Timestamp.now(),
      status: 'active',
      priority: score.riskLevel === 'high' ? 'urgent' : 'normal',
    });

    // Log alert creation
    await db.collection('jsiLogs').add({
      userId: score.userId,
      customerId: score.customerId,
      agencyId: score.agencyId,
      action: 'risk_alert_created',
      riskLevel: score.riskLevel,
      flags: score.flags,
      timestamp: admin.firestore.Timestamp.now(),
    });

    logger.info(`Risk alert created for user ${score.userId} with ${score.riskLevel} risk level`);
  } catch (error) {
    logger.error('Error triggering risk alerts:', error);
  }
}

// Get JSI aggregate statistics
export const getJSIAggregateStats = onCall(async (request) => {
  try {
    const { customerId } = request.data;
    
    if (!customerId) {
      throw new Error('Missing required parameter: customerId');
    }

    // Get all JSI scores for the customer
    const scoresSnapshot = await db.collection('jsiScores')
      .where('customerId', '==', customerId)
      .get();
    
    const scores = scoresSnapshot.docs.map(doc => doc.data() as JSIScore);

    if (scores.length === 0) {
      return {
        success: true,
        data: {
          totalWorkers: 0,
          averageScore: 0,
          scoreDistribution: { low: 0, medium: 0, high: 0 },
          riskDistribution: { low: 0, medium: 0, high: 0 },
          trends: { improving: 0, declining: 0, stable: 0 }
        }
      };
    }

    // Calculate statistics
    const totalWorkers = scores.length;
    const averageScore = scores.reduce((sum, score) => sum + score.overallScore, 0) / totalWorkers;
    
    const scoreDistribution = {
      low: scores.filter(s => s.overallScore < 50).length,
      medium: scores.filter(s => s.overallScore >= 50 && s.overallScore < 70).length,
      high: scores.filter(s => s.overallScore >= 70).length
    };

    const riskDistribution = {
      low: scores.filter(s => s.riskLevel === 'low').length,
      medium: scores.filter(s => s.riskLevel === 'medium').length,
      high: scores.filter(s => s.riskLevel === 'high').length
    };

    const trends = {
      improving: scores.filter(s => s.trend === 'up').length,
      declining: scores.filter(s => s.trend === 'down').length,
      stable: scores.filter(s => s.trend === 'stable').length
    };

    return {
      success: true,
      data: {
        totalWorkers,
        averageScore: Math.round(averageScore),
        scoreDistribution,
        riskDistribution,
        trends
      }
    };

  } catch (error: any) {
    logger.error('Error getting JSI aggregate stats:', error);
    throw new Error(`Failed to get JSI aggregate stats: ${error.message}`);
  }
});

// Trigger JSI prompts
export const triggerJSIPrompts = onCall(async (request) => {
  try {
    const { userId, customerId, promptType, dimension } = request.data;
    
    if (!userId || !customerId) {
      throw new Error('Missing required parameters: userId, customerId');
    }

    logger.info(`Triggering JSI prompt for user ${userId}, type: ${promptType}`);

    // Create prompt document
    const promptData = {
      userId,
      customerId,
      promptType: promptType || 'flagged',
      dimension: dimension || 'workEngagement',
      promptText: `How are you feeling about your ${dimension || 'work engagement'} lately?`,
      createdAt: admin.firestore.Timestamp.now(),
      status: 'sent'
    };

    await db.collection('jsiPrompts').add(promptData);

    // Log the prompt trigger
    await db.collection('aiActions').add({
      userId: 'system',
      actionType: 'jsi_prompt_triggered',
      sourceModule: 'JobSatisfactionInsights',
      customerId,
      success: true,
      latencyMs: 0,
      versionTag: 'v1.0',
      reason: `Triggered ${promptType} prompt for user ${userId}`,
      eventType: 'jsi.prompt_triggered',
      targetType: 'worker',
      targetId: userId,
      aiRelevant: true,
      contextType: 'jsi_prompting',
      traitsAffected: null,
      aiTags: ['jsi', 'satisfaction', 'prompt'],
      urgencyScore: 0.6
    });

    return {
      success: true,
      message: 'Prompt triggered successfully'
    };

  } catch (error: any) {
    logger.error('Error triggering JSI prompt:', error);
    throw new Error(`Failed to trigger JSI prompt: ${error.message}`);
  }
});

// Establish JSI baseline for a customer
export const establishJSIBaseline = onCall(async (request) => {
  try {
    const { customerId, department, location } = request.data;
    
    if (!customerId) {
      throw new Error('Missing required parameter: customerId');
    }

    logger.info(`Establishing JSI baseline for customer ${customerId}`);

    // Get JSI scores from the last 14 days
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    
    const scoresQuery = db.collection('jsiScores')
      .where('customerId', '==', customerId)
      .where('lastUpdated', '>=', admin.firestore.Timestamp.fromDate(fourteenDaysAgo));

    if (department && department !== 'all') {
      scoresQuery.where('department', '==', department);
    }
    if (location && location !== 'all') {
      scoresQuery.where('location', '==', location);
    }

    const scoresSnapshot = await scoresQuery.get();
    const scores = scoresSnapshot.docs.map(doc => doc.data() as JSIScore);

    if (scores.length === 0) {
      throw new Error('No JSI scores found for baseline calculation');
    }

    // Calculate baseline averages
    const totalScores = scores.reduce((acc, score) => ({
      overall: acc.overall + score.overallScore,
      engagement: acc.engagement + score.workEngagement,
      career: acc.career + score.careerAlignment,
      manager: acc.manager + score.managerRelationship,
      wellbeing: acc.wellbeing + score.personalWellbeing,
      mobility: acc.mobility + score.jobMobility
    }), {
      overall: 0, engagement: 0, career: 0, manager: 0, wellbeing: 0, mobility: 0
    });

    const baseline: JSIBaseline = {
      customerId,
      department: department !== 'all' ? department : undefined,
      location: location !== 'all' ? location : undefined,
      overallScore: Math.round(totalScores.overall / scores.length),
      workEngagement: Math.round(totalScores.engagement / scores.length),
      careerAlignment: Math.round(totalScores.career / scores.length),
      managerRelationship: Math.round(totalScores.manager / scores.length),
      personalWellbeing: Math.round(totalScores.wellbeing / scores.length),
      jobMobility: Math.round(totalScores.mobility / scores.length),
      dateRange: {
        start: fourteenDaysAgo.toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
      },
      workerCount: scores.length,
      calculatedAt: new Date().toISOString()
    };

    // Save baseline to Firestore
    const baselineId = `${customerId}_${department || 'all'}_${location || 'all'}`;
    await db.collection('jsiBaselines').doc(baselineId).set(baseline);

    // Log baseline establishment
    await db.collection('aiActions').add({
      userId: 'system',
      actionType: 'jsi_baseline_established',
      sourceModule: 'JobSatisfactionInsights',
      customerId,
      success: true,
      latencyMs: 0,
      versionTag: 'v1.0',
      reason: `Established JSI baseline for ${department || 'all'} department, ${location || 'all'} location`,
      eventType: 'jsi.baseline_established',
      targetType: 'baseline',
      targetId: baselineId,
      aiRelevant: true,
      contextType: 'jsi_baseline',
      traitsAffected: null,
      aiTags: ['jsi', 'baseline', 'analytics'],
      urgencyScore: 0.3
    });

    return {
      success: true,
      data: baseline
    };

  } catch (error: any) {
    logger.error('Error establishing JSI baseline:', error);
    throw new Error(`Failed to establish JSI baseline: ${error.message}`);
  }
});

// Get JSI trend data
export const getJSITrendData = onCall(async (request) => {
  try {
    const { customerId, department, location, timeRange } = request.data;
    
    if (!customerId) {
      throw new Error('Missing required parameter: customerId');
    }

    logger.info(`Getting JSI trend data for customer ${customerId}`);

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    const days = parseInt(timeRange || '90');
    startDate.setDate(startDate.getDate() - days);

    // Get JSI scores within the date range
    const scoresQuery = db.collection('jsiScores')
      .where('customerId', '==', customerId)
      .where('lastUpdated', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .where('lastUpdated', '<=', admin.firestore.Timestamp.fromDate(endDate))
      .orderBy('lastUpdated', 'asc');

    if (department && department !== 'all') {
      scoresQuery.where('department', '==', department);
    }
    if (location && location !== 'all') {
      scoresQuery.where('location', '==', location);
    }

    const scoresSnapshot = await scoresQuery.get();
    const scores = scoresSnapshot.docs.map(doc => doc.data() as JSIScore);

    // Group scores by week and calculate averages
    const weeklyData: { [key: string]: JSIScore[] } = {};
    
    scores.forEach(score => {
      const date = score.lastUpdated.toDate();
      const weekStart = new Date(date);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of week (Sunday)
      const weekKey = weekStart.toISOString().split('T')[0];
      
      if (!weeklyData[weekKey]) {
        weeklyData[weekKey] = [];
      }
      weeklyData[weekKey].push(score);
    });

    // Calculate weekly averages
    const trendData: JSITrendData[] = Object.keys(weeklyData)
      .sort()
      .map(weekKey => {
        const weekScores = weeklyData[weekKey];
        const totalScores = weekScores.reduce((acc, score) => ({
          overall: acc.overall + score.overallScore,
          engagement: acc.engagement + score.workEngagement,
          career: acc.career + score.careerAlignment,
          manager: acc.manager + score.managerRelationship,
          wellbeing: acc.wellbeing + score.personalWellbeing,
          mobility: acc.mobility + score.jobMobility
        }), {
          overall: 0, engagement: 0, career: 0, manager: 0, wellbeing: 0, mobility: 0
        });

        return {
          date: weekKey,
          overall: Math.round(totalScores.overall / weekScores.length),
          engagement: Math.round(totalScores.engagement / weekScores.length),
          career: Math.round(totalScores.career / weekScores.length),
          manager: Math.round(totalScores.manager / weekScores.length),
          wellbeing: Math.round(totalScores.wellbeing / weekScores.length),
          mobility: Math.round(totalScores.mobility / weekScores.length),
          workerCount: weekScores.length
        };
      });

    return {
      success: true,
      data: trendData
    };

  } catch (error: any) {
    logger.error('Error getting JSI trend data:', error);
    throw new Error(`Failed to get JSI trend data: ${error.message}`);
  }
});

// Get JSI baseline data
export const getJSIBaseline = onCall(async (request) => {
  try {
    const { customerId, department, location } = request.data;
    
    if (!customerId) {
      throw new Error('Missing required parameter: customerId');
    }

    logger.info(`Getting JSI baseline for customer ${customerId}`);

    const baselineId = `${customerId}_${department || 'all'}_${location || 'all'}`;
    const baselineDoc = await db.collection('jsiBaselines').doc(baselineId).get();

    if (!baselineDoc.exists) {
      // If no baseline exists, establish one
      const establishResult = await establishJSIBaseline({
        data: { customerId, department, location }
      } as any, {} as any);
      return establishResult;
    }

    return {
      success: true,
      data: baselineDoc.data() as JSIBaseline
    };

  } catch (error: any) {
    logger.error('Error getting JSI baseline:', error);
    throw new Error(`Failed to get JSI baseline: ${error.message}`);
  }
});

// Flag JSI risk
export const flagJSIRisk = onCall(async (request) => {
  try {
    const { userId, customerId, riskType, description, severity } = request.data;
    
    if (!userId || !customerId) {
      throw new Error('Missing required parameters: userId, customerId');
    }

    logger.info(`Flagging JSI risk for user ${userId}, type: ${riskType}`);

    // Create risk flag document
    const riskFlagData = {
      userId,
      customerId,
      riskType: riskType || 'manual',
      description: description || 'Manual risk flag',
      severity: severity || 'medium',
      createdAt: admin.firestore.Timestamp.now(),
      status: 'active'
    };

    await db.collection('jsiRiskFlags').add(riskFlagData);

    // Log the risk flag
    await db.collection('aiActions').add({
      userId: 'system',
      actionType: 'jsi_risk_flagged',
      sourceModule: 'JobSatisfactionInsights',
      customerId,
      success: true,
      latencyMs: 0,
      versionTag: 'v1.0',
      reason: `Risk flag added for user ${userId}: ${description}`,
      eventType: 'jsi.risk_flagged',
      targetType: 'worker',
      targetId: userId,
      aiRelevant: true,
      contextType: 'jsi_risk_management',
      traitsAffected: null,
      aiTags: ['jsi', 'satisfaction', 'risk'],
      urgencyScore: 0.9
    });

    return {
      success: true,
      message: 'Risk flag added successfully'
    };

  } catch (error: any) {
    logger.error('Error flagging JSI risk:', error);
    throw new Error(`Failed to flag JSI risk: ${error.message}`);
  }
});

// Enhanced JSI Reporting Functions

// Detect anomalies in JSI scores
export const detectJSIAnomalies = onCall(async (request) => {
  try {
    const { customerId, department, location, timeRange } = request.data;
    
    if (!customerId) {
      throw new Error('Missing required parameter: customerId');
    }

    logger.info(`Detecting JSI anomalies for customer ${customerId}`);

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    const days = parseInt(timeRange || '30');
    startDate.setDate(startDate.getDate() - days);

    // Get JSI scores within the date range
    const scoresQuery = db.collection('jsiScores')
      .where('customerId', '==', customerId)
      .where('lastUpdated', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .where('lastUpdated', '<=', admin.firestore.Timestamp.fromDate(endDate))
      .orderBy('lastUpdated', 'desc');

    if (department && department !== 'all') {
      scoresQuery.where('department', '==', department);
    }
    if (location && location !== 'all') {
      scoresQuery.where('location', '==', location);
    }

    const scoresSnapshot = await scoresQuery.get();
    const scores = scoresSnapshot.docs.map(doc => doc.data() as JSIScore);

    // Group scores by user to analyze individual trends
    const userScores: { [userId: string]: JSIScore[] } = {};
    scores.forEach(score => {
      if (!userScores[score.userId]) {
        userScores[score.userId] = [];
      }
      userScores[score.userId].push(score);
    });

    const anomalies: any[] = [];

    // Analyze each user's scores for anomalies
    Object.keys(userScores).forEach(userId => {
      const userScoreHistory = userScores[userId].sort((a, b) => 
        a.lastUpdated.toMillis() - b.lastUpdated.toMillis()
      );

      if (userScoreHistory.length >= 2) {
        const latestScore = userScoreHistory[userScoreHistory.length - 1];
        const previousScore = userScoreHistory[userScoreHistory.length - 2];
        const scoreDrop = previousScore.overallScore - latestScore.overallScore;

                 // Detect rapid drops (>20 points in 30 days)
         if (scoreDrop > 20) {
           anomalies.push({
             userId,
             type: 'rapid_drop',
             severity: 'high',
             description: `Rapid score drop of ${scoreDrop} points detected`,
             scoreDrop,
             currentScore: latestScore.overallScore,
             previousScore: previousScore.overallScore,
             detectedAt: new Date().toISOString(),
             department: latestScore.department || 'Unknown',
             location: latestScore.location || 'Unknown'
           });
         }

         // Detect sustained low scores
         if (latestScore.overallScore < 50 && previousScore.overallScore < 50) {
           anomalies.push({
             userId,
             type: 'sustained_low_score',
             severity: 'medium',
             description: 'Sustained low JSI score detected',
             currentScore: latestScore.overallScore,
             previousScore: previousScore.overallScore,
             detectedAt: new Date().toISOString(),
             department: latestScore.department || 'Unknown',
             location: latestScore.location || 'Unknown'
           });
         }
      }
    });

    // Save anomalies to Firestore
    for (const anomaly of anomalies) {
      await db.collection('jsiAnomalies').add({
        ...anomaly,
        customerId,
        createdAt: admin.firestore.Timestamp.now(),
        status: 'active'
      });
    }

    return {
      success: true,
      data: {
        anomalies,
        totalDetected: anomalies.length,
        timeRange: { start: startDate.toISOString(), end: endDate.toISOString() }
      }
    };

  } catch (error: any) {
    logger.error('Error detecting JSI anomalies:', error);
    throw new Error(`Failed to detect JSI anomalies: ${error.message}`);
  }
});

// Get comprehensive JSI report data
export const getJSIReportData = onCall(async (request) => {
  try {
    const { 
      customerId, 
      department, 
      location, 
      timeRange, 
      includePersonalWellbeing,
      // reportType - unused parameter, keeping for future use 
    } = request.data;
    
    if (!customerId) {
      throw new Error('Missing required parameter: customerId');
    }

    logger.info(`Generating JSI report for customer ${customerId}`);

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    const days = parseInt(timeRange || '90');
    startDate.setDate(startDate.getDate() - days);

    // Get JSI scores
    const scoresQuery = db.collection('jsiScores')
      .where('customerId', '==', customerId)
      .where('lastUpdated', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .where('lastUpdated', '<=', admin.firestore.Timestamp.fromDate(endDate))
      .orderBy('lastUpdated', 'desc');

    if (department && department !== 'all') {
      scoresQuery.where('department', '==', department);
    }
    if (location && location !== 'all') {
      scoresQuery.where('location', '==', location);
    }

    const scoresSnapshot = await scoresQuery.get();
    const scores = scoresSnapshot.docs.map(doc => doc.data() as JSIScore);

    // Get baseline data
    const baselineId = `${customerId}_${department || 'all'}_${location || 'all'}`;
    const baselineDoc = await db.collection('jsiBaselines').doc(baselineId).get();
    const baseline = baselineDoc.exists ? baselineDoc.data() as JSIBaseline : null;

    // Calculate comprehensive statistics
    const totalWorkers = scores.length;
    const averageScore = totalWorkers > 0 ? 
      scores.reduce((sum, score) => sum + score.overallScore, 0) / totalWorkers : 0;

    // Score distribution
    const scoreDistribution = {
      excellent: scores.filter(s => s.overallScore >= 80).length,
      good: scores.filter(s => s.overallScore >= 60 && s.overallScore < 80).length,
      fair: scores.filter(s => s.overallScore >= 40 && s.overallScore < 60).length,
      poor: scores.filter(s => s.overallScore < 40).length
    };

    // Risk distribution
    const riskDistribution = {
      low: scores.filter(s => s.riskLevel === 'low').length,
      medium: scores.filter(s => s.riskLevel === 'medium').length,
      high: scores.filter(s => s.riskLevel === 'high').length
    };

    // Trend distribution
    const trendDistribution = {
      improving: scores.filter(s => s.trend === 'up').length,
      declining: scores.filter(s => s.trend === 'down').length,
      stable: scores.filter(s => s.trend === 'stable').length
    };

    // Department breakdown
    const departmentStats: { [dept: string]: any } = {};
    scores.forEach(score => {
      const dept = score.department || 'Unknown';
      if (!departmentStats[dept]) {
        departmentStats[dept] = {
          count: 0,
          totalScore: 0,
          riskLevels: { low: 0, medium: 0, high: 0 }
        };
      }
      departmentStats[dept].count++;
      departmentStats[dept].totalScore += score.overallScore;
      departmentStats[dept].riskLevels[score.riskLevel]++;
    });

    // Calculate averages for departments
    Object.keys(departmentStats).forEach(dept => {
      departmentStats[dept].averageScore = 
        Math.round(departmentStats[dept].totalScore / departmentStats[dept].count);
    });

    // Location breakdown
    const locationStats: { [loc: string]: any } = {};
    scores.forEach(score => {
      const loc = score.location || 'Unknown';
      if (!locationStats[loc]) {
        locationStats[loc] = {
          count: 0,
          totalScore: 0,
          riskLevels: { low: 0, medium: 0, high: 0 }
        };
      }
      locationStats[loc].count++;
      locationStats[loc].totalScore += score.overallScore;
      locationStats[loc].riskLevels[score.riskLevel]++;
    });

    // Calculate averages for locations
    Object.keys(locationStats).forEach(loc => {
      locationStats[loc].averageScore = 
        Math.round(locationStats[loc].totalScore / locationStats[loc].count);
    });

    // Top performers and concerns
    const sortedScores = [...scores].sort((a, b) => b.overallScore - a.overallScore);
    const topPerformers = sortedScores.slice(0, 5);
    const topConcerns = sortedScores.slice(-5).reverse();

    // Calculate baseline comparison
    const baselineComparison = baseline ? {
      currentAverage: Math.round(averageScore),
      baselineAverage: baseline.overallScore,
      percentageChange: Math.round(((averageScore - baseline.overallScore) / baseline.overallScore) * 100),
      trend: averageScore > baseline.overallScore ? 'improving' : 
             averageScore < baseline.overallScore ? 'declining' : 'stable'
    } : null;

    const reportData = {
      summary: {
        totalWorkers,
        averageScore: Math.round(averageScore),
        dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
        baselineComparison
      },
      distributions: {
        score: scoreDistribution,
        risk: riskDistribution,
        trend: trendDistribution
      },
      breakdowns: {
        departments: departmentStats,
        locations: locationStats
      },
      highlights: {
        topPerformers,
        topConcerns
      },
      baseline: baseline,
      filters: {
        department,
        location,
        timeRange,
        includePersonalWellbeing
      }
    };

    return {
      success: true,
      data: reportData
    };

  } catch (error: any) {
    logger.error('Error generating JSI report:', error);
    throw new Error(`Failed to generate JSI report: ${error.message}`);
  }
});

// Automated JSI Insights Generation
export const generateAutomatedJSIInsights = onCall(async (request) => {
  try {
    const { customerId, agencyId, timeRange, includeOrganizational } = request.data;
    
    if (!customerId) {
      throw new Error('Missing required parameter: customerId');
    }

    logger.info(`Generating automated JSI insights for customer ${customerId}`);

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    const days = parseInt(timeRange || '30');
    startDate.setDate(startDate.getDate() - days);

    // Get JSI scores
    const scoresQuery = db.collection('jsiScores')
      .where('customerId', '==', customerId)
      .where('lastUpdated', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .where('lastUpdated', '<=', admin.firestore.Timestamp.fromDate(endDate))
      .orderBy('lastUpdated', 'desc');

    const scoresSnapshot = await scoresQuery.get();
    const scores = scoresSnapshot.docs.map(doc => doc.data() as JSIScore);

    if (scores.length === 0) {
      throw new Error('No JSI scores found for insights generation');
    }

    // Generate automated insights
    const insights = await generateInsights(scores, includeOrganizational);

    // Save insights to Firestore
    const insightsId = `${customerId}_${startDate.toISOString().split('T')[0]}_${endDate.toISOString().split('T')[0]}`;
    await db.collection('jsiAutomatedInsights').doc(insightsId).set({
      customerId,
      agencyId,
      insights,
      dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
      generatedAt: new Date().toISOString(),
      scoreCount: scores.length,
      includeOrganizational
    });

    // Log AI action
    await db.collection('aiActions').add({
      userId: 'system',
      actionType: 'jsi_automated_insights_generated',
      sourceModule: 'JobSatisfactionInsights',
      customerId,
      success: true,
      latencyMs: 0,
      versionTag: 'v1.0',
      reason: `Generated automated insights for ${scores.length} workers`,
      eventType: 'jsi.insights_generated',
      targetType: 'insights',
      targetId: insightsId,
      aiRelevant: true,
      contextType: 'jsi_insights',
      traitsAffected: null,
      aiTags: ['jsi', 'insights', 'automation'],
      urgencyScore: 0.4
    });

    return {
      success: true,
      data: insights
    };

  } catch (error: any) {
    logger.error('Error generating automated JSI insights:', error);
    throw new Error(`Failed to generate automated insights: ${error.message}`);
  }
});

// Generate insights from JSI data
async function generateInsights(scores: JSIScore[], includeOrganizational: boolean = false) {
  const insights = {
    summary: {
      totalWorkers: scores.length,
      averageScore: Math.round(scores.reduce((sum, s) => sum + s.overallScore, 0) / scores.length),
      riskLevels: {
        high: scores.filter(s => s.riskLevel === 'high').length,
        medium: scores.filter(s => s.riskLevel === 'medium').length,
        low: scores.filter(s => s.riskLevel === 'low').length
      },
      trends: {
        improving: scores.filter(s => s.trend === 'up').length,
        declining: scores.filter(s => s.trend === 'down').length,
        stable: scores.filter(s => s.trend === 'stable').length
      }
    },
    keyFindings: [] as string[],
    recommendations: [] as string[],
    alerts: [] as string[],
    organizational: includeOrganizational ? {} : null
  };

  // Generate key findings
  const avgScore = insights.summary.averageScore;
  if (avgScore < 50) {
    insights.keyFindings.push('Overall job satisfaction is below optimal levels');
    insights.recommendations.push('Implement immediate intervention programs for low-scoring workers');
  } else if (avgScore < 70) {
    insights.keyFindings.push('Job satisfaction is moderate with room for improvement');
    insights.recommendations.push('Focus on targeted improvements in specific satisfaction dimensions');
  } else {
    insights.keyFindings.push('Job satisfaction is strong across the organization');
    insights.recommendations.push('Maintain current positive practices and monitor for sustained performance');
  }

  // Analyze risk levels
  const highRiskCount = insights.summary.riskLevels.high;
  if (highRiskCount > scores.length * 0.1) {
    insights.alerts.push(`High risk workers represent ${Math.round(highRiskCount / scores.length * 100)}% of workforce`);
    insights.recommendations.push('Prioritize high-risk worker interventions and support programs');
  }

  // Analyze trends
  const decliningCount = insights.summary.trends.declining;
  if (decliningCount > scores.length * 0.2) {
    insights.alerts.push(`Declining satisfaction trends detected in ${Math.round(decliningCount / scores.length * 100)}% of workers`);
    insights.recommendations.push('Investigate root causes of declining satisfaction and implement corrective measures');
  }

  // Organizational insights if requested
  if (includeOrganizational) {
    insights.organizational = await generateOrganizationalInsights(scores);
  }

  return insights;
}

// Generate organizational insights
async function generateOrganizationalInsights(scores: JSIScore[]) {
  const organizational = {
    departments: {} as any,
    locations: {} as any,
    regions: {} as any,
    divisions: {} as any
  };

  // Department analysis
  const deptGroups = scores.reduce((acc, score) => {
    const dept = score.department || 'Unknown';
    if (!acc[dept]) acc[dept] = [];
    acc[dept].push(score);
    return acc;
  }, {} as { [key: string]: JSIScore[] });

  Object.keys(deptGroups).forEach(dept => {
    const deptScores = deptGroups[dept];
    const avgScore = deptScores.reduce((sum, s) => sum + s.overallScore, 0) / deptScores.length;
    const riskLevels = {
      high: deptScores.filter(s => s.riskLevel === 'high').length,
      medium: deptScores.filter(s => s.riskLevel === 'medium').length,
      low: deptScores.filter(s => s.riskLevel === 'low').length
    };

    organizational.departments[dept] = {
      workerCount: deptScores.length,
      averageScore: Math.round(avgScore),
      riskLevels,
      needsAttention: avgScore < 60 || riskLevels.high > deptScores.length * 0.15
    };
  });

  // Location analysis
  const locGroups = scores.reduce((acc, score) => {
    const loc = score.location || 'Unknown';
    if (!acc[loc]) acc[loc] = [];
    acc[loc].push(score);
    return acc;
  }, {} as { [key: string]: JSIScore[] });

  Object.keys(locGroups).forEach(loc => {
    const locScores = locGroups[loc];
    const avgScore = locScores.reduce((sum, s) => sum + s.overallScore, 0) / locScores.length;
    const riskLevels = {
      high: locScores.filter(s => s.riskLevel === 'high').length,
      medium: locScores.filter(s => s.riskLevel === 'medium').length,
      low: locScores.filter(s => s.riskLevel === 'low').length
    };

    organizational.locations[loc] = {
      workerCount: locScores.length,
      averageScore: Math.round(avgScore),
      riskLevels,
      needsAttention: avgScore < 60 || riskLevels.high > locScores.length * 0.15
    };
  });

  return organizational;
}

// Automated JSI Report Scheduling
export const scheduleAutomatedJSIReports = onCall(async (request) => {
  try {
    const { customerId, agencyId, schedule, recipients, reportType } = request.data;
    
    if (!customerId || !schedule || !recipients) {
      throw new Error('Missing required parameters: customerId, schedule, recipients');
    }

    logger.info(`Scheduling automated JSI reports for customer ${customerId}`);

    const scheduleId = `${customerId}_${schedule.frequency}_${Date.now()}`;
    
    const scheduleData = {
      customerId,
      agencyId,
      schedule,
      recipients,
      reportType: reportType || 'comprehensive',
      isActive: true,
      createdAt: new Date().toISOString(),
      lastRun: null,
      nextRun: calculateNextRun(schedule),
      totalRuns: 0
    };

    await db.collection('jsiReportSchedules').doc(scheduleId).set(scheduleData);

    // Log AI action
    await db.collection('aiActions').add({
      userId: 'system',
      actionType: 'jsi_report_schedule_created',
      sourceModule: 'JobSatisfactionInsights',
      customerId,
      success: true,
      latencyMs: 0,
      versionTag: 'v1.0',
      reason: `Scheduled ${schedule.frequency} JSI reports for ${recipients.length} recipients`,
      eventType: 'jsi.schedule_created',
      targetType: 'schedule',
      targetId: scheduleId,
      aiRelevant: true,
      contextType: 'jsi_scheduling',
      traitsAffected: null,
      aiTags: ['jsi', 'scheduling', 'automation'],
      urgencyScore: 0.3
    });

    return {
      success: true,
      scheduleId
    };

  } catch (error: any) {
    logger.error('Error scheduling automated JSI reports:', error);
    throw new Error(`Failed to schedule reports: ${error.message}`);
  }
});

// Calculate next run time based on schedule
function calculateNextRun(schedule: any): string {
  const now = new Date();
  
  switch (schedule.frequency) {
    case 'daily':
      return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    case 'weekly':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    case 'monthly':
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  }
}

// Get automated insights
export const getAutomatedJSIInsights = onCall(async (request) => {
  try {
    const { customerId, agencyId } = request.data;
    
    if (!customerId) {
      throw new Error('Missing required parameter: customerId');
    }

    // Get latest insights
    const insightsQuery = db.collection('jsiAutomatedInsights')
      .where('customerId', '==', customerId)
      .orderBy('generatedAt', 'desc')
      .limit(1);

    if (agencyId) {
      insightsQuery.where('agencyId', '==', agencyId);
    }

    const insightsSnapshot = await insightsQuery.get();
    
    if (insightsSnapshot.empty) {
      return {
        success: true,
        data: null
      };
    }

    const latestInsights = insightsSnapshot.docs[0].data();

    return {
      success: true,
      data: latestInsights
    };

  } catch (error: any) {
    logger.error('Error getting automated JSI insights:', error);
    throw new Error(`Failed to get insights: ${error.message}`);
  }
});

// Export JSI data in various formats
export const exportJSIData = onCall(async (request) => {
  try {
    const { 
      customerId, 
      department, 
      location, 
      timeRange, 
      format,
      includePersonalWellbeing,
      exportType 
    } = request.data;
    
    if (!customerId || !format) {
      throw new Error('Missing required parameters: customerId, format');
    }

    logger.info(`Exporting JSI data for customer ${customerId} in ${format} format`);

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    const days = parseInt(timeRange || '90');
    startDate.setDate(startDate.getDate() - days);

    // Get JSI scores
    const scoresQuery = db.collection('jsiScores')
      .where('customerId', '==', customerId)
      .where('lastUpdated', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .where('lastUpdated', '<=', admin.firestore.Timestamp.fromDate(endDate))
      .orderBy('lastUpdated', 'desc');

    if (department && department !== 'all') {
      scoresQuery.where('department', '==', department);
    }
    if (location && location !== 'all') {
      scoresQuery.where('location', '==', location);
    }

    const scoresSnapshot = await scoresQuery.get();
    const scores = scoresSnapshot.docs.map(doc => doc.data() as JSIScore);

    // Get baseline data
    const baselineId = `${customerId}_${department || 'all'}_${location || 'all'}`;
    const baselineDoc = await db.collection('jsiBaselines').doc(baselineId).get();
    const baseline = baselineDoc.exists ? baselineDoc.data() as JSIBaseline : null;

    // Prepare export data based on type
    let exportData: any;

    switch (exportType) {
      case 'detailed':
        exportData = scores.map(score => ({
          userId: score.userId,
          department: score.department || 'Unknown',
          location: score.location || 'Unknown',
          overallScore: score.overallScore,
          workEngagement: score.workEngagement,
          careerAlignment: score.careerAlignment,
          managerRelationship: score.managerRelationship,
          personalWellbeing: includePersonalWellbeing ? score.personalWellbeing : null,
          jobMobility: score.jobMobility,
          riskLevel: score.riskLevel,
          trend: score.trend,
          flags: score.flags.join(', '),
          lastUpdated: score.lastUpdated.toDate().toISOString(),
          baselineComparison: baseline ? 
            Math.round(((score.overallScore - baseline.overallScore) / baseline.overallScore) * 100) : null
        }));
        break;

      case 'summary':
        const averageScore = scores.length > 0 ? 
          scores.reduce((sum, score) => sum + score.overallScore, 0) / scores.length : 0;
        
        exportData = {
          summary: {
            totalWorkers: scores.length,
            averageScore: Math.round(averageScore),
            dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
            baselineComparison: baseline ? {
              baselineScore: baseline.overallScore,
              percentageChange: Math.round(((averageScore - baseline.overallScore) / baseline.overallScore) * 100)
            } : null
          },
          distributions: {
            riskLevels: {
              low: scores.filter(s => s.riskLevel === 'low').length,
              medium: scores.filter(s => s.riskLevel === 'medium').length,
              high: scores.filter(s => s.riskLevel === 'high').length
            },
            trends: {
              improving: scores.filter(s => s.trend === 'up').length,
              declining: scores.filter(s => s.trend === 'down').length,
              stable: scores.filter(s => s.trend === 'stable').length
            }
          }
        };
        break;

      default:
        throw new Error(`Invalid export type: ${exportType}`);
    }

    // Format the data based on requested format
    let formattedData: string;

    switch (format.toLowerCase()) {
      case 'csv':
        if (exportType === 'detailed') {
          const headers = Object.keys(exportData[0]).join(',');
          const rows = exportData.map((row: any) => 
            Object.values(row).map(value => 
              typeof value === 'string' && value.includes(',') ? `"${value}"` : value
            ).join(',')
          );
          formattedData = [headers, ...rows].join('\n');
        } else {
          // For summary, create a flattened CSV
          const summaryData = [
            ['Metric', 'Value'],
            ['Total Workers', exportData.summary.totalWorkers],
            ['Average Score', exportData.summary.averageScore],
            ['Date Range Start', exportData.summary.dateRange.start],
            ['Date Range End', exportData.summary.dateRange.end],
            ['Baseline Score', exportData.summary.baselineComparison?.baselineScore || 'N/A'],
            ['Percentage Change', exportData.summary.baselineComparison?.percentageChange || 'N/A'],
            ['Low Risk Workers', exportData.distributions.riskLevels.low],
            ['Medium Risk Workers', exportData.distributions.riskLevels.medium],
            ['High Risk Workers', exportData.distributions.riskLevels.high],
            ['Improving Workers', exportData.distributions.trends.improving],
            ['Declining Workers', exportData.distributions.trends.declining],
            ['Stable Workers', exportData.distributions.trends.stable]
          ];
          formattedData = summaryData.map(row => row.join(',')).join('\n');
        }
        break;

      case 'json':
        formattedData = JSON.stringify(exportData, null, 2);
        break;

      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    // Log the export action
    await db.collection('aiActions').add({
      userId: 'system',
      actionType: 'jsi_data_exported',
      sourceModule: 'JobSatisfactionInsights',
      customerId,
      success: true,
      latencyMs: 0,
      versionTag: 'v1.0',
      reason: `Exported JSI data in ${format} format`,
      eventType: 'jsi.data_exported',
      targetType: 'export',
      targetId: `${format}_${exportType}`,
      aiRelevant: true,
      contextType: 'jsi_reporting',
      traitsAffected: null,
      aiTags: ['jsi', 'export', 'reporting'],
      urgencyScore: 0.2
    });

    return {
      success: true,
      data: {
        format,
        exportType,
        data: formattedData,
        recordCount: exportType === 'detailed' ? exportData.length : 1,
        exportedAt: new Date().toISOString()
      }
    };

  } catch (error: any) {
    logger.error('Error exporting JSI data:', error);
    throw new Error(`Failed to export JSI data: ${error.message}`);
  }
});

// Get advanced trend analysis
export const getJSIAdvancedTrends = onCall(async (request) => {
  try {
    const { customerId, department, location, timeRange, granularity } = request.data;
    
    if (!customerId) {
      throw new Error('Missing required parameter: customerId');
    }

    logger.info(`Getting advanced JSI trends for customer ${customerId}`);

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    const days = parseInt(timeRange || '90');
    startDate.setDate(startDate.getDate() - days);

    // Get JSI scores
    const scoresQuery = db.collection('jsiScores')
      .where('customerId', '==', customerId)
      .where('lastUpdated', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .where('lastUpdated', '<=', admin.firestore.Timestamp.fromDate(endDate))
      .orderBy('lastUpdated', 'asc');

    if (department && department !== 'all') {
      scoresQuery.where('department', '==', department);
    }
    if (location && location !== 'all') {
      scoresQuery.where('location', '==', location);
    }

    const scoresSnapshot = await scoresQuery.get();
    const scores = scoresSnapshot.docs.map(doc => doc.data() as JSIScore);

    // Group scores by time period
    const timeGroupedData: { [key: string]: JSIScore[] } = {};
    const groupBy = granularity || 'week';

    scores.forEach(score => {
      const date = score.lastUpdated.toDate();
      let groupKey: string;

      switch (groupBy) {
        case 'day':
          groupKey = date.toISOString().split('T')[0];
          break;
        case 'week':
          const weekStart = new Date(date);
          weekStart.setDate(weekStart.getDate() - weekStart.getDay());
          groupKey = weekStart.toISOString().split('T')[0];
          break;
        case 'month':
          groupKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          break;
        default:
          groupKey = date.toISOString().split('T')[0];
      }

      if (!timeGroupedData[groupKey]) {
        timeGroupedData[groupKey] = [];
      }
      timeGroupedData[groupKey].push(score);
    });

    // Calculate trend data with advanced metrics
    const trendData: any[] = Object.keys(timeGroupedData)
      .sort()
      .map(groupKey => {
        const periodScores = timeGroupedData[groupKey];
        const totalScores = periodScores.reduce((acc, score) => ({
          overall: acc.overall + score.overallScore,
          engagement: acc.engagement + score.workEngagement,
          career: acc.career + score.careerAlignment,
          manager: acc.manager + score.managerRelationship,
          wellbeing: acc.wellbeing + score.personalWellbeing,
          mobility: acc.mobility + score.jobMobility
        }), {
          overall: 0, engagement: 0, career: 0, manager: 0, wellbeing: 0, mobility: 0
        });

        const averages = {
          overall: Math.round(totalScores.overall / periodScores.length),
          engagement: Math.round(totalScores.engagement / periodScores.length),
          career: Math.round(totalScores.career / periodScores.length),
          manager: Math.round(totalScores.manager / periodScores.length),
          wellbeing: Math.round(totalScores.wellbeing / periodScores.length),
          mobility: Math.round(totalScores.mobility / periodScores.length)
        };

        // Calculate additional metrics
        const riskDistribution = {
          low: periodScores.filter(s => s.riskLevel === 'low').length,
          medium: periodScores.filter(s => s.riskLevel === 'medium').length,
          high: periodScores.filter(s => s.riskLevel === 'high').length
        };

        const trendDistribution = {
          improving: periodScores.filter(s => s.trend === 'up').length,
          declining: periodScores.filter(s => s.trend === 'down').length,
          stable: periodScores.filter(s => s.trend === 'stable').length
        };

        return {
          date: groupKey,
          ...averages,
          workerCount: periodScores.length,
          riskDistribution,
          trendDistribution,
          // Calculate volatility (standard deviation)
          volatility: calculateVolatility(periodScores.map(s => s.overallScore))
        };
      });

    // Calculate trend direction and momentum
    const trendAnalysis = analyzeTrendDirection(trendData);

    return {
      success: true,
      data: {
        trendData,
        analysis: trendAnalysis,
        granularity: groupBy,
        timeRange: { start: startDate.toISOString(), end: endDate.toISOString() }
      }
    };

  } catch (error: any) {
    logger.error('Error getting advanced JSI trends:', error);
    throw new Error(`Failed to get advanced JSI trends: ${error.message}`);
  }
});

// Helper function to calculate volatility (standard deviation)
function calculateVolatility(scores: number[]): number {
  if (scores.length < 2) return 0;
  
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const squaredDiffs = scores.map(score => Math.pow(score - mean, 2));
  const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / scores.length;
  
  return Math.round(Math.sqrt(variance));
}

// Helper function to analyze trend direction
function analyzeTrendDirection(trendData: any[]): any {
  if (trendData.length < 3) {
    return {
      direction: 'insufficient_data',
      momentum: 0,
      confidence: 0
    };
  }

  // Get recent data points
  const recent = trendData.slice(-3);
  const overallScores = recent.map(point => point.overall);

  // Calculate momentum (rate of change)
  const momentum = (overallScores[2] - overallScores[0]) / 2;

  // Determine direction
  let direction: string;
  if (momentum > 2) direction = 'strongly_improving';
  else if (momentum > 0) direction = 'improving';
  else if (momentum < -2) direction = 'strongly_declining';
  else if (momentum < 0) direction = 'declining';
  else direction = 'stable';

  // Calculate confidence based on consistency
  const volatility = recent.reduce((sum, point) => sum + point.volatility, 0) / recent.length;
  const confidence = Math.max(0, 100 - volatility * 2);

  return {
    direction,
    momentum: Math.round(momentum * 10) / 10,
    confidence: Math.round(confidence),
    volatility: Math.round(volatility)
  };
}

// Get JSI messaging configuration
export const getJSIMessagingConfig = onCall(async (request) => {
  try {
    const { customerId, agencyId } = request.data;
    
    if (!customerId) {
      throw new Error('Missing required parameter: customerId');
    }

    logger.info(`Getting JSI messaging config for customer ${customerId}`);

    const configId = `${customerId}_${agencyId || 'default'}`;
    const configDoc = await db.collection('jsiMessagingConfig').doc(configId).get();

    if (!configDoc.exists) {
      // Create default configuration
      const defaultConfig: JSIMessagingConfig = {
        customerId,
        agencyId,
        topics: defaultJSITopics,
        globalSettings: {
          enableCustomTopics: true,
          maxTopicsPerPrompt: 3,
          topicRotationStrategy: 'priority',
          defaultFrequency: 'weekly'
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await db.collection('jsiMessagingConfig').doc(configId).set(defaultConfig);

      return {
        success: true,
        data: defaultConfig
      };
    }

    return {
      success: true,
      data: configDoc.data() as JSIMessagingConfig
    };

  } catch (error: any) {
    logger.error('Error getting JSI messaging config:', error);
    throw new Error(`Failed to get JSI messaging config: ${error.message}`);
  }
});

// Update JSI messaging configuration
export const updateJSIMessagingConfig = onCall(async (request) => {
  try {
    const { customerId, agencyId, topics, globalSettings } = request.data;
    
    if (!customerId) {
      throw new Error('Missing required parameter: customerId');
    }

    logger.info(`Updating JSI messaging config for customer ${customerId}`);

    const configId = `${customerId}_${agencyId || 'default'}`;
    
    const updateData: Partial<JSIMessagingConfig> = {
      updatedAt: new Date().toISOString()
    };

    if (topics) {
      updateData.topics = topics;
    }

    if (globalSettings) {
      updateData.globalSettings = globalSettings;
    }

    await db.collection('jsiMessagingConfig').doc(configId).update(updateData);

    // Log the configuration update
    await db.collection('aiActions').add({
      userId: 'system',
      actionType: 'jsi_messaging_config_updated',
      sourceModule: 'JobSatisfactionInsights',
      customerId,
      success: true,
      latencyMs: 0,
      versionTag: 'v1.0',
      reason: `Updated JSI messaging configuration for customer ${customerId}`,
      eventType: 'jsi.messaging_config_updated',
      targetType: 'configuration',
      targetId: configId,
      aiRelevant: true,
      contextType: 'jsi_messaging',
      traitsAffected: null,
      aiTags: ['jsi', 'messaging', 'configuration'],
      urgencyScore: 0.3
    });

    return {
      success: true,
      message: 'Messaging configuration updated successfully'
    };

  } catch (error: any) {
    logger.error('Error updating JSI messaging config:', error);
    throw new Error(`Failed to update JSI messaging config: ${error.message}`);
  }
});

// Add custom messaging topic
export const addJSICustomTopic = onCall(async (request) => {
  try {
    const { customerId, agencyId, topic } = request.data;
    
    if (!customerId || !topic) {
      throw new Error('Missing required parameters: customerId, topic');
    }

    logger.info(`Adding custom JSI topic for customer ${customerId}`);

    const configId = `${customerId}_${agencyId || 'default'}`;
    const configDoc = await db.collection('jsiMessagingConfig').doc(configId).get();

    if (!configDoc.exists) {
      throw new Error('Messaging configuration not found. Please initialize first.');
    }

    const config = configDoc.data() as JSIMessagingConfig;
    
    // Validate custom topic
    if (!topic.name || !topic.description || !topic.samplePrompts) {
      throw new Error('Topic must include name, description, and sample prompts');
    }

    const newTopic: JSIMessagingTopic = {
      id: `custom_${Date.now()}`,
      name: topic.name,
      description: topic.description,
      isEnabled: topic.isEnabled !== undefined ? topic.isEnabled : true,
      priority: topic.priority || 'medium',
      frequency: topic.frequency || 'monthly',
      samplePrompts: topic.samplePrompts,
      category: 'custom',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    config.topics.push(newTopic);

    await db.collection('jsiMessagingConfig').doc(configId).update({
      topics: config.topics,
      updatedAt: new Date().toISOString()
    });

    // Log the custom topic addition
    await db.collection('aiActions').add({
      userId: 'system',
      actionType: 'jsi_custom_topic_added',
      sourceModule: 'JobSatisfactionInsights',
      customerId,
      success: true,
      latencyMs: 0,
      versionTag: 'v1.0',
      reason: `Added custom topic "${topic.name}" for customer ${customerId}`,
      eventType: 'jsi.custom_topic_added',
      targetType: 'topic',
      targetId: newTopic.id,
      aiRelevant: true,
      contextType: 'jsi_messaging',
      traitsAffected: null,
      aiTags: ['jsi', 'messaging', 'custom_topic'],
      urgencyScore: 0.4
    });

    return {
      success: true,
      data: newTopic,
      message: 'Custom topic added successfully'
    };

  } catch (error: any) {
    logger.error('Error adding custom JSI topic:', error);
    throw new Error(`Failed to add custom JSI topic: ${error.message}`);
  }
});

// Generate AI prompt based on messaging configuration
export const generateJSIPrompt = onCall(async (request) => {
  try {
    const { customerId, agencyId, userId, context } = request.data;
    
    if (!customerId) {
      throw new Error('Missing required parameter: customerId');
    }

    logger.info(`Generating JSI prompt for user ${userId} in customer ${customerId}`);

    // Get messaging configuration
    const configId = `${customerId}_${agencyId || 'default'}`;
    const configDoc = await db.collection('jsiMessagingConfig').doc(configId).get();

    if (!configDoc.exists) {
      throw new Error('Messaging configuration not found');
    }

    const config = configDoc.data() as JSIMessagingConfig;
    
    // Filter enabled topics
    const enabledTopics = config.topics.filter(topic => topic.isEnabled);
    
    if (enabledTopics.length === 0) {
      throw new Error('No enabled messaging topics found');
    }

    // Select topics based on rotation strategy
    let selectedTopics: JSIMessagingTopic[] = [];
    
    switch (config.globalSettings.topicRotationStrategy) {
      case 'priority':
        // Select high priority topics first, then medium, then low
        const highPriority = enabledTopics.filter(t => t.priority === 'high');
        const mediumPriority = enabledTopics.filter(t => t.priority === 'medium');
        const lowPriority = enabledTopics.filter(t => t.priority === 'low');
        
        selectedTopics = [
          ...highPriority.slice(0, Math.ceil(config.globalSettings.maxTopicsPerPrompt / 2)),
          ...mediumPriority.slice(0, Math.ceil(config.globalSettings.maxTopicsPerPrompt / 3)),
          ...lowPriority.slice(0, Math.ceil(config.globalSettings.maxTopicsPerPrompt / 6))
        ].slice(0, config.globalSettings.maxTopicsPerPrompt);
        break;
        
      case 'frequency':
        // Select topics based on their frequency setting
        const weeklyTopics = enabledTopics.filter(t => t.frequency === 'weekly');
        const monthlyTopics = enabledTopics.filter(t => t.frequency === 'monthly');
        // const quarterlyTopics = enabledTopics.filter(t => t.frequency === 'quarterly');
        
        // Simple frequency-based selection (could be enhanced with actual timing logic)
        selectedTopics = [
          ...weeklyTopics.slice(0, 2),
          ...monthlyTopics.slice(0, 1)
        ].slice(0, config.globalSettings.maxTopicsPerPrompt);
        break;
        
      case 'random':
      default:
        // Random selection
        const shuffled = enabledTopics.sort(() => 0.5 - Math.random());
        selectedTopics = shuffled.slice(0, config.globalSettings.maxTopicsPerPrompt);
        break;
    }

    // Generate prompt from selected topics
    const topicPrompts = selectedTopics.map(topic => {
      const randomPrompt = topic.samplePrompts[Math.floor(Math.random() * topic.samplePrompts.length)];
      return `${topic.name}: ${randomPrompt}`;
    });

    const generatedPrompt = topicPrompts.join('\n\n');

    // Log the prompt generation
    await db.collection('aiActions').add({
      userId: 'system',
      actionType: 'jsi_prompt_generated',
      sourceModule: 'JobSatisfactionInsights',
      customerId,
      success: true,
      latencyMs: 0,
      versionTag: 'v1.0',
      reason: `Generated JSI prompt for user ${userId} using ${selectedTopics.length} topics`,
      eventType: 'jsi.prompt_generated',
      targetType: 'worker',
      targetId: userId,
      aiRelevant: true,
      contextType: 'jsi_messaging',
      traitsAffected: null,
      aiTags: ['jsi', 'messaging', 'prompt_generation'],
      urgencyScore: 0.5
    });

    return {
      success: true,
      data: {
        prompt: generatedPrompt,
        topics: selectedTopics.map(t => ({ id: t.id, name: t.name, category: t.category })),
        context: context || 'general_check_in'
      }
    };

  } catch (error: any) {
    logger.error('Error generating JSI prompt:', error);
    throw new Error(`Failed to generate JSI prompt: ${error.message}`);
  }
});

// Calculate percentiles for benchmarking
function calculatePercentiles(scores: number[]): { p25: number; p50: number; p75: number; p90: number } {
  if (scores.length === 0) {
    return { p25: 0, p50: 0, p75: 0, p90: 0 };
  }

  const sorted = [...scores].sort((a, b) => a - b);
  const n = sorted.length;

  const getPercentile = (p: number) => {
    const index = (p / 100) * (n - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    
    if (upper >= n) return sorted[n - 1];
    if (lower === upper) return sorted[lower];
    
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  };

  return {
    p25: getPercentile(25),
    p50: getPercentile(50),
    p75: getPercentile(75),
    p90: getPercentile(90)
  };
}

// Calculate global benchmark across all customers
async function calculateGlobalBenchmark(dateRange?: { start: string; end: string }): Promise<JSIBenchmark> {
  try {
    let query: any = db.collection('jsiScores');
    
    if (dateRange) {
      const startDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);
      query = query.where('lastUpdated', '>=', admin.firestore.Timestamp.fromDate(startDate))
                   .where('lastUpdated', '<=', admin.firestore.Timestamp.fromDate(endDate));
    }

    const snapshot = await query.get();
    const scores = snapshot.docs.map((doc: any) => doc.data() as JSIScore);

    if (scores.length === 0) {
      return {
        type: 'global',
        overallScore: 0,
        workEngagement: 0,
        careerAlignment: 0,
        managerRelationship: 0,
        personalWellbeing: 0,
        jobMobility: 0,
        workerCount: 0,
        customerCount: 0,
        calculatedAt: new Date().toISOString(),
        dateRange: dateRange || { start: '', end: '' },
        percentiles: { p25: 0, p50: 0, p75: 0, p90: 0 }
      };
    }

    // Calculate averages
    const overallScores = scores.map((s: JSIScore) => s.overallScore);
    const engagementScores = scores.map((s: JSIScore) => s.workEngagement);
    const careerScores = scores.map((s: JSIScore) => s.careerAlignment);
    const managerScores = scores.map((s: JSIScore) => s.managerRelationship);
    const wellbeingScores = scores.map((s: JSIScore) => s.personalWellbeing);
    const mobilityScores = scores.map((s: JSIScore) => s.jobMobility);

    const uniqueCustomers = new Set(scores.map((s: JSIScore) => s.customerId));

    return {
      type: 'global',
      overallScore: overallScores.reduce((a: number, b: number) => a + b, 0) / overallScores.length,
      workEngagement: engagementScores.reduce((a: number, b: number) => a + b, 0) / engagementScores.length,
      careerAlignment: careerScores.reduce((a: number, b: number) => a + b, 0) / careerScores.length,
      managerRelationship: managerScores.reduce((a: number, b: number) => a + b, 0) / managerScores.length,
      personalWellbeing: wellbeingScores.reduce((a: number, b: number) => a + b, 0) / wellbeingScores.length,
      jobMobility: mobilityScores.reduce((a: number, b: number) => a + b, 0) / mobilityScores.length,
      workerCount: scores.length,
      customerCount: uniqueCustomers.size,
      calculatedAt: new Date().toISOString(),
      dateRange: dateRange || { start: '', end: '' },
      percentiles: calculatePercentiles(overallScores)
    };
  } catch (error) {
    logger.error('Error calculating global benchmark:', error);
    throw new Error('Failed to calculate global benchmark');
  }
}

// Calculate industry benchmark
async function calculateIndustryBenchmark(industryCode: string, dateRange?: { start: string; end: string }): Promise<JSIBenchmark> {
  try {
    // First get all customers in this industry
    const customersSnapshot = await db.collection('customers')
      .where('industry', '==', industryCode)
      .get();
    
    const customerIds = customersSnapshot.docs.map(doc => doc.id);
    
    if (customerIds.length === 0) {
      return {
        type: 'industry',
        industryCode,
        industryName: 'Unknown Industry',
        overallScore: 0,
        workEngagement: 0,
        careerAlignment: 0,
        managerRelationship: 0,
        personalWellbeing: 0,
        jobMobility: 0,
        workerCount: 0,
        customerCount: 0,
        calculatedAt: new Date().toISOString(),
        dateRange: dateRange || { start: '', end: '' },
        percentiles: { p25: 0, p50: 0, p75: 0, p90: 0 }
      };
    }

    // Get JSI scores for these customers
    let query = db.collection('jsiScores').where('customerId', 'in', customerIds);
    
    if (dateRange) {
      const startDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);
      query = query.where('lastUpdated', '>=', admin.firestore.Timestamp.fromDate(startDate))
                   .where('lastUpdated', '<=', admin.firestore.Timestamp.fromDate(endDate));
    }

    const snapshot = await query.get();
    const scores = snapshot.docs.map(doc => doc.data() as JSIScore);

    if (scores.length === 0) {
      return {
        type: 'industry',
        industryCode,
        industryName: 'Unknown Industry',
        overallScore: 0,
        workEngagement: 0,
        careerAlignment: 0,
        managerRelationship: 0,
        personalWellbeing: 0,
        jobMobility: 0,
        workerCount: 0,
        customerCount: customerIds.length,
        calculatedAt: new Date().toISOString(),
        dateRange: dateRange || { start: '', end: '' },
        percentiles: { p25: 0, p50: 0, p75: 0, p90: 0 }
      };
    }

    // Calculate averages
    const overallScores = scores.map(s => s.overallScore);
    const engagementScores = scores.map(s => s.workEngagement);
    const careerScores = scores.map(s => s.careerAlignment);
    const managerScores = scores.map(s => s.managerRelationship);
    const wellbeingScores = scores.map(s => s.personalWellbeing);
    const mobilityScores = scores.map(s => s.jobMobility);

    const uniqueCustomers = new Set(scores.map(s => s.customerId));

    // Get industry name
    const industryName = customersSnapshot.docs[0]?.data()?.industryName || 'Unknown Industry';

    return {
      type: 'industry',
      industryCode,
      industryName,
      overallScore: overallScores.reduce((a, b) => a + b, 0) / overallScores.length,
      workEngagement: engagementScores.reduce((a, b) => a + b, 0) / engagementScores.length,
      careerAlignment: careerScores.reduce((a, b) => a + b, 0) / careerScores.length,
      managerRelationship: managerScores.reduce((a, b) => a + b, 0) / managerScores.length,
      personalWellbeing: wellbeingScores.reduce((a, b) => a + b, 0) / wellbeingScores.length,
      jobMobility: mobilityScores.reduce((a, b) => a + b, 0) / mobilityScores.length,
      workerCount: scores.length,
      customerCount: uniqueCustomers.size,
      calculatedAt: new Date().toISOString(),
      dateRange: dateRange || { start: '', end: '' },
      percentiles: calculatePercentiles(overallScores)
    };
  } catch (error) {
    logger.error('Error calculating industry benchmark:', error);
    throw new Error('Failed to calculate industry benchmark');
  }
}

// Get benchmarks for a specific customer
async function getCustomerBenchmarks(customerId: string, dateRange?: { start: string; end: string }): Promise<{
  global: JSIBenchmark;
  industry?: JSIBenchmark;
}> {
  try {
    // Get customer's industry
    const customerDoc = await db.collection('customers').doc(customerId).get();
    if (!customerDoc.exists) {
      throw new Error('Customer not found');
    }

    const customerData = customerDoc.data();
    const industryCode = customerData?.industry;

    // Calculate global benchmark
    const globalBenchmark = await calculateGlobalBenchmark(dateRange);

    // Calculate industry benchmark if customer has industry
    let industryBenchmark: JSIBenchmark | undefined;
    if (industryCode) {
      industryBenchmark = await calculateIndustryBenchmark(industryCode, dateRange);
    }

    return {
      global: globalBenchmark,
      industry: industryBenchmark
    };
  } catch (error) {
    logger.error('Error getting customer benchmarks:', error);
    throw new Error('Failed to get customer benchmarks');
  }
}

// Export function to get JSI benchmarks
export const getJSIBenchmarks = onCall(async (request) => {
  try {
    const { customerId, dateRange } = request.data;
    
    if (!customerId) {
      throw new Error('Missing required parameter: customerId');
    }

    logger.info(`Getting JSI benchmarks for customer ${customerId}`);

    const benchmarks = await getCustomerBenchmarks(customerId, dateRange);

    // Log the benchmark retrieval
    await db.collection('aiActions').add({
      userId: 'system',
      actionType: 'jsi_benchmarks_retrieved',
      sourceModule: 'JobSatisfactionInsights',
      customerId,
      success: true,
      latencyMs: 0,
      versionTag: 'v1.0',
      reason: `Retrieved JSI benchmarks for customer ${customerId}`,
      eventType: 'jsi.benchmarks_retrieved',
      targetType: 'customer',
      targetId: customerId,
      aiRelevant: true,
      contextType: 'jsi_benchmarking',
      traitsAffected: null,
      aiTags: ['jsi', 'benchmarking', 'analytics'],
      urgencyScore: 0.2
    });

    return {
      success: true,
      data: benchmarks
    };

  } catch (error: any) {
    logger.error('Error getting JSI benchmarks:', error);
    throw new Error(`Failed to get JSI benchmarks: ${error.message}`);
  }
}); 