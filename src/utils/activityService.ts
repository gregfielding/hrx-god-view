import { 
  collection, 
  doc, 
  query, 
  where, 
  getDocs,
  Timestamp,
  getDoc,
  setDoc,
  updateDoc,
  WriteBatch
} from 'firebase/firestore';

import { db } from '../firebase';

export interface ActivityLog {
  id?: string;
  tenantId: string;
  entityType: 'contact' | 'deal' | 'company' | 'salesperson';
  entityId: string;
  activityType: 'email' | 'task' | 'note' | 'call' | 'meeting' | 'follow_up' | 'status_change' | 'custom';
  title: string;
  description: string;
  timestamp: Timestamp;
  userId: string;
  userName: string;
  
  // Related entities for cross-filtering
  relatedEntities?: {
    contacts?: string[];
    deals?: string[];
    companies?: string[];
  };
  
  // Metadata for AI context
  metadata?: {
    emailSubject?: string;
    emailFrom?: string;
    emailTo?: string[];
    taskStatus?: 'completed' | 'pending' | 'cancelled';
    callDuration?: number;
    meetingType?: 'internal' | 'client' | 'prospect';
    sentiment?: 'positive' | 'neutral' | 'negative';
    priority?: 'low' | 'medium' | 'high';
    tags?: string[];
  };
  
  // AI logging fields
  aiLogged?: boolean;
  aiContext?: string;
  aiInsights?: string[];
}

export interface ActivityQuery {
  tenantId: string;
  entityType?: 'contact' | 'deal' | 'company' | 'salesperson';
  entityId?: string;
  activityTypes?: string[];
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  includeRelated?: boolean;
}

export class ActivityService {
  private tenantId: string;
  private userId: string;

  constructor(tenantId: string, userId: string) {
    this.tenantId = tenantId;
    this.userId = userId;
  }

