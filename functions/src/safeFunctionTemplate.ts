// SAFEGUARD SYSTEM - PREVENTS ACCIDENTAL FUNCTION REMOVAL
interface SafeguardConfig {
  readonly: boolean; // If true, function cannot be modified or removed
  requiresApproval: boolean; // If true, changes require explicit user approval
  criticalFunction: boolean; // If true, function is marked as business-critical
  lastModified: string; // Timestamp of last modification
  modificationHistory: string[]; // History of changes
}

const SAFEGUARD_CONFIGS: Record<string, SafeguardConfig> = {
  // CRITICAL BUSINESS FUNCTIONS - NEVER REMOVE WITHOUT EXPLICIT DISCUSSION
  'enrichCompanyOnDemand': {
    readonly: false,
    requiresApproval: true,
    criticalFunction: true,
    lastModified: new Date().toISOString(),
    modificationHistory: ['Created as core company enrichment function']
  },
  'syncApolloHeadquartersLocation': {
    readonly: false,
    requiresApproval: true,
    criticalFunction: true,
    lastModified: new Date().toISOString(),
    modificationHistory: ['Creates headquarters locations from Apollo data']
  },
  'getSalespeopleForTenant': {
    readonly: false,
    requiresApproval: true,
    criticalFunction: true,
    lastModified: new Date().toISOString(),
    modificationHistory: ['Core CRM functionality']
  },
  'getCalendarStatus': {
    readonly: false,
    requiresApproval: true,
    criticalFunction: true,
    lastModified: new Date().toISOString(),
    modificationHistory: ['Core Google integration']
  },
  'getGmailStatus': {
    readonly: false,
    requiresApproval: true,
    criticalFunction: true,
    lastModified: new Date().toISOString(),
    modificationHistory: ['Core Google integration']
  },
  'listCalendarEvents': {
    readonly: false,
    requiresApproval: true,
    criticalFunction: true,
    lastModified: new Date().toISOString(),
    modificationHistory: ['Core calendar functionality']
  },
  'getTasks': {
    readonly: false,
    requiresApproval: true,
    criticalFunction: true,
    lastModified: new Date().toISOString(),
    modificationHistory: ['Core task management functionality']
  },
  'getFirmographics': {
    readonly: false,
    requiresApproval: true,
    criticalFunction: true,
    lastModified: new Date().toISOString(),
    modificationHistory: ['Core company data functionality']
  },
  'dealCoachAnalyzeCallable': {
    readonly: false,
    requiresApproval: true,
    criticalFunction: true,
    lastModified: new Date().toISOString(),
    modificationHistory: ['Core AI deal coaching functionality']
  },
  'firestoreLogAILogCreated': {
    readonly: false,
    requiresApproval: true,
    criticalFunction: true,
    lastModified: new Date().toISOString(),
    modificationHistory: ['Core AI logging functionality']
  },
  'updateActiveSalespeopleOnEmailLog': {
    readonly: false,
    requiresApproval: true,
    criticalFunction: true,
    lastModified: new Date().toISOString(),
    modificationHistory: ['Core salespeople tracking functionality']
  },
  'firestoreCompanySnapshotFanout': {
    readonly: false,
    requiresApproval: true,
    criticalFunction: true,
    lastModified: new Date().toISOString(),
    modificationHistory: ['Core company data synchronization']
  }
};

// Safeguard check function
export function checkSafeguard(functionName: string, operation: 'modify' | 'remove' | 'disable'): boolean {
  const config = SAFEGUARD_CONFIGS[functionName];
  
  if (!config) {
    console.warn(`⚠️  SAFEGUARD: Function ${functionName} not in safeguard config - proceeding with caution`);
    return true;
  }
  
  if (config.readonly) {
    console.error(`🚨 SAFEGUARD BLOCKED: Function ${functionName} is READONLY and cannot be ${operation}d`);
    return false;
  }
  
  if (config.criticalFunction) {
    console.warn(`⚠️  SAFEGUARD WARNING: Function ${functionName} is CRITICAL - ${operation} requires explicit user approval`);
    console.warn(`   Last modified: ${config.lastModified}`);
    console.warn(`   History: ${config.modificationHistory.join(', ')}`);
    return false;
  }
  
  if (config.requiresApproval) {
    console.warn(`⚠️  SAFEGUARD: Function ${functionName} requires approval for ${operation}`);
    return false;
  }
  
  return true;
}

// Function to update safeguard config
export function updateSafeguardConfig(functionName: string, updates: Partial<SafeguardConfig>): void {
  if (!SAFEGUARD_CONFIGS[functionName]) {
    SAFEGUARD_CONFIGS[functionName] = {
      readonly: false,
      requiresApproval: false,
      criticalFunction: false,
      lastModified: new Date().toISOString(),
      modificationHistory: ['Initial configuration']
    };
  }
  
  const config = SAFEGUARD_CONFIGS[functionName];
  const oldConfig = { ...config };
  
  Object.assign(config, updates);
  config.lastModified = new Date().toISOString();
  config.modificationHistory.push(`Modified: ${JSON.stringify(updates)}`);
  
  console.log(`✅ SAFEGUARD: Updated config for ${functionName}:`, {
    old: oldConfig,
    new: config
  });
}
