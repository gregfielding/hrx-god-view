// /utils/inferModuleFromEventType.ts - Module inference from event types

export function inferModuleFromEventType(eventType: string): string {
  const eventTypeLower = eventType.toLowerCase();
  
  // AI Settings and Configuration
  if (eventTypeLower.includes('ai_settings') || eventTypeLower.includes('ai-settings')) {
    return 'AISettings';
  }
  if (eventTypeLower.includes('tone') || eventTypeLower.includes('tone_style')) {
    return 'ToneSettings';
  }
  if (eventTypeLower.includes('traits') || eventTypeLower.includes('traits_engine')) {
    return 'TraitsEngine';
  }
  if (eventTypeLower.includes('moments') || eventTypeLower.includes('moments_engine')) {
    return 'MomentsEngine';
  }
  if (eventTypeLower.includes('feedback') || eventTypeLower.includes('feedback_engine')) {
    return 'FeedbackEngine';
  }
  if (eventTypeLower.includes('vector') || eventTypeLower.includes('vector_settings')) {
    return 'VectorSettings';
  }
  if (eventTypeLower.includes('weights') || eventTypeLower.includes('weights_engine')) {
    return 'WeightsEngine';
  }
  if (eventTypeLower.includes('context') || eventTypeLower.includes('context_engine')) {
    return 'ContextEngine';
  }
  if (eventTypeLower.includes('retrieval') || eventTypeLower.includes('retrieval_filters')) {
    return 'RetrievalFilters';
  }
  
  // User Management
  if (eventTypeLower.includes('user') || eventTypeLower.includes('profile')) {
    return 'UserManagement';
  }
  if (eventTypeLower.includes('customer') || eventTypeLower.includes('customer_profile')) {
    return 'CustomerManagement';
  }
  if (eventTypeLower.includes('agency') || eventTypeLower.includes('agency_profile')) {
    return 'AgencyManagement';
  }
  
  // Communication and Notifications
  if (eventTypeLower.includes('motivation') || eventTypeLower.includes('motivation_message')) {
    return 'MotivationLibrary';
  }
  if (eventTypeLower.includes('help') || eventTypeLower.includes('help_management')) {
    return 'HelpManagement';
  }
  if (eventTypeLower.includes('notification') || eventTypeLower.includes('broadcast')) {
    return 'NotificationSystem';
  }
  if (eventTypeLower.includes('chat') || eventTypeLower.includes('ai_chat')) {
    return 'AIChat';
  }
  
  // Scheduling and Assignments
  if (eventTypeLower.includes('schedule') || eventTypeLower.includes('scheduler')) {
    return 'Scheduler';
  }
  if (eventTypeLower.includes('assignment') || eventTypeLower.includes('job_order')) {
    return 'AssignmentManagement';
  }
  if (eventTypeLower.includes('shift') || eventTypeLower.includes('shift_management')) {
    return 'ShiftManagement';
  }
  
  // Analytics and Insights
  if (eventTypeLower.includes('analytics') || eventTypeLower.includes('insights')) {
    return 'Analytics';
  }
  if (eventTypeLower.includes('job_satisfaction') || eventTypeLower.includes('jsi')) {
    return 'JobSatisfactionInsights';
  }
  
  // System Events
  if (eventTypeLower.includes('system') || eventTypeLower.includes('auto_devops')) {
    return 'SystemManagement';
  }
  if (eventTypeLower.includes('birthday') || eventTypeLower.includes('anniversary')) {
    return 'BirthdayManager';
  }
  if (eventTypeLower.includes('login') || eventTypeLower.includes('logout') || eventTypeLower.includes('auth')) {
    return 'Authentication';
  }
  
  // Field-specific patterns
  if (eventTypeLower.includes('field_change') || eventTypeLower.includes('field_update')) {
    return 'FieldManagement';
  }
  
  // Default fallback
  return 'Unknown';
}

export function inferDestinationModules(eventType: string, module?: string): string[] {
  const eventTypeLower = eventType.toLowerCase();
  const modules: string[] = [];
  
  // Add the primary module if known
  if (module && module !== 'Unknown') {
    modules.push(module);
  }
  
  // Add downstream processing modules based on event type
  if (eventTypeLower.includes('ai_settings') || eventTypeLower.includes('tone') || eventTypeLower.includes('traits')) {
    modules.push('ContextEngine', 'TraitsEngine', 'FeedbackEngine');
  }
  
  if (eventTypeLower.includes('user') || eventTypeLower.includes('profile')) {
    modules.push('Scheduler', 'MotivationLibrary', 'NotificationSystem');
  }
  
  if (eventTypeLower.includes('assignment') || eventTypeLower.includes('shift')) {
    modules.push('Scheduler', 'NotificationSystem', 'Analytics');
  }
  
  if (eventTypeLower.includes('feedback') || eventTypeLower.includes('satisfaction')) {
    modules.push('Analytics', 'JobSatisfactionInsights', 'MotivationLibrary');
  }
  
  // Remove duplicates
  return [...new Set(modules)];
} 