  /**
   * Log an activity and automatically cross-reference to related entities
   */
  async logActivity(activity: Omit<ActivityLog, 'id' | 'tenantId' | 'timestamp' | 'userId' | 'userName' | 'aiLogged' | 'aiContext' | 'aiInsights'>): Promise<string> {
    try {
      // For now, just log to console since we need to implement proper activity storage
      // This will be implemented when we add activity logging to the existing CRM structure
      console.log('✅ Activity logged (console only):', activity.title, 'for', activity.entityType, ':', activity.entityId);
      return 'temp-activity-id';

      // TODO: Implement proper activity logging to entity subcollections
      // const batch = writeBatch(db);
      // const activitiesRef = collection(db, 'tenants', this.tenantId, 'activities');
      
      // // Create the main activity log
      // const activityData: ActivityLog = {
      //   ...activity,
      //   tenantId: this.tenantId,
      //   timestamp: Timestamp.now(),
      //   userId: this.userId,
      //   userName: await this.getUserName(),
      //   aiLogged: false // Will be set to true after AI processing
      // };

      // const activityRef = doc(activitiesRef);
      // batch.set(activityRef, activityData);

      // // If this activity should appear in related entities, create cross-references
      // if (activity.relatedEntities) {
      //   await this.createCrossReferences(batch, activityRef.id, activity);
      // }

      // await batch.commit();

      // // Trigger AI logging
      // await this.triggerAILogging(activityRef.id, activityData);

      // console.log(`✅ Activity logged: ${activity.title} for ${activity.entityType}:${activity.entityId}`);
      // return activityRef.id;

    } catch (error) {
      console.error('❌ Error logging activity:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to log activity: ${message}`);
    }
  }

  /*
   * createCrossReferences disabled until activities subcollections are fully implemented
   * Keeping stub for future use to avoid unused private member errors with strict settings
   */
  // private async createCrossReferences(
  //   batch: WriteBatch,
  //   activityId: string,
  //   activity: Omit<ActivityLog, 'id' | 'tenantId' | 'timestamp' | 'userId' | 'userName'>
  // ) {
  //   const { relatedEntities } = activity;
  //   if (relatedEntities?.contacts) { /* ... */ }
  //   if (relatedEntities?.deals) { /* ... */ }
  //   if (relatedEntities?.companies) { /* ... */ }
  // }

  /**
   * Query activities for a specific entity
   */
  async queryActivities(queryParams: ActivityQuery): Promise<ActivityLog[]> {
    try {
      // For now, return empty array since we need to implement activities as subcollections
      // This will be implemented when we add activity logging to the existing CRM structure
      console.log('Activity logging not yet implemented - returning empty activities');
      return [];

      // TODO: Implement proper activity querying from entity subcollections
      // const activitiesRef = collection(db, 'tenants', this.tenantId, 'activities');
      // let q = query(activitiesRef);

      // // Add filters
      // if (queryParams.entityType && queryParams.entityId) {
      //   q = query(q, where('entityType', '==', queryParams.entityType));
      //   q = query(q, where('entityId', '==', queryParams.entityId));
      // }

      // if (queryParams.activityTypes && queryParams.activityTypes.length > 0) {
      //   q = query(q, where('activityType', 'in', queryParams.activityTypes));
      // }

      // if (queryParams.startDate) {
      //   q = query(q, where('timestamp', '>=', Timestamp.fromDate(queryParams.startDate)));
      // }

      // if (queryParams.endDate) {
      //   q = query(q, where('timestamp', '<=', Timestamp.fromDate(queryParams.endDate)));
      // }

      // // Order by timestamp (newest first)
      // q = query(q, orderBy('timestamp', 'desc'));

      // if (queryParams.limit) {
      //   q = query(q, limit(queryParams.limit));
      // }

      // const snapshot = await getDocs(q);
      // const activities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ActivityLog[];

      // // If includeRelated is true, also fetch activities from related entities
      // if (queryParams.includeRelated) {
      //   const relatedActivities = await this.getRelatedActivities(queryParams);
      //   activities.push(...relatedActivities);
        
      //   // Sort by timestamp and remove duplicates
      //   activities.sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());
      //   return this.removeDuplicateActivities(activities);
      // }

      // return activities;

    } catch (error) {
      console.error('❌ Error querying activities:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to query activities: ${message}`);
    }
  }

  // private async getRelatedActivities(_queryParams: ActivityQuery): Promise<ActivityLog[]> {
  //   return [];
  // }

  // private removeDuplicateActivities(activities: ActivityLog[]): ActivityLog[] {
  //   const seen = new Set<string>();
  //   return activities.filter(activity => {
  //     if (seen.has(activity.id!)) {
  //       return false;
  //     }
  //     seen.add(activity.id!);
  //     return true;
  //   });
  // }

  // private async triggerAILogging(_activityId: string, _activity: ActivityLog) {
  //   /* disabled */
  // }

  /**
   * Generate AI context from activity
   */
  private generateAIContext(activity: ActivityLog): string {
    const context = {
      entityType: activity.entityType,
      entityId: activity.entityId,
      activityType: activity.activityType,
      title: activity.title,
      description: activity.description,
      metadata: activity.metadata,
      relatedEntities: activity.relatedEntities,
      timestamp: activity.timestamp.toDate().toISOString()
    };

    return JSON.stringify(context);
  }

  // private async getUserName(): Promise<string> {
  //   return 'Unknown User';
  // }

  /**
   * Log email activity (for Gmail integration)
   */
  async logEmailActivity(
    entityType: 'contact' | 'deal' | 'company' | 'salesperson',
    entityId: string,
    emailData: {
      subject: string;
      from: string;
      to: string[];
      body: string;
      timestamp: Date;
    }
  ): Promise<string> {
    return this.logActivity({
      entityType,
      entityId,
      activityType: 'email',
      title: `Email: ${emailData.subject}`,
      description: emailData.body,
      metadata: {
        emailSubject: emailData.subject,
        emailFrom: emailData.from,
        emailTo: emailData.to
      },
      relatedEntities: await this.getRelatedEntities(entityType, entityId)
    });
  }

  /**
   * Log task completion
   */
  async logTaskActivity(
    entityType: 'contact' | 'deal' | 'company' | 'salesperson',
    entityId: string,
    taskData: {
      title: string;
      description: string;
      status: 'completed' | 'pending' | 'cancelled';
      priority: 'low' | 'medium' | 'high';
    }
  ): Promise<string> {
    return this.logActivity({
      entityType,
      entityId,
      activityType: 'task',
      title: `Task ${taskData.status}: ${taskData.title}`,
      description: taskData.description,
      metadata: {
        taskStatus: taskData.status,
        priority: taskData.priority
      },
      relatedEntities: await this.getRelatedEntities(entityType, entityId)
    });
  }

  /**
   * Get related entities for cross-referencing
   */
  private async getRelatedEntities(entityType: string, entityId: string) {
    const relatedEntities: { contacts?: string[]; deals?: string[]; companies?: string[] } = {};

    try {
      // For salesperson entity type, we don't need to read from a collection
      // since we're logging activity for the salesperson themselves
      if (entityType === 'salesperson') {
        // For salesperson activities, we can return empty related entities
        // or try to get their associated deals/companies if needed
        return relatedEntities;
      }

      const entityRef = doc(db, 'tenants', this.tenantId, `crm_${entityType}s`, entityId);
      const entityDoc = await getDoc(entityRef);

      if (!entityDoc.exists()) {
        return relatedEntities;
      }

      const entityData = entityDoc.data();

      if (entityType === 'contact') {
        if (entityData.dealIds) relatedEntities.deals = entityData.dealIds;
        if (entityData.companyId) relatedEntities.companies = [entityData.companyId];
      } else if (entityType === 'deal') {
        if (entityData.contactIds) relatedEntities.contacts = entityData.contactIds;
        if (entityData.companyId) relatedEntities.companies = [entityData.companyId];
      } else if (entityType === 'company') {
        // For companies, we'll get related entities when needed
        relatedEntities.contacts = [entityId]; // This will be expanded in query
        relatedEntities.deals = [entityId]; // This will be expanded in query
      }

      return relatedEntities;

    } catch (error) {
      console.error('Error getting related entities:', error);
      return relatedEntities;
    }
  }
}

export const createActivityService = (tenantId: string, userId: string): ActivityService => {
  return new ActivityService(tenantId, userId);
};