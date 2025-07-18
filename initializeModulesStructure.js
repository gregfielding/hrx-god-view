const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, setDoc, collection, getDocs } = require('firebase/firestore');

// Your Firebase config
const firebaseConfig = {
  // Add your Firebase config here
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Default module definitions
const defaultModules = [
  {
    id: 'hrx-companion',
    name: 'HRX Companion',
    description: 'AI companion for personalized support and guidance',
    isEnabled: true,
    isCore: true,
    settings: {
      enablePersonalization: true,
      enableAnalytics: true,
      dataRetentionDays: 1095,
    }
  },
  {
    id: 'hrx-intelligence',
    name: 'HRX Intelligence',
    description: 'Risk scoring and predictive insights',
    isEnabled: true,
    isCore: true,
    settings: {
      enableRiskScoring: true,
      enablePredictiveAnalytics: true,
      dataRetentionDays: 1825,
    }
  },
  {
    id: 'hrx-traits-engine',
    name: 'HRX Traits Engine',
    description: 'Behavioral analysis and trait tracking',
    isEnabled: true,
    isCore: true,
    settings: {
      enableTraitObservation: true,
      enableBehavioralPatterns: true,
      dataRetentionDays: 1095,
    }
  },
  {
    id: 'hrx-moments-engine',
    name: 'HRX Moments Engine',
    description: 'Intelligent interventions and nudges',
    isEnabled: false,
    isCore: false,
    settings: {
      enableNudges: true,
      enableOneOnOneCadence: true,
      dataRetentionDays: 730,
    }
  },
  {
    id: 'hrx-campaigns',
    name: 'HRX Campaigns',
    description: 'Strategic campaign management',
    isEnabled: false,
    isCore: false,
    settings: {
      enableCampaignTriggers: true,
      enableEngagementTracking: true,
      dataRetentionDays: 1095,
    }
  },
  {
    id: 'hrx-broadcasts',
    name: 'HRX Broadcasts',
    description: 'Communication and surveys',
    isEnabled: false,
    isCore: false,
    settings: {
      enableOneTimeBroadcasts: true,
      enableSurveys: true,
      dataRetentionDays: 730,
    }
  },
  {
    id: 'hrx-flex',
    name: 'HRX Flex',
    description: 'Flexible workforce management system',
    isEnabled: false,
    isCore: false,
    isComingSoon: true,
    settings: {
      enableJobOrders: true,
      enableVisibilityRules: true,
      dataRetentionDays: 1095,
    }
  },
  {
    id: 'hrx-recruiter',
    name: 'HRX Recruiter',
    description: 'Intelligent recruitment system',
    isEnabled: false,
    isCore: false,
    isComingSoon: true,
    settings: {
      enableApplicationSettings: true,
      enableAIScoring: true,
      dataRetentionDays: 1825,
    }
  },
  {
    id: 'hrx-insight-reports',
    name: 'HRX Insight Reports',
    description: 'Comprehensive reporting system',
    isEnabled: false,
    isCore: false,
    isComingSoon: true,
    settings: {
      enableToggleReports: true,
      enableFavorites: true,
      dataRetentionDays: 1825,
    }
  },
  {
    id: 'job-satisfaction-insights',
    name: 'Job Satisfaction Insights',
    description: 'AI-powered satisfaction scoring',
    isEnabled: false,
    isCore: false,
    settings: {
      baselineSurveyEnabled: true,
      enableRiskAlerts: true,
      dataRetentionDays: 1095,
    }
  },
  {
    id: 'work-life-balance',
    name: 'Work-Life Balance',
    description: 'Wellbeing monitoring and support',
    isEnabled: false,
    isCore: false,
    settings: {
      enableWeeklyCheckIns: true,
      enableBurnoutRiskIndex: true,
      dataRetentionDays: 730,
    }
  },
  {
    id: 'daily-motivation',
    name: 'Daily Motivation',
    description: 'AI-powered motivational messaging',
    isEnabled: false,
    isCore: false,
    isComingSoon: true,
    settings: {
      defaultDeliveryTime: '09:00',
      defaultFrequency: 'daily',
      dataRetentionDays: 730,
    }
  },
  {
    id: 'reset-mode',
    name: 'Reset Mode',
    description: 'Mental/emotional break mechanism',
    isEnabled: false,
    isCore: false,
    isComingSoon: true,
    settings: {
      defaultDuration: 2,
      mindfulnessEnabled: true,
      dataRetentionDays: 365,
    }
  },
  {
    id: 'mini-learning-boosts',
    name: 'Mini-Learning Boosts',
    description: 'AI-curated microlearning content',
    isEnabled: false,
    isCore: false,
    isComingSoon: true,
    settings: {
      defaultDeliveryTime: '09:00',
      defaultFrequency: 'weekly',
      dataRetentionDays: 730,
    }
  },
  {
    id: 'professional-growth',
    name: 'Professional Growth',
    description: 'Career goal tracking and development',
    isEnabled: false,
    isCore: false,
    isComingSoon: true,
    settings: {
      enableGoalSetting: true,
      enableCareerJournaling: true,
      dataRetentionDays: 1095,
    }
  },
];

async function initializeModulesStructure() {
  try {
    console.log('Starting modules structure initialization...');
    
    // Get all tenants
    const tenantsRef = collection(db, 'tenants');
    const tenantsSnap = await getDocs(tenantsRef);
    
    for (const tenantDoc of tenantsSnap.docs) {
      const tenantId = tenantDoc.id;
      console.log(`Processing tenant: ${tenantId}`);
      
      // Check if modules subcollection already exists
      const modulesRef = collection(db, 'tenants', tenantId, 'modules');
      const modulesSnap = await getDocs(modulesRef);
      
      if (modulesSnap.empty) {
        console.log(`No modules found for tenant ${tenantId}, initializing...`);
        
        // Initialize with default modules
        for (const module of defaultModules) {
          const moduleRef = doc(db, 'tenants', tenantId, 'modules', module.id);
          
          const moduleData = {
            isEnabled: module.isEnabled,
            settings: module.settings,
            customSettings: {},
            lastUpdated: new Date().toISOString(),
          };
          
          await setDoc(moduleRef, moduleData);
          console.log(`Initialized module ${module.id} for tenant ${tenantId}`);
        }
        
        console.log(`Completed initialization for tenant ${tenantId}`);
      } else {
        console.log(`Modules already exist for tenant ${tenantId} (${modulesSnap.docs.length} modules)`);
      }
    }
    
    console.log('Modules structure initialization completed successfully!');
  } catch (error) {
    console.error('Initialization failed:', error);
  }
}

// Run the initialization
initializeModulesStructure(); 