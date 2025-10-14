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
  const [error, setError] = useState<string | null>(null);

  const effectiveTenantSlug = useMemo(() => (tenantSlug || '').toLowerCase(), [tenantSlug]);

  useEffect(() => {
    const resolveTenant = async () => {
      try {
        setLoading(true);
        setError(null);

        if (!effectiveTenantSlug) {
          setError('Missing tenant slug');
          return;
        }

        // If the param looks like a Firestore ID (no dashes and length >= 20), trust it to avoid restricted reads
        const looksLikeId = /^[A-Za-z0-9]{20,}$/.test(effectiveTenantSlug);
        if (looksLikeId) {
          setTenantId(effectiveTenantSlug);
          setTenantName(null); // optional fetch skipped for applicants
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
  }, [effectiveTenantSlug]);

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
    <Box sx={{ px: 0, py: 4 }}>
      <Wizard
        tenantId={tenantId}
        tenantName={tenantName || undefined}
        jobId={jobId}
        uid={user?.uid || null}
      />
    </Box>
  );
};

export default ApplyWizardPage;


