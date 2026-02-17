/**
 * Worker Dashboard — /c1/workers/dashboard
 * Work Hub landing page. Truthful metrics only; no fake data (Go-Live spec §3).
 * Fixed links (do not change): /c1/jobs-board, /c1/workers/applications
 */

import React, { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { Box, Stack } from '@mui/material';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { getUserScore } from '../../../utils/scoreSummary';
import { useOnboarding } from '../../../hooks/useOnboarding';
import WorkerDashboardHero from '../../../components/worker/dashboard/WorkerDashboardHero';
import type { UpcomingShift } from '../../../components/worker/dashboard/WorkerDashboardHero';
import WorkerDashboardSmsToggle from '../../../components/worker/dashboard/WorkerDashboardSmsToggle';
import WorkerDashboardAlerts from '../../../components/worker/dashboard/WorkerDashboardAlerts';
import WorkerDashboardStatusCards from '../../../components/worker/dashboard/WorkerDashboardStatusCards';
import WorkerDashboardQuickActions from '../../../components/worker/dashboard/WorkerDashboardQuickActions';
import WorkerDashboardActivity from '../../../components/worker/dashboard/WorkerDashboardActivity';
import WorkerDashboardCompleteApplicationCard from '../../../components/worker/dashboard/WorkerDashboardCompleteApplicationCard';
import { useT, getLanguage } from '../../../i18n';

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

/** True if string looks like a Firestore doc ID — don't show as display name */
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
): UpcomingShift {
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
  };
}

const WorkerDashboard: React.FC = () => {
  const { user, activeTenant } = useAuth();
  const t = useT();
  const locale = localeForLanguage(getLanguage());
  const [userDoc, setUserDoc] = useState<Record<string, unknown> | null>(null);
  const [nextShift, setNextShift] = useState<UpcomingShift | null>(null);
  const { checklist, summary: complianceSummary, hasOnboarding } = useOnboarding(user?.uid);
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

  const score = userDoc ? getUserScore(userDoc) : undefined;
  const applicationIds = Array.isArray(userDoc?.applicationIds) ? (userDoc.applicationIds as string[]) : [];
  const applicationsCount = userDoc != null ? String(applicationIds.length) : null;

  const readinessPercent =
    userDoc != null && typeof score === 'number' && Number.isFinite(score)
      ? String(Math.round(score))
      : null;
  const hasChecklist = hasOnboarding && Object.keys(checklist).length > 0;
  const documentsStatusKey = !hasChecklist
    ? 'NotStarted'
    : complianceSummary.compliancePercent === 100
      ? 'AllSet'
      : 'Incomplete';
  const documentsStatus = t(`dashboard.documents${documentsStatusKey}`);
  const documentsSubtext = t(`dashboard.documentsSubtext${documentsStatusKey}`);

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

  const alerts = [
    {
      severity: 'info' as const,
      message: t('dashboard.finishProfileAlert'),
      ctaLabel: t('dashboard.jobReadiness'),
      ctaTo: '/c1/workers/profile',
    },
  ];

  return (
    <Box sx={{ maxWidth: 'lg', mx: 'auto' }}>
      <Stack spacing={4} sx={{ py: 2 }}>
        <WorkerDashboardHero firstName={displayFirstName} nextShift={nextShift} />

        <WorkerDashboardSmsToggle
          smsEnabled={smsEnabled}
          onToggle={handleSmsToggle}
          disabled={!user?.uid}
        />

        <WorkerDashboardAlerts alerts={alerts} />

        <WorkerDashboardCompleteApplicationCard userId={user?.uid} />

        <WorkerDashboardStatusCards
          readinessPercent={readinessPercent}
          documentsStatus={documentsStatus}
          documentsSubtext={documentsSubtext}
          applicationsCount={applicationsCount}
          supportCardOnly
          supportSubtext={t('dashboard.contactSupport')}
          showSupportCard={false}
        />

        <WorkerDashboardQuickActions />

        <WorkerDashboardActivity />
      </Stack>
    </Box>
  );
};

export default WorkerDashboard;
