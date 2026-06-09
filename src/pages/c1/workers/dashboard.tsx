/**
 * Worker Dashboard — /c1/workers/dashboard
 * Action items from buildWorkerDashboardActionItems; optional upcoming assignments; minimal bottom nav.
 */

import React, { useCallback, useState, useEffect, useMemo } from 'react';
import { doc, getDoc, collection, query, where, getDocs, limit } from 'firebase/firestore';
import {
  Box,
  CircularProgress,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useNavigate } from 'react-router-dom';

import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import WorkerQuickNav from '../../../components/worker/WorkerQuickNav';
import WorkerDashboardActionItems from '../../../components/worker/home/WorkerDashboardActionItems';
import type { UpcomingShift } from '../../../components/worker/dashboard/WorkerDashboardHero';
import { buildWorkerDashboardActionItems } from '../../../utils/workerDashboardActionItems';
import { useWorkerAiPrescreenSurfaceSignals } from '../../../hooks/useWorkerAiPrescreenSurfaceSignals';
import { deriveWorkerComplianceSignals } from '../../../utils/workerComplianceActionDerivers';
import {
  assignmentDocNeedsWorkerConfirmation,
  readTempworksOnboardingFromUserDoc,
  type WorkerDashboardJobSignals,
} from '../../../utils/workerJobRequirementSignals';
import {
  applyClientOnlyWorkerDashboardActionItemPersonalization,
  useWorkerDashboardActionItemsV1,
  workerDashboardActionItemsV1ToLegacy,
} from '../../../hooks/useWorkerDashboardActionItemsV1';
import { getLanguage, useT } from '../../../i18n';

const C1_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';

/**
 * Feature flag for the V2 server-written snapshot
 * (`users/{uid}.workerDashboardActionItemsV1`). When `true`, the dashboard
 * reads the snapshot via `useWorkerDashboardActionItemsV1`. When `false` (or
 * the snapshot is missing for this worker — no recompute has run yet), the
 * dashboard falls back to the legacy in-memory builder.
 *
 * See `docs/WORKER_ACTION_ITEMS_V2_CURSOR_BRIEF.md` §3 for the rollout plan.
 */
const WORKER_DASHBOARD_ACTION_ITEMS_V2_ENABLED =
  process.env.REACT_APP_WORKER_DASHBOARD_ACTION_ITEMS_V2 === 'true';

function toStartAt(data: Record<string, unknown>): number {
  const startDate = data.startDate;
  const startTime = (data.startTime as string) || '00:00';
  if (!startDate) return 0;
  const dateStr =
    typeof startDate === 'string'
      ? startDate
      : (startDate as { toDate?: () => Date })?.toDate?.()?.toISOString?.()?.slice(0, 10) ?? '';
  if (!dateStr) return 0;
  const iso = `${dateStr}T${String(startTime).slice(0, 5)}:00`;
  return new Date(iso).getTime();
}

function looksLikeDocId(s: unknown): boolean {
  if (typeof s !== 'string' || !s) return false;
  const t = s.trim();
  return t.length >= 15 && t.length <= 30 && /^[a-zA-Z0-9_-]+$/.test(t);
}

const localeForLanguage = (lang: string) => (lang === 'es' ? 'es' : 'en-US');

function assignmentToUpcomingShift(
  docId: string,
  data: Record<string, unknown>,
  resolvedLocationName?: string | null,
  locale = 'en-US'
): UpcomingShift & { payRate?: number } {
  const startAt = toStartAt(data);
  const start = new Date(startAt);
  const jobTitle = (data.jobTitle as string) || 'Assignment';
  const rawSite = (data.locationNickname as string) || (data.worksiteName as string);
  const siteName =
    resolvedLocationName ||
    (rawSite && !looksLikeDocId(rawSite) ? rawSite : undefined);
  const rawCompany = data.companyName as string | undefined;
  const clientName =
    rawCompany && !looksLikeDocId(rawCompany) ? rawCompany : undefined;
  const worksiteAddress = data.worksiteAddress as { city?: string; state?: string; street?: string } | undefined;
  const cityState =
    worksiteAddress?.city && worksiteAddress?.state
      ? `${worksiteAddress.city}, ${worksiteAddress.state}`
      : undefined;
  const rawLocation = (data.worksiteName as string) || (data.locationNickname as string);
  const addressShort =
    cityState ||
    (rawLocation && !looksLikeDocId(rawLocation) ? rawLocation : undefined);
  const payRate = typeof data.payRate === 'number' ? data.payRate : undefined;
  return {
    jobTitle,
    siteName,
    clientName,
    day: start.toLocaleDateString(locale, { weekday: 'short' }),
    date: start.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }),
    time: start.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true }),
    addressShort: addressShort || undefined,
    locationCity: addressShort || undefined,
    assignmentId: docId,
    payRate,
  };
}

