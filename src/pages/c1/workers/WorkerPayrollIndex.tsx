/**
 * Worker payroll entry — `/c1/workers/payroll`
 *
 * Uses `users/{uid}.evereeWorkerIds` (map of Everee tenant id → worker id).
 * If that map is empty, falls back to `tenants/{tenantId}/everee_workers` where
 * `firebaseUid` matches (same linkage as provision; workers may read own rows).
 * 0 → empty state; 1 → redirect to `/c1/workers/payroll/{evereeTenantId}`; 2+ → picker.
 *
 * Eligibility: intersect linkage keys with active `entity_employments` + matching
 * `everee_workers/{entityId}__{uid}` (worker-readable). Stale `evereeWorkerIds` entries with no such hire are hidden.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, CardActionArea, CircularProgress, Stack, Typography } from '@mui/material';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { getWorkerPayrollLanding } from '../../../utils/workerPayrollRouting';
import {
  buildPayrollEligibleEvereeTenantIdSet,
  filterEvereeWorkerMapByEligibleTenants,
} from '../../../utils/workerPayrollEligibility';

function useEvereeEntityLabels(
  tenantId: string | undefined,
  evereeTenantIds: string[],
): { labels: Record<string, string>; loading: boolean } {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId || evereeTenantIds.length === 0) {
      setLabels({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const next: Record<string, string> = {};
      try {
        for (const tid of evereeTenantIds) {
          const q = query(
            collection(db, 'tenants', tenantId, 'entities'),
            where('evereeTenantId', '==', tid),
            limit(3),
          );
          const snap = await getDocs(q);
          const name =
            snap.docs[0]?.data()?.name ||
            snap.docs[0]?.data()?.legalName ||
            snap.docs[0]?.data()?.title ||
            tid;
          next[tid] = typeof name === 'string' && name.trim() ? name.trim() : `Payroll · ${tid}`;
        }
      } catch {
        evereeTenantIds.forEach((tid) => {
          next[tid] = next[tid] || `Payroll · ${tid}`;
        });
      }
      if (!cancelled) {
        setLabels(next);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, evereeTenantIds.join('|')]);

  return { labels, loading };
}

const WorkerPayrollIndex: React.FC = () => {
  const { user, tenantId, tenantIds } = useAuth();
  const navigate = useNavigate();
  const uid = user?.uid;
  const scopeTenantId = tenantId || tenantIds[0];
  const [map, setMap] = useState<Record<string, string> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** When `users.evereeWorkerIds` is empty, linkage docs are readable by the worker (rules) and backfill routing. */
  const [linkageMap, setLinkageMap] = useState<Record<string, string> | null>(null);
  const [linkageLoading, setLinkageLoading] = useState(false);
  /** `undefined` = not computed yet; filtered by active entity employment + Everee entity. */
  const [payrollMapEligible, setPayrollMapEligible] = useState<Record<string, string> | undefined>(undefined);

  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        const m = (snap.data()?.evereeWorkerIds ?? null) as Record<string, string> | null;
        setMap(m && typeof m === 'object' ? m : {});
        setLoadError(null);
      },
      (err) => setLoadError(err.message || 'Failed to load profile'),
    );
    return () => unsub();
  }, [uid]);

  useEffect(() => {
    if (!uid || !scopeTenantId || map === null) return;
    const userHasKeys = Object.keys(map).some((k) => String(map[k] ?? '').trim());
    if (userHasKeys) {
      setLinkageMap(null);
      setLinkageLoading(false);
      return;
    }
    let cancelled = false;
    setLinkageLoading(true);
    void (async () => {
      try {
        const q = query(
          collection(db, 'tenants', scopeTenantId, 'everee_workers'),
          where('firebaseUid', '==', uid),
        );
        const snap = await getDocs(q);
        const acc: Record<string, string> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as {
            evereeTenantId?: string | number;
            evereeWorkerId?: string;
            externalWorkerId?: string;
          };
          const tidRaw = data.evereeTenantId;
          const tid =
            typeof tidRaw === 'number' && Number.isFinite(tidRaw)
              ? String(tidRaw)
              : typeof tidRaw === 'string'
                ? tidRaw.trim()
                : '';
          const wid = String(data.evereeWorkerId || data.externalWorkerId || '').trim();
          if (tid && wid) acc[tid] = wid;
        });
        if (!cancelled) {
          setLinkageMap(acc);
          setLinkageLoading(false);
        }
      } catch {
        if (!cancelled) {
          setLinkageMap({});
          setLinkageLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, scopeTenantId, map]);

  const effectiveMap = useMemo(() => {
    if (map === null) return null;
    return { ...(linkageMap ?? {}), ...map };
  }, [map, linkageMap]);

  useEffect(() => {
    if (!uid || effectiveMap === null) return;
    if (!scopeTenantId) {
      setPayrollMapEligible({});
      return;
    }
    const entries = Object.entries(effectiveMap).filter(([k, v]) => k && String(v ?? '').trim());
    if (entries.length === 0) {
      setPayrollMapEligible({});
      return;
    }
    let cancelled = false;
    setPayrollMapEligible(undefined);
    void (async () => {
      try {
        const allowed = await buildPayrollEligibleEvereeTenantIdSet(db, scopeTenantId, uid);
        if (cancelled) return;
        setPayrollMapEligible(filterEvereeWorkerMapByEligibleTenants(effectiveMap, allowed));
      } catch {
        if (!cancelled) setPayrollMapEligible({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scopeTenantId, uid, effectiveMap]);

  const eligibilityLoading =
    !!scopeTenantId &&
    !!uid &&
    effectiveMap !== null &&
    Object.keys(effectiveMap).some((k) => String(effectiveMap[k] ?? '').trim()) &&
    payrollMapEligible === undefined;

  const routingMap = payrollMapEligible !== undefined ? payrollMapEligible : effectiveMap ?? {};

  const landing = useMemo(() => getWorkerPayrollLanding(eligibilityLoading ? {} : routingMap), [
    routingMap,
    eligibilityLoading,
  ]);

  const waitForLinkage =
    !!scopeTenantId &&
    map !== null &&
    Object.keys(map).every((k) => !String(map[k] ?? '').trim()) &&
    linkageLoading;

  const idsForLabels =
    landing.kind === 'picker' ? landing.evereeTenantIds : landing.kind === 'redirect' ? [landing.evereeTenantId] : [];
  const { labels, loading: labelsLoading } = useEvereeEntityLabels(scopeTenantId, idsForLabels);

  useEffect(() => {
    if (landing.kind === 'redirect') {
      navigate(`/c1/workers/payroll/${encodeURIComponent(landing.evereeTenantId)}`, { replace: true });
    }
  }, [landing, navigate]);

  if (!uid) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>Sign in to view payroll.</Typography>
      </Box>
    );
  }

  if (map === null || waitForLinkage || eligibilityLoading || loadError) {
    return (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
        {loadError ? (
          <Typography color="error">{loadError}</Typography>
        ) : (
          <CircularProgress />
        )}
      </Box>
    );
  }

  if (landing.kind === 'redirect') {
    return (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (landing.kind === 'empty') {
    return (
      <Box sx={{ p: 3, maxWidth: 560 }}>
        <Typography variant="h6" gutterBottom>
          Payroll
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          No payroll account yet — contact your recruiter if you were expecting access.
        </Typography>
        <Button variant="outlined" onClick={() => navigate('/c1/workers/dashboard')}>
          Back to dashboard
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, maxWidth: 720 }}>
      <Typography variant="h6" gutterBottom>
        Payroll
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Choose your employer to open payroll onboarding or your portal.
      </Typography>
      {labelsLoading ? (
        <CircularProgress size={28} />
      ) : (
        <Stack spacing={1.5}>
          {landing.evereeTenantIds.map((tid) => (
            <Card key={tid} variant="outlined">
              <CardActionArea
                onClick={() => navigate(`/c1/workers/payroll/${encodeURIComponent(tid)}`)}
                sx={{ p: 2, alignItems: 'flex-start' }}
              >
                <Typography variant="subtitle1" fontWeight={600}>
                  {labels[tid] || `Payroll · ${tid}`}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  Everee tenant {tid}
                </Typography>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      )}
    </Box>
  );
};

export default WorkerPayrollIndex;
