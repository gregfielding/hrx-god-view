/**
 * Worker Dashboard — /c1/workers/dashboard
 * Mobile-first smart-card landing: one context-aware card rail + compact quick-nav.
 * Priority: upcoming assignment → action-needed application → applications → profile → jobs.
 * Routes and data structures preserved.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { doc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { Box, Stack, Typography, CircularProgress } from '@mui/material';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useOnboarding } from '../../../hooks/useOnboarding';
import WorkerDashboardSmsToggle from '../../../components/worker/dashboard/WorkerDashboardSmsToggle';
import WorkerDashboardCardRail from '../../../components/worker/dashboard/WorkerDashboardCardRail';
import WorkerDashboardQuickActions from '../../../components/worker/dashboard/WorkerDashboardQuickActions';
import type { DashboardCardPayload } from '../../../components/worker/dashboard/cards';
import type { UpcomingShift } from '../../../components/worker/dashboard/WorkerDashboardHero';
import { UserApplicationsService } from '../../../services/userApplicationsService';
import type { UserApplication } from '../../../services/userApplicationsService';
import { JobsBoardService } from '../../../services/recruiter/jobsBoardService';
import type { JobsBoardPost } from '../../../services/recruiter/jobsBoardService';
import { getCategoryForTitle } from '../../../utils/dashboardCardCategory';
import { useT, getLanguage } from '../../../i18n';

const C1_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';
const MAX_APPLICATION_CARDS = 5;
const MAX_JOB_CARDS = 5;

/** Statuses that require worker action (Accept/Decline) */
const APPLICATION_NEEDS_RESPONSE = ['offer_extended', 'offer_pending', 'offer', 'hired_pending'];

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
  const { user, activeTenant } = useAuth();
  const t = useT();
  const locale = localeForLanguage(getLanguage());
  const [userDoc, setUserDoc] = useState<Record<string, unknown> | null>(null);
  const [nextShift, setNextShift] = useState<(UpcomingShift & { payRate?: number }) | null>(null);
  const [applications, setApplications] = useState<UserApplication[]>([]);
  const [jobs, setJobs] = useState<JobsBoardPost[]>([]);
  const [cardsLoading, setCardsLoading] = useState(true);
  const { checklist, summary: complianceSummary, hasOnboarding } = useOnboarding(user?.uid);
  const tenantId = activeTenant?.id ?? C1_TENANT_ID;

  const firstName =
    (userDoc?.firstName as string) ||
    user?.displayName?.split(' ')[0] ||
    'there';
  const displayFirstName =
    firstName === 'there' ? firstName : firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();

  const profileIncomplete =
    hasOnboarding &&
    (complianceSummary.compliancePercent < 100 || complianceSummary.overallStatus !== 'compliant');

  useEffect(() => {
    if (!user?.uid) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      setUserDoc(snap.exists() ? (snap.data() as Record<string, unknown>) : null);
    });
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || !tenantId) {
      setNextShift(null);
      return;
    }
    let cancelled = false;
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
        const first = upcoming[0];
        if (first) {
          let resolvedLocationName: string | null = null;
          const locationId = first.data.locationId as string | undefined;
          const rawSite = (first.data.locationNickname as string) || (first.data.worksiteName as string);
          if (
            locationId &&
            typeof locationId === 'string' &&
            (looksLikeDocId(rawSite) || !rawSite)
          ) {
            try {
              const locSnap = await getDoc(doc(db, 'tenants', tenantId, 'locations', locationId));
              if (locSnap.exists()) {
                const loc = locSnap.data() as Record<string, unknown>;
                const name = (loc.nickname || loc.title || loc.name || loc.locationName) as string | undefined;
                if (name && !looksLikeDocId(name)) resolvedLocationName = name;
              }
            } catch (_) {
              // ignore
            }
          }
          setNextShift(assignmentToUpcomingShift(first.id, first.data, resolvedLocationName, locale));
        } else {
          setNextShift(null);
        }
      } catch (err) {
        console.error('Failed to load next shift for dashboard:', err);
        if (!cancelled) setNextShift(null);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, tenantId, locale]);

  useEffect(() => {
    if (!user?.uid || !tenantId) {
      setApplications([]);
      setJobs([]);
      setCardsLoading(false);
      return;
    }
    let cancelled = false;
    setCardsLoading(true);
    const appsService = UserApplicationsService.getInstance();
    const jobsService = JobsBoardService.getInstance();
    Promise.all([
      appsService.getUserApplications(user.uid, tenantId),
      jobsService.getPublicPosts(tenantId).then((posts) => posts.filter((p) => p.status === 'active').slice(0, 12)),
    ])
      .then(([apps, posts]) => {
        if (cancelled) return;
        setApplications(apps);
        setJobs(posts);
      })
      .catch((err) => {
        if (!cancelled) {
          setApplications([]);
          setJobs([]);
        }
        console.error('Dashboard cards load error:', err);
      })
      .finally(() => {
        if (!cancelled) setCardsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.uid, tenantId]);

  const smsEnabled =
    userDoc != null &&
    userDoc.smsOptIn !== false &&
    userDoc.smsBlockedSystem !== true;

  const fetchUserDoc = useCallback(() => {
    if (!user?.uid) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      setUserDoc(snap.exists() ? (snap.data() as Record<string, unknown>) : null);
    });
  }, [user?.uid]);

  const handleSmsToggle = useCallback(
    async (enabled: boolean) => {
      if (!user?.uid) return;
      try {
        const updates: Record<string, unknown> = {
          smsOptIn: enabled,
          updatedAt: new Date(),
        };
        if (enabled) {
          updates.smsBlockedSystem = false;
        }
        await updateDoc(doc(db, 'users', user.uid), updates);
        fetchUserDoc();
      } catch (err) {
        console.error('Failed to update SMS preference:', err);
      }
    },
    [user?.uid, fetchUserDoc]
  );

  const cards = useMemo((): DashboardCardPayload[] => {
    const list: DashboardCardPayload[] = [];

    // 1. Upcoming assignment
    if (nextShift) {
      const dateTime = `${nextShift.day}, ${nextShift.date} at ${nextShift.time}`;
      const location = nextShift.addressShort || nextShift.locationCity;
      const viewTo = nextShift.assignmentId
        ? `/c1/workers/assignments/${nextShift.assignmentId}`
        : '/c1/workers/assignments';
      list.push({
        type: 'assignment',
        id: `assignment-${nextShift.assignmentId ?? 'next'}`,
        label: t('dashboard.cardLabelNextShift'),
        jobTitle: nextShift.jobTitle,
        company: nextShift.clientName || nextShift.siteName,
        dateTime,
        location: location || undefined,
        pay: nextShift.payRate,
        status: undefined,
        viewAssignmentTo: viewTo,
        directionsQuery: location || undefined,
      });
    }

    // 2. Action-needed applications first, then other active applications
    const needsResponse = applications.filter((app) =>
      APPLICATION_NEEDS_RESPONSE.includes(String(app.status || '').toLowerCase())
    );
    const otherApps = applications.filter(
      (app) => !APPLICATION_NEEDS_RESPONSE.includes(String(app.status || '').toLowerCase())
    );
    const orderedApps = [...needsResponse, ...otherApps].slice(0, MAX_APPLICATION_CARDS);
    orderedApps.forEach((app) => {
      const jobTitle = app.jobTitle || app.postTitle || 'Job';
      const appliedDateOrStatus = app.appliedAt
        ? new Date(app.appliedAt).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
        : (app.status || '').replace(/_/g, ' ');
      const needsResponse = APPLICATION_NEEDS_RESPONSE.includes(String(app.status || '').toLowerCase());
      list.push({
        type: 'application',
        id: `app-${app.applicationId}`,
        label: t('dashboard.cardLabelApplicationUpdate'),
        jobTitle,
        company: app.companyName,
        location: app.location,
        pay: app.payRate,
        appliedDateOrStatus,
        viewJobTo: `/c1/jobs-board/${app.jobId}`,
        viewApplicationsTo: '/c1/workers/applications',
        needsResponse,
      });
    });

    // 3. Profile completion
    if (profileIncomplete) {
      const suggestedTasks: string[] = [];
      if (complianceSummary.compliancePercent < 100) {
        suggestedTasks.push(t('dashboard.suggestedTaskDocuments'));
        suggestedTasks.push(t('dashboard.suggestedTaskProfile'));
      }
      list.push({
        type: 'profile',
        id: 'profile-completion',
        label: t('dashboard.cardLabelUnlockMoreJobs'),
        readinessPercent: complianceSummary.compliancePercent,
        suggestedTasks,
        continueProfileTo: '/c1/workers/profile',
        seeJobsTo: '/c1/jobs-board',
      });
    }

    // 4. Recommended jobs
    jobs.slice(0, MAX_JOB_CARDS).forEach((post) => {
      const jobTitle = post.jobTitle || post.postTitle || 'Job';
      const location =
        post.worksiteAddress?.city && post.worksiteAddress?.state
          ? `${post.worksiteAddress.city}, ${post.worksiteAddress.state}`
          : post.worksiteName || undefined;
      const dateTime = post.nextShiftDate
        ? new Date(post.nextShiftDate).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
        : undefined;
      const spotsLeft =
        post.workersNeeded != null && post.applicationCount != null
          ? Math.max(0, post.workersNeeded - post.applicationCount)
          : undefined;
      list.push({
        type: 'job',
        id: `job-${post.id}`,
        label: t('dashboard.cardLabelNewJobNearYou'),
        jobTitle,
        company: post.companyName,
        dateTime,
        location,
        pay: post.payRate,
        spotsLeft: spotsLeft !== undefined && spotsLeft > 0 ? spotsLeft : undefined,
        viewJobTo: `/c1/jobs-board/${post.id}`,
        applyTo: `/c1/jobs-board/${post.id}`,
        category: getCategoryForTitle(jobTitle),
      });
    });

    return list;
  }, [
    nextShift,
    applications,
    jobs,
    profileIncomplete,
    complianceSummary.compliancePercent,
    t,
    locale,
  ]);

  return (
    <Box sx={{ maxWidth: 'lg', mx: 'auto' }}>
      <Stack spacing={3} sx={{ py: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {t('dashboard.welcomeBack', { firstName: displayFirstName })}
          </Typography>
        </Box>

        <WorkerDashboardSmsToggle
          smsEnabled={smsEnabled}
          onToggle={handleSmsToggle}
          disabled={!user?.uid}
        />

        {cardsLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <WorkerDashboardCardRail cards={cards} />
        )}

        <WorkerDashboardQuickActions />
      </Stack>
    </Box>
  );
};

export default WorkerDashboard;
