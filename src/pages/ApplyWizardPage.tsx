import React, { useEffect, useMemo, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import Wizard from '../components/apply/Wizard';

type RouteParams = {
  tenantSlug?: string;
  jobId?: string;
};

const ApplyWizardPage: React.FC = () => {
  const { tenantSlug, jobId } = useParams<RouteParams>();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [actualSlug, setActualSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep the raw slug for ID detection (Firestore IDs are case sensitive)
  const rawTenantSlug = tenantSlug || '';
  const effectiveTenantSlug = useMemo(() => rawTenantSlug.toLowerCase(), [rawTenantSlug]);

  useEffect(() => {
    const resolveTenant = async () => {
      try {
        setLoading(true);
        setError(null);

        if (!rawTenantSlug) {
          setError('Missing tenant slug');
          return;
        }

        // If the param looks like a Firestore ID (no dashes and length >= 20),
        // use it AS-IS (case sensitive). Do not lowercase IDs.
        const looksLikeId = /^[A-Za-z0-9]{20,}$/.test(rawTenantSlug);
        if (looksLikeId) {
          setTenantId(rawTenantSlug);
          // Fetch the tenant document to get the actual slug
          const tenantRef = doc(db, 'tenants', rawTenantSlug);
          const tenantSnap = await getDoc(tenantRef);
          if (tenantSnap.exists()) {
            const data = tenantSnap.data() as any;
            setTenantName(data?.name || null);
            setActualSlug(data?.slug || null);
          }
          return;
        }

        // Otherwise, resolve by slug (may require elevated permissions)
        const q = query(collection(db, 'tenants'), where('slug', '==', effectiveTenantSlug), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const docSnap = snap.docs[0];
          setTenantId(docSnap.id);
          const data = docSnap.data() as any;
          setTenantName(data?.name || null);
          setActualSlug(data?.slug || effectiveTenantSlug);
          return;
        }

        setError('Tenant not found');
      } catch (e: any) {
        setError(e?.message || 'Failed to load tenant');
      } finally {
        setLoading(false);
      }
    };
    resolveTenant();
  }, [effectiveTenantSlug, rawTenantSlug]);

  if (loading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" minHeight="40vh">
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (error || !tenantId) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6" fontWeight={700}>Application</Typography>
        <Typography variant="body2" color="error" sx={{ mt: 1 }}>{error || 'Unknown error'}</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ px: 0, py: 0 }}>
      <Wizard
        tenantId={tenantId}
        tenantSlug={actualSlug || rawTenantSlug}
        tenantName={tenantName || undefined}
        jobId={jobId}
        uid={user?.uid || null}
      />
    </Box>
  );
};

export default ApplyWizardPage;


