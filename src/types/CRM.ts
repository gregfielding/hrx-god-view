// AI-Driven CRM Types

// 🆕 UNIVERSAL ASSOCIATION SYSTEM
export interface CRMAssociation {
  id: string;
  sourceEntityType: 'company' | 'location' | 'contact' | 'deal' | 'salesperson' | 'division';
  sourceEntityId: string;
  targetEntityType: 'company' | 'location' | 'contact' | 'deal' | 'salesperson' | 'division';
  targetEntityId: string;
  associationType: 'primary' | 'secondary' | 'reporting' | 'collaboration' | 'ownership' | 'influence';
  role?: string; // e.g., 'decision_maker', 'influencer', 'owner', 'collaborator'
  strength: 'weak' | 'medium' | 'strong'; // Relationship strength for AI context
  metadata?: {
    startDate?: any;
    endDate?: any;
    notes?: string;
    tags?: string[];
    customFields?: { [key: string]: any };
  };
  tenantId: string;
  createdAt: any;
  updatedAt: any;
  createdBy: string;
  updatedBy: string;
}

// 🆕 ASSOCIATION QUERY INTERFACE
export interface AssociationQuery {
  entityType: 'company' | 'location' | 'contact' | 'deal' | 'salesperson' | 'division';
  entityId: string;
  targetTypes?: ('company' | 'location' | 'contact' | 'deal' | 'salesperson' | 'division')[];
  associationTypes?: ('primary' | 'secondary' | 'reporting' | 'collaboration' | 'ownership' | 'influence')[];
  strength?: ('weak' | 'medium' | 'strong')[];
  includeMetadata?: boolean;
  limit?: number;
}

// 🆕 ASSOCIATION RESULT INTERFACE
export interface AssociationResult {
  associations: CRMAssociation[];
  entities: {
    companies: CRMCompany[];
    locations: CRMLocation[];
    contacts: CRMContact[];
    deals: CRMDeal[];
    salespeople: any[]; // Will be defined when we implement salespeople
    divisions: any[]; // Will be defined when we implement divisions
  };
  summary: {
    totalAssociations: number;
    byType: { [key: string]: number };
    byStrength: { [key: string]: number };
  };
}

// 🆕 ENHANCED CRM ENTITIES WITH ASSOCIATION SUPPORT
export interface CRMContact {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  title: string;
  companyId: string;
  role: 'decision_maker' | 'influencer' | 'finance' | 'operations' | 'hr' | 'other';
  status: 'active' | 'inactive';
  tags: string[];
  notes: string;
  salesOwnerId?: string;
  salesOwnerName?: string;
  salesOwnerRef?: string;
  freshsalesId?: string;
  createdAt: any;
  updatedAt: any;
  
  // 🆕 Location Association
  locationId?: string; // Associated location ID
  locationName?: string; // Cached location name for display
  
  // 🆕 Enhanced Contact Role Mapping
  contactProfile?: {
    // Deal Intelligence Fields
    dealRole: 'decision_maker' | 'recommender' | 'observer' | 'blocker' | 'champion';
    influence: 'low' | 'medium' | 'high';
    personality: 'dominant' | 'analytical' | 'amiable' | 'expressive';
    contactMethod: 'email' | 'phone' | 'in_person' | 'linkedin';
    isContractSigner: boolean;
    isDecisionInfluencer: boolean;
    isImplementationResponsible: boolean;
    
    // Relationship Tracking
    relationshipStage: 'cold' | 'warm' | 'hot' | 'advocate';
    lastContactDate?: any;
    preferredContactTime?: string;
    communicationStyle?: 'formal' | 'casual' | 'technical' | 'relationship_focused';
    
    // Organizational Context
    department?: string;
    division?: string;
    location?: string;
    reportingTo?: string; // Contact ID of supervisor
    directReports?: string[]; // Array of contact IDs
    
    // Deal-Specific Notes
    dealNotes?: string;
    objections?: string[];
    interests?: string[];
    painPoints?: string[];
  };
  
  // 🆕 Association Metadata (for quick queries)
  associationCounts?: {
    deals: number;
    locations: number;
    salespeople: number;
    divisions: number;
  };
}

