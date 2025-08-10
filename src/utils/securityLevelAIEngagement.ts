import { getFunctions, httpsCallable } from 'firebase/functions';

import { app } from '../firebase';

// Security Level Definitions
export const SECURITY_LEVELS = {
  ADMIN: '7',
  MANAGER: '6', 
  WORKER: '5',
  HIRED_STAFF: '4',
  APPLICANT: '3',
  SUSPENDED: '2',
  DISMISSED: '1'
} as const;

export type SecurityLevel = typeof SECURITY_LEVELS[keyof typeof SECURITY_LEVELS];

// AI Engagement Configuration Interface
export interface SecurityLevelAIEngagement {
  securityLevel: SecurityLevel;
  enabled: boolean;
  engagementType: 'standard' | 'applicant' | 'hired_staff' | 'flex_worker' | 'none';
  modules: {
    aiChat: boolean;
    aiCampaigns: boolean;
    aiMoments: boolean;
    jobSatisfactionInsights: boolean;
    traitsEngine: boolean;
    feedbackEngine: boolean;
    motivationLibrary: boolean;
  };
  messaging: {
    tone: 'professional' | 'casual' | 'supportive' | 'none';
    frequency: 'low' | 'medium' | 'high' | 'none';
    topics: string[];
    restrictedTopics: string[];
  };
  behavior: {
    allowJobApplications: boolean;
    encourageQualifications: boolean;
    allowCareerGoals: boolean;
    allowProfileUpdates: boolean;
    allowFeedback: boolean;
  };
  targeting: {
    includeInCampaigns: boolean;
    includeInMoments: boolean;
    includeInAnalytics: boolean;
    includeInReports: boolean;
  };
}

