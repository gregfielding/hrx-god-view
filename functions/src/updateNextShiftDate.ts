import * as admin from 'firebase-admin';
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { sendWorkerMessageInternal } from './twilio';

const db = admin.firestore();

/**
 * Update nextShiftDate for job postings when shifts are created, updated, or deleted
 */
async function refreshNextShiftDate(tenantId: string, jobOrderId: string) {
  try {
    console.log(`🔄 Refreshing nextShiftDate for jobOrder ${jobOrderId}`);
    
    // Get today's date at midnight
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Format as YYYY-MM-DD in local timezone (not UTC)
    const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    // Get shifts for next 30 days
    const cutoffDate = new Date(today);
    cutoffDate.setDate(cutoffDate.getDate() + 30);
    const cutoffISO = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}`;
    
    // Query shifts
    const shiftsRef = db.collection('shifts');
    const shiftsQuery = shiftsRef
      .where('jobOrderId', '==', jobOrderId)
      .where('tenantId', '==', tenantId);
    
    const shiftsSnapshot = await shiftsQuery.get();
    
    // Filter and sort to get next shift
    const upcomingShifts = shiftsSnapshot.docs
      .map(doc => doc.data())
      .filter((shift: any) => shift.shiftDate >= todayISO && shift.shiftDate <= cutoffISO)
      .sort((a: any, b: any) => a.shiftDate.localeCompare(b.shiftDate));
    
    const nextShiftDate = upcomingShifts.length > 0 
      ? new Date(upcomingShifts[0].shiftDate + 'T00:00:00')
      : null;
    
    // Update all job postings for this job order
    const postingsRef = db.collection('tenants').doc(tenantId).collection('job_postings');
    const postingsQuery = postingsRef
      .where('jobOrderId', '==', jobOrderId)
      .where('jobType', '==', 'gig');
    
    const postingsSnapshot = await postingsQuery.get();
    
    if (postingsSnapshot.empty) {
      console.log(`No Gig postings found for jobOrder ${jobOrderId}`);
      return;
    }
    
    const batch = db.batch();
    let updateCount = 0;
    
    for (const postingDoc of postingsSnapshot.docs) {
      batch.update(postingDoc.ref, {
        nextShiftDate: nextShiftDate || admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      updateCount++;
    }
    
    await batch.commit();
    
    console.log(`✅ Updated ${updateCount} posting(s) with nextShiftDate: ${nextShiftDate ? upcomingShifts[0].shiftDate : 'null'}`);
    
  } catch (error) {
    console.error('Error refreshing nextShiftDate:', error);
  }
}

/**
 * Send SMS notifications to assigned workers for a shift
 */
async function notifyShiftWorkers(
  shiftId: string,
  shift: any,
  tenantId: string,
  notificationType: 'created' | 'updated' | 'cancelled'
): Promise<void> {
  try {
    // Find all assignments for this shift
    const assignmentsRef = db.collection(`tenants/${tenantId}/assignments`);
    const assignmentsQuery = assignmentsRef
      .where('shiftId', '==', shiftId)
      .where('status', 'in', ['proposed', 'confirmed', 'active']);
    
    const assignmentsSnapshot = await assignmentsQuery.get();
    
    if (assignmentsSnapshot.empty) {
      logger.info(`No active assignments found for shift ${shiftId}`);
      return;
    }

    // Fetch job order details
    let jobTitle = 'your shift';
    let locationName = '';
    if (shift.jobOrderId) {
      try {
        const jobOrderDoc = await db.doc(`tenants/${tenantId}/job_orders/${shift.jobOrderId}`).get();
        const jobOrderData = jobOrderDoc.data();
        if (jobOrderData?.jobTitle) {
          jobTitle = jobOrderData.jobTitle;
        }
      } catch (err) {
        logger.warn(`Failed to fetch job order ${shift.jobOrderId}:`, err);
      }
    }

    // Format shift date and time
    let dateTimeInfo = '';
    if (shift.shiftDate) {
      const shiftDate = new Date(shift.shiftDate + 'T00:00:00');
      dateTimeInfo = shiftDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      
      if (shift.startTime && shift.endTime) {
        const startTime = shift.startTime.toDate ? shift.startTime.toDate() : new Date(shift.startTime);
        const endTime = shift.endTime.toDate ? shift.endTime.toDate() : new Date(shift.endTime);
        const timeRange = `${startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${endTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
        dateTimeInfo += ` from ${timeRange}`;
      }
    }

    // Send SMS to each assigned worker
    for (const assignmentDoc of assignmentsSnapshot.docs) {
      const assignment = assignmentDoc.data();
      const userId = assignment.userId || assignment.candidateId;
      
      if (!userId) continue;

      try {
        const userDoc = await db.doc(`users/${userId}`).get();
        const userData = userDoc.data();
        
        if (!userData?.phoneE164 || !userData?.phoneVerified) {
          logger.info(`User ${userId} has no verified phone, skipping SMS for shift ${shiftId}`);
          continue;
        }

        const firstName = assignment.firstName || userData.firstName || 'there';
        let message = '';

        switch (notificationType) {
          case 'created':
            message = `Hi ${firstName}, a new shift has been assigned: ${jobTitle} on ${dateTimeInfo}. Please confirm your availability.`;
            break;
          case 'updated':
            message = `Hi ${firstName}, your shift for ${jobTitle} on ${dateTimeInfo} has been updated. Please check your account for details.`;
            break;
          case 'cancelled':
            message = `Hi ${firstName}, your shift for ${jobTitle} on ${dateTimeInfo} has been cancelled. Please check your account for details.`;
            break;
        }

        if (message) {
          await sendWorkerMessageInternal(
            userData.phoneE164,
            message,
            {
              systemContext: true,
              source: `shift_${notificationType}`,
              sourceId: shiftId
            }
          );
          
          logger.info(`SMS sent for shift ${notificationType} ${shiftId} to ${userData.phoneE164}`);
        }
      } catch (userError: any) {
        logger.error(`Error sending SMS to user ${userId} for shift ${shiftId}:`, userError);
        // Continue with other users
      }
    }
  } catch (error: any) {
    logger.error(`Error notifying workers for shift ${shiftId}:`, error);
    // Don't throw - allow shift operation to succeed
  }
}

