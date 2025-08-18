// 🎯 COMPREHENSIVE TASKS SYSTEM FOR CRM
// Integrates with existing CRM entities, AI logging, and activity tracking

// 🏗️ CORE TASK TYPES
export type TaskStatus = 'scheduled' | 'upcoming' | 'due' | 'overdue' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskType = 'email' | 'phone_call' | 'scheduled_meeting_virtual' | 'scheduled_meeting_in_person' | 'research' | 'custom' | 'follow_up' | 'prospecting' | 'presentation' | 'demo' | 'proposal' | 'contract' | 'onboarding' | 'training' | 'admin' | 'activity' | 'other';
export type TaskCategory = 'general' | 'follow_up' | 'prospecting' | 'presentation' | 'demo' | 'proposal' | 'contract' | 'onboarding' | 'training' | 'admin' | 'other';
export type QuotaCategory = 'business_generating' | 'business_maintaining' | 'business_developing' | 'non_business';

// New task classification types
export type TaskClassification = 'todo' | 'appointment';

export interface Task {
  id: string;
  title: string;
  description?: string;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  classification: TaskClassification; // NEW: todo or appointment
  
  // Time fields for appointments
  startTime?: string; // ISO string for appointments
  endTime?: string; // Calculated from startTime + duration
  duration?: number; // Duration in minutes for appointments
  
  // Existing fields
  scheduledDate: string; // Date only (YYYY-MM-DD)
  dueDate?: string;
  estimatedDuration?: number; // Legacy field, use duration for appointments
  
  // Assignment fields
  assignedTo: string;
  assignedToName?: string; // Optimized field
  createdBy: string;
  createdByName?: string; // Optimized field
  
  // Organization fields
  tenantId: string;
  category: TaskCategory;
  quotaCategory: QuotaCategory;
  
  // Associations
  associations?: {
    companies?: string[];
    contacts?: string[];
    deals?: string[];
    salespeople?: string[];
    locations?: string[];
    divisions?: string[];
    tasks?: string[];
    relatedTo?: {
      type: 'deal' | 'company' | 'contact';
      id: string;
    };
    relatedToName?: string; // Optimized field
  };
  
  // Additional fields
  tags?: string[];
  notes?: string;
  reason?: string;
  
  // AI fields
  aiSuggested?: boolean;
  aiPrompt?: string;
  aiRecommendations?: string;
  aiGenerated?: boolean;
  aiReason?: string;
  aiConfidence?: number;
  aiContext?: any;
  
  // Google Calendar/Tasks sync fields
  googleCalendarEventId?: string; // For appointments
  googleTaskId?: string; // For todos
  lastGoogleSync?: string; // ISO timestamp of last sync
  syncStatus?: 'pending' | 'synced' | 'failed';
  
  // Google Meet integration
  googleMeetLink?: string; // Meet URL for virtual meetings
  googleMeetConferenceId?: string; // Meet conference ID
  meetingAttendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  }>;
  
  // Task-type-specific fields
  agenda?: string; // For meetings
  goals?: string[]; // For in-person meetings
  researchTopics?: string[]; // For research tasks
  callScript?: string; // For phone calls
  emailTemplate?: string; // For email tasks
  followUpNotes?: string; // For follow-up tasks
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  
  // Repeating task fields
  isRepeating?: boolean;
  repeatInterval?: number; // Days between repetitions
  nextRepeatDate?: string; // ISO date string for next occurrence
  originalTaskId?: string; // Reference to the original task for repeating tasks
  
  // Action tracking
  actionResult?: any;
  estimatedValue?: number;
  kpiContribution?: any;
  
  // Communication details (for email/phone tasks)
  communicationDetails?: {
    method: 'email' | 'phone';
    subject?: string;
    draftContent?: string;
    recipient?: string;
  };
}

export type CRMTask = Task



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