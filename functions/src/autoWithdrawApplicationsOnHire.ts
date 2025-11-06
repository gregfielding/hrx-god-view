import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Extract the date (YYYY-MM-DD) from a shift date string
 */
function extractDateFromShiftDate(shiftDate: string): string {
  return shiftDate.split('T')[0];
}

/**
 * Get shift date(s) from an application document
 */
async function getShiftDatesFromApplication(
  tenantId: string,
  applicationData: admin.firestore.DocumentData
): Promise<string[]> {
  const shiftDates: string[] = [];
  
  // Check if shiftDate is directly stored (for quick lookup)
  if (applicationData.shiftDate) {
    shiftDates.push(extractDateFromShiftDate(applicationData.shiftDate));
  }
  
  // Check if shiftDates array is stored
  if (Array.isArray(applicationData.shiftDates)) {
    applicationData.shiftDates.forEach((date: string) => {
      const dateStr = extractDateFromShiftDate(date);
      if (!shiftDates.includes(dateStr)) {
        shiftDates.push(dateStr);
      }
    });
  }
  
  // Fallback: fetch from shift documents if shiftId/shiftIds exist
  if (applicationData.jobOrderId) {
    if (applicationData.shiftId) {
      try {
        const shiftRef = db
          .collection('tenants')
          .doc(tenantId)
          .collection('job_orders')
          .doc(applicationData.jobOrderId)
          .collection('shifts')
          .doc(applicationData.shiftId);
        
        const shiftSnap = await shiftRef.get();
        if (shiftSnap.exists()) {
          const shiftData = shiftSnap.data();
          if (shiftData?.shiftDate) {
            const dateStr = extractDateFromShiftDate(shiftData.shiftDate);
            if (!shiftDates.includes(dateStr)) {
              shiftDates.push(dateStr);
            }
          }
        }
      } catch (error) {
        console.error(`Error fetching shift date for ${applicationData.shiftId}:`, error);
      }
    }
    
    if (Array.isArray(applicationData.shiftIds)) {
      for (const shiftId of applicationData.shiftIds) {
        try {
          const shiftRef = db
            .collection('tenants')
            .doc(tenantId)
            .collection('job_orders')
            .doc(applicationData.jobOrderId)
            .collection('shifts')
            .doc(shiftId);
          
          const shiftSnap = await shiftRef.get();
          if (shiftSnap.exists()) {
            const shiftData = shiftSnap.data();
            if (shiftData?.shiftDate) {
              const dateStr = extractDateFromShiftDate(shiftData.shiftDate);
              if (!shiftDates.includes(dateStr)) {
                shiftDates.push(dateStr);
              }
            }
          }
        } catch (error) {
          console.error(`Error fetching shift date for ${shiftId}:`, error);
        }
      }
    }
  }
  
  return shiftDates;
}

/**
 * Auto-withdraw other applications when one is hired
 * 
 * This function triggers when an application status changes to "hired".
 * It automatically withdraws other active applications for the same shift date(s),
 * ensuring users can only be hired for one shift per day.
 */
export const autoWithdrawApplicationsOnHire = onDocumentUpdated(
  {
    document: 'tenants/{tenantId}/applications/{applicationId}',
    region: 'us-central1',
    maxInstances: 10,
    timeoutSeconds: 540,
    memory: '256MiB'
  },
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();
    
    if (!beforeData || !afterData) {
      console.log('Missing before/after data, skipping');
      return;
    }
    
    // Only proceed if status changed to "hired"
    if (beforeData.status === 'hired' || afterData.status !== 'hired') {
      return;
    }
    
    const tenantId = event.params.tenantId;
    const applicationId = event.params.applicationId;
    const userId = afterData.userId;
    
    if (!userId || !tenantId) {
      console.log('Missing userId or tenantId, skipping');
      return;
    }
    
    console.log(`🔄 Application ${applicationId} was hired. Checking for other applications to withdraw...`);
    
    try {
      // Get shift dates for the hired application
      const shiftDates = await getShiftDatesFromApplication(tenantId, afterData);
      
      if (shiftDates.length === 0) {
        console.log('No shift dates found for hired application, skipping auto-withdraw');
        return;
      }
      
      console.log(`📅 Found ${shiftDates.length} shift date(s) for hired application: ${shiftDates.join(', ')}`);
      
      // Find all other active applications for this user on the same shift date(s)
      const applicationsRef = db
        .collection('tenants')
        .doc(tenantId)
        .collection('applications');
      
      const userApplicationsQuery = applicationsRef
        .where('userId', '==', userId);
      
      const snapshot = await userApplicationsQuery.get();
      
      // Active statuses that should be withdrawn
      const activeStatuses = ['submitted', 'screened', 'advanced', 'interview', 'offer_pending'];
      
      let withdrawnCount = 0;
      
      for (const docSnap of snapshot.docs) {
        // Skip the application that was just hired
        if (docSnap.id === applicationId) {
          continue;
        }
        
        const appData = docSnap.data();
        
        // Only withdraw active applications
        if (!activeStatuses.includes(appData.status)) {
          continue;
        }
        
        // Get shift dates for this application
        const appShiftDates = await getShiftDatesFromApplication(tenantId, appData);
        
        // Check if any shift date overlaps
        const hasOverlap = shiftDates.some(hiredDate => 
          appShiftDates.some(appDate => hiredDate === appDate)
        );
        
        if (hasOverlap) {
          console.log(`🚫 Withdrawing application ${docSnap.id} (conflicts with hired shift date)`);
          
          await docSnap.ref.update({
            status: 'withdrawn',
            withdrawnAt: admin.firestore.FieldValue.serverTimestamp(),
            withdrawnReason: 'auto_withdrawn_on_hire',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          
          withdrawnCount++;
        }
      }
      
      console.log(`✅ Auto-withdrew ${withdrawnCount} application(s) for user ${userId}`);
      
    } catch (error) {
      console.error('❌ Error in autoWithdrawApplicationsOnHire:', error);
      // Don't throw - we don't want to fail the application status update
    }
  }
);

