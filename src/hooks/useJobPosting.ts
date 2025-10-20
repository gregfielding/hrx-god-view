import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firebase';

export function useJobPosting(tenantId?: string, jobId?: string) {
  const [job, setJob] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(!!(tenantId && jobId));

  useEffect(() => {
    if (!tenantId || !jobId) return;
    setLoading(true);
    const ref = doc(db, 'tenants', tenantId, 'job_postings', jobId);
    const unsub = onSnapshot(ref, (snap) => {
      setJob(snap.exists() ? snap.data() : null);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [tenantId, jobId]);

  return { job, loading };
}


