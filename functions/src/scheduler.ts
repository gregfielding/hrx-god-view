import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { getWorkers } from './utils/getWorkers';
import { createNotification } from './utils/createNotification';
import { logAIAction } from './feedbackEngine';

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

interface Worker {
  id: string;
  name: string;
  email: string;
  tenureDays: number;
  traits: Record<string, number>;
  lastActive: Date;
  agencyId?: string;
  customerId?: string;
  status: 'active' | 'inactive';
  regionId?: string;
  divisionId?: string;
  departmentId?: string;
  locationId?: string;
}

interface Moment {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'active' | 'paused';
  timing?: {
    type: "tenure_based" | "recurring" | "trait_decay" | "manual";
    condition?: {
      field: string;
      operator: ">=" | "<=" | "==" | "!=";
      value: number;
    };
    recurrence?: "monthly" | "quarterly" | "custom";
    customDays?: number;
    followUpDays?: number;
    maxRetries?: number;
    retryDelayDays?: number;
  };
}

interface Campaign {
  id: string;
  title: string;
  objective: string;
  category: 'morale' | 'feedback' | 'sales' | 'policy' | 'support' | 'wellness';
  tone: 'motivational' | 'survey' | 'coaching' | 'feedback-seeking' | 'empathetic' | 'directive';
  targetAudience: {
    regionIds: string[];
    divisionIds: string[];
    locationIds: string[];
    departmentIds: string[];
    userIds: string[];
    userGroupIds: string[];
    jobOrderIds: string[];
  };
  startDate: Date;
  endDate?: Date;
  frequency: 'one-time' | 'daily' | 'weekly' | 'monthly' | 'custom';
  status: 'draft' | 'active' | 'paused' | 'completed';
  creatorUserId: string;
  tenantId?: string;
  followUpStrategy: 'none' | '1_followup' | 'continuous' | 'ai_paced';
  aiBehavior: {
    responsePattern: string;
    escalationThreshold: number;
    escalationEmail?: string;
    traitTracking: string[];
  };
  analytics?: {
    totalRecipients: number;
    responsesReceived: number;
    avgEngagementScore: number;
    traitChanges: Record<string, number>;
  };
}

interface ScheduledMoment {
  id: string;
  workerId: string;
  momentId: string;
  scheduledFor: Date;
  status: 'pending' | 'sent' | 'retry' | 'missed';
  retryCount: number;
  triggeredBy: string;
  createdAt: Date;
  updatedAt: Date;
  nextRetry?: Date;
  maxRetries?: number;
  retryDelayDays?: number;
}

interface ScheduledCampaign {
  id: string;
  campaignId: string;
  workerId: string;
  scheduledFor: Date;
  status: 'pending' | 'sent' | 'retry' | 'missed';
  retryCount: number;
  triggeredBy: string;
  createdAt: Date;
  updatedAt: Date;
  nextRetry?: Date;
  maxRetries?: number;
  retryDelayDays?: number;
  campaignData?: Campaign;
}

