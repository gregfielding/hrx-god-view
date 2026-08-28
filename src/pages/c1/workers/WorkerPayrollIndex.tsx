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

import { t } from '../../../i18n';
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
import { Chip, Divider } from '@mui/material';
import {
  USD,
  useWorkerEmployerLinkages,
  useWorkerPayHistory,
} from '../../../hooks/useWorkerPayHistory';
import { useAuth } from '../../../contexts/AuthContext';
import { getWorkerPayrollLanding } from '../../../utils/workerPayrollRouting';
import {
  buildPayrollEligibleEvereeTenantIdSet,
  filterEvereeWorkerMapByEligibleTenants,
} from '../../../utils/workerPayrollEligibility';
import {
  resolvePayrollWorkerKind,
  type PayrollWorkerKind,
} from '../../../utils/payrollEntityDisplay';
import PaymentIssueBanner from '../../../components/worker/PaymentIssueBanner';

interface EvereeEntityInfo {
  label: string;
  kind: PayrollWorkerKind;
  /** HRX entity id (e.g. c1_select_llc) — needed for evereeGetPayHistory. */
  entityId?: string;
}

function useEvereeEntityInfos(
  tenantId: string | undefined,
  evereeTenantIds: string[],
): { infos: Record<string, EvereeEntityInfo>; loading: boolean } {
  const [infos, setInfos] = useState<Record<string, EvereeEntityInfo>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId || evereeTenantIds.length === 0) {
      setInfos({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const next: Record<string, EvereeEntityInfo> = {};
      try {
        for (const tid of evereeTenantIds) {
          const q = query(
            collection(db, 'tenants', tenantId, 'entities'),
            where('evereeTenantId', '==', tid),
            limit(3),
          );
          const snap = await getDocs(q);
          const top = snap.docs[0];
          const data = (top?.data() ?? {}) as Record<string, unknown>;
          const rawName = (data.name ?? data.legalName ?? data.title) as unknown;
          const label =
            typeof rawName === 'string' && rawName.trim() ? rawName.trim() : `Payroll · ${tid}`;
          const kind = resolvePayrollWorkerKind({
            entityId: top?.id,
            evereeWorkerKind: data.evereeWorkerKind,
            payrollWorkerClassification: data.payrollWorkerClassification,
            workerType: data.workerType,
          });
          next[tid] = { label, kind, entityId: top?.id };
        }
      } catch {
        evereeTenantIds.forEach((tid) => {
          if (!next[tid]) next[tid] = { label: `Payroll · ${tid}`, kind: 'employee' };
        });
      }
      if (!cancelled) {
        setInfos(next);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, evereeTenantIds.join('|')]);

  return { infos, loading };
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

  const idsForLabels = landing.kind === 'picker' ? landing.evereeTenantIds : [];
  const { infos, loading: labelsLoading } = useEvereeEntityInfos(scopeTenantId, idsForLabels);
  const { linkages: payLinkages } = useWorkerEmployerLinkages(scopeTenantId, uid);
  const { rows: payRows, loading: payLoading } = useWorkerPayHistory(scopeTenantId, payLinkages, 10);

  /** Per-Everee-tenant onboarding completeness from the worker-readable
   *  linkage docs — drives the tax-forms-vs-finish-setup card labels
   *  (2026-08-28 Payroll-hub IA). Absent/unknown status → treated as NOT
   *  complete, which shows the safer "Finish payroll setup" label. */
  const [onboardingDoneByTid, setOnboardingDoneByTid] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!uid || !scopeTenantId) return;
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'tenants', scopeTenantId, 'everee_workers'),
            where('firebaseUid', '==', uid),
          ),
        );
        const next: Record<string, boolean> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as { evereeTenantId?: string | number; status?: string };
          const tid =
            typeof data.evereeTenantId === 'number'
              ? String(data.evereeTenantId)
              : String(data.evereeTenantId ?? '').trim();
          if (!tid) return;
          const st = String(data.status ?? '').toLowerCase();
          next[tid] = st === 'onboarding_complete' || st === 'complete' || st === 'completed';
        });
        if (!cancelled) setOnboardingDoneByTid(next);
      } catch {
        /* labels fall back to "Finish payroll setup" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, scopeTenantId]);

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

  if (landing.kind === 'empty') {
    return (
      <Box sx={{ maxWidth: 560 }}>
        <Typography variant="h5" component="h1" gutterBottom>
          {t('nav.payroll')}
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
    <Box>
      <Typography variant="h5" component="h1">
        {t('nav.payroll')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
        {t('earnings.chooseEmployer')}
      </Typography>
      <PaymentIssueBanner rows={payRows} />
      {/* Native pay history (Earnings v1, 2026-08-24; leads the hub since the 2026-08-28 IA). */}
      {(payLoading || payRows.length > 0) && (
        <Box>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            {t('earnings.recentPay')}
          </Typography>
          <Card variant="outlined">
            {payLoading && payRows.length === 0 ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress size={22} />
              </Box>
            ) : (
              <Stack divider={<Divider />}>
                {payRows.map((r) => (
                  <Stack
                    key={r.statementId}
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    sx={{ px: 2, py: 1.5, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                    spacing={1}
                    onClick={() =>
                      navigate(
                        `/c1/workers/pay-history/${encodeURIComponent(r.evereeTenantId)}/${encodeURIComponent(r.statementId)}`,
                      )
                    }
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body1" sx={{ fontWeight: 600 }}>
                        {r.gross != null ? USD.format(r.gross) : '—'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap display="block">
                        {[r.payDate, r.employerLabel].filter(Boolean).join(' · ')}
                      </Typography>
                    </Box>
                    <Chip
                      size="small"
                      label={
                        r.status === 'PAID'
                          ? t('earnings.statusPaid')
                          : r.status === 'ERROR' || r.status === 'RETURNED'
                            ? t('earnings.statusIssue')
                            : t('earnings.statusPending')
                      }
                      color={
                        r.status === 'PAID'
                          ? 'success'
                          : r.status === 'ERROR' || r.status === 'RETURNED'
                            ? 'error'
                            : 'default'
                      }
                      variant={r.status === 'PAID' ? 'filled' : 'outlined'}
                    />
                  </Stack>
                ))}
              </Stack>
            )}
          </Card>
          {payRows.length > 0 && (
            <Button variant="text" onClick={() => navigate('/c1/workers/pay-history')} sx={{ mt: 1, px: 0 }}>
              {t('earnings.viewAll')} →
            </Button>
          )}
        </Box>
      )}

      <Box sx={{ mt: 3 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          {t('earnings.settingsHeading')}
        </Typography>
        <Stack spacing={1.5}>
          <Card variant="outlined">
            <CardActionArea
              onClick={() => navigate('/c1/workers/payroll-settings')}
              sx={{ p: 2, alignItems: 'flex-start' }}
            >
              <Typography variant="subtitle1">{t('profile.sectionDirectDepositTitle')}</Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                {t('profile.sectionDirectDepositDescription')}
              </Typography>
            </CardActionArea>
          </Card>
          {labelsLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            landing.evereeTenantIds.map((tid) => {
              const info = infos[tid];
              // Label follows the worker's state (2026-08-28 Payroll-hub IA):
              // mid-onboarding the embedded step is the blocking setup (SSN +
              // tax forms); once complete it's the tax-forms surface (W-4
              // changes, year-end docs). Entity name stays as the caption.
              const done = onboardingDoneByTid[tid] === true;
              const title = !done
                ? t('earnings.finishSetupCard')
                : info
                  ? t(info.kind === 'contractor' ? 'earnings.contractorTaxForms' : 'earnings.w2TaxForms')
                  : `Payroll · ${tid}`;
              const caption = info?.label ?? null;
              return (
                <Card key={tid} variant="outlined">
                  <CardActionArea
                    onClick={() => navigate(`/c1/workers/earnings/${encodeURIComponent(tid)}`)}
                    sx={{ p: 2, alignItems: 'flex-start' }}
                  >
                    <Typography variant="subtitle1">
                      {title}
                    </Typography>
                    {caption ? (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {caption}
                      </Typography>
                    ) : null}
                  </CardActionArea>
                </Card>
              );
            })
          )}
        </Stack>
      </Box>
      {/* Payroll help desk entry (Slice 1, 2026-08-24). */}
      <Button
        variant="text"
        onClick={() => navigate('/c1/workers/payroll-help')}
        sx={{ mt: 3, px: 0 }}
      >
        {t('payrollHelp.entryTitle')} →
      </Button>
    </Box>
  );
};

export default WorkerPayrollIndex;
