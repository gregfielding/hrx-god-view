import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

export const clearAllEmails = onCall({
  cors: true,
  maxInstances: 1,
  region: 'us-central1'
}, async (request) => {
  try {
    const { tenantId } = request.data;
    
    if (!tenantId) {
      throw new Error('tenantId is required');
    }

    console.log(`🗑️ Starting complete email cleanup for tenant: ${tenantId}`);
    
    // Get all email logs for the tenant
    const emailLogsRef = db.collection('tenants').doc(tenantId).collection('email_logs');
    const emailLogsSnapshot = await emailLogsRef.get();
    
    // Get all activity logs for the tenant
    const activityLogsRef = db.collection('tenants').doc(tenantId).collection('activity_logs');
    const activityLogsSnapshot = await activityLogsRef.get();
    
    const totalEmails = emailLogsSnapshot.size;
    const totalActivities = activityLogsSnapshot.size;
    
    console.log(`📊 Found ${totalEmails} email logs and ${totalActivities} activity logs to delete`);

    if (totalEmails === 0 && totalActivities === 0) {
      console.log('📭 No email logs or activity logs found');
      return {
        success: true,
        message: 'No email logs or activity logs found to delete',
        emailsDeleted: 0,
        activitiesDeleted: 0
      };
    }

    // Delete all email logs in batches
    const batchSize = 500;
    let emailDeletedCount = 0;
    
    const emailDocIds = emailLogsSnapshot.docs.map(doc => doc.id);
    for (let i = 0; i < emailDocIds.length; i += batchSize) {
      const batch = db.batch();
      const batchIds = emailDocIds.slice(i, i + batchSize);
      
      batchIds.forEach(id => {
        const docRef = emailLogsRef.doc(id);
        batch.delete(docRef);
      });
      
      await batch.commit();
      emailDeletedCount += batchIds.length;
      console.log(`🗑️ Deleted email batch ${Math.floor(i / batchSize) + 1}: ${batchIds.length} emails`);
    }

    // Delete all activity logs in batches
    let activityDeletedCount = 0;
    
    const activityDocIds = activityLogsSnapshot.docs.map(doc => doc.id);
    for (let i = 0; i < activityDocIds.length; i += batchSize) {
      const batch = db.batch();
      const batchIds = activityDocIds.slice(i, i + batchSize);
      
      batchIds.forEach(id => {
        const docRef = activityLogsRef.doc(id);
        batch.delete(docRef);
      });
      
      await batch.commit();
      activityDeletedCount += batchIds.length;
      console.log(`🗑️ Deleted activity batch ${Math.floor(i / batchSize) + 1}: ${batchIds.length} activities`);
    }

    console.log(`✅ Complete email cleanup finished: ${emailDeletedCount} emails and ${activityDeletedCount} activities deleted`);
    
    return {
      success: true,
      message: `Successfully cleared all email data: ${emailDeletedCount} emails and ${activityDeletedCount} activities deleted`,
      emailsDeleted: emailDeletedCount,
      activitiesDeleted: activityDeletedCount,
      totalDeleted: emailDeletedCount + activityDeletedCount
    };

  } catch (error) {
    console.error('❌ Error clearing all emails:', error);
    throw new Error(`Failed to clear all emails: ${error}`);
  }
});