// Default AI Engagement Configurations
export const DEFAULT_AI_ENGAGEMENT_CONFIG: Record<SecurityLevel, SecurityLevelAIEngagement> = {
  [SECURITY_LEVELS.ADMIN]: {
    securityLevel: SECURITY_LEVELS.ADMIN,
    enabled: true,
    engagementType: 'standard',
    modules: {
      aiChat: true,
      aiCampaigns: true,
      aiMoments: true,
      jobSatisfactionInsights: true,
      traitsEngine: true,
      feedbackEngine: true,
      motivationLibrary: true,
    },
    messaging: {
      tone: 'professional',
      frequency: 'low',
      topics: ['system_updates', 'admin_tasks', 'team_management'],
      restrictedTopics: ['job_applications', 'qualifications_update'],
    },
    behavior: {
      allowJobApplications: false,
      encourageQualifications: false,
      allowCareerGoals: false,
      allowProfileUpdates: true,
      allowFeedback: true,
    },
    targeting: {
      includeInCampaigns: true,
      includeInMoments: true,
      includeInAnalytics: true,
      includeInReports: true,
    },
  },
  [SECURITY_LEVELS.MANAGER]: {
    securityLevel: SECURITY_LEVELS.MANAGER,
    enabled: true,
    engagementType: 'standard',
    modules: {
      aiChat: true,
      aiCampaigns: true,
      aiMoments: true,
      jobSatisfactionInsights: true,
      traitsEngine: true,
      feedbackEngine: true,
      motivationLibrary: true,
    },
    messaging: {
      tone: 'professional',
      frequency: 'medium',
      topics: ['team_management', 'performance', 'leadership'],
      restrictedTopics: ['job_applications', 'qualifications_update'],
    },
    behavior: {
      allowJobApplications: false,
      encourageQualifications: false,
      allowCareerGoals: false,
      allowProfileUpdates: true,
      allowFeedback: true,
    },
    targeting: {
      includeInCampaigns: true,
      includeInMoments: true,
      includeInAnalytics: true,
      includeInReports: true,
    },
  },
  [SECURITY_LEVELS.WORKER]: {
    securityLevel: SECURITY_LEVELS.WORKER,
    enabled: true,
    engagementType: 'standard',
    modules: {
      aiChat: true,
      aiCampaigns: true,
      aiMoments: true,
      jobSatisfactionInsights: true,
      traitsEngine: true,
      feedbackEngine: true,
      motivationLibrary: true,
    },
    messaging: {
      tone: 'supportive',
      frequency: 'medium',
      topics: ['wellness', 'performance', 'teamwork', 'growth'],
      restrictedTopics: ['job_applications', 'qualifications_update'],
    },
    behavior: {
      allowJobApplications: false,
      encourageQualifications: false,
      allowCareerGoals: false,
      allowProfileUpdates: true,
      allowFeedback: true,
    },
    targeting: {
      includeInCampaigns: true,
      includeInMoments: true,
      includeInAnalytics: true,
      includeInReports: true,
    },
  },
  [SECURITY_LEVELS.HIRED_STAFF]: {
    securityLevel: SECURITY_LEVELS.HIRED_STAFF,
    enabled: true,
    engagementType: 'hired_staff',
    modules: {
      aiChat: true,
      aiCampaigns: true,
      aiMoments: true,
      jobSatisfactionInsights: true,
      traitsEngine: true,
      feedbackEngine: true,
      motivationLibrary: true,
    },
    messaging: {
      tone: 'supportive',
      frequency: 'medium',
      topics: ['assignment_support', 'workplace_integration', 'performance', 'wellness'],
      restrictedTopics: ['job_applications', 'qualifications_update'],
    },
    behavior: {
      allowJobApplications: false,
      encourageQualifications: false,
      allowCareerGoals: false,
      allowProfileUpdates: true,
      allowFeedback: true,
    },
    targeting: {
      includeInCampaigns: true,
      includeInMoments: true,
      includeInAnalytics: true,
      includeInReports: true,
    },
  },
  [SECURITY_LEVELS.APPLICANT]: {
    securityLevel: SECURITY_LEVELS.APPLICANT,
    enabled: true,
    engagementType: 'applicant',
    modules: {
      aiChat: true,
      aiCampaigns: false,
      aiMoments: true,
      jobSatisfactionInsights: false,
      traitsEngine: true,
      feedbackEngine: false,
      motivationLibrary: false,
    },
    messaging: {
      tone: 'supportive',
      frequency: 'high',
      topics: ['resume_completion', 'profile_completion', 'application_status', 'next_steps'],
      restrictedTopics: [],
    },
    behavior: {
      allowJobApplications: true,
      encourageQualifications: true,
      allowCareerGoals: true,
      allowProfileUpdates: true,
      allowFeedback: false,
    },
    targeting: {
      includeInCampaigns: false,
      includeInMoments: true,
      includeInAnalytics: false,
      includeInReports: false,
    },
  },
  [SECURITY_LEVELS.SUSPENDED]: {
    securityLevel: SECURITY_LEVELS.SUSPENDED,
    enabled: false,
    engagementType: 'none',
    modules: {
      aiChat: false,
      aiCampaigns: false,
      aiMoments: false,
      jobSatisfactionInsights: false,
      traitsEngine: false,
      feedbackEngine: false,
      motivationLibrary: false,
    },
    messaging: {
      tone: 'none',
      frequency: 'none',
      topics: [],
      restrictedTopics: [],
    },
    behavior: {
      allowJobApplications: false,
      encourageQualifications: false,
      allowCareerGoals: false,
      allowProfileUpdates: false,
      allowFeedback: false,
    },
    targeting: {
      includeInCampaigns: false,
      includeInMoments: false,
      includeInAnalytics: false,
      includeInReports: false,
    },
  },
  [SECURITY_LEVELS.DISMISSED]: {
    securityLevel: SECURITY_LEVELS.DISMISSED,
    enabled: false,
    engagementType: 'none',
    modules: {
      aiChat: false,
      aiCampaigns: false,
      aiMoments: false,
      jobSatisfactionInsights: false,
      traitsEngine: false,
      feedbackEngine: false,
      motivationLibrary: false,
    },
    messaging: {
      tone: 'none',
      frequency: 'none',
      topics: [],
      restrictedTopics: [],
    },
    behavior: {
      allowJobApplications: false,
      encourageQualifications: false,
      allowCareerGoals: false,
      allowProfileUpdates: false,
      allowFeedback: false,
    },
    targeting: {
      includeInCampaigns: false,
      includeInMoments: false,
      includeInAnalytics: false,
      includeInReports: false,
    },
  },
};

// Utility Functions
export const getSecurityLevelConfig = (securityLevel: SecurityLevel): SecurityLevelAIEngagement => {
  return DEFAULT_AI_ENGAGEMENT_CONFIG[securityLevel] || DEFAULT_AI_ENGAGEMENT_CONFIG[SECURITY_LEVELS.WORKER];
};