async function runSchedulerLogic(): Promise<void> {
  const startTime = Date.now();
  console.log('Starting AI Scheduler...');

  try {
    // Fetch all active moments
    const momentsRef = db.collection('aiMoments');
    const momentsSnap = await momentsRef.where('status', '==', 'active').get();
    const moments: Moment[] = [];
    
    momentsSnap.forEach(doc => {
      moments.push({
        id: doc.id,
        ...doc.data()
      } as Moment);
    });

    console.log(`Found ${moments.length} active moments`);

    // Fetch all active campaigns
    const campaignsRef = db.collection('campaigns');
    const campaignsSnap = await campaignsRef.where('status', '==', 'active').get();
    const campaigns: Campaign[] = [];
    
    campaignsSnap.forEach(doc => {
      campaigns.push({
        id: doc.id,
        ...doc.data()
      } as Campaign);
    });

    console.log(`Found ${campaigns.length} active campaigns`);

    // Fetch all active workers
    const workers: Worker[] = await getWorkers();
    console.log(`Found ${workers.length} active workers`);

    // Filter workers by security level for AI engagement
    const filteredWorkers = workers.filter(worker => {
      const securityLevel = (worker as any).securityLevel || '5';
      
      // Skip suspended and dismissed workers
      if (securityLevel === '2' || securityLevel === '1') {
        return false;
      }
      
      return true;
    });
    console.log(`Found ${filteredWorkers.length} workers eligible for AI engagement`);

    // Fetch existing scheduled moments to avoid duplicates
    const scheduledRef = db.collection('scheduledMoments');
    const scheduledSnap = await scheduledRef.where('status', 'in', ['pending', 'retry']).get();
    const existingScheduled = new Set<string>();
    
    scheduledSnap.forEach(doc => {
      const data = doc.data();
      existingScheduled.add(`${data.workerId}_${data.momentId}`);
    });

    console.log(`Found ${existingScheduled.size} existing scheduled moments`);

    // Fetch existing scheduled campaigns to avoid duplicates
    const scheduledCampaignsRef = db.collection('scheduledCampaigns');
    const scheduledCampaignsSnap = await scheduledCampaignsRef.where('status', 'in', ['pending', 'retry']).get();
    const existingScheduledCampaigns = new Set<string>();
    
    scheduledCampaignsSnap.forEach(doc => {
      const data = doc.data();
      existingScheduledCampaigns.add(`${data.workerId}_${data.campaignId}`);
    });

    console.log(`Found ${existingScheduledCampaigns.size} existing scheduled campaigns`);

    // Generate new scheduled moments
    const newScheduledMoments: Omit<ScheduledMoment, 'id'>[] = [];
    let scheduledCount = 0;

    for (const worker of workers) {
      for (const moment of moments) {
        if (!moment.timing || moment.timing.type === 'manual') continue;

        const scheduledKey = `${worker.id}_${moment.id}`;
        if (existingScheduled.has(scheduledKey)) continue;

        try {
          const shouldSchedule = checkEligibility(worker, moment, existingScheduled);
          if (shouldSchedule) {
            const scheduledFor = calculateNextScheduledDate(worker, moment);
            newScheduledMoments.push({
              workerId: worker.id,
              momentId: moment.id,
              scheduledFor,
              status: 'pending',
              retryCount: 0,
              triggeredBy: moment.timing.type as any,
              createdAt: new Date(),
              updatedAt: new Date()
            });
            scheduledCount++;
            await logAIAction({
              userId: worker.id,
              actionType: 'moment_triggered',
              sourceModule: 'MomentsEngine',
              inputPrompt: `Check eligibility for moment: ${moment.title}`,
              composedPrompt: `Evaluate worker ${worker.id} for moment ${moment.id}`,
              aiResponse: `Moment ${moment.title} triggered for worker ${worker.id}`,
              success: true,
              latencyMs: Date.now() - startTime,
              versionTag: 'v1',
              scenarioContext: moment.id,
              customerId: worker.customerId || undefined,
              tenantId: undefined,
              globalContextUsed: null,
              scenarioContextUsed: moment,
              customerContextUsed: null,
              weightsApplied: null,
              traitsActive: worker.traits,
              vectorChunksUsed: null,
              vectorSimilarityScores: null,
              dryRun: false,
              manualOverride: false,
              feedbackGiven: null,
              reason: `Moment "${moment.title}" triggered for worker ${worker.id}`
            });
          }
        } catch (error) {
          console.error(`Error checking eligibility for worker ${worker.id} and moment ${moment.id}:`, error);
        }
      }
    }

    // Generate new scheduled campaigns
    const newScheduledCampaigns: Omit<ScheduledCampaign, 'id'>[] = [];
    let scheduledCampaignCount = 0;

    for (const worker of workers) {
      for (const campaign of campaigns) {
        const scheduledKey = `${worker.id}_${campaign.id}`;
        if (existingScheduledCampaigns.has(scheduledKey)) continue;

        try {
          const shouldSchedule = checkCampaignEligibility(worker, campaign, existingScheduledCampaigns);
          if (shouldSchedule) {
            const scheduledFor = calculateNextCampaignDate(worker, campaign);
            newScheduledCampaigns.push({
              campaignId: campaign.id,
              workerId: worker.id,
              scheduledFor,
              status: 'pending',
              retryCount: 0,
              triggeredBy: campaign.frequency,
              createdAt: new Date(),
              updatedAt: new Date(),
              campaignData: campaign
            });
            scheduledCampaignCount++;
            await logAIAction({
              userId: worker.id,
              actionType: 'campaign_triggered',
              sourceModule: 'CampaignsEngine',
              inputPrompt: `Check eligibility for campaign: ${campaign.title}`,
              composedPrompt: `Evaluate worker ${worker.id} for campaign ${campaign.id}`,
              aiResponse: `Campaign ${campaign.title} triggered for worker ${worker.id}`,
              success: true,
              latencyMs: Date.now() - startTime,
              versionTag: 'v1',
              scenarioContext: campaign.id,
              customerId: worker.customerId || undefined,
              tenantId: campaign.tenantId || undefined,
              globalContextUsed: null,
              scenarioContextUsed: campaign,
              customerContextUsed: null,
              weightsApplied: null,
              traitsActive: worker.traits,
              vectorChunksUsed: null,
              vectorSimilarityScores: null,
              dryRun: false,
              manualOverride: false,
              feedbackGiven: null,
              reason: `Campaign "${campaign.title}" triggered for worker ${worker.id}`,
              eventType: 'campaign.triggered',
              targetType: 'campaign',
              targetId: campaign.id,
              aiRelevant: true,
              contextType: 'campaign',
              traitsAffected: null,
              aiTags: ['campaign', 'automation'],
              urgencyScore: 6
            });
          }
        } catch (error) {
          console.error(`Error checking campaign eligibility for worker ${worker.id} and campaign ${campaign.id}:`, error);
        }
      }
    }

    // Batch write to Firestore for moments
    if (newScheduledMoments.length > 0) {
      const batch = db.batch();
      
      for (const scheduledMoment of newScheduledMoments) {
        const docRef = scheduledRef.doc();
        batch.set(docRef, {
          ...scheduledMoment,
          scheduledFor: admin.firestore.Timestamp.fromDate(scheduledMoment.scheduledFor),
          createdAt: admin.firestore.Timestamp.fromDate(scheduledMoment.createdAt),
          updatedAt: admin.firestore.Timestamp.fromDate(scheduledMoment.updatedAt)
        });
      }
      
      await batch.commit();
      console.log(`Successfully saved ${newScheduledMoments.length} scheduled moments`);

      // Notify HRX admin
      await createNotification({
        recipientType: 'hrx',
        recipientId: null,
        type: 'moment',
        message: `${newScheduledMoments.length} new moments scheduled.`,
        actions: ['view'],
        status: 'unread',
      });
    }

    // Batch write to Firestore for campaigns
    if (newScheduledCampaigns.length > 0) {
      const batch = db.batch();
      
      for (const scheduledCampaign of newScheduledCampaigns) {
        const docRef = scheduledCampaignsRef.doc();
        batch.set(docRef, {
          ...scheduledCampaign,
          scheduledFor: admin.firestore.Timestamp.fromDate(scheduledCampaign.scheduledFor),
          createdAt: admin.firestore.Timestamp.fromDate(scheduledCampaign.createdAt),
          updatedAt: admin.firestore.Timestamp.fromDate(scheduledCampaign.updatedAt)
        });
      }
      
      await batch.commit();
      console.log(`Successfully saved ${newScheduledCampaigns.length} scheduled campaigns`);

      // Notify HRX admin
      await createNotification({
        recipientType: 'hrx',
        recipientId: null,
        type: 'campaign',
        message: `${newScheduledCampaigns.length} new campaigns scheduled.`,
        actions: ['view'],
        status: 'unread',
      });
    }

    // Check for missed moments and retry logic
    await handleMissedMoments();
    await handleRetryLogic();

    // Check for missed campaigns and retry logic
    await handleMissedCampaigns();
    await handleCampaignRetryLogic();

    const endTime = Date.now();
    console.log(`AI Scheduler completed in ${endTime - startTime}ms`);
    console.log(`Scheduled ${scheduledCount} moments and ${scheduledCampaignCount} campaigns for ${workers.length} workers`);

  } catch (error) {
    console.error('AI Scheduler failed:', error);
    throw error;
  }
}

