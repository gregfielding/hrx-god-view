import * as admin from 'firebase-admin';

const dummyWorkers = [
  {
    id: 'dummy1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    tenureDays: 10,
    traits: { reliability: 7, teamwork: 8 },
    lastActive: new Date(),
    status: 'active',
  },
  {
    id: 'dummy2',
    name: 'John Smith',
    email: 'john@example.com',
    tenureDays: 5,
    traits: { reliability: 6, teamwork: 9 },
    lastActive: new Date(),
    status: 'active',
  },
];

export async function getWorkers(): Promise<any[]> {
  const db = admin.firestore();
  const snap = await db.collection('users').limit(1).get();
  if (!snap.empty) {
    // Real data exists
    const all = await db.collection('users').where('status', '==', 'active').get();
    return all.docs.map(doc => ({ id: doc.id, ...(doc.data() as object) }));
  }
  // No real data, return dummy
  return dummyWorkers;
} 