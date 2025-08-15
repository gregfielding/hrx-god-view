import * as admin from 'firebase-admin';

try {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-test' } as any);
  }
} catch {
  // ignore
}


