/**
 * Load current worker's profile for Credentials tab.
 * Work Eligibility = attestation (not document); workEligibility boolean derived for compatibility.
 * Screening orders (from admin) drive Background summary.
 */

import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { WorkEligibilityAttestation } from '../types/workEligibility';
import { deriveWorkEligibilityFromAttestation } from '../types/workEligibility';

export interface ScreeningOrder {
  id: string;
  type?: string;
  typeLabel?: string;
  dateOrdered?: string;
  dateSubmitted?: string;
  status?: string;
  result?: string;
  completionDate?: string;
}

export interface WorkerCredentialsData {
  /** Structured attestation (source of truth). */
  workEligibilityAttestation: WorkEligibilityAttestation | null;
  /** Derived from attestation for backward compatibility; fallback to legacy boolean if no attestation. */
  workEligibility: boolean;
  resume: { downloadUrl?: string; storagePath?: string } | null;
  certCount: number;
  backgroundCheckOrders: ScreeningOrder[];
  drugScreeningOrders: ScreeningOrder[];
  additionalScreeningOrders: ScreeningOrder[];
  eVerifyOrders: ScreeningOrder[];
  backgroundSummary: string;
}

const defaultData: WorkerCredentialsData = {
  workEligibilityAttestation: null,
  workEligibility: false,
  resume: null,
  certCount: 0,
  backgroundCheckOrders: [],
  drugScreeningOrders: [],
  additionalScreeningOrders: [],
  eVerifyOrders: [],
  backgroundSummary: '—',
};

function formatOrdersSummary(
  bg: ScreeningOrder[],
  drug: ScreeningOrder[],
  other: ScreeningOrder[],
  eVerify: ScreeningOrder[]
): string {
  const parts: string[] = [];
  if (bg.length) parts.push(`${bg.length} background`);
  if (drug.length) parts.push(`${drug.length} drug`);
  if (other.length) parts.push(`${other.length} other`);
  if (eVerify.length) parts.push(`${eVerify.length} E-Verify`);
  if (parts.length === 0) return 'None ordered';
  return parts.join(', ');
}

export function useWorkerCredentials(uid: string | undefined): {
  data: WorkerCredentialsData;
  loading: boolean;
} {
  const [data, setData] = useState<WorkerCredentialsData>(defaultData);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setData(defaultData);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const userRef = doc(db, 'users', uid);
        const snap = await getDoc(userRef);
        if (cancelled) return;

        if (!snap.exists()) {
          setData(defaultData);
          setLoading(false);
          return;
        }

        const d = snap.data() as any;
        const bg = Array.isArray(d.backgroundCheckOrders) ? d.backgroundCheckOrders : [];
        const drug = Array.isArray(d.drugScreeningOrders) ? d.drugScreeningOrders : [];
        const other = Array.isArray(d.additionalScreeningOrders) ? d.additionalScreeningOrders : [];
        const eVerify = Array.isArray(d.eVerifyOrders) ? d.eVerifyOrders : [];

        const certs = d.certifications;
        const certCount = Array.isArray(certs) ? certs.length : 0;
        const resume = d.resume && (d.resume.downloadUrl || d.resume.storagePath) ? d.resume : null;
        const attestation = d.workEligibilityAttestation && typeof d.workEligibilityAttestation === 'object'
          ? (d.workEligibilityAttestation as WorkEligibilityAttestation)
          : null;
        const workEligibility = attestation
          ? deriveWorkEligibilityFromAttestation(attestation)
          : (d.workEligibility === true);

        setData({
          workEligibilityAttestation: attestation,
          workEligibility,
          resume,
          certCount,
          backgroundCheckOrders: bg,
          drugScreeningOrders: drug,
          additionalScreeningOrders: other,
          eVerifyOrders: eVerify,
          backgroundSummary: formatOrdersSummary(bg, drug, other, eVerify),
        });
      } catch {
        if (!cancelled) setData(defaultData);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [uid]);

  return { data, loading };
}
