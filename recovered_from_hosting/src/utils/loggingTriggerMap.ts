// Master AI Trigger Map - Single source of truth for all AI-relevant field changes
// This file is used by both Cursor for automated testing and the application for logging

export type TriggerType = 'create' | 'update' | 'delete';
export type Module = 
  | 'TraitsEngine'
  | 'ContextEngine' 
  | 'WeightsEngine'
  | 'MomentsEngine'
  | 'FeedbackEngine'
  | 'ToneEngine'
  | 'VectorEngine'
  | 'PriorityEngine'
  | 'Scheduler'
  | 'Logs'
  | 'MotivationEngine'
  | 'CampaignsEngine';

export interface LogTriggerDefinition {
  fieldPath: string; // Use colon format for variables (e.g., 'users/:uid.traits.resilience')
  trigger: TriggerType;
  expectedLogKeys: string[];
  destinationModules: Module[];
  required: boolean;
  urgencyScore: number; // 1-10 scale
  contextType: string; // e.g., 'traits', 'tone', 'feedback'
  testRequired: boolean; // For Cursor automation
  description: string; // Human-readable description
}

export const loggingTriggerMap: LogTriggerDefinition[] = [
  // Tone & Style Settings
  {
    fieldPath: 'customers/:customerId.aiSettings.tone.formality',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ToneEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 3,
    contextType: 'tone',
    testRequired: true,
    description: 'Customer tone formality setting'
  },
  {
    fieldPath: 'customers/:customerId.aiSettings.tone.friendliness',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ToneEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 3,
    contextType: 'tone',
    testRequired: true,
    description: 'Customer tone friendliness setting'
  },
  {
    fieldPath: 'customers/:customerId.aiSettings.tone.conciseness',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ToneEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 3,
    contextType: 'tone',
    testRequired: true,
    description: 'Customer tone conciseness setting'
  },
  {
    fieldPath: 'customers/:customerId.aiSettings.tone.assertiveness',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ToneEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 3,
    contextType: 'tone',
    testRequired: true,
    description: 'Customer tone assertiveness setting'
  },
  {
    fieldPath: 'customers/:customerId.aiSettings.tone.enthusiasm',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ToneEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 3,
    contextType: 'tone',
    testRequired: true,
    description: 'Customer tone enthusiasm setting'
  },

  // Custom Prompts
  {
    fieldPath: 'customers/:customerId.aiSettings.prompts.custom.0',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ContextEngine'],
    required: true,
    urgencyScore: 5,
    contextType: 'prompts',
    testRequired: true,
    description: 'Customer custom prompt 1'
  },
  {
    fieldPath: 'customers/:customerId.aiSettings.prompts.custom.1',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ContextEngine'],
    required: true,
    urgencyScore: 5,
    contextType: 'prompts',
    testRequired: true,
    description: 'Customer custom prompt 2'
  },
  {
    fieldPath: 'customers/:customerId.aiSettings.prompts.custom.2',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ContextEngine'],
    required: true,
    urgencyScore: 5,
    contextType: 'prompts',
    testRequired: true,
    description: 'Customer custom prompt 3'
  },

  // Prompt Frequency & Goals
  {
    fieldPath: 'customers/:customerId.aiSettings.prompts.frequency',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['MomentsEngine'],
    required: true,
    urgencyScore: 4,
    contextType: 'prompts',
    testRequired: true,
    description: 'Customer prompt frequency setting'
  },
  {
    fieldPath: 'customers/:customerId.aiSettings.prompts.goals',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ContextEngine'],
    required: true,
    urgencyScore: 4,
    contextType: 'prompts',
    testRequired: true,
    description: 'Customer prompt goals setting'
  },

  // Context & Branding
  {
    fieldPath: 'customers/:customerId.aiSettings.context.websiteUrl',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ContextEngine'],
    required: true,
    urgencyScore: 2,
    contextType: 'context',
    testRequired: true,
    description: 'Customer website URL for context'
  },
  {
    fieldPath: 'customers/:customerId.aiSettings.context.sampleSocialPosts.0',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ContextEngine'],
    required: true,
    urgencyScore: 2,
    contextType: 'context',
    testRequired: true,
    description: 'Customer sample social post 1'
  },
  {
    fieldPath: 'customers/:customerId.aiSettings.context.sampleSocialPosts.1',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ContextEngine'],
    required: true,
    urgencyScore: 2,
    contextType: 'context',
    testRequired: true,
    description: 'Customer sample social post 2'
  },
  {
    fieldPath: 'customers/:customerId.aiSettings.context.sampleSocialPosts.2',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ContextEngine'],
    required: true,
    urgencyScore: 2,
    contextType: 'context',
    testRequired: true,
    description: 'Customer sample social post 3'
  },

  // Agency AI Settings - Tone & Style
  {
    fieldPath: 'agencies/:agencyId.aiSettings.tone.formality',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ToneEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 3,
    contextType: 'tone',
    testRequired: true,
    description: 'Agency tone formality setting'
  },
  {
    fieldPath: 'agencies/:agencyId.aiSettings.tone.friendliness',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ToneEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 3,
    contextType: 'tone',
    testRequired: true,
    description: 'Agency tone friendliness setting'
  },

  // Agency AI Settings - Traits Engine
  {
    fieldPath: 'agencies/:agencyId.aiSettings.traits.communication.enabled',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['TraitsEngine'],
    required: true,
    urgencyScore: 6,
    contextType: 'traits',
    testRequired: true,
    description: 'Agency communication trait enabled setting'
  },
  {
    fieldPath: 'agencies/:agencyId.aiSettings.traits.communication.weight',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['TraitsEngine', 'WeightsEngine'],
    required: true,
    urgencyScore: 6,
    contextType: 'traits',
    testRequired: true,
    description: 'Agency communication trait weight setting'
  },
  {
    fieldPath: 'agencies/:agencyId.aiSettings.traits.communication.threshold',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['TraitsEngine'],
    required: true,
    urgencyScore: 6,
    contextType: 'traits',
    testRequired: true,
    description: 'Agency communication trait threshold setting'
  },

  // Agency AI Settings - Feedback Engine
  {
    fieldPath: 'agencies/:agencyId.aiSettings.feedback.sentimentScoring.enabled',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['FeedbackEngine'],
    required: true,
    urgencyScore: 7,
    contextType: 'feedback',
    testRequired: true,
    description: 'Agency sentiment scoring enabled setting'
  },
  {
    fieldPath: 'agencies/:agencyId.aiSettings.feedback.managerAccess.enabled',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['FeedbackEngine'],
    required: true,
    urgencyScore: 7,
    contextType: 'feedback',
    testRequired: true,
    description: 'Agency manager access enabled setting'
  },

  // Agency AI Settings - Weights Engine
  {
    fieldPath: 'agencies/:agencyId.aiSettings.weights.admin.adminInstruction',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['WeightsEngine'],
    required: true,
    urgencyScore: 8,
    contextType: 'weights',
    testRequired: true,
    description: 'Agency admin instruction weight setting'
  },
  {
    fieldPath: 'agencies/:agencyId.aiSettings.weights.customer.mission',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['WeightsEngine'],
    required: true,
    urgencyScore: 6,
    contextType: 'weights',
    testRequired: true,
    description: 'Agency customer mission weight setting'
  },

  // Agency AI Settings - Conversation Settings
  {
    fieldPath: 'agencies/:agencyId.aiSettings.conversation.privacy.enableAnonymousMode',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ContextEngine'],
    required: true,
    urgencyScore: 8,
    contextType: 'conversation',
    testRequired: true,
    description: 'Agency anonymous mode setting'
  },

  // User Profile Fields
  {
    fieldPath: 'users/:uid.profile.firstName',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp'],
    destinationModules: ['Logs'],
    required: true,
    urgencyScore: 1,
    contextType: 'profile',
    testRequired: false,
    description: 'User first name update'
  },
  {
    fieldPath: 'users/:uid.profile.lastName',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp'],
    destinationModules: ['Logs'],
    required: true,
    urgencyScore: 1,
    contextType: 'profile',
    testRequired: false,
    description: 'User last name update'
  },

  // Shift Status Changes
  {
    fieldPath: 'shifts/:shiftId.status',
    trigger: 'update',
    expectedLogKeys: ['shiftId', 'oldValue', 'newValue', 'timestamp', 'userId'],
    destinationModules: ['Scheduler', 'ContextEngine'],
    required: true,
    urgencyScore: 5,
    contextType: 'scheduling',
    testRequired: true,
    description: 'Shift status change'
  },

  // Feedback Creation
  {
    fieldPath: 'feedback/:feedbackId.score',
    trigger: 'create',
    expectedLogKeys: ['feedbackId', 'score', 'targetUserId', 'sourceUserId', 'timestamp'],
    destinationModules: ['FeedbackEngine', 'TraitsEngine'],
    required: true,
    urgencyScore: 7,
    contextType: 'feedback',
    testRequired: true,
    description: 'Feedback score creation'
  },

  // Admin AI Settings - Tone
  {
    fieldPath: 'appAiSettings.tone.contextAwareness',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ToneEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 4,
    contextType: 'tone',
    testRequired: true,
    description: 'Admin tone context awareness setting'
  },
  {
    fieldPath: 'appAiSettings.tone.personalityOverride',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ToneEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 4,
    contextType: 'tone',
    testRequired: true,
    description: 'Admin tone personality override setting'
  },

  // Admin AI Settings - Motivation
  {
    fieldPath: 'appAiSettings.motivation.enableRoleBasedMessaging',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['MotivationEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 5,
    contextType: 'motivation',
    testRequired: true,
    description: 'Admin motivation role-based messaging setting'
  },
  {
    fieldPath: 'appAiSettings.motivation.enableTraitBasedMessaging',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['MotivationEngine', 'TraitsEngine'],
    required: true,
    urgencyScore: 5,
    contextType: 'motivation',
    testRequired: true,
    description: 'Admin motivation trait-based messaging setting'
  },
  {
    fieldPath: 'appAiSettings.motivation.enableAIComposition',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['MotivationEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 6,
    contextType: 'motivation',
    testRequired: true,
    description: 'Admin motivation AI composition setting'
  },
  {
    fieldPath: 'appAiSettings.motivation.enableSmartTiming',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['MotivationEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 4,
    contextType: 'motivation',
    testRequired: true,
    description: 'Admin motivation smart timing setting'
  },
  {
    fieldPath: 'appAiSettings.motivation.enableStreakTracking',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['MotivationEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 4,
    contextType: 'motivation',
    testRequired: true,
    description: 'Admin motivation streak tracking setting'
  },
  {
    fieldPath: 'appAiSettings.motivation.enableFeedbackLoop',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['MotivationEngine', 'FeedbackEngine'],
    required: true,
    urgencyScore: 6,
    contextType: 'motivation',
    testRequired: true,
    description: 'Admin motivation feedback loop setting'
  },
  {
    fieldPath: 'appAiSettings.motivation.enablePersonalizationLearning',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['MotivationEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 5,
    contextType: 'motivation',
    testRequired: true,
    description: 'Admin motivation personalization learning setting'
  },
  {
    fieldPath: 'appAiSettings.motivation.streakRewardsEnabled',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['MotivationEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 3,
    contextType: 'motivation',
    testRequired: true,
    description: 'Admin motivation streak rewards setting'
  },

  // Agency AI Settings - Traits Master Rules
  {
    fieldPath: 'agencies/:agencyId.aiSettings.traits.masterRules.minScoreThreshold',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['TraitsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 4,
    contextType: 'traits',
    testRequired: true,
    description: 'Agency traits min score threshold'
  },
  {
    fieldPath: 'agencies/:agencyId.aiSettings.traits.masterRules.maxScoreThreshold',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['TraitsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 4,
    contextType: 'traits',
    testRequired: true,
    description: 'Agency traits max score threshold'
  },
  {
    fieldPath: 'agencies/:agencyId.aiSettings.traits.masterRules.signalWeightMultiplier',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['TraitsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 4,
    contextType: 'traits',
    testRequired: true,
    description: 'Agency traits signal weight multiplier'
  },

  // Admin AI Settings - Motivation Advanced
  {
    fieldPath: 'appAiSettings.motivation.feedbackLoopSensitivity',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['MotivationEngine', 'FeedbackEngine'],
    required: true,
    urgencyScore: 6,
    contextType: 'motivation',
    testRequired: true,
    description: 'Admin motivation feedback loop sensitivity setting'
  },
  {
    fieldPath: 'appAiSettings.motivation.smartDeliveryWindow',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['MotivationEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 4,
    contextType: 'motivation',
    testRequired: true,
    description: 'Admin motivation smart delivery window setting'
  },
  {
    fieldPath: 'appAiSettings.motivation.personalizationDepth',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['MotivationEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 5,
    contextType: 'motivation',
    testRequired: true,
    description: 'Admin motivation personalization depth setting'
  },
  {
    fieldPath: 'appAiSettings.motivation.themeOfTheMonth',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['MotivationEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 3,
    contextType: 'motivation',
    testRequired: true,
    description: 'Admin motivation theme of the month setting'
  },

  // Admin AI Settings - Weights Engine
  {
    fieldPath: 'appAiSettings.weights.admin.adminInstruction',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['WeightsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 7,
    contextType: 'weights',
    testRequired: true,
    description: 'Admin weights admin instruction setting'
  },
  {
    fieldPath: 'appAiSettings.weights.admin.compliance',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['WeightsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 7,
    contextType: 'weights',
    testRequired: true,
    description: 'Admin weights compliance setting'
  },
  {
    fieldPath: 'appAiSettings.weights.admin.riskTolerance',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['WeightsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 7,
    contextType: 'weights',
    testRequired: true,
    description: 'Admin weights risk tolerance setting'
  },
  {
    fieldPath: 'appAiSettings.weights.admin.escalation',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['WeightsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 7,
    contextType: 'weights',
    testRequired: true,
    description: 'Admin weights escalation setting'
  },
  {
    fieldPath: 'appAiSettings.weights.customer.mission',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['WeightsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 6,
    contextType: 'weights',
    testRequired: true,
    description: 'Customer weights mission setting'
  },
  {
    fieldPath: 'appAiSettings.weights.customer.teamStructure',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['WeightsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 6,
    contextType: 'weights',
    testRequired: true,
    description: 'Customer weights team structure setting'
  },
  {
    fieldPath: 'appAiSettings.weights.customer.retentionGoals',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['WeightsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 6,
    contextType: 'weights',
    testRequired: true,
    description: 'Customer weights retention goals setting'
  },
  {
    fieldPath: 'appAiSettings.weights.customer.customPolicies',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['WeightsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 6,
    contextType: 'weights',
    testRequired: true,
    description: 'Customer weights custom policies setting'
  },
  {
    fieldPath: 'appAiSettings.weights.customer.cultureFit',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['WeightsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 6,
    contextType: 'weights',
    testRequired: true,
    description: 'Customer weights culture fit setting'
  },
  {
    fieldPath: 'appAiSettings.weights.employee.feedback',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['WeightsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 5,
    contextType: 'weights',
    testRequired: true,
    description: 'Employee weights feedback setting'
  },
  {
    fieldPath: 'appAiSettings.weights.employee.behavior',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['WeightsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 5,
    contextType: 'weights',
    testRequired: true,
    description: 'Employee weights behavior setting'
  },
  {
    fieldPath: 'appAiSettings.weights.employee.performance',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['WeightsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 5,
    contextType: 'weights',
    testRequired: true,
    description: 'Employee weights performance setting'
  },
  {
    fieldPath: 'appAiSettings.weights.employee.wellness',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['WeightsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 5,
    contextType: 'weights',
    testRequired: true,
    description: 'Employee weights wellness setting'
  },
  {
    fieldPath: 'appAiSettings.weights.employee.growth',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['WeightsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 5,
    contextType: 'weights',
    testRequired: true,
    description: 'Employee weights growth setting'
  },

  // Module Settings
  {
    fieldPath: 'modules/:moduleId.name',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ContextEngine'],
    required: true,
    urgencyScore: 6,
    contextType: 'modules',
    testRequired: true,
    description: 'Module name setting'
  },
  {
    fieldPath: 'modules/:moduleId.description',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ContextEngine'],
    required: true,
    urgencyScore: 4,
    contextType: 'modules',
    testRequired: true,
    description: 'Module description setting'
  },
  {
    fieldPath: 'modules/:moduleId.isEnabled',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ContextEngine'],
    required: true,
    urgencyScore: 7,
    contextType: 'modules',
    testRequired: true,
    description: 'Module enabled setting'
  },
  {
    fieldPath: 'modules/:moduleId.aiRecommendsByDefault',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['ContextEngine'],
    required: true,
    urgencyScore: 5,
    contextType: 'modules',
    testRequired: true,
    description: 'Module AI recommendation setting'
  },

  // Campaign Settings
  {
    fieldPath: 'campaigns/:campaignId.title',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['CampaignsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 6,
    contextType: 'campaigns',
    testRequired: true,
    description: 'Campaign title setting'
  },
  {
    fieldPath: 'campaigns/:campaignId.objective',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['CampaignsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 7,
    contextType: 'campaigns',
    testRequired: true,
    description: 'Campaign objective setting'
  },
  {
    fieldPath: 'campaigns/:campaignId.category',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['CampaignsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 5,
    contextType: 'campaigns',
    testRequired: true,
    description: 'Campaign category setting'
  },
  {
    fieldPath: 'campaigns/:campaignId.tone',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['CampaignsEngine', 'ToneEngine'],
    required: true,
    urgencyScore: 6,
    contextType: 'campaigns',
    testRequired: true,
    description: 'Campaign AI tone setting'
  },
  {
    fieldPath: 'campaigns/:campaignId.targetAudience',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['CampaignsEngine', 'ContextEngine'],
    required: true,
    urgencyScore: 8,
    contextType: 'campaigns',
    testRequired: true,
    description: 'Campaign target audience setting'
  },
  {
    fieldPath: 'campaigns/:campaignId.frequency',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['CampaignsEngine', 'Scheduler'],
    required: true,
    urgencyScore: 6,
    contextType: 'campaigns',
    testRequired: true,
    description: 'Campaign frequency setting'
  },
  {
    fieldPath: 'campaigns/:campaignId.status',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['CampaignsEngine', 'Scheduler'],
    required: true,
    urgencyScore: 8,
    contextType: 'campaigns',
    testRequired: true,
    description: 'Campaign status setting'
  },
  {
    fieldPath: 'campaigns/:campaignId.followUpStrategy',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['CampaignsEngine', 'Scheduler'],
    required: true,
    urgencyScore: 7,
    contextType: 'campaigns',
    testRequired: true,
    description: 'Campaign follow-up strategy setting'
  },
  {
    fieldPath: 'campaigns/:campaignId.aiBehavior.responsePattern',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['CampaignsEngine', 'ToneEngine'],
    required: true,
    urgencyScore: 6,
    contextType: 'campaigns',
    testRequired: true,
    description: 'Campaign AI response pattern setting'
  },
  {
    fieldPath: 'campaigns/:campaignId.aiBehavior.escalationThreshold',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['CampaignsEngine', 'PriorityEngine'],
    required: true,
    urgencyScore: 7,
    contextType: 'campaigns',
    testRequired: true,
    description: 'Campaign escalation threshold setting'
  },
  {
    fieldPath: 'campaigns/:campaignId.aiBehavior.traitTracking',
    trigger: 'update',
    expectedLogKeys: ['userId', 'fieldPath', 'oldValue', 'newValue', 'triggerType', 'timestamp', 'contextType', 'urgencyScore'],
    destinationModules: ['CampaignsEngine', 'TraitsEngine'],
    required: true,
    urgencyScore: 6,
    contextType: 'campaigns',
    testRequired: true,
    description: 'Campaign trait tracking setting'
  }
];

// Helper functions for working with the trigger map
export const getTriggerDefinition = (fieldPath: string): LogTriggerDefinition | undefined => {
  return loggingTriggerMap.find(trigger => trigger.fieldPath === fieldPath);
};

export const getTriggersByModule = (module: Module): LogTriggerDefinition[] => {
  return loggingTriggerMap.filter(trigger => trigger.destinationModules.includes(module));
};

export const getTriggersByContextType = (contextType: string): LogTriggerDefinition[] => {
  return loggingTriggerMap.filter(trigger => trigger.contextType === contextType);
};

export const getRequiredTriggers = (): LogTriggerDefinition[] => {
  return loggingTriggerMap.filter(trigger => trigger.required);
};

export const getTestRequiredTriggers = (): LogTriggerDefinition[] => {
  return loggingTriggerMap.filter(trigger => trigger.testRequired);
};

// Field path utilities
export const parseFieldPath = (fieldPath: string): { 
  collection: string; 
  documentId: string; 
  field: string; 
  variables: string[] 
} => {
  const parts = fieldPath.split('.');
  const collectionDoc = parts[0];
  const [collection, documentId] = collectionDoc.split(':');
  
  const variables = documentId.match(/:[^/]+/g)?.map(v => v.slice(1)) || [];
  const field = parts.slice(1).join('.');
  
  return {
    collection,
    documentId,
    field,
    variables
  };
};

// Validation functions
export const validateLogEntry = (logEntry: any, triggerDefinition: LogTriggerDefinition): {
  isValid: boolean;
  missingKeys: string[];
  extraKeys: string[];
} => {
  const expectedKeys = triggerDefinition.expectedLogKeys;
  const actualKeys = Object.keys(logEntry);
  
  const missingKeys = expectedKeys.filter(key => !actualKeys.includes(key));
  const extraKeys = actualKeys.filter(key => !expectedKeys.includes(key));
  
  return {
    isValid: missingKeys.length === 0,
    missingKeys,
    extraKeys
  };
}; 