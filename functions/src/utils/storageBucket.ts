import * as admin from 'firebase-admin';
import { getStorage } from 'firebase-admin/storage';

export function getStorageBucketName(): string {
  // Prefer explicitly configured bucket name on the initialized Admin app
  const app: any = admin.apps?.length ? admin.app() : null;
  const fromApp = String(app?.options?.storageBucket || '').trim();
  if (fromApp) return fromApp;

  // Common env var fallbacks
  const fromEnv = String(process.env.STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || '').trim();
  if (fromEnv) return fromEnv;

  // FIREBASE_CONFIG often contains storageBucket/projectId
  try {
    const raw = process.env.FIREBASE_CONFIG;
    if (raw) {
      const cfg = JSON.parse(raw);
      const fromCfg = String(cfg?.storageBucket || '').trim();
      if (fromCfg) return fromCfg;
      const projectId = String(cfg?.projectId || cfg?.project_id || '').trim();
      if (projectId) return `${projectId}.appspot.com`;
    }
  } catch {
    // ignore
  }

  // Last resort: derive from project id envs
  const projectId = String(process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.PROJECT_ID || '').trim();
  if (projectId) return `${projectId}.appspot.com`;

  throw new Error(
    'Bucket name not specified. Set storageBucket in admin.initializeApp() or provide FIREBASE_STORAGE_BUCKET/STORAGE_BUCKET.'
  );
}

export function getDefaultBucket() {
  return getStorage().bucket(getStorageBucketName());
}