export const isAIEngagementEnabled = (securityLevel: SecurityLevel): boolean => {
  const config = getSecurityLevelConfig(securityLevel);
  return config.enabled;
};

export const canAccessModule = (securityLevel: SecurityLevel, moduleName: keyof SecurityLevelAIEngagement['modules']): boolean => {
  const config = getSecurityLevelConfig(securityLevel);
  return config.enabled && config.modules[moduleName];
};

export const shouldIncludeInTargeting = (securityLevel: SecurityLevel, targetingType: keyof SecurityLevelAIEngagement['targeting']): boolean => {
  const config = getSecurityLevelConfig(securityLevel);
  return config.enabled && config.targeting[targetingType];
};

export const getMessagingTone = (securityLevel: SecurityLevel): string => {
  const config = getSecurityLevelConfig(securityLevel);
  return config.messaging.tone;
};

export const getMessagingFrequency = (securityLevel: SecurityLevel): string => {
  const config = getSecurityLevelConfig(securityLevel);
  return config.messaging.frequency;
};

export const getEngagementType = (securityLevel: SecurityLevel): string => {
  const config = getSecurityLevelConfig(securityLevel);
  return config.engagementType;
};

// Filter workers by AI engagement eligibility
export const filterWorkersForAIEngagement = (workers: any[], engagementType: 'campaigns' | 'moments' | 'analytics' | 'reports'): any[] => {
  return workers.filter(worker => {
    const securityLevel = worker.securityLevel || SECURITY_LEVELS.WORKER;
    
    if (!isAIEngagementEnabled(securityLevel)) {
      return false;
    }

    switch (engagementType) {
      case 'campaigns':
        return shouldIncludeInTargeting(securityLevel, 'includeInCampaigns');
      case 'moments':
        return shouldIncludeInTargeting(securityLevel, 'includeInMoments');
      case 'analytics':
        return shouldIncludeInTargeting(securityLevel, 'includeInAnalytics');
      case 'reports':
        return shouldIncludeInTargeting(securityLevel, 'includeInReports');
      default:
        return false;
    }
  });
};

// Get AI engagement settings for a tenant
export const getTenantAIEngagementSettings = async (tenantId: string): Promise<Record<SecurityLevel, SecurityLevelAIEngagement>> => {
  try {
    const functions = getFunctions(app, 'us-central1');
    const getSettingsFn = httpsCallable(functions, 'getTenantAIEngagementSettings');
    const result = await getSettingsFn({ tenantId });
    return result.data as Record<SecurityLevel, SecurityLevelAIEngagement>;
  } catch (error) {
    console.error('Failed to get tenant AI engagement settings:', error);
    return DEFAULT_AI_ENGAGEMENT_CONFIG;
  }
};

// Update AI engagement settings for a tenant
export const updateTenantAIEngagementSettings = async (
  tenantId: string, 
  settings: Record<SecurityLevel, SecurityLevelAIEngagement>
): Promise<void> => {
  try {
    const functions = getFunctions(app, 'us-central1');
    const updateSettingsFn = httpsCallable(functions, 'updateTenantAIEngagementSettings');
    await updateSettingsFn({ tenantId, settings });
  } catch (error) {
    console.error('Failed to update tenant AI engagement settings:', error);
    throw error;
  }
};

// Get custom messaging for specific engagement types
export const getCustomMessaging = (securityLevel: SecurityLevel, context: string): string => {
  const config = getSecurityLevelConfig(securityLevel);
  
  switch (config.engagementType) {
    case 'applicant':
      return `I'm here to help you complete your application and answer any questions about the position.`;
    case 'hired_staff':
      return `I'm here to support you in your role at your assigned workplace. How can I help you today?`;
    case 'flex_worker':
      return `I'm here to help you with your flexible work arrangements and career goals.`;
    default:
      return `I'm here to help you with your work and professional development.`;
  }
};

// Check if a topic is restricted for a security level
export const isTopicRestricted = (securityLevel: SecurityLevel, topic: string): boolean => {
  const config = getSecurityLevelConfig(securityLevel);
  return config.messaging.restrictedTopics.includes(topic);
};

// Get allowed topics for a security level
export const getAllowedTopics = (securityLevel: SecurityLevel): string[] => {
  const config = getSecurityLevelConfig(securityLevel);
  return config.messaging.topics;
}; 