import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '../../firebase';
import type { CertificationShadowEventDoc } from '../../types/certifications/certEngineShadowEvent';
import { CERT_ENGINE_SHADOW_COLLECTION } from './certEngineShadowTelemetryConstants';

/**
 * Best-effort append-only write. Skips when unauthenticated (rules require auth).
 * Keeps payload small — callers should trim `details`.
 */
export async function persistCertEngineShadowEvent(
  doc: Omit<CertificationShadowEventDoc, 'createdAt'>,
): Promise<void> {
  try {
    if (!getAuth().currentUser) return;
    await addDoc(collection(db, CERT_ENGINE_SHADOW_COLLECTION), {
      ...doc,
      createdAt: serverTimestamp(),
    });
  } catch {
    // ignore — telemetry must not break UX
  }
}