export const runAIScheduler = onSchedule({
  schedule: '0 9 * * *', // Run daily at 9 AM
  timeZone: 'America/New_York'
}, async (event) => {
  await runSchedulerLogic();
});

function checkEligibility(worker: Worker, moment: Moment, existingScheduled: Set<string>): boolean {
  if (!moment.timing) return false;
  
  switch (moment.timing.type) {
    case 'tenure_based':
      if (moment.timing.condition?.field === 'tenure_days') {
        const workerValue = worker.tenureDays;
        const conditionValue = moment.timing.condition.value;
        const operator = moment.timing.condition.operator;
        
        switch (operator) {
          case '>=': return workerValue >= conditionValue;
          case '<=': return workerValue <= conditionValue;
          case '==': return workerValue === conditionValue;
          case '!=': return workerValue !== conditionValue;
          default: return false;
        }
      }
      break;
      
    case 'trait_decay':
      if (moment.timing.condition?.field.startsWith('trait:')) {
        const traitName = moment.timing.condition.field.replace('trait:', '');
        const workerValue = worker.traits[traitName] || 0;
        const conditionValue = moment.timing.condition.value;
        const operator = moment.timing.condition.operator;
        
        switch (operator) {
          case '>=': return workerValue >= conditionValue;
          case '<=': return workerValue <= conditionValue;
          case '==': return workerValue === conditionValue;
          case '!=': return workerValue !== conditionValue;
          default: return false;
        }
      }
      break;
      
    case 'recurring':
      // Check if enough time has passed since last moment
      const scheduledKey = `${worker.id}_${moment.id}`;
      if (existingScheduled.has(scheduledKey)) return false;
      
      // For recurring moments, we'll schedule them based on the recurrence pattern
      // This is a simplified check - in production you'd want to check actual last completion
      return true;
  }
  
  return false;
}

