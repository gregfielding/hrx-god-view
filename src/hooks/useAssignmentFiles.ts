/**
 * Load assignment files for the worker from Job Order Staff Instructions.
 * Source: users/{uid}.applicationIds -> applications (jobOrderId) -> job_orders staffInstructions.
 * Matches upload path: Job Order Staff Instructions tab, file label (e.g. "First Day Instructions").
 */

import { useState, useEffect } from 'react';
import { collection, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

export interface AssignmentFileEntry {
  jobOrderId: string;
  jobOrderName: string;
  tenantId: string;
  /** Section from Staff Instructions tab (e.g. "First Day Instructions") */
  sectionLabel: string;
  /** Per-file label from upload (e.g. "First Day Instructions" or custom) */
  fileLabel: string;
  fileName: string;
  url: string;
  uploadedAt?: string;
}

/** Section titles matching RecruiterJobOrderDetail Staff Instructions tab */
const STAFF_SECTION_LABELS: Record<string, string> = {
  firstDay: 'First Day Instructions',
  parking: 'Parking Instructions',
  checkIn: 'Check-In Instructions',
  uniform: 'Uniform Instructions',
  credentials: 'Credential Instructions',
  other: 'Other Instructions',
  attachments: 'Other Attachments',
};

export function useAssignmentFiles(uid: string | undefined): {
  files: AssignmentFileEntry[];
  loading: boolean;
  error: string | null;
} {
  const [files, setFiles] = useState<AssignmentFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setFiles([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        const applicationIds: string[] = Array.isArray((userSnap.data() as any)?.applicationIds)
          ? (userSnap.data() as any).applicationIds
          : [];

        const seen = new Set<string>();
        const entries: AssignmentFileEntry[] = [];

        for (const appId of applicationIds) {
          const parts = appId.split('_');
          const tenantId = parts[0];
          const jobId = parts[1];
          if (!tenantId || !jobId) continue;

          const appRef = doc(db, 'tenants', tenantId, 'applications', `${uid}_${jobId}`);
          const appSnap = await getDoc(appRef);
          const jobOrderId = (appSnap.data() as any)?.jobOrderId;
          if (!jobOrderId || cancelled) continue;

          const key = `${tenantId}_${jobOrderId}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const jobOrdersCol = collection(db, 'tenants', tenantId, 'job_orders');
          const jobOrderRef = doc(jobOrdersCol, jobOrderId);
          const jobOrderSnap = await getDoc(jobOrderRef);
          if (!jobOrderSnap.exists() || cancelled) continue;

          const jobOrderData = jobOrderSnap.data() as any;
          const staffInstructions = jobOrderData?.staffInstructions || {};
          const jobOrderName = jobOrderData?.jobOrderName || jobOrderData?.jobTitle || 'Job';

          for (const [fieldKey, section] of Object.entries(staffInstructions)) {
            const sect = section as { files?: Array<{ label?: string; name?: string; url?: string; uploadedAt?: string }> };
            const sectionLabel = STAFF_SECTION_LABELS[fieldKey] ?? fieldKey;
            const fileList = sect?.files || [];
            for (const file of fileList) {
              if (file?.url) {
                entries.push({
                  jobOrderId,
                  jobOrderName,
                  tenantId,
                  sectionLabel,
                  fileLabel: file.label || file.name || 'Document',
                  fileName: file.name || 'file',
                  url: file.url,
                  uploadedAt: file.uploadedAt,
                });
              }
            }
          }
        }

        if (!cancelled) setFiles(entries);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? 'Failed to load assignment files');
          setFiles([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  return { files, loading, error };
}
