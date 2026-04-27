import * as admin from 'firebase-admin';
import { CloudTasksClient } from '@google-cloud/tasks';

const tasksClient = new CloudTasksClient();
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
const LOCATION = process.env.FUNCTIONS_REGION || 'us-central1';
const DEFAULT_QUEUE = process.env.CLOUD_TASKS_QUEUE || 'default';

export async function ensureFirstTime(eventId: string, functionName: string): Promise<boolean> {
  if (!eventId) return true; // fallback, don't block
  const db = admin.firestore();
  const key = `${functionName}_${eventId}`;
  const ref = db.collection('function_runs').doc(key);
  try {
    await ref.create({ createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  } catch {
    return false; // already processed
  }
}

export async function enqueueOnce(
  taskName: string,
  urlPath: string,
  payload: Record<string, any>,
  queue: string = DEFAULT_QUEUE,
  delaySeconds = 15
): Promise<void> {
  if (!PROJECT) {
    throw new Error('GCLOUD_PROJECT or GCP_PROJECT environment variable not set');
  }
  
  const parent = tasksClient.queuePath(PROJECT, LOCATION, queue);
  // Names must be unique; use deterministic name to dedupe
  const name = `${parent}/tasks/${taskName}`;
  const body = Buffer.from(JSON.stringify(payload)).toString('base64');
  const url = `https://${LOCATION}-${PROJECT}.cloudfunctions.net${urlPath}`;

  const request: any = {
    parent,
    task: {
      name,
      httpRequest: {
        httpMethod: 'POST',
        url,
        headers: { 'Content-Type': 'application/json' },
        body,
      },
      scheduleTime: { seconds: Math.floor(Date.now() / 1000) + delaySeconds },
    },
  };

  try {
    await tasksClient.createTask(request);
  } catch (e: any) {
    // If the task already exists, treat as success (debounced)
    if (!(e && e.code === 6)) { // ALREADY_EXISTS
      throw e;
    }
  }
}

export function relevantChanges(before: any, after: any, whitelist: string[]): boolean {
  if (!before || !after) return false;
  return whitelist.some((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]));
}


