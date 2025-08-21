import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

export const cleanupDuplicateEmails = onCall({
  cors: true,
  maxInstances: 1,
  region: 'us-central1'
}, async (request) => {
  try {
    const { tenantId } = request.data;
    
    if (!tenantId) {
      throw new Error('tenantId is required');
    }

    console.log(`🔍 Starting duplicate email cleanup for tenant: ${tenantId}`);
    
    // Get all email logs for the tenant
    const emailLogsRef = db.collection('tenants').doc(tenantId).collection('email_logs');
    const emailLogsSnapshot = await emailLogsRef.get();
    
    // Get all activity logs for the tenant
    const activityLogsRef = db.collection('tenants').doc(tenantId).collection('activity_logs');
    const activityLogsSnapshot = await activityLogsRef.get();
    
    if (emailLogsSnapshot.empty && activityLogsSnapshot.empty) {
      console.log('📭 No email logs or activity logs found');
      return {
        success: true,
        message: 'No email logs or activity logs found',
        duplicatesRemoved: 0,
        totalEmails: 0,
        totalActivities: 0
      };
    }

    // Group email logs by gmailMessageId
    const emailMessageGroups = new Map<string, any[]>();
    
    emailLogsSnapshot.forEach(doc => {
      const data = doc.data();
      const gmailMessageId = data.gmailMessageId;
      
      if (gmailMessageId) {
        if (!emailMessageGroups.has(gmailMessageId)) {
          emailMessageGroups.set(gmailMessageId, []);
        }
        emailMessageGroups.get(gmailMessageId)!.push({
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate?.() || data.createdAt
        });
      }
    });

    // Group activity logs by gmailMessageId
    const activityMessageGroups = new Map<string, any[]>();
    
    activityLogsSnapshot.forEach(doc => {
      const data = doc.data();
      const gmailMessageId = data.metadata?.gmailMessageId;
      
      if (gmailMessageId && data.type === 'email') {
        if (!activityMessageGroups.has(gmailMessageId)) {
          activityMessageGroups.set(gmailMessageId, []);
        }
        activityMessageGroups.get(gmailMessageId)!.push({
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate?.() || data.createdAt
        });
      }
    });

    console.log(`📊 Found ${emailLogsSnapshot.size} total emails, ${emailMessageGroups.size} unique email message IDs`);
    console.log(`📊 Found ${activityLogsSnapshot.size} total activities, ${activityMessageGroups.size} unique activity message IDs`);

    // Find duplicates in email logs and prepare for deletion
    const emailDuplicatesToRemove: string[] = [];
    
    emailMessageGroups.forEach((emails, messageId) => {
      if (emails.length > 1) {
        // Sort by creation time, keep the most recent
        emails.sort((a, b) => {
          const timeA = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
          const timeB = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
          return timeB - timeA; // Most recent first
        });
        
        // Remove all but the first (most recent) one
        const toRemove = emails.slice(1);
        emailDuplicatesToRemove.push(...toRemove.map(email => email.id));
        
        console.log(`🔄 Email Message ID ${messageId}: keeping most recent, removing ${toRemove.length} duplicates`);
      }
    });

    // Find duplicates in activity logs and prepare for deletion
    const activityDuplicatesToRemove: string[] = [];
    
    activityMessageGroups.forEach((activities, messageId) => {
      if (activities.length > 1) {
        // Sort by creation time, keep the most recent
        activities.sort((a, b) => {
          const timeA = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
          const timeB = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
          return timeB - timeA; // Most recent first
        });
        
        // Remove all but the first (most recent) one
        const toRemove = activities.slice(1);
        activityDuplicatesToRemove.push(...toRemove.map(activity => activity.id));
        
        console.log(`🔄 Activity Message ID ${messageId}: keeping most recent, removing ${toRemove.length} duplicates`);
      }
    });

    const totalDuplicates = emailDuplicatesToRemove.length + activityDuplicatesToRemove.length;

    if (totalDuplicates === 0) {
      console.log('✅ No duplicates found');
      return {
        success: true,
        message: 'No duplicates found',
        duplicatesRemoved: 0,
        totalEmails: emailLogsSnapshot.size,
        totalActivities: activityLogsSnapshot.size
      };
    }

    // Delete email log duplicates in batches
    const batchSize = 500;
    let emailDeletedCount = 0;
    
    for (let i = 0; i < emailDuplicatesToRemove.length; i += batchSize) {
      const batch = db.batch();
      const batchIds = emailDuplicatesToRemove.slice(i, i + batchSize);
      
      batchIds.forEach(id => {
        const docRef = emailLogsRef.doc(id);
        batch.delete(docRef);
      });
      
      await batch.commit();
      emailDeletedCount += batchIds.length;
      console.log(`🗑️ Deleted email batch ${Math.floor(i / batchSize) + 1}: ${batchIds.length} duplicates`);
    }

    // Delete activity log duplicates in batches
    let activityDeletedCount = 0;
    
    for (let i = 0; i < activityDuplicatesToRemove.length; i += batchSize) {
      const batch = db.batch();
      const batchIds = activityDuplicatesToRemove.slice(i, i + batchSize);
      
      batchIds.forEach(id => {
        const docRef = activityLogsRef.doc(id);
        batch.delete(docRef);
      });
      
      await batch.commit();
      activityDeletedCount += batchIds.length;
      console.log(`🗑️ Deleted activity batch ${Math.floor(i / batchSize) + 1}: ${batchIds.length} duplicates`);
    }

    const totalDeleted = emailDeletedCount + activityDeletedCount;
    console.log(`✅ Duplicate cleanup completed: ${totalDeleted} duplicates removed (${emailDeletedCount} emails, ${activityDeletedCount} activities)`);
    
    return {
      success: true,
      message: `Successfully removed ${totalDeleted} duplicate emails and activities`,
      duplicatesRemoved: totalDeleted,
      emailDuplicatesRemoved: emailDeletedCount,
      activityDuplicatesRemoved: activityDeletedCount,
      totalEmails: emailLogsSnapshot.size,
      totalActivities: activityLogsSnapshot.size,
      remainingEmails: emailLogsSnapshot.size - emailDeletedCount,
      remainingActivities: activityLogsSnapshot.size - activityDeletedCount
    };

  } catch (error) {
    console.error('❌ Error cleaning up duplicate emails:', error);
    throw new Error(`Failed to cleanup duplicate emails: ${error}`);
  }
});
