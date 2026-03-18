/**
 * Worker Dashboard — /c1/workers/dashboard
 * Three sections (vertical scroll): 1. Assignment, 2. Recommended jobs, 3. Job Readiness.
 * Horizontal swipe (mobile) or prev/next arrows (web) within each section.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import CloseIcon from '@mui/icons-material/Close';
import {
  Box,
  Stack,
  Typography,
  CircularProgress,
  useTheme,
  useMediaQuery,
  Dialog,
  DialogContent,
  IconButton,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';

import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useOnboarding } from '../../../hooks/useOnboarding';
import WorkerQuickNav from '../../../components/worker/WorkerQuickNav';
import ApplicationsAssignmentsSnapshot from '../../../components/worker/home/ApplicationsAssignmentsSnapshot';
import NextStepsChecklist from '../../../components/worker/home/NextStepsChecklist';
import ProfileNudgesSection from '../../../components/worker/home/ProfileNudgesSection';
import ReadinessSummaryCard from '../../../components/worker/home/ReadinessSummaryCard';
import RecommendedJobsSection from '../../../components/worker/home/RecommendedJobsSection';
import type { HomeChecklistItem, HomeReadinessLaunchStep } from '../../../components/worker/home/types';
import type { DashboardCardPayload } from '../../../components/worker/dashboard/cards';
import type { UpcomingShift } from '../../../components/worker/dashboard/WorkerDashboardHero';
import { UserApplicationsService } from '../../../services/userApplicationsService';
import type { UserApplication } from '../../../services/userApplicationsService';
import { JobsBoardService } from '../../../services/recruiter/jobsBoardService';
import type { JobsBoardPost } from '../../../services/recruiter/jobsBoardService';
import { getCategoryForTitle } from '../../../utils/dashboardCardCategory';
import { buildHomeReadinessModel } from '../../../utils/homeReadinessModel';
import { getImprovementTasks } from '../../../utils/jobReadinessTasks';
import { useT, getLanguage } from '../../../i18n';

import JobReadinessFeed from './JobReadinessFeed';

const C1_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';
/** Recommendation deck: exactly 3 job cards + 1 gateway card. */
const RECOMMENDATION_JOB_COUNT = 3;

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

/**
 * Rank jobs for recommendation: nearest upcoming, pay rate, urgency (spots remaining), then stable order.
 * Worker location/skills/preferred shifts can be added later when available.
 */
