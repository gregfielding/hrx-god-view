import admin from 'firebase-admin';
import type { WorkerConfig } from './config.ts';

let app: admin.app.App | null = null;

/**
 * Admin SDK via Application Default Credentials. On the worker box that is
 * GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account JSON with
 * Firestore + Storage access (see README). Never bundle the key in the repo.
 */
export function initFirebase(config: WorkerConfig): admin.app.App {
  if (app) return app;
  app = admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: config.projectId,
    ...(config.storageBucket ? { storageBucket: config.storageBucket } : {}),
  });
  admin.firestore().settings({ ignoreUndefinedProperties: true });
  return app;
}

export function db(): admin.firestore.Firestore {
  if (!app) throw new Error('initFirebase() first');
  return admin.firestore();
}

export const Timestamp = admin.firestore.Timestamp;
export const FieldValue = admin.firestore.FieldValue;
export type Firestore = admin.firestore.Firestore;
export type DocRef = admin.firestore.DocumentReference;
export type FirestoreTimestamp = admin.firestore.Timestamp;

export function bucket() {
  if (!app) throw new Error('initFirebase() first');
  return admin.storage().bucket();
}