function calculateNextScheduledDate(worker: Worker, moment: Moment): Date {
  const now = new Date();
  
  switch (moment.timing?.type) {
    case 'tenure_based':
      // Schedule for tomorrow to give immediate attention
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
      
    case 'trait_decay':
      // Schedule within 2 days for urgent trait issues
      return new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
      
    case 'recurring':
      if (moment.timing.recurrence === 'monthly') {
        return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      } else if (moment.timing.recurrence === 'quarterly') {
        return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      } else if (moment.timing.customDays) {
        return new Date(now.getTime() + moment.timing.customDays * 24 * 60 * 60 * 1000);
      }
      break;
  }
  
  // Default: schedule for tomorrow
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

function checkCampaignEligibility(worker: Worker, campaign: Campaign, existingScheduled: Set<string>): boolean {
  // Check if campaign is within date range
  const now = new Date();
  if (campaign.startDate && now < campaign.startDate) return false;
  if (campaign.endDate && now > campaign.endDate) return false;

  // Check organizational targeting
  if (campaign.targetAudience.regionIds.length > 0 && 
      !campaign.targetAudience.regionIds.includes(worker.regionId || '')) {
    return false;
  }
  
  if (campaign.targetAudience.divisionIds.length > 0 && 
      !campaign.targetAudience.divisionIds.includes(worker.divisionId || '')) {
    return false;
  }
  
  if (campaign.targetAudience.departmentIds.length > 0 && 
      !campaign.targetAudience.departmentIds.includes(worker.departmentId || '')) {
    return false;
  }
  
  if (campaign.targetAudience.locationIds.length > 0 && 
      !campaign.targetAudience.locationIds.includes(worker.locationId || '')) {
    return false;
  }

  // Check specific user targeting
  if (campaign.targetAudience.userIds.length > 0 && 
      !campaign.targetAudience.userIds.includes(worker.id)) {
    return false;
  }

  // Check if already scheduled
  const scheduledKey = `${worker.id}_${campaign.id}`;
  if (existingScheduled.has(scheduledKey)) return false;

  return true;
}

function calculateNextCampaignDate(worker: Worker, campaign: Campaign): Date {
  const now = new Date();
  
  switch (campaign.frequency) {
    case 'one-time':
      return new Date(now.getTime() + 24 * 60 * 60 * 1000); // Tomorrow
      
    case 'daily':
      return new Date(now.getTime() + 24 * 60 * 60 * 1000); // Tomorrow
      
    case 'weekly':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // Next week
      
    case 'monthly':
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // Next month
      
    case 'custom':
      // Default to weekly for custom frequency
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000); // Tomorrow
  }
}

async function handleMissedMoments(): Promise<void> {
  const now = new Date();
  const scheduledRef = db.collection('scheduledMoments');
  
  // Find moments that were scheduled for the past but are still pending
  const missedSnap = await scheduledRef
    .where('status', '==', 'pending')
    .where('scheduledFor', '<', admin.firestore.Timestamp.fromDate(now))
    .get();

  const batch = db.batch();
  let missedCount = 0;

  missedSnap.forEach(doc => {
    batch.update(doc.ref, {
      status: 'missed',
      updatedAt: admin.firestore.Timestamp.fromDate(now)
    });
    missedCount++;
  });

  if (missedCount > 0) {
    await batch.commit();
    console.log(`Marked ${missedCount} moments as missed`);
  }
}

