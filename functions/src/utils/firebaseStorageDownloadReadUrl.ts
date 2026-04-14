/**
 * Firebase Storage read URL using firebaseStorageDownloadTokens — avoids GCS V4 signed URLs,
 * which call IAM signBlob and fail unless the runtime SA has iam.serviceAccounts.signBlob.
 * @see resumeParser getOrCreateFirebaseDownloadReadUrl (same pattern as gmailIntegration makeDownloadUrl)
 */
import * as crypto from 'crypto';
import { getStorage } from 'firebase-admin/storage';
import { getStorageBucketName } from './storageBucket';

export async function getOrCreateFirebaseDownloadReadUrl(storagePath: string): Promise<string> {
  const bucket = getStorage().bucket(getStorageBucketName());
  const bucketName = bucket.name;
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(`File does not exist at path: ${storagePath}`);
  }
  const [meta] = await file.getMetadata();
  const existing = (meta.metadata || {}) as Record<string, string>;
  const tokensRaw = String(existing.firebaseStorageDownloadTokens || '');
  let token = tokensRaw.split(',')[0]?.trim();
  if (!token) {
    token = crypto.randomUUID();
    await file.setMetadata({
      metadata: {
        ...existing,
        firebaseStorageDownloadTokens: token,
      },
    });
  }
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(token)}`;
}