export interface CRMCompany {
  id: string;
  name: string;
  companyName: string;
  status: 'lead' | 'qualified' | 'active' | 'inactive' | 'lost';
  industry: string;
  tier: 'A' | 'B' | 'C';
  tags: string[];
  accountOwner: string;
  source: string;
  address: string;
  city: string;
  state: string;
  zipcode: string;
  country: string;
  phone: string;
  website: string;
  linkedInUrl?: string;
  latitude?: number;
  longitude?: number;
  notes: string;
  salesOwnerId?: string;
  salesOwnerName?: string;
  salesOwnerRef?: string;
  freshsalesId?: string;
  externalId?: string;
  createdAt: any;
  updatedAt: any;
  
  // 🆕 Enhanced Company Structure for National Accounts
  companyStructure?: {
    parentId?: string; // Reference to parent company
    locationType: 'headquarters' | 'facility' | 'branch' | 'regional_office';
    region?: string; // Geographic region
    msaSigned?: boolean; // Master Service Agreement signed
    nationalAccountId?: string; // Reference to national account
    assignedRep?: string; // Local sales rep
    facilityCode?: string; // Internal facility identifier
    headcount?: number; // Number of employees at this location
    isUnionized?: boolean;
    hasTempLaborExperience?: boolean;
    workforceModel?: 'full_time' | 'flex' | 'outsourced' | 'mixed';
  };
  
  // 🆕 Deal Intelligence Fields
  dealIntelligence?: {
    complexityScore?: number; // 1-10 scale
    urgencyLevel?: 'low' | 'medium' | 'high' | 'critical';
    painPoints?: string[]; // Array of identified pain points
    decisionMakers?: string[]; // Array of contact IDs
    influencers?: string[]; // Array of contact IDs
    blockers?: string[]; // Array of contact IDs
    competitiveVendors?: string[];
    complianceRequirements?: string[];
    implementationTimeline?: number; // Days
    estimatedValue?: number;
    effortToRewardRatio?: number;
  };
  
  // 🆕 Association Metadata (for quick queries)
  associationCounts?: {
    locations: number;
    contacts: number;
    deals: number;
    salespeople: number;
    divisions: number;
  };
}

export interface CRMDeal {
  id: string;
  name: string;
  companyId: string;
  contactIds: string[];
  stage: string;
  estimatedRevenue: number;
  probability: number;
  closeDate: string;
  owner: string;
  tags: string[];
  notes: string;
  dealProfile?: DealIntelligenceProfile;
  createdAt: any;
  updatedAt: any;
  
  // 🆕 Location Association
  locationId?: string; // Associated location ID
  locationName?: string; // Cached location name for display
  
  // 🆕 Association Metadata (for quick queries)
  associationCounts?: {
    contacts: number;
    locations: number;
    salespeople: number;
    divisions: number;
  };
}

export interface CRMLocation {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zipcode: string;
  zipCode?: string; // Legacy support
  country: string;
  locationType: 'headquarters' | 'facility' | 'branch' | 'regional_office' | 'warehouse' | 'manufacturing' | 'office';
  type?: string; // Legacy support
  companyId: string;
  phone?: string;
  email?: string;
  contactPerson?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  isActive: boolean;
  
  // Additional properties for enhanced location management
  division?: string;
  website?: string;
  headcount?: number;
  isUnionized?: boolean;
  hasTempLaborExperience?: boolean;
  workforceModel?: 'full_time' | 'flex' | 'outsourced' | 'mixed';
  
  // Legacy count properties for backward compatibility
  contactCount?: number;
  dealCount?: number;
  salespersonCount?: number;
  
  createdAt: any;
  updatedAt: any;
  
  // 🆕 Association Metadata (for quick queries)
  associationCounts?: {
    contacts: number;
    deals: number;
    salespeople: number;
    divisions: number;
  };
}

export interface CRMLocationDetails {
  location: CRMLocation;
  associatedContacts: CRMContact[];
  associatedDeals: CRMDeal[];
  associatedSalespeople: any[]; // Will be defined when we implement salespeople
}

export interface CRMPipelineStage {
  id: string;
  name: string;
  order: number;
  color: string;
  probability: number;
  isActive: boolean;
}

