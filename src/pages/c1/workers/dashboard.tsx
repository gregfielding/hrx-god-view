/**
 * Worker Dashboard — /c1/workers/dashboard
 * Three sections (vertical scroll): 1. Assignment, 2. Recommended jobs, 3. Job Readiness.
 * Horizontal swipe (mobile) or prev/next arrows (web) within each section.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { Box, Stack, Typography, CircularProgress, useTheme, useMediaQuery, Link } from '@mui/material';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useOnboarding } from '../../../hooks/useOnboarding';
import WorkerDashboardCardRail from '../../../components/worker/dashboard/WorkerDashboardCardRail';
import WorkerQuickNav from '../../../components/worker/WorkerQuickNav';
import JobReadinessCompactCard from '../../../components/worker/dashboard/cards/JobReadinessCompactCard';
import type { DashboardCardPayload, JobReadinessCardPayload } from '../../../components/worker/dashboard/cards';
import type { UpcomingShift } from '../../../components/worker/dashboard/WorkerDashboardHero';
import { UserApplicationsService } from '../../../services/userApplicationsService';
import type { UserApplication } from '../../../services/userApplicationsService';
import { JobsBoardService } from '../../../services/recruiter/jobsBoardService';
import type { JobsBoardPost } from '../../../services/recruiter/jobsBoardService';
import { getCategoryForTitle } from '../../../utils/dashboardCardCategory';
import { getImprovementTasks } from '../../../utils/jobReadinessTasks';
import { useT, getLanguage } from '../../../i18n';
import { useNavigate } from 'react-router-dom';

const C1_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';
/** Recommendation deck: exactly 3 job cards + 1 gateway card. */
const RECOMMENDATION_JOB_COUNT = 3;

/** Statuses that require worker action (Accept/Decline) */
const APPLICATION_NEEDS_RESPONSE = ['offer_extended', 'offer_pending', 'offer', 'hired_pending'];

/** Job Readiness: compact when only a few items missing; full deck when significantly incomplete. */
const JOB_READINESS_COMPACT_MAX_ITEMS = 1;

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

/**
 * Rank jobs for recommendation: nearest upcoming, pay rate, urgency (spots remaining), then stable order.
 * Worker location/skills/preferred shifts can be added later when available.
 */
