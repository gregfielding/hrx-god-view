import * as admin from 'firebase-admin';

admin.initializeApp();
const db = admin.firestore();

async function backfillShiftsAndAssignments() {
  // 1. Backfill shifts
  const shiftsSnap = await db.collection('shifts').get();
  for (const shiftDoc of shiftsSnap.docs) {
    const shift = shiftDoc.data();
    if (!shift.jobOrderId) continue;
    const jobOrderSnap = await db.collection('jobOrders').doc(shift.jobOrderId).get();
    if (!jobOrderSnap.exists) continue;
    const jobOrder = jobOrderSnap.data();
    if (!jobOrder) continue;
    const customerId = jobOrder.customerId || '';
    const worksiteId = jobOrder.worksiteId || '';
    const locationIds = worksiteId ? [worksiteId] : [];
    await shiftDoc.ref.update({ customerId, worksiteId, locationIds });
  }
  console.log('Shifts backfilled.');

  // 2. Backfill assignments
  const assignmentsSnap = await db.collection('assignments').get();
  for (const assignmentDoc of assignmentsSnap.docs) {
    const assignment = assignmentDoc.data();
    if (!assignment.shiftId) continue;
    const shiftSnap = await db.collection('shifts').doc(assignment.shiftId).get();
    if (!shiftSnap.exists) continue;
    const shift = shiftSnap.data();
    if (!shift) continue;
    const customerId = shift.customerId || '';
    const worksiteId = shift.worksiteId || '';
    const locationIds = shift.locationIds || (worksiteId ? [worksiteId] : []);
    await assignmentDoc.ref.update({ customerId, worksiteId, locationIds });
  }
  console.log('Assignments backfilled.');
}

backfillShiftsAndAssignments().then(() => {
  console.log('Backfill complete.');
  process.exit(0);
}).catch(err => {
  console.error('Backfill error:', err);
  process.exit(1);
}); 