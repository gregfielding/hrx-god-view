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
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Chip, Divider } from '@mui/material';
import { useAuth } from '../../../contexts/AuthContext';
import { getWorkerPayrollLanding } from '../../../utils/workerPayrollRouting';
import {
  buildPayrollEligibleEvereeTenantIdSet,
  filterEvereeWorkerMapByEligibleTenants,
} from '../../../utils/workerPayrollEligibility';
import {
  payrollEntityDescription,
  resolvePayrollWorkerKind,
  type PayrollWorkerKind,
} from '../../../utils/payrollEntityDisplay';

interface EvereeEntityInfo {
  label: string;
  kind: PayrollWorkerKind;
  /** HRX entity id (e.g. c1_select_llc) — needed for evereeGetPayHistory. */
  entityId?: string;
}

interface PayHistoryRow {
  statementId: string;
  payDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  gross: number | null;
  status: string | null;
  employerLabel: string;
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/**
 * Native pay history (Earnings v1, Greg 2026-08-24): merges
 * evereeGetPayHistory across the worker's employers. The callable already
 * allows self-access (canSelfOrManageEveree) — no new server surface.
 */
function useWorkerPayHistory(
  tenantId: string | undefined,
  infos: Record<string, EvereeEntityInfo>,
): { rows: PayHistoryRow[]; loading: boolean } {
  const [rows, setRows] = useState<PayHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  const key = Object.entries(infos)
    .map(([tid, i]) => `${tid}:${i.entityId ?? ''}`)
    .sort()
    .join('|');

  useEffect(() => {
    const entries = Object.values(infos).filter((i) => i.entityId);
    if (!tenantId || entries.length === 0) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const merged: PayHistoryRow[] = [];
      await Promise.all(
        entries.map(async (info) => {
          try {
            const fn = httpsCallable(getFunctions(), 'evereeGetPayHistory');
            const res = await fn({ tenantId, entityId: info.entityId });
            const items = ((res.data as { items?: Array<Record<string, unknown>> })?.items ?? []).slice(0, 12);
            for (const it of items) {
              merged.push({
                statementId: String(it.statementId || ''),
                payDate: (it.payDate as string) ?? null,
                periodStart: (it.periodStart as string) ?? null,
                periodEnd: (it.periodEnd as string) ?? null,
                gross: typeof it.gross === 'number' ? it.gross : null,
                status: (it.status as string) ?? null,
                employerLabel: info.label,
              });
            }
          } catch {
            /* pay history is a convenience — employer card still works */
          }
        }),
      );
      if (cancelled) return;
      merged.sort((a, b) => String(b.payDate ?? '').localeCompare(String(a.payDate ?? '')));
      setRows(merged.slice(0, 10));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, key]);

  return { rows, loading };
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

  const idsForLabels =
    landing.kind === 'picker' ? landing.evereeTenantIds : landing.kind === 'redirect' ? [landing.evereeTenantId] : [];
  const { infos, loading: labelsLoading } = useEvereeEntityInfos(scopeTenantId, idsForLabels);
  const { rows: payRows, loading: payLoading } = useWorkerPayHistory(scopeTenantId, infos);

  useEffect(() => {
    if (landing.kind === 'redirect') {
      navigate(`/c1/workers/earnings/${encodeURIComponent(landing.evereeTenantId)}`, { replace: true });
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
      {labelsLoading ? (
        <CircularProgress size={28} />
      ) : (
        <Stack spacing={1.5}>
          {landing.evereeTenantIds.map((tid) => {
            const info = infos[tid];
            const label = info?.label ?? `Payroll · ${tid}`;
            const description = info ? payrollEntityDescription(info.kind) : null;
            return (
              <Card key={tid} variant="outlined">
                <CardActionArea
                  onClick={() => navigate(`/c1/workers/earnings/${encodeURIComponent(tid)}`)}
                  sx={{ p: 2, alignItems: 'flex-start' }}
                >
                  <Typography variant="subtitle1">
                    {label}
                  </Typography>
                  {description ? (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {description}
                    </Typography>
                  ) : null}
                </CardActionArea>
              </Card>
            );
          })}
        </Stack>
      )}
      {/* Native pay history (Earnings v1, 2026-08-24). */}
      {(payLoading || payRows.length > 0) && (
        <Box sx={{ mt: 3 }}>
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
                    sx={{ px: 2, py: 1.5 }}
                    spacing={1}
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
        </Box>
      )}

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