function rankRecommendedJobs(
  posts: JobsBoardPost[],
  _userDoc: Record<string, unknown> | null
): JobsBoardPost[] {
  const now = Date.now();
  return [...posts].sort((a, b) => {
    // Nearest upcoming shift date first
    const aDate = a.nextShiftDate ? new Date(a.nextShiftDate).getTime() : 0;
    const bDate = b.nextShiftDate ? new Date(b.nextShiftDate).getTime() : 0;
    if (aDate && bDate && aDate !== bDate) return aDate - bDate;
    if (aDate && !bDate) return -1;
    if (!aDate && bDate) return 1;

    // Higher pay rate preferred
    const aPay = a.payRate ?? 0;
    const bPay = b.payRate ?? 0;
    if (aPay !== bPay) return bPay - aPay;

    // Urgency: fewer spots remaining = higher priority (optional; use workersNeeded as proxy if no applicationCount)
    const aSpots = a.workersNeeded ?? 0;
    const bSpots = b.workersNeeded ?? 0;
    const aApp = (a as { applicationCount?: number }).applicationCount ?? 0;
    const bApp = (b as { applicationCount?: number }).applicationCount ?? 0;
    const aLeft = Math.max(0, aSpots - aApp);
    const bLeft = Math.max(0, bSpots - bApp);
    if (aLeft !== bLeft) return aLeft - bLeft;

    return 0;
  });
}

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
  const improvementTasks = useMemo(
    () => getImprovementTasks(userDoc, checklist),
    [userDoc, checklist]
  );
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
      jobsService.getPublicPosts(tenantId).then((posts) => posts.filter((p) => p.status === 'active')),
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

  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('sm'));
  const navigate = useNavigate();

  const sections = useMemo(() => {
    // ——— Section 1: Assignment (active job / upcoming assignment or application needing action) ———
    const assignmentCards: DashboardCardPayload[] = [];
    if (nextShift) {
      const dateTime = `${nextShift.day}, ${nextShift.date} at ${nextShift.time}`;
      const location = nextShift.addressShort || nextShift.locationCity;
      const viewTo = nextShift.assignmentId
        ? `/c1/workers/assignments/${nextShift.assignmentId}`
        : '/c1/workers/assignments';
      assignmentCards.push({
        type: 'assignment',
        id: `assignment-${nextShift.assignmentId ?? 'next'}`,
        label: t('dashboard.cardLabelUpcomingShift'),
        jobTitle: nextShift.jobTitle,
        company: nextShift.clientName || nextShift.siteName,
        dateTime,
        location: location || undefined,
        pay: nextShift.payRate,
        status: undefined,
        viewAssignmentTo: viewTo,
        directionsQuery: location || undefined,
      });
    } else {
      const needsResponse = applications.find((app) =>
        APPLICATION_NEEDS_RESPONSE.includes(String(app.status || '').toLowerCase())
      );
      if (needsResponse) {
        const app = needsResponse;
        const jobTitle = app.jobTitle || app.postTitle || 'Job';
        const appliedDateOrStatus = app.appliedAt
          ? new Date(app.appliedAt).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
          : (app.status || '').replace(/_/g, ' ');
        assignmentCards.push({
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
          needsResponse: true,
        });
      }
    }

    // ——— Section 2: Recommended jobs (header + top 3 jobs + gateway) ———
    const ranked = rankRecommendedJobs(jobs, userDoc);
    const topJobs = ranked.slice(0, RECOMMENDATION_JOB_COUNT);
    const jobsSectionHeader = t('dashboard.recommendationHeader', { count: topJobs.length });
    const jobsCards: DashboardCardPayload[] = [];
    for (const post of topJobs) {
      const jobTitle = post.jobTitle || post.postTitle || 'Job';
      const location =
        post.worksiteAddress?.city && post.worksiteAddress?.state
          ? `${post.worksiteAddress.city}, ${post.worksiteAddress.state}`
          : post.worksiteName || undefined;
      const dateTime = post.nextShiftDate
        ? new Date(post.nextShiftDate).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
        : undefined;
      const appCount = (post as { applicationCount?: number }).applicationCount ?? 0;
      const spotsLeft =
        post.workersNeeded != null ? Math.max(0, post.workersNeeded - appCount) : undefined;
      jobsCards.push({
        type: 'job',
        id: `job-${post.id}`,
        label: t('dashboard.cardLabelRecommendedJob'),
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
    }
    jobsCards.push({
      type: 'gateway',
      id: 'gateway-see-all-jobs',
      label: t('dashboard.seeAllJobs'),
      seeJobsTo: '/c1/jobs-board',
    });

    // ——— Section 3: Job Readiness (compact or full) ———
    let jobReadinessPayload: JobReadinessCardPayload | null = null;
    let jobReadinessCompact = true;
    if (profileIncomplete && improvementTasks.length > 0) {
      const blockingCount = improvementTasks.length;
      jobReadinessPayload = {
        type: 'job_readiness',
        id: 'job-readiness-unlock',
        label: t('dashboard.cardLabelUnlockMoreJobs'),
        body: t('dashboard.unlockMoreJobsBody', { count: blockingCount }),
        readinessPercent: complianceSummary.compliancePercent ?? 0,
        blockingCount,
        fixNowTo: '/c1/workers/job-readiness',
      };
      jobReadinessCompact = blockingCount <= JOB_READINESS_COMPACT_MAX_ITEMS;
    }

    return {
      assignmentCards,
      jobsSectionHeader,
      jobsCards,
      jobReadinessPayload,
      jobReadinessCompact,
    };
  }, [
    nextShift,
    applications,
    jobs,
    userDoc,
    profileIncomplete,
    improvementTasks.length,
    complianceSummary.compliancePercent,
    t,
    locale,
  ]);

  return (
    <Box sx={{ maxWidth: 480, mx: 'auto', px: 1 }}>
      <Stack spacing={4} sx={{ py: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          {t('dashboard.welcomeBack', { firstName: displayFirstName })}
        </Typography>

        {cardsLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {/* Section 1: Active job / upcoming assignment */}
            <Stack spacing={1.5}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('dashboard.sectionAssignment')}
              </Typography>
              {sections.assignmentCards.length > 0 ? (
                <WorkerDashboardCardRail
                  cards={sections.assignmentCards}
                  showNavArrows={isDesktop}
                />
              ) : (
                <Box sx={{ py: 2, px: 1, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t('dashboard.noUpcomingAssignment')}
                  </Typography>
                  <Link
                    component="button"
                    variant="body2"
                    onClick={() => navigate('/c1/jobs-board')}
                    sx={{ fontWeight: 600 }}
                  >
                    {t('dashboard.viewJobs')}
                  </Link>
                </Box>
              )}
            </Stack>

            {/* Section 2: Recommended jobs */}
            <Stack spacing={1.5}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('dashboard.sectionRecommendedJobs')}
              </Typography>
              <WorkerDashboardCardRail
                cards={sections.jobsCards}
                sectionHeader={sections.jobsSectionHeader}
                showNavArrows={isDesktop}
              />
            </Stack>

            {/* Section 3: Job Readiness (profile improvements) */}
            {sections.jobReadinessPayload && (
              <Stack spacing={1.5}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {t('dashboard.sectionJobReadiness')}
                </Typography>
                {sections.jobReadinessCompact ? (
                  <JobReadinessCompactCard
                    payload={sections.jobReadinessPayload}
                    onTap={() => navigate(sections.jobReadinessPayload!.fixNowTo)}
                  />
                ) : (
                  <WorkerDashboardCardRail
                    cards={[sections.jobReadinessPayload]}
                    showNavArrows={isDesktop}
                  />
                )}
              </Stack>
            )}

            <WorkerQuickNav />
          </>
        )}
      </Stack>
    </Box>
  );
};

export default WorkerDashboard;
