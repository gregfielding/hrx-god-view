// 🎯 COMPREHENSIVE TASKS SYSTEM FOR CRM
// Integrates with existing CRM entities, AI logging, and activity tracking

// 🏗️ CORE TASK TYPES
export interface CRMTask {
  id: string;
  title: string;
  description: string;
  
  // 🎯 Task Classification
  type: TaskType;
  category: TaskCategory;
  subcategory?: string; // For specific task reasons like "contract negotiation", "vacation follow-up"
  reason?: string; // Free text or dropdown reason (e.g., "Follow-up after vacation")
  
  // 📅 Scheduling & Timing
  scheduledDate: string; // ISO date string
  dueDate?: string; // Optional due date
  dueDateTime?: string; // Full timestamp for precise scheduling
  estimatedDuration?: number; // In minutes
  timeZone?: string; // Default to user's timezone
  
  // 🎯 Priority & Status
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: TaskStatus;
  
  // 👤 Assignment & Ownership
  assignedTo: string; // User ID
  assignedByName?: string; // Cached name for display
  createdBy: string;
  createdByName?: string;
  
  // 🔗 Associations (Universal Association System)
  associations: {
    deals?: string[];
    companies?: string[];
    contacts?: string[];
    salespeople?: string[];
    locations?: string[];
    campaigns?: string[]; // For campaign-based tasks
  };
  
  // 📝 Content & Context
  notes?: string;
  actionItems?: string[]; // Specific actions to take
  expectedOutcome?: string;
  actionResult?: string; // Summary of what was done or what to do next (used by AI and reporting)
  
  // 🤖 AI Integration
  aiGenerated?: boolean;
  aiSuggested?: boolean; // Whether AI created it
  aiReason?: string; // Why AI suggested this task
  aiConfidence?: number; // 0-100 confidence score
  aiContext?: string; // AI context used for generation
  aiPrompt?: string; // Optional—what prompt AI used to suggest or generate task
  
  // 📊 KPI & Quota Tracking
  quotaCategory?: 'business_generating' | 'relationship_building' | 'administrative' | 'research';
  estimatedValue?: number; // Potential deal value
  kpiContribution?: {
    kpiId: string;
    contributionValue: number;
  }[];
  
  // 🔄 Recurring & Campaign Tasks
  isRecurring?: boolean;
  recurrencePattern?: {
    frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'custom';
    interval?: number; // Every X days/weeks/months
    endDate?: string;
    customDays?: number[]; // For custom frequency
  };
  
  // 📧 Communication Tasks
  communicationDetails?: {
    method: 'email' | 'phone' | 'linkedin' | 'in_person' | 'virtual_meeting';
    recipient?: string; // Contact ID or email
    subject?: string; // For emails
    template?: string; // AI-generated template
    draftContent?: string; // AI-drafted content
    sendTime?: string; // Optimal send time
  };
  
  // 🎁 Gift & Gesture Tasks
  giftDetails?: {
    type: 'gift' | 'card' | 'lunch' | 'event_invitation';
    recipient?: string;
    budget?: number;
    occasion?: string;
    message?: string;
  };
  
  // 📍 Location & Travel
  locationDetails?: {
    address?: string;
    coordinates?: { lat: number; lng: number };
    isVirtual?: boolean;
    meetingUrl?: string;
    travelTime?: number; // In minutes
  };
  
  // 🔔 Reminders & Notifications
  reminders?: {
    enabled: boolean;
    times: string[]; // Array of reminder times (e.g., ["1h", "1d", "1w"])
    lastReminderSent?: string;
  };
  
  // 📈 Completion & Follow-up
  completedAt?: string;
  completionNotes?: string;
  outcome?: 'positive' | 'neutral' | 'negative';
  followUpRequired?: boolean;
  followUpTaskId?: string; // ID of follow-up task
  
  // 🏷️ Organization
  tags: string[];
  tenantId: string;
  createdAt: any;
  updatedAt: any;
}

// 🎯 TASK TYPES (Enhanced to match ChatGPT specification)
export type TaskType = 
  | 'email' 
  | 'phone_call' 
  | 'in_person_drop_by' // Physical stop at company
  | 'scheduled_meeting_in_person' // Future dated in-person
  | 'scheduled_meeting_virtual' // Zoom/Google Meet, etc
  | 'linkedin_message' 
  | 'send_gift' 
  | 'custom' // Catch-all option with editable label
  | 'research' 
  | 'proposal_preparation' 
  | 'contract_review' 
  | 'follow_up' 
  | 'check_in' 
  | 'presentation' 
  | 'demo' 
  | 'negotiation' 
  | 'closing' 
  | 'administrative';

// 📂 TASK CATEGORIES
export type TaskCategory = 
  | 'prospecting' 
  | 'qualification' 
  | 'proposal' 
  | 'negotiation' 
  | 'closing' 
  | 'relationship_building' 
  | 'account_management' 
  | 'research' 
  | 'administrative' 
  | 'campaign' 
  | 'follow_up' 
  | 'custom';