/**
 * Trigger when a shift is created
 */
export const onShiftCreated = onDocumentCreated('shifts/{shiftId}', async (event) => {
  const shiftId = event.params.shiftId;
  const shift = event.data?.data();
  if (!shift) return;
  
  // Refresh next shift date
  await refreshNextShiftDate(shift.tenantId, shift.jobOrderId);
  
  // Send SMS notifications to assigned workers
  await notifyShiftWorkers(shiftId, shift, shift.tenantId, 'created');
});

/**
 * Trigger when a shift is updated
 */
export const onShiftUpdated = onDocumentUpdated('shifts/{shiftId}', async (event) => {
  const shiftId = event.params.shiftId;
  const beforeShift = event.data?.before.data();
  const afterShift = event.data?.after.data();
  
  if (!beforeShift || !afterShift) return;
  
  // Check for significant changes
  const dateChanged = beforeShift.shiftDate !== afterShift.shiftDate;
  const timeChanged = beforeShift.startTime !== afterShift.startTime || beforeShift.endTime !== afterShift.endTime;
  const statusChanged = beforeShift.status !== afterShift.status;
  const isCancelled = afterShift.status === 'cancelled' || afterShift.status === 'canceled';
  
  // Refresh next shift date if date changed
  if (dateChanged) {
    await refreshNextShiftDate(afterShift.tenantId, afterShift.jobOrderId);
  }
  
  // Send SMS if significant changes occurred
  if (dateChanged || timeChanged || isCancelled) {
    const notificationType = isCancelled ? 'cancelled' : 'updated';
    await notifyShiftWorkers(shiftId, afterShift, afterShift.tenantId, notificationType);
  }
});

/**
 * Trigger when a shift is deleted
 */
export const onShiftDeleted = onDocumentDeleted('shifts/{shiftId}', async (event) => {
  const shift = event.data?.data();
  if (!shift) return;
  
  await refreshNextShiftDate(shift.tenantId, shift.jobOrderId);
});

