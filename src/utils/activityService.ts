import { 
  collection, 
  doc, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  getDocs, 
  onSnapshot,
  Timestamp,
  writeBatch,
  getDoc,
  setDoc,
  updateDoc,
  limit,
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
      throw new Error(`Failed to log activity: ${error.message}`);
    }
  }

  /**
   * Create cross-references for activities that should appear in multiple entity logs
   */
  private async createCrossReferences(
    batch: WriteBatch, 
    activityId: string, 
    activity: Omit<ActivityLog, 'id' | 'tenantId' | 'timestamp' | 'userId' | 'userName'>
  ) {
    const { relatedEntities } = activity;

    // Add to related contacts
    if (relatedEntities?.contacts) {
      for (const contactId of relatedEntities.contacts) {
        const contactActivityRef = doc(collection(db, 'tenants', this.tenantId, 'contacts', contactId, 'activities'));
        batch.set(contactActivityRef, {
          activityId,
          entityType: activity.entityType,
          entityId: activity.entityId,
          timestamp: Timestamp.now()
        });
      }
    }

    // Add to related deals
    if (relatedEntities?.deals) {
      for (const dealId of relatedEntities.deals) {
        const dealActivityRef = doc(collection(db, 'tenants', this.tenantId, 'deals', dealId, 'activities'));
        batch.set(dealActivityRef, {
          activityId,
          entityType: activity.entityType,
          entityId: activity.entityId,
          timestamp: Timestamp.now()
        });
      }
    }

    // Add to related companies
    if (relatedEntities?.companies) {
      for (const companyId of relatedEntities.companies) {
        const companyActivityRef = doc(collection(db, 'tenants', this.tenantId, 'companies', companyId, 'activities'));
        batch.set(companyActivityRef, {
          activityId,
          entityType: activity.entityType,
          entityId: activity.entityId,
          timestamp: Timestamp.now()
        });
      }
    }
  }

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
      throw new Error(`Failed to query activities: ${error.message}`);
    }
  }

  /**
   * Get activities from related entities
   */
  private async getRelatedActivities(queryParams: ActivityQuery): Promise<ActivityLog[]> {
    const relatedActivities: ActivityLog[] = [];

    if (!queryParams.entityType || !queryParams.entityId) {
      return relatedActivities;
    }

    try {
      // Get the main entity to find related entities
      const entityRef = doc(db, 'tenants', this.tenantId, `crm_${queryParams.entityType}s`, queryParams.entityId);
      const entityDoc = await getDoc(entityRef);

      if (!entityDoc.exists()) {
        return relatedActivities;
      }

      const entityData = entityDoc.data();

      // For contacts, get activities from associated deals and companies
      if (queryParams.entityType === 'contact') {
        // Get deal activities
        if (entityData.dealIds) {
          for (const dealId of entityData.dealIds) {
            const dealActivities = await this.queryActivities({
              ...queryParams,
              entityType: 'deal',
              entityId: dealId,
              includeRelated: false
            });
            relatedActivities.push(...dealActivities);
          }
        }

        // Get company activities
        if (entityData.companyId) {
          const companyActivities = await this.queryActivities({
            ...queryParams,
            entityType: 'company',
            entityId: entityData.companyId,
            includeRelated: false
          });
          relatedActivities.push(...companyActivities);
        }
      }

      // For deals, get activities from associated contacts and companies
      if (queryParams.entityType === 'deal') {
        // Get contact activities
        if (entityData.contactIds) {
          for (const contactId of entityData.contactIds) {
            const contactActivities = await this.queryActivities({
              ...queryParams,
              entityType: 'contact',
              entityId: contactId,
              includeRelated: false
            });
            relatedActivities.push(...contactActivities);
          }
        }

        // Get company activities
        if (entityData.companyId) {
          const companyActivities = await this.queryActivities({
            ...queryParams,
            entityType: 'company',
            entityId: entityData.companyId,
            includeRelated: false
          });
          relatedActivities.push(...companyActivities);
        }
      }

      // For companies, get activities from associated contacts and deals
      if (queryParams.entityType === 'company') {
        // Get contact activities
        const contactsQuery = query(
          collection(db, 'tenants', this.tenantId, 'crm_contacts'),
          where('companyId', '==', queryParams.entityId)
        );
        const contactsSnapshot = await getDocs(contactsQuery);
        
        for (const contactDoc of contactsSnapshot.docs) {
          const contactActivities = await this.queryActivities({
            ...queryParams,
            entityType: 'contact',
            entityId: contactDoc.id,
            includeRelated: false
          });
          relatedActivities.push(...contactActivities);
        }

        // Get deal activities
        const dealsQuery = query(
          collection(db, 'tenants', this.tenantId, 'crm_deals'),
          where('companyId', '==', queryParams.entityId)
        );
        const dealsSnapshot = await getDocs(dealsQuery);
        
        for (const dealDoc of dealsSnapshot.docs) {
          const dealActivities = await this.queryActivities({
            ...queryParams,
            entityType: 'deal',
            entityId: dealDoc.id,
            includeRelated: false
          });
          relatedActivities.push(...dealActivities);
        }
      }

      return relatedActivities;

    } catch (error) {
      console.error('❌ Error getting related activities:', error);
      return relatedActivities;
    }
  }

  /**
   * Remove duplicate activities based on activityId
   */
  private removeDuplicateActivities(activities: ActivityLog[]): ActivityLog[] {
    const seen = new Set<string>();
    return activities.filter(activity => {
      if (seen.has(activity.id!)) {
        return false;
      }
      seen.add(activity.id!);
      return true;
    });
  }

  /**
   * Trigger AI logging for an activity
   */
  private async triggerAILogging(activityId: string, activity: ActivityLog) {
    try {
      // Log to AI system
      const aiLogRef = doc(collection(db, 'ai_logs', `activity_${activityId}_${Date.now()}`));
      await setDoc(aiLogRef, {
        section: 'ActivityLog',
        changed: 'activity',
        oldValue: null,
        newValue: activity,
        timestamp: new Date().toISOString(),
        eventType: 'activity_logged',
        engineTouched: ['ContextEngine', 'StrategyEngine', 'ReportingEngine'],
        userId: this.userId,
        sourceModule: 'ActivityService',
        entityType: activity.entityType,
        entityId: activity.entityId,
        activityType: activity.activityType,
        aiContext: this.generateAIContext(activity)
      });

      // Update the activity to mark it as AI logged
      await updateDoc(doc(db, 'tenants', this.tenantId, 'activities', activityId), {
        aiLogged: true,
        aiContext: this.generateAIContext(activity)
      });

      console.log(`✅ AI logging triggered for activity: ${activityId}`);

    } catch (error) {
      console.error('❌ Error triggering AI logging:', error);
    }
  }

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

  /**
   * Get user name for activity logging
   */
  private async getUserName(): Promise<string> {
    try {
      const userDoc = await getDoc(doc(db, 'users', this.userId));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        return userData.displayName || userData.email || 'Unknown User';
      }
      return 'Unknown User';
    } catch (error) {
      console.error('Error getting user name:', error);
      return 'Unknown User';
    }
  }

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