export interface CRMTask {
  id: string;
  title: string;
  description: string;
  type: 'call' | 'email' | 'meeting' | 'follow_up' | 'proposal' | 'other';
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  dueDate: string;
  assignedTo: string;
  relatedTo: {
    type: 'contact' | 'company' | 'deal';
    id: string;
  };
  tags: string[];
  createdAt: any;
  updatedAt: any;
}

// KPI System Types

export interface KPIDefinition {
  id: string;
  name: string;
  description: string;
  category: 'activity' | 'revenue' | 'conversion' | 'engagement' | 'efficiency';
  type: 'count' | 'percentage' | 'currency' | 'duration' | 'score';
  target: number;
  unit: string; // e.g., 'calls', 'emails', 'meetings', 'dollars', 'percent'
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  isActive: boolean;
  priority: 'low' | 'medium' | 'high';
  tags: string[];
  aiSuggestions: boolean; // Whether AI should suggest tasks to meet this KPI
  createdAt: any;
  updatedAt: any;
}

export interface KPIAssignment {
  id: string;
  kpiId: string;
  salespersonId: string;
  salespersonName: string;
  target: number; // Can override default target
  startDate: string;
  endDate?: string; // Optional end date
  isActive: boolean;
  notes: string;
  createdAt: any;
  updatedAt: any;
}

export interface KPITracking {
  id: string;
  kpiAssignmentId: string;
  salespersonId: string;
  kpiId: string;
  period: string; // e.g., '2024-01-15' for daily, '2024-W03' for weekly
  currentValue: number;
  targetValue: number;
  percentageComplete: number;
  status: 'on_track' | 'behind' | 'ahead' | 'completed';
  lastUpdated: any;
  createdAt: any;
}

export interface KPIActivity {
  id: string;
  salespersonId: string;
  kpiId: string;
  activityType: 'call' | 'email' | 'meeting' | 'proposal' | 'follow_up' | 'research' | 'other';
  activityDate: string;
  description: string;
  relatedTo?: {
    type: 'contact' | 'company' | 'deal';
    id: string;
    name: string;
  };
  value: number; // How much this activity contributes to KPI
  duration?: number; // In minutes
  outcome?: 'positive' | 'neutral' | 'negative';
  notes: string;
  createdAt: any;
}

export interface KPITaskSuggestion {
  id: string;
  salespersonId: string;
  kpiId: string;
  title: string;
  description: string;
  type: 'call' | 'email' | 'meeting' | 'research' | 'follow_up' | 'proposal';
  priority: 'low' | 'medium' | 'high';
  suggestedDate: string;
  estimatedValue: number; // How much this task will contribute to KPI
  reason: string; // AI explanation of why this task was suggested
  isAccepted: boolean;
  isCompleted: boolean;
  relatedTo?: {
    type: 'contact' | 'company' | 'deal';
    id: string;
    name: string;
  };
  createdAt: any;
}

export interface KPIDashboard {
  salespersonId: string;
  period: string;
  kpis: {
    kpiId: string;
    kpiName: string;
    category: string;
    currentValue: number;
    targetValue: number;
    percentageComplete: number;
    status: 'on_track' | 'behind' | 'ahead' | 'completed';
    remainingToTarget: number;
    suggestedTasks: KPITaskSuggestion[];
  }[];
  summary: {
    totalKPIs: number;
    onTrack: number;
    behind: number;
    ahead: number;
    completed: number;
    overallProgress: number;
  };
}

// Deal Intelligence Wizard Types

export interface DealIntelligenceProfile {
  // 1. Company Context
  companyContext: {
    size: 'small' | 'medium' | 'large' | 'enterprise';
    headcount: number;
    locations: number;
    isUnionized: boolean;
    hasTempLaborExperience: boolean;
    workforceModel: 'full_time' | 'flex' | 'outsourced' | 'mixed';
  };

  // 2. Pain & Need Profile
  painProfile: {
    corePain: string;
    urgency: 'low' | 'medium' | 'high';
    whyNow: string;
    painOwner: string;
    consequenceOfInaction: string;
    aiSummary: string;
  };

  // 3. Stakeholder Map
  stakeholders: DealStakeholder[];