// 📊 TASK STATUS (Enhanced to match ChatGPT specification)
export type TaskStatus = 
  | 'upcoming' // Light Blue
  | 'due' // Orange
  | 'completed' // Green
  | 'postponed' // Gray
  | 'cancelled' // Red
  | 'in_progress'
  | 'draft';

// 🎯 TASK CAMPAIGNS (Recurring Task Sequences)
export interface TaskCampaign {
  id: string;
  name: string;
  description: string;
  
  // 🎯 Campaign Structure
  type: 'nurture' | 'prospecting' | 'account_management' | 'custom';
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'custom';
  
  // 👥 Targeting
  targetAudience: {
    companies?: string[];
    contacts?: string[];
    deals?: string[];
    criteria?: {
      companySize?: 'small' | 'medium' | 'large' | 'enterprise';
      industry?: string[];
      location?: string[];
      dealStage?: string[];
    };
  };
  
  // 📅 Schedule
  startDate: string;
  endDate?: string;
  isActive: boolean;
  
  // 🎯 Task Templates
  taskTemplates: TaskTemplate[];
  
  // 🤖 AI Configuration
  aiEnabled: boolean;
  aiBehavior: {
    personalizeContent: boolean;
    optimizeTiming: boolean;
    suggestFollowUps: boolean;
    adaptToResponses: boolean;
  };
  
  // 📊 Performance Tracking
  metrics: {
    totalTasksCreated: number;
    completedTasks: number;
    responseRate: number;
    conversionRate: number;
  };
  
  tenantId: string;
  createdBy: string;
  createdAt: any;
  updatedAt: any;
}

// 📝 TASK TEMPLATES (For Campaigns & Recurring Tasks)
export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  
  // 🎯 Template Configuration
  type: TaskType;
  category: TaskCategory;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  
  // 📅 Timing
  delayDays: number; // Days after previous task or campaign start
  optimalTime?: string; // "9:00 AM", "2:00 PM", etc.
  timeZone?: string;
  
  // 📝 Content
  titleTemplate: string; // Supports variables like {contactName}, {companyName}
  descriptionTemplate: string;
  actionItems?: string[];
  
  // 📧 Communication Templates
  communicationTemplate?: {
    subject?: string;
    body?: string;
    linkedinMessage?: string;
    phoneScript?: string;
  };
  
  // 🔄 Conditions
  conditions?: {
    requiresPreviousTask?: boolean;
    requiresResponse?: boolean;
    skipIf?: string; // Condition to skip this task
  };
  
  // 🤖 AI Configuration
  aiEnabled: boolean;
  aiCustomization?: {
    tone?: 'professional' | 'friendly' | 'urgent' | 'casual';
    personalizationLevel?: 'low' | 'medium' | 'high';
    contextFields?: string[]; // Which fields to use for personalization
  };
  
  tenantId: string;
  createdBy: string;
  createdAt: any;
  updatedAt: any;
}

// 📅 CALENDAR & SCHEDULING
export interface TaskCalendar {
  userId: string;
  date: string; // YYYY-MM-DD
  tasks: {
    taskId: string;
    title: string;
    type: TaskType;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    status: TaskStatus;
    scheduledTime?: string; // HH:MM
    estimatedDuration?: number;
    associations: {
      deals?: string[];
      companies?: string[];
      contacts?: string[];
    };
  }[];
  summary: {
    totalTasks: number;
    completedTasks: number;
    pendingTasks: number;
    overdueTasks: number;
    quotaProgress: {
      businessGenerating: number;
      target: number;
      percentage: number;
    };
  };
}

// 🎯 AI TASK SUGGESTIONS
export interface AITaskSuggestion {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  category: TaskCategory;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  
  // 🤖 AI Context
  aiReason: string;
  aiConfidence: number; // 0-100
  aiContext: string;
  aiInsights: string[];
  
  // 📅 Suggested Timing
  suggestedDate: string;
  suggestedTime?: string;
  urgencyScore: number; // 1-10
  
  // 🔗 Associations
  associations: {
    deals?: string[];
    companies?: string[];
    contacts?: string[];
    salespeople?: string[];
  };
  
  // 📊 Expected Impact
  estimatedValue?: number;
  kpiImpact?: {
    kpiId: string;
    impactValue: number;
  }[];
  
  // 👤 Assignment
  suggestedFor: string; // User ID
  autoAssign?: boolean;
  
  // 📝 Pre-generated Content
  draftContent?: {
    emailSubject?: string;
    emailBody?: string;
    phoneScript?: string;
    linkedinMessage?: string;
  };
  
  // 🔄 Actions
  isAccepted: boolean;
  isRejected: boolean;
  rejectionReason?: string;
  acceptedAt?: string;
  
  tenantId: string;
  createdAt: any;
}

// 📊 TASK ANALYTICS & REPORTING
export interface TaskAnalytics {
  userId: string;
  period: string; // "2024-01", "2024-W03", "2024-01-15"
  