const WorkerDashboard: React.FC = () => {
  const { user, activeTenant, avatarUrl } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const locale = localeForLanguage(getLanguage());
  const [userDoc, setUserDoc] = useState<Record<string, unknown> | null>(null);
  const [upcomingAssignments, setUpcomingAssignments] = useState<(UpcomingShift & { payRate?: number })[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(true);
  const [smsSnoozeTick, setSmsSnoozeTick] = useState(0);
  const [jobContextTick, setJobContextTick] = useState(0);
  const [jobSignals, setJobSignals] = useState<WorkerDashboardJobSignals | null>(null);
  const tenantId = activeTenant?.id ?? C1_TENANT_ID;

  const { workerAiPrescreenItems, refreshPrescreenSignals } = useWorkerAiPrescreenSurfaceSignals(
    tenantId,
    user?.uid ?? null,
  );

  useEffect(() => {
    if (!user?.uid) return;
    void getDoc(doc(db, 'users', user.uid)).then((snap) => {
      setUserDoc(snap.exists() ? (snap.data() as Record<string, unknown>) : null);
    });
  }, [user?.uid]);

  const refreshAfterDashboardAction = useCallback(() => {
    setSmsSnoozeTick((n) => n + 1);
    setJobContextTick((n) => n + 1);
    refreshPrescreenSignals();
    if (!user?.uid) return;
    void getDoc(doc(db, 'users', user.uid)).then((snap) => {
      setUserDoc(snap.exists() ? (snap.data() as Record<string, unknown>) : null);
    });
  }, [user?.uid, refreshPrescreenSignals]);

  const smsSnoozedUntilMs = useMemo(() => {
    if (!user?.uid) return 0;
    try {
      const raw = window.localStorage.getItem(`worker_sms_warning_dismiss_until_${user.uid}`);
      const n = raw ? Number(raw) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }, [user?.uid, smsSnoozeTick]);

  useEffect(() => {
    if (!user?.uid || !tenantId) {
      setJobSignals(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');
        const aq = query(assignmentsRef, where('userId', '==', user.uid));
        const snap = await getDocs(aq);
        const pending: Array<{ assignmentId: string; startAtMs: number }> = [];
        snap.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          if (assignmentDocNeedsWorkerConfirmation(data)) {
            pending.push({ assignmentId: d.id, startAtMs: toStartAt(data) });
          }
        });
        let bgRows: Record<string, unknown>[] = [];
        let evRows: Record<string, unknown>[] = [];
        try {
          const [bgSnap, evSnap] = await Promise.all([
            getDocs(
              query(
                collection(db, 'backgroundChecks'),
                where('candidateId', '==', user.uid),
                where('tenantId', '==', tenantId),
                limit(25)
              )
            ),
            getDocs(
              query(
                collection(db, 'tenants', tenantId, 'everify_cases'),
                where('userId', '==', user.uid),
                limit(25)
              )
            ),
          ]);
          bgRows = bgSnap.docs.map((d) => d.data() as Record<string, unknown>);
          evRows = evSnap.docs.map((d) => d.data() as Record<string, unknown>);
        } catch (complianceErr) {
          console.warn('Dashboard: compliance queries skipped', complianceErr);
        }
        if (cancelled) return;
        setJobSignals({
          tenantId,
          pendingAssignmentConfirmations: pending,
          tempworks: readTempworksOnboardingFromUserDoc(userDoc),
          compliance: deriveWorkerComplianceSignals(bgRows, evRows),
        });
      } catch (err) {
        console.error('Failed to load dashboard job signals:', err);
        if (!cancelled) setJobSignals(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, tenantId, jobContextTick, userDoc]);

  const v1Snapshot = useWorkerDashboardActionItemsV1(
    WORKER_DASHBOARD_ACTION_ITEMS_V2_ENABLED ? user?.uid ?? null : null,
  );

  const legacyActionItems = useMemo(
    () =>
      buildWorkerDashboardActionItems({
        userDoc,
        authAvatarUrl: avatarUrl || user?.photoURL || null,
        smsSnoozedUntilMs,
        jobSignals,
        workerAiPrescreenItems,
      }),
    [userDoc, avatarUrl, user?.photoURL, smsSnoozedUntilMs, jobSignals, workerAiPrescreenItems]
  );

  /**
   * Server snapshot when present, legacy builder otherwise. The fallback
   * matters during rollout — the user-doc trigger only runs the first time
   * a worker's user doc is touched after the deploy, so workers who
   * haven't been written to recently won't have a snapshot for a few
   * minutes / hours / days. We prefer "show legacy" over "show empty".
   */
  const dashboardActionItems = useMemo(() => {
    if (WORKER_DASHBOARD_ACTION_ITEMS_V2_ENABLED && v1Snapshot.items && user?.uid) {
      const personalised = applyClientOnlyWorkerDashboardActionItemPersonalization(
        v1Snapshot.items,
        { uid: user.uid },
      );
      // eslint-disable-next-line no-console
      console.debug('[WorkerDashboardActionItemsV2]', {
        uid: user.uid,
        source: 'snapshot',
        itemCount: personalised.length,
        rawCount: v1Snapshot.items.length,
        inputsHash: v1Snapshot.inputsHash,
        updatedAt: v1Snapshot.updatedAt?.toISOString?.() ?? null,
      });
      return workerDashboardActionItemsV1ToLegacy(personalised);
    }
    if (WORKER_DASHBOARD_ACTION_ITEMS_V2_ENABLED && user?.uid) {
      // eslint-disable-next-line no-console
      console.debug('[WorkerDashboardActionItemsV2]', {
        uid: user.uid,
        source: v1Snapshot.loading ? 'loading_fallback' : 'fallback',
        itemCount: legacyActionItems.length,
      });
    }
    return legacyActionItems;
  }, [
    legacyActionItems,
    user?.uid,
    v1Snapshot.items,
    v1Snapshot.inputsHash,
    v1Snapshot.updatedAt,
    v1Snapshot.loading,
  ]);

  useEffect(() => {
    if (!user?.uid || !tenantId) {
      setUpcomingAssignments([]);
      setAssignmentsLoading(false);
      return;
    }
    let cancelled = false;
    setAssignmentsLoading(true);
    const load = async () => {
      try {
        const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');
        const q = query(assignmentsRef, where('userId', '==', user.uid));
        const snap = await getDocs(q);
        if (cancelled) return;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayMs = todayStart.getTime();
        const upcoming: Array<{ id: string; data: Record<string, unknown>; startAt: number }> = [];
        snap.docs.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          const status = String(data.status || '').toLowerCase();
          if (['cancelled', 'canceled', 'declined', 'completed'].includes(status)) return;
          const startAt = toStartAt(data);
          if (startAt < todayMs) return;
          upcoming.push({ id: d.id, data, startAt });
        });
        upcoming.sort((a, b) => a.startAt - b.startAt);
        const shifts = upcoming.map(({ id, data }) => assignmentToUpcomingShift(id, data, null, locale));
        if (!cancelled) setUpcomingAssignments(shifts);
      } catch (err) {
        console.error('Failed to load upcoming assignments for dashboard:', err);
        if (!cancelled) setUpcomingAssignments([]);
      } finally {
        if (!cancelled) setAssignmentsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, tenantId, locale]);

  const showBottomNav = dashboardActionItems.length > 0;

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', px: { xs: 2, sm: 3 }, pb: 4 }}>
      <Stack spacing={{ xs: 3, sm: 3.5 }} sx={{ pt: { xs: 2, sm: 2.5 } }}>
        {user?.uid ? (
          <WorkerDashboardActionItems
            uid={user.uid}
            items={dashboardActionItems}
            onAfterFirestoreChange={refreshAfterDashboardAction}
            onNavigate={(path) => navigate(path)}
          />
        ) : null}

        {!assignmentsLoading && upcomingAssignments.length > 0 ? (
          <Box component="section" aria-label={t('dashboard.upcomingAssignments.title')}>
            <Typography
              variant="h5"
              component="h2"
              sx={{ fontWeight: 700, letterSpacing: -0.02, mb: 1.5 }}
            >
              {t('dashboard.upcomingAssignments.title')}
            </Typography>
            <List
              disablePadding
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                bgcolor: 'background.paper',
                overflow: 'hidden',
              }}
            >
              {upcomingAssignments.map((row, index) => (
                <React.Fragment key={row.assignmentId}>
                  {index > 0 ? <Divider component="li" /> : null}
                  <ListItemButton
                    onClick={() => navigate(`/c1/workers/assignments/${row.assignmentId}`)}
                    alignItems="center"
                    sx={{ py: 1.75, px: 2, gap: 1.5 }}
                  >
                    <ListItemText
                      primary={row.jobTitle}
                      secondary={`${row.day}, ${row.date} · ${row.time}${row.siteName ? ` · ${row.siteName}` : ''}`}
                      primaryTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
                      secondaryTypographyProps={{ variant: 'body2', color: 'text.secondary' }}
                    />
                    {/* Arrow affordance (decorative — the whole row navigates). */}
                    <Box
                      aria-hidden
                      sx={{
                        flexShrink: 0,
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: 'primary.main',
                        color: '#fff',
                      }}
                    >
                      <ArrowForwardIcon fontSize="small" />
                    </Box>
                  </ListItemButton>
                </React.Fragment>
              ))}
            </List>
          </Box>
        ) : assignmentsLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={28} />
          </Box>
        ) : null}

        {showBottomNav ? (
          <Box sx={{ pt: 1 }}>
            <WorkerQuickNav />
          </Box>
        ) : null}
      </Stack>
    </Box>
  );
};

export default WorkerDashboard;
