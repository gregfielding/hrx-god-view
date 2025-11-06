import * as admin from 'firebase-admin';
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';

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
 * Trigger when a shift is created
 */
export const onShiftCreated = onDocumentCreated('shifts/{shiftId}', async (event) => {
  const shift = event.data?.data();
  if (!shift) return;
  
  await refreshNextShiftDate(shift.tenantId, shift.jobOrderId);
});

/**
 * Trigger when a shift is updated
 */
export const onShiftUpdated = onDocumentUpdated('shifts/{shiftId}', async (event) => {
  const beforeShift = event.data?.before.data();
  const afterShift = event.data?.after.data();
  
  if (!beforeShift || !afterShift) return;
  
  // Only refresh if the shift date changed
  if (beforeShift.shiftDate !== afterShift.shiftDate) {
    await refreshNextShiftDate(afterShift.tenantId, afterShift.jobOrderId);
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