  // 📈 Performance Metrics
  metrics: {
    totalTasks: number;
    completedTasks: number;
    completionRate: number;
    averageCompletionTime: number; // In hours
    overdueTasks: number;
    overdueRate: number;
  };
  
  // 🎯 Task Type Breakdown
  byType: {
    [key in TaskType]: {
      count: number;
      completed: number;
      completionRate: number;
      averageValue: number;
    };
  };
  
  // 📊 Priority Analysis
  byPriority: {
    urgent: { count: number; completed: number; completionRate: number; };
    high: { count: number; completed: number; completionRate: number; };
    medium: { count: number; completed: number; completionRate: number; };
    low: { count: number; completed: number; completionRate: number; };
  };
  
  // 💰 Value Tracking
  valueMetrics: {
    totalEstimatedValue: number;
    totalActualValue: number;
    valuePerTask: number;
    topValueTasks: string[]; // Task IDs
  };
  
  // 🎯 KPI Progress
  kpiProgress: {
    [kpiId: string]: {
      kpiName: string;
      currentValue: number;
      targetValue: number;
      percentageComplete: number;
      tasksContributing: number;
    };
  };
  
  // 🤖 AI Performance
  aiMetrics: {
    aiGeneratedTasks: number;
    aiAcceptedTasks: number;
    aiAcceptanceRate: number;
    aiTaskCompletionRate: number;
    aiTaskValueRate: number; // Value generated by AI tasks
  };
  
  // 📅 Time Analysis
  timeAnalysis: {
    mostProductiveDay: string;
    mostProductiveTime: string;
    averageTasksPerDay: number;
    peakProductivityHours: string[];
  };
}

// 🔔 TASK REMINDERS & NOTIFICATIONS
export interface TaskReminder {
  id: string;
  taskId: string;
  userId: string;
  
  // ⏰ Timing
  reminderTime: string; // ISO timestamp
  reminderType: 'email' | 'push' | 'sms' | 'in_app';
  
  // 📝 Content
  title: string;
  message: string;
  
  // 📊 Status
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  sentAt?: string;
  errorMessage?: string;
  
  // 🔄 Retry Logic
  retryCount: number;
  maxRetries: number;
  nextRetryTime?: string;
  
  tenantId: string;
  createdAt: any;
}

// 📋 TASK QUERIES & FILTERS
export interface TaskQuery {
  tenantId: string;
  userId?: string;
  status?: TaskStatus[];
  type?: TaskType[];
  category?: TaskCategory[];
  priority?: ('low' | 'medium' | 'high' | 'urgent')[];
  
  // 📅 Date Filters
  startDate?: string;
  endDate?: string;
  dueDate?: string;
  
  // 🔗 Association Filters
  dealId?: string;
  companyId?: string;
  contactId?: string;
  salespersonId?: string;
  
  // 🏷️ Tag Filters
  tags?: string[];
  
  // 🤖 AI Filters
  aiGenerated?: boolean;
  
  // 📊 KPI Filters
  quotaCategory?: ('business_generating' | 'relationship_building' | 'administrative' | 'research')[];
  
  // 📄 Pagination
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'scheduledDate' | 'dueDate' | 'priority' | 'title';
  orderDirection?: 'asc' | 'desc';
}

// 🎯 TASK BATCH OPERATIONS
export interface TaskBatchOperation {
  operation: 'update_status' | 'reassign' | 'reschedule' | 'add_tags' | 'remove_tags';
  taskIds: string[];
  data: {
    status?: TaskStatus;
    assignedTo?: string;
    scheduledDate?: string;
    tags?: string[];
  };
  tenantId: string;
  userId: string;
}

// 📊 TASK DASHBOARD
export interface TaskDashboard {
  userId: string;
  date: string; // YYYY-MM-DD
  
  // 📅 Today's Overview
  today: {
    totalTasks: number;
    completedTasks: number;
    pendingTasks: number;
    overdueTasks: number;
    nextTask?: {
      id: string;
      title: string;
      scheduledTime: string;
      type: TaskType;
    };
  };
  
  // 📈 This Week
  thisWeek: {
    totalTasks: number;
    completedTasks: number;
    completionRate: number;
    quotaProgress: {
      businessGenerating: number;
      target: number;
      percentage: number;
    };
  };
  
  // 🎯 Priority Breakdown
  priorities: {
    urgent: { count: number; completed: number; };
    high: { count: number; completed: number; };
    medium: { count: number; completed: number; };
    low: { count: number; completed: number; };
  };
  
  // 📊 Type Breakdown
  types: {
    [key in TaskType]: { count: number; completed: number; };
  };
  
  // 🤖 AI Suggestions
  aiSuggestions: AITaskSuggestion[];
  
  // 📅 Upcoming Tasks
  upcoming: {
    today: CRMTask[];
    tomorrow: CRMTask[];
    thisWeek: CRMTask[];
  };
  
  // 🎯 KPI Progress
  kpiProgress: {
    [kpiId: string]: {
      kpiName: string;
      currentValue: number;
      targetValue: number;
      percentageComplete: number;
      tasksRemaining: number;
    };
  };
} 