async function handleRetryLogic(): Promise<void> {
  const now = new Date();
  const scheduledRef = db.collection('scheduledMoments');
  
  // Find moments that are in retry status and due for next retry
  const retrySnap = await scheduledRef
    .where('status', '==', 'retry')
    .where('nextRetry', '<=', admin.firestore.Timestamp.fromDate(now))
    .get();

  const batch = db.batch();
  let retryCount = 0;

  retrySnap.forEach(doc => {
    const data = doc.data();
    const maxRetries = data.maxRetries || 3;
    
    if (data.retryCount < maxRetries) {
      // Schedule next retry
      const retryDelayDays = data.retryDelayDays || 3;
      const nextRetry = new Date(now.getTime() + retryDelayDays * 24 * 60 * 60 * 1000);
      
      batch.update(doc.ref, {
        status: 'pending',
        retryCount: admin.firestore.FieldValue.increment(1),
        nextRetry: admin.firestore.Timestamp.fromDate(nextRetry),
        updatedAt: admin.firestore.Timestamp.fromDate(now)
      });
    } else {
      // Max retries reached, mark as missed
      batch.update(doc.ref, {
        status: 'missed',
        updatedAt: admin.firestore.Timestamp.fromDate(now)
      });
    }
    retryCount++;
  });

  if (retryCount > 0) {
    await batch.commit();
    console.log(`Processed ${retryCount} retry moments`);
  }
}

async function handleMissedCampaigns(): Promise<void> {
  const now = new Date();
  const scheduledRef = db.collection('scheduledCampaigns');
  
  // Find campaigns that are past due
  const missedSnap = await scheduledRef
    .where('status', '==', 'pending')
    .where('scheduledFor', '<=', admin.firestore.Timestamp.fromDate(now))
    .get();

  const batch = db.batch();
  let missedCount = 0;

  missedSnap.forEach(doc => {
    batch.update(doc.ref, {
      status: 'missed',
      updatedAt: admin.firestore.Timestamp.fromDate(now)
    });
    missedCount++;
  });

  if (missedCount > 0) {
    await batch.commit();
    console.log(`Marked ${missedCount} campaigns as missed`);
  }
}

async function handleCampaignRetryLogic(): Promise<void> {
  const now = new Date();
  const scheduledRef = db.collection('scheduledCampaigns');
  
  // Find campaigns that are in retry status and due for next retry
  const retrySnap = await scheduledRef
    .where('status', '==', 'retry')
    .where('nextRetry', '<=', admin.firestore.Timestamp.fromDate(now))
    .get();

  const batch = db.batch();
  let retryCount = 0;

  retrySnap.forEach(doc => {
    const data = doc.data();
    const maxRetries = data.maxRetries || 3;
    
    if (data.retryCount < maxRetries) {
      // Schedule next retry
      const retryDelayDays = data.retryDelayDays || 3;
      const nextRetry = new Date(now.getTime() + retryDelayDays * 24 * 60 * 60 * 1000);
      
      batch.update(doc.ref, {
        status: 'pending',
        retryCount: admin.firestore.FieldValue.increment(1),
        nextRetry: admin.firestore.Timestamp.fromDate(nextRetry),
        updatedAt: admin.firestore.Timestamp.fromDate(now)
      });
    } else {
      // Max retries reached, mark as missed
      batch.update(doc.ref, {
        status: 'missed',
        updatedAt: admin.firestore.Timestamp.fromDate(now)
      });
    }
    retryCount++;
  });

  if (retryCount > 0) {
    await batch.commit();
    console.log(`Processed ${retryCount} retry campaigns`);
  }
}

// Manual trigger function for testing
export const manualSchedulerRun = onCall({
  cors: true,
  maxInstances: 1
}, async (request) => {
  // Check if user is authenticated and has admin privileges
  if (!request.auth) {
    throw new Error('User must be authenticated');
  }

  // You can add additional authorization checks here
  // For example, check if the user has HRX admin role

  try {
    // Run the same logic as the scheduled function
    await runSchedulerLogic();
    return { success: true, message: 'Scheduler run completed' };
  } catch (error: any) {
    console.error('Manual scheduler run failed:', error, error?.stack);
    throw new Error('Scheduler run failed: ' + (error?.message || error));
  }
}); 