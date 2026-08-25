/**
 * Worker Dashboard — /c1/workers/dashboard
 * Action items from the server snapshot (users/{uid}.workerDashboardActionItemsV1
 * — the legacy in-browser builder was deleted 2026-08-24 once the snapshot
 * pipeline reached parity); optional upcoming assignments; minimal bottom nav.
 */

import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react';
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
import WorkerDashboardActionItems from '../../../components/worker/home/WorkerDashboardActionItems';
import type { UpcomingShift } from '../../../components/worker/dashboard/WorkerDashboardHero';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  applyClientOnlyWorkerDashboardActionItemPersonalization,
  useWorkerDashboardActionItemsV1,
  workerDashboardActionItemsV1ToLegacy,
} from '../../../hooks/useWorkerDashboardActionItemsV1';
import { getLanguage, useT } from '../../../i18n';

const C1_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';

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

/** Shift end (ms). Falls back to endDate→startDate and endTime→startTime→23:59. */
function toEndAt(data: Record<string, unknown>): number {
  const endDate = data.endDate ?? data.startDate;
  const endTime = (data.endTime as string) || (data.startTime as string) || '23:59';
  if (!endDate) return 0;
  const dateStr =
    typeof endDate === 'string'
      ? endDate
      : (endDate as { toDate?: () => Date })?.toDate?.()?.toISOString?.()?.slice(0, 10) ?? '';
  if (!dateStr) return 0;
  const iso = `${dateStr}T${String(endTime).slice(0, 5)}:00`;
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
  const tenantId = activeTenant?.id ?? C1_TENANT_ID;

  useEffect(() => {
    if (!user?.uid) return;
    void getDoc(doc(db, 'users', user.uid)).then((snap) => {
      setUserDoc(snap.exists() ? (snap.data() as Record<string, unknown>) : null);
    });
  }, [user?.uid]);

  /** Post-action refresh — item mutations write the users doc, which the
   *  server trigger turns into a fresh snapshot; the doc listener delivers
   *  it. Only the local userDoc copy needs a re-read here. */
  const refreshAfterDashboardAction = useCallback(() => {
    if (!user?.uid) return;
    void getDoc(doc(db, 'users', user.uid)).then((snap) => {
      setUserDoc(snap.exists() ? (snap.data() as Record<string, unknown>) : null);
    });
  }, [user?.uid]);


  const v1Snapshot = useWorkerDashboardActionItemsV1(user?.uid ?? null);

  // Snapshot is the ONLY pipeline (legacy builder deleted 2026-08-24).
  // A worker untouched since the rollout has no snapshot doc yet — ask the
  // server for a one-shot recompute; the doc listener delivers the result.
  const recomputeRequestedRef = useRef(false);
  useEffect(() => {
    if (recomputeRequestedRef.current) return;
    if (!user?.uid || !tenantId) return;
    if (v1Snapshot.loading || v1Snapshot.items !== null) return;
    recomputeRequestedRef.current = true;
    const fn = httpsCallable(getFunctions(), 'syncWorkerDashboardActionItemsV1');
    void fn({ uid: user.uid, tenantId }).catch(() => {
      /* next users-doc write triggers the sync anyway */
    });
  }, [user?.uid, tenantId, v1Snapshot.loading, v1Snapshot.items]);

  const dashboardActionItems = useMemo(() => {
    if (!user?.uid || !v1Snapshot.items) return [];
    const personalised = applyClientOnlyWorkerDashboardActionItemPersonalization(
      v1Snapshot.items,
      { uid: user.uid },
    );
    return workerDashboardActionItemsV1ToLegacy(personalised);
  }, [user?.uid, v1Snapshot.items, v1Snapshot.inputsHash]);

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
    <Box sx={{ maxWidth: 720, mx: 'auto', pb: 4 }}>
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
              sx={{ mb: 1.5 }}
            >
              {t('dashboard.upcomingAssignments.title')}
            </Typography>
            <List
              disablePadding
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                
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
          </Box>
        ) : null}
      </Stack>
    </Box>
  );
};

export default WorkerDashboard;
