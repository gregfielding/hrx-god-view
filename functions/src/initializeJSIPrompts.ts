import * as admin from 'firebase-admin';

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const { Timestamp } = admin.firestore;

interface JSIPromptTemplate {
  promptType: 'baseline' | 'quarterly' | 'flagged' | 'opportunistic';
  dimension: 'workEngagement' | 'careerAlignment' | 'managerRelationship' | 'personalWellbeing' | 'jobMobility';
  promptText: string;
  category: string;
  priority: 'low' | 'medium' | 'high';
  isActive: boolean;
  createdAt: admin.firestore.Timestamp;
}

const defaultPromptTemplates: JSIPromptTemplate[] = [
  // Work Engagement Prompts
  {
    promptType: 'baseline',
    dimension: 'workEngagement',
    promptText: "How would you describe your energy and focus at work this week? Do you feel like you're making a meaningful contribution?",
    category: 'energy_focus',
    priority: 'high',
    isActive: true,
    createdAt: Timestamp.now(),
  },
  {
    promptType: 'quarterly',
    dimension: 'workEngagement',
    promptText: "Looking back at the past few months, what aspects of your work have been most energizing? What has felt most draining?",
    category: 'reflection',
    priority: 'medium',
    isActive: true,
    createdAt: Timestamp.now(),
  },
  {
    promptType: 'opportunistic',
    dimension: 'workEngagement',
    promptText: "How's your day going? Do you feel like you're in a good rhythm with your work?",
    category: 'daily_check',
    priority: 'low',
    isActive: true,
    createdAt: Timestamp.now(),
  },

  // Career Alignment Prompts
  {
    promptType: 'baseline',
    dimension: 'careerAlignment',
    promptText: "Are you developing skills and gaining experience that align with your long-term career goals? What would you like to learn or improve?",
    category: 'skill_development',
    priority: 'high',
    isActive: true,
    createdAt: Timestamp.now(),
  },
  {
    promptType: 'quarterly',
    dimension: 'careerAlignment',
    promptText: "How do you see this current role fitting into your career path? Are there opportunities here that excite you?",
    category: 'career_path',
    priority: 'medium',
    isActive: true,
    createdAt: Timestamp.now(),
  },
  {
    promptType: 'flagged',
    dimension: 'careerAlignment',
    promptText: "I noticed you might be feeling uncertain about your career direction. What kind of work or role would you find most fulfilling?",
    category: 'career_guidance',
    priority: 'high',
    isActive: true,
    createdAt: Timestamp.now(),
  },

  // Manager Relationship Prompts
  {
    promptType: 'baseline',
    dimension: 'managerRelationship',
    promptText: "How would you describe your relationship with your manager? Do you feel supported and heard?",
    category: 'relationship_assessment',
    priority: 'high',
    isActive: true,
    createdAt: Timestamp.now(),
  },
  {
    promptType: 'quarterly',
    dimension: 'managerRelationship',
    promptText: "What's one thing your manager does really well? What's one area where you'd like to see improvement?",
    category: 'feedback',
    priority: 'medium',
    isActive: true,
    createdAt: Timestamp.now(),
  },
  {
    promptType: 'flagged',
    dimension: 'managerRelationship',
    promptText: "It seems like there might be some challenges with your manager relationship. What would help improve communication or support?",
    category: 'conflict_resolution',
    priority: 'high',
    isActive: true,
    createdAt: Timestamp.now(),
  },

  // Personal Wellbeing Prompts
  {
    promptType: 'baseline',
    dimension: 'personalWellbeing',
    promptText: "How are you feeling outside of work lately? Are you getting enough rest and maintaining a good work-life balance?",
    category: 'work_life_balance',
    priority: 'medium',
    isActive: true,
    createdAt: Timestamp.now(),
  },
  {
    promptType: 'quarterly',
    dimension: 'personalWellbeing',
    promptText: "How has your personal wellbeing been over the past few months? What's been going well, and what's been challenging?",
    category: 'wellbeing_assessment',
    priority: 'medium',
    isActive: true,
    createdAt: Timestamp.now(),
  },
  {
    promptType: 'flagged',
    dimension: 'personalWellbeing',
    promptText: "I want to check in on how you're doing personally. Is there anything outside of work that's been affecting your energy or mood?",
    category: 'support_check',
    priority: 'high',
    isActive: true,
    createdAt: Timestamp.now(),
  },

  // Job Mobility Prompts
  {
    promptType: 'baseline',
    dimension: 'jobMobility',
    promptText: "How committed do you feel to staying with this company long-term? What would make you consider other opportunities?",
    category: 'commitment_assessment',
    priority: 'high',
    isActive: true,
    createdAt: Timestamp.now(),
  },
  {
    promptType: 'quarterly',
    dimension: 'jobMobility',
    promptText: "Have you been thinking about your future with the company? What would make you want to stay or consider other options?",
    category: 'retention_check',
    priority: 'medium',
    isActive: true,
    createdAt: Timestamp.now(),
  },
  {
    promptType: 'flagged',
    dimension: 'jobMobility',
    promptText: "I want to understand what might be causing you to consider other opportunities. What would make this role more fulfilling for you?",
    category: 'retention_intervention',
    priority: 'high',
    isActive: true,
    createdAt: Timestamp.now(),
  },
];

export async function initializeJSIPromptTemplates() {
  try {
    console.log('Initializing JSI prompt templates...');
    
    const templatesRef = db.collection('jsiPromptTemplates');
    
    for (const template of defaultPromptTemplates) {
      await templatesRef.add(template);
    }
    
    console.log(`Successfully initialized ${defaultPromptTemplates.length} JSI prompt templates`);
    return { success: true, count: defaultPromptTemplates.length };
  } catch (error) {
    console.error('Error initializing JSI prompt templates:', error);
    throw error;
  }
}

// Export for manual execution
export { defaultPromptTemplates }; 