  // 4. Buying Process
  buyingProcess: {
    hasFormalBid: boolean;
    isCompetitive: boolean;
    competitors: string[];
    requiresLegalReview: boolean;
    requiresProcurement: boolean;
    requiresBackgroundChecks: boolean;
    estimatedTimeline: number; // days
    processComplexityIndex: number; // 1-10
  };

  // 5. Implementation Path
  implementation: {
    onboardingModel: 'centralized' | 'site_based' | 'hybrid';
    operationalPOC: string;
    knownBlockers: string[];
    requiresSiteVisits: boolean;
    requiresWalkthroughs: boolean;
  };

  // 6. Competitive Landscape
  competitiveLandscape: {
    currentVendor: string;
    vendorLikes: string[];
    vendorDislikes: string[];
    internalRelationships: string[];
    hasWorkedWithC1: boolean;
  };

  // 7. Forecast & Value
  forecast: {
    estimatedHeadcount: number;
    estimatedBillRate: number;
    grossProfitPerMonth: number;
    expansionOpportunities: string[];
    dealValue: number;
    effortToRewardRatio: number;
    salesMotionType: 'simple' | 'complex' | 'bureaucratic' | 'enterprise';
  };

  // AI Analysis
  aiAnalysis: {
    summary: string;
    riskLevel: 'low' | 'medium' | 'high';
    nextSteps: string[];
    confidenceLevel: number; // 0-100
    recommendedCadence: string;
    stakeholderStrategy: string;
    timelineForecast: string;
    heatmapRisks: {
      timeline: 'low' | 'medium' | 'high';
      political: 'low' | 'medium' | 'high';
      legal: 'low' | 'medium' | 'high';
      competitive: 'low' | 'medium' | 'high';
    };
  };

  createdAt: any;
  updatedAt: any;
}

export interface DealStakeholder {
  name: string;
  title: string;
  role: 'decision_maker' | 'recommender' | 'observer' | 'blocker';
  influence: 'low' | 'medium' | 'high';
  personality: 'dominant' | 'analytical' | 'amiable' | 'expressive';
  contactMethod: 'email' | 'phone' | 'in_person';
  isContractSigner: boolean;
  isDecisionInfluencer: boolean;
  isImplementationResponsible: boolean;
  notes: string;
}

// AI Integration Types

export interface AIEmailDraft {
  id: string;
  dealId: string;
  stakeholderId: string;
  type: 'intro' | 'follow_up' | 'proposal' | 'closing';
  subject: string;
  body: string;
  tone: 'professional' | 'friendly' | 'urgent' | 'casual';
  suggestedSendTime: string;
  isGenerated: boolean;
  createdAt: any;
}

export interface AITaskSuggestion {
  id: string;
  dealId: string;
  type: 'call' | 'email' | 'meeting' | 'follow_up';
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  suggestedDate: string;
  assignedTo: string;
  reason: string;
  isAccepted: boolean;
  createdAt: any;
}

export interface AIDealInsight {
  id: string;
  dealId: string;
  type: 'risk' | 'opportunity' | 'recommendation' | 'warning';
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  category: 'timeline' | 'stakeholder' | 'competitive' | 'technical' | 'financial';
  actionable: boolean;
  actionItems: string[];
  createdAt: any;
}

// CRM Dashboard Types

export interface CRMDashboardMetrics {
  totalContacts: number;
  totalCompanies: number;
  totalDeals: number;
  totalPipelineValue: number;
  averageDealSize: number;
  winRate: number;
  averageSalesCycle: number;
  topDeals: CRMDeal[];
  recentActivity: CRMActivity[];
}

export interface CRMActivity {
  id: string;
  type: 'email' | 'call' | 'meeting' | 'task' | 'deal_update';
  title: string;
  description: string;
  relatedTo: {
    type: 'contact' | 'company' | 'deal';
    id: string;
    name: string;
  };
  performedBy: string;
  timestamp: any;
}

// AI Campaign Integration

export interface AICampaignTarget {
  dealId: string;
  campaignId: string;
  targetAudience: {
    locationIds: string[];
    departmentIds: string[];
    roleIds: string[];
  };
  personalizationData: {
    stakeholderName: string;
    companyName: string;
    painPoints: string[];
    urgency: string;
  };
  status: 'pending' | 'active' | 'completed' | 'failed';
  createdAt: any;
} 