function rankRecommendedJobs(
  posts: JobsBoardPost[],
  _userDoc: Record<string, unknown> | null
): JobsBoardPost[] {
  void _userDoc;
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
  const { checklist, summary: complianceSummary } = useOnboarding(user?.uid);
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
  const isMobile = !isDesktop;
  const navigate = useNavigate();
  const [readinessFlowOpen, setReadinessFlowOpen] = useState(false);
  const [readinessLaunchStep, setReadinessLaunchStep] = useState<HomeReadinessLaunchStep>('start');

  const openReadinessFlow = (launchStep: HomeReadinessLaunchStep = 'start') => {
    setReadinessLaunchStep(launchStep);
    setReadinessFlowOpen(true);
  };

  const closeReadinessFlow = () => {
    setReadinessFlowOpen(false);
    setReadinessLaunchStep('start');
  };

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
        category: getCategoryForTitle(jobTitle),
      });
    }
    jobsCards.push({
      type: 'gateway',
      id: 'gateway-see-all-jobs',
      label: t('dashboard.seeAllJobs'),
      seeJobsTo: '/c1/jobs-board',
    });

    return {
      assignmentCards,
      jobsSectionHeader,
      jobsCards,
    };
  }, [
    nextShift,
    applications,
    jobs,
    userDoc,
    t,
    locale,
  ]);

  const readinessPercent = Math.max(0, Math.min(100, complianceSummary.compliancePercent ?? 0));
  const readinessModel = useMemo(() => buildHomeReadinessModel(userDoc), [userDoc]);
  const checklistItems: HomeChecklistItem[] = readinessModel.orderedChecklist.map((item) => ({
    id: item.id,
    title: item.title,
    benefit: item.benefit,
    status: item.status,
    priority: item.priority,
    launchStep: item.launchStep,
  }));
  const requiredCount = readinessModel.requiredCount || complianceSummary.requiredCount || 0;
  const completedCount = readinessModel.completedCount || complianceSummary.completedCount || 0;
  const scoredPercent = readinessModel.readinessPercent;
  const effectiveReadinessPercent =
    readinessModel.source === 'snapshot' || readinessModel.source === 'computed'
      ? scoredPercent
      : readinessPercent;
  const nextIncompleteStep = checklistItems.find((item) => item.status !== 'complete');
  const primaryCtaLabel =
    effectiveReadinessPercent <= 0
      ? 'Start getting job-ready'
      : effectiveReadinessPercent >= 85 || !nextIncompleteStep
        ? 'Finish setup'
        : `Next: ${nextIncompleteStep.title}`;
  const readinessMessage =
    effectiveReadinessPercent <= 10
      ? "You're just getting started."
      : effectiveReadinessPercent <= 45
        ? "You're building momentum."
        : effectiveReadinessPercent <= 75
          ? "You're halfway there."
          : effectiveReadinessPercent < 100
            ? "You're almost done."
            : 'You are job-ready.';
  const needsApplicationAttention = applications.some((app) =>
    APPLICATION_NEEDS_RESPONSE.includes(String(app.status || '').toLowerCase())
  );
  const upcomingAssignmentLabel = nextShift
    ? `${nextShift.day}, ${nextShift.date} at ${nextShift.time}`
    : null;

  return (
    <Box sx={{ maxWidth: 760, mx: 'auto', px: 1 }}>
      <Stack spacing={4} sx={{ py: 2 }}>
        <Stack spacing={0.75}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {t('dashboard.welcomeBack', { firstName: displayFirstName })}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Complete a few quick steps to unlock more jobs and improve your matches.
          </Typography>
        </Stack>

        {cardsLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <ReadinessSummaryCard
              data={{ readinessPercent: effectiveReadinessPercent, completedCount, requiredCount }}
              readinessMessage={readinessMessage}
              primaryCtaLabel={primaryCtaLabel}
              onContinueSetup={() => openReadinessFlow(nextIncompleteStep?.launchStep ?? 'start')}
              onViewProfile={() => navigate('/c1/workers/profile')}
            />

            <NextStepsChecklist
              items={checklistItems}
              onSelectItem={(item) => openReadinessFlow(item.launchStep)}
            />

            <RecommendedJobsSection
              cards={sections.jobsCards.slice(0, 5)}
              sectionHeader={sections.jobsSectionHeader}
              showNavArrows={isDesktop}
            />

            <ApplicationsAssignmentsSnapshot
              needsApplicationAttention={needsApplicationAttention}
              upcomingAssignmentLabel={upcomingAssignmentLabel}
              onOpenApplications={() => navigate('/c1/workers/applications')}
              onOpenAssignments={() => navigate('/c1/workers/assignments')}
            />

            <ProfileNudgesSection
              items={improvementTasks.slice(0, 3).map((task) => ({
                id: task.id,
                label: t(task.titleKey),
              }))}
              onSelectNudge={() => openReadinessFlow('start')}
            />

            <WorkerQuickNav />
          </>
        )}
      </Stack>
      <Dialog
        fullScreen={isMobile}
        maxWidth="md"
        fullWidth
        open={readinessFlowOpen}
        onClose={closeReadinessFlow}
      >
        <DialogContent sx={{ p: 0 }}>
          <Stack direction="row" justifyContent="flex-end" sx={{ p: 1 }}>
            <IconButton onClick={closeReadinessFlow} aria-label="Close setup">
              <CloseIcon />
            </IconButton>
          </Stack>
          <JobReadinessFeed launchStep={readinessLaunchStep} />
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default WorkerDashboard;
