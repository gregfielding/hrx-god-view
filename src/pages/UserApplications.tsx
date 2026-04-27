import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Button,
  Stack,
} from '@mui/material';
import { collection, query, where, getDocs, doc, getDoc, updateDoc, serverTimestamp, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useParams } from 'react-router-dom';
import { useT, getLanguage } from '../i18n';
import { formatHourlyPayRateForDisplay } from '../utils/hourlyPayDisplay';
import { extractDateFromShiftDate } from '../utils/gigShiftApplicationLimits';
import WorkerApplicationListCard from '../components/worker/applications/WorkerApplicationListCard';

/** Combine YYYY-MM-DD with optional time (HH:mm string or Timestamp) for list display. */
function combineShiftDateAndTime(shiftDateStr: string, startTime: unknown): Date | null {
  const day = extractDateFromShiftDate(String(shiftDateStr || ''));
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split('-').map(Number);
  let hh = 12;
  let mm = 0;
  if (startTime != null && startTime !== '') {
    if (typeof startTime === 'string' && /^\d{1,2}:\d{2}/.test(startTime.trim())) {
      const parts = startTime.trim().split(':');
      hh = parseInt(parts[0], 10) || 0;
      mm = parseInt(parts[1], 10) || 0;
    } else if (typeof (startTime as { toDate?: () => Date }).toDate === 'function') {
      const t = (startTime as { toDate: () => Date }).toDate();
      hh = t.getHours();
      mm = t.getMinutes();
    }
  }
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

interface Application {
  id: string;
  tenantId: string;
  jobId: string;
  jobTitle?: string;
  postTitle?: string;
  companyName?: string;
  location?: string;
  payRate?: number;
  status: string;
  submittedAt: Date;
  /** When present, display as Shift Date (e.g. Mar 22, 5:00 PM) */
  shiftStart?: Date;
}

/** Set of "tenantId_jobPostId" for which the user has a proposed (offer sent) assignment */
type PendingOfferSet = Set<string>;
/** Set of "tenantId_jobPostId" for which the user has accepted (confirmed/hired) assignment */
type HiredOfferSet = Set<string>;

const UserApplications: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { applicationId: routeApplicationId } = useParams<{ applicationId?: string }>();
  const t = useT();
  const [applications, setApplications] = useState<Application[]>([]);
  const [pendingOfferKeys, setPendingOfferKeys] = useState<PendingOfferSet>(new Set());
  const [hiredOfferKeys, setHiredOfferKeys] = useState<HiredOfferSet>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linkedApplicationMissing, setLinkedApplicationMissing] = useState(false);

  useEffect(() => {
    loadApplications();
  }, [user?.uid, routeApplicationId]);

  const loadApplications = async () => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        setApplications([]);
        setLoading(false);
        return;
      }

      const userData = userSnap.data();
      const applicationIds: string[] = Array.isArray(userData?.applicationIds) ? userData.applicationIds : [];

      if (applicationIds.length === 0) {
        setApplications([]);
        setLoading(false);
        return;
      }

      const loadedApplications: Application[] = [];

      for (const appId of applicationIds) {
        try {
          const [tenantId, jobId] = appId.split('_');
          if (!tenantId || !jobId) continue;

          const appRef = doc(db, 'tenants', tenantId, 'applications', `${user.uid}_${jobId}`);
          const appSnap = await getDoc(appRef);

          if (appSnap.exists()) {
            const appData = appSnap.data();

            let jobTitle = '';
            let postTitle = '';
            let companyName = '';
            let location = '';
            let payRate = undefined;
            let shiftStart: Date | undefined;

            const userDoc = await getDoc(doc(db, 'users', user.uid));
            if (userDoc.exists()) {
              const ud = userDoc.data();
              const appDataMap = ud.applicationData || {};

              for (const [, value] of Object.entries(appDataMap)) {
                const cached = value as any;
                if (cached.jobId === jobId) {
                  location = cached.location || '';
                  companyName = cached.companyName || '';
                  payRate = cached.payRate;
                  jobTitle = cached.jobTitle || '';
                  postTitle = cached.postTitle || '';
                  break;
                }
              }
            }

            // Application doc (authoritative for gig shiftDate / shiftId)
            if (typeof appData.companyName === 'string' && appData.companyName.trim()) {
              companyName = companyName || appData.companyName.trim();
            }
            const appShiftDateRaw =
              typeof appData.shiftDate === 'string' && appData.shiftDate.trim()
                ? appData.shiftDate.trim()
                : Array.isArray(appData.shiftDates) && appData.shiftDates.length > 0
                  ? String(appData.shiftDates[0]).trim()
                  : '';
            if (appData.jobOrderId && appData.shiftId) {
              try {
                const shiftRef = doc(
                  db,
                  'tenants',
                  tenantId,
                  'job_orders',
                  String(appData.jobOrderId),
                  'shifts',
                  String(appData.shiftId),
                );
                const shiftSnap = await getDoc(shiftRef);
                if (shiftSnap.exists()) {
                  const sh = shiftSnap.data();
                  const dstr = String(sh.shiftDate || appShiftDateRaw || '').trim();
                  const st = sh.startTime ?? sh.defaultStartTime;
                  const combined = combineShiftDateAndTime(dstr, st);
                  if (combined) shiftStart = combined;
                }
              } catch (shiftErr) {
                console.warn('Could not load shift for application list', jobId, shiftErr);
              }
            }
            if (!shiftStart && appShiftDateRaw) {
              const fallback = combineShiftDateAndTime(appShiftDateRaw, undefined);
              if (fallback) shiftStart = fallback;
            }
            if (!companyName && appData.jobOrderId) {
              try {
                const joRef = doc(db, 'tenants', tenantId, 'job_orders', String(appData.jobOrderId));
                const joSnap = await getDoc(joRef);
                if (joSnap.exists()) {
                  const jo = joSnap.data() as Record<string, unknown>;
                  const cn =
                    (typeof jo.companyName === 'string' && jo.companyName.trim()) ||
                    (typeof jo.clientName === 'string' && jo.clientName.trim()) ||
                    '';
                  if (cn) companyName = cn;
                }
              } catch (_) {
                // ignore
              }
            }

            if (!location || !jobTitle) {
              try {
                const jobRef = doc(db, 'tenants', tenantId, 'job_postings', jobId);
                const jobSnap = await getDoc(jobRef);
                if (jobSnap.exists()) {
                  const jobData = jobSnap.data();
                  jobTitle = jobTitle || jobData.jobTitle || '';
                  postTitle = postTitle || jobData.postTitle || '';
                  companyName = companyName || jobData.companyName || '';
                  payRate = payRate !== undefined ? payRate : jobData.payRate;
                  if (!shiftStart) {
                    if (jobData.startDate?.toDate) {
                      shiftStart = jobData.startDate.toDate();
                    } else if (jobData.startDate) {
                      shiftStart = new Date(jobData.startDate);
                    } else if (Array.isArray(jobData.shifts) && jobData.shifts[0]?.startTime) {
                      const s = jobData.shifts[0];
                      shiftStart = s.startTime?.toDate ? s.startTime.toDate() : new Date(s.startTime);
                    }
                  }
                  if (!location) {
                    if (jobData.city && jobData.state) {
                      location = `${jobData.city}, ${jobData.state}`;
                    } else if (jobData.worksiteAddress?.city && jobData.worksiteAddress?.state) {
                      location = `${jobData.worksiteAddress.city}, ${jobData.worksiteAddress.state}`;
                    } else if (jobData.worksiteName) {
                      location = jobData.worksiteName;
                    }
                  }
                }
              } catch (jobErr) {
                console.warn('Could not load job details for', jobId, jobErr);
              }
            }

            loadedApplications.push({
              id: appSnap.id,
              tenantId,
              jobId,
              jobTitle,
              postTitle: postTitle || jobTitle,
              companyName,
              location,
              payRate,
              status: appData.status || 'submitted',
              submittedAt: appData.submittedAt?.toDate() || new Date(),
              shiftStart,
            });
          }
        } catch (appErr) {
          console.warn('Error loading application', appId, appErr);
        }
      }

      loadedApplications.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());

      setApplications(loadedApplications);
      if (routeApplicationId) {
        setLinkedApplicationMissing(!loadedApplications.some((app) => app.id === routeApplicationId));
      } else {
        setLinkedApplicationMissing(false);
      }

      const tenantIds = [...new Set(loadedApplications.map((a) => a.tenantId))];
      const pendingKeys = new Set<string>();
      const hiredKeys = new Set<string>();
      for (const tenantId of tenantIds) {
        try {
          const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');
          const proposedQ = query(
            assignmentsRef,
            where('userId', '==', user.uid),
            where('status', '==', 'proposed')
          );
          const proposedSnap = await getDocs(proposedQ);
          proposedSnap.docs.forEach((d) => {
            const data = d.data();
            const jobPostId = data.jobPostId || data.jobId;
            if (jobPostId) pendingKeys.add(`${tenantId}_${jobPostId}`);
          });
          const confirmedQ = query(
            assignmentsRef,
            where('userId', '==', user.uid),
            where('status', 'in', ['confirmed', 'active'])
          );
          const confirmedSnap = await getDocs(confirmedQ);
          confirmedSnap.docs.forEach((d) => {
            const data = d.data();
            const jobPostId = data.jobPostId || data.jobId;
            if (jobPostId) hiredKeys.add(`${tenantId}_${jobPostId}`);
          });
        } catch (_) {
          // ignore
        }
      }
      setPendingOfferKeys(pendingKeys);
      setHiredOfferKeys(hiredKeys);
    } catch (err: any) {
      console.error('Error loading applications:', err);
      setError(err.message || 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  };

  const getStatusLabel = (app: Application): string => {
    const key = `${app.tenantId}_${app.jobId}`;
    const status = app.status.toLowerCase();
    if (hiredOfferKeys.has(key)) return t('applications.statusHired');
    if (status === 'withdrawn') return t('applications.statusWithdrawn');
    if (status === 'rejected' || status === 'declined') return t('applications.statusDeclined');
    if (status === 'expired' || status === 'cancelled') return t('applications.statusExpired');
    if (status === 'submitted' && pendingOfferKeys.has(key)) return t('applications.statusUnderReview');
    if (status === 'submitted') return t('applications.statusApplied');
    if (status === 'reviewed' || status === 'pending') return t('applications.statusUnderReview');
    if (status === 'accepted' || status === 'confirmed' || status === 'hired') return t('applications.statusHired');
    return t('applications.statusApplied');
  };

  const canWithdraw = (app: Application): boolean => {
    const label = getStatusLabel(app);
    return label === t('applications.statusApplied') || label === t('applications.statusUnderReview');
  };

  const handleWithdraw = async (e: React.MouseEvent, app: Application) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to withdraw your application?')) return;
    try {
      const appRef = doc(db, 'tenants', app.tenantId, 'applications', app.id);
      await updateDoc(appRef, {
        status: 'withdrawn',
        withdrawnAt: new Date(),
        withdrawnBy: user?.uid || null,
        applyDate: deleteField(),
        applyDates: deleteField(),
        updatedAt: serverTimestamp(),
      });
      await loadApplications();
    } catch (err) {
      console.error('Failed to withdraw application:', err);
      alert('We were unable to withdraw your application. Please try again.');
    }
  };

  const getStatusColor = (app: Application): 'default' | 'primary' | 'success' | 'error' | 'warning' => {
    const key = `${app.tenantId}_${app.jobId}`;
    if (hiredOfferKeys.has(key)) return 'success';
    if (app.status.toLowerCase() === 'submitted' && pendingOfferKeys.has(key)) return 'warning';
    switch (app.status.toLowerCase()) {
      case 'submitted':
        return 'primary';
      case 'reviewed':
        return 'default';
      case 'accepted':
      case 'hired':
      case 'confirmed':
        return 'success';
      case 'rejected':
        return 'error';
      case 'pending':
        return 'warning';
      default:
        return 'default';
    }
  };

  const getStatusChipSx = (app: Application): object | undefined => {
    const label = getStatusLabel(app);
    if (label === t('applications.statusHired')) return { fontWeight: 600 };
    if (label === t('applications.statusUnderReview') || label === t('applications.statusApplied')) {
      return { backgroundColor: '#FFC700', color: '#000', fontWeight: 600 };
    }
    return undefined;
  };

  const locale = getLanguage() === 'es' ? 'es' : 'en-US';
  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  };
  const formatShiftDate = (date: Date): string => {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  };

  const openJob = (app: Application) => {
    navigate(`/c1/jobs-board/${app.jobId}`);
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 'lg', mx: 'auto', py: 2 }}>
      {linkedApplicationMissing && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This item is unavailable. You can review your other applications below.
        </Alert>
      )}
      <Typography variant="h4" component="h1" sx={{ fontWeight: 600, mb: applications.length > 0 ? 2 : 0 }}>
        {t('applications.title')}
      </Typography>
      {applications.length === 0 ? (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
            {t('applications.emptyMessage')}
          </Typography>
          <Button variant="contained" color="primary" onClick={() => navigate('/c1/jobs-board')}>
            {t('applications.browseJobs')}
          </Button>
        </Box>
      ) : (
        <Stack spacing={2}>
          {applications.map((app) => {
            const title = app.postTitle || app.jobTitle || t('applications.untitledJob');
            const companyLine = app.companyName?.trim() || '';
            const locationLine = app.location || '';
            const shiftLine = app.shiftStart ? formatShiftDate(app.shiftStart) : '';
            const payLine = formatHourlyPayRateForDisplay(app.payRate) ?? '';
            const appliedLine = `${t('applications.dateApplied')}: ${formatDate(app.submittedAt)}`;
            const statusLabel = getStatusLabel(app);
            return (
              <WorkerApplicationListCard
                key={app.id}
                jobTitle={title}
                companyLine={companyLine}
                locationLine={locationLine}
                shiftDateLine={shiftLine}
                payLine={payLine}
                dateAppliedLine={appliedLine}
                statusLabel={statusLabel}
                statusChipColor={getStatusColor(app)}
                statusChipSx={getStatusChipSx(app)}
                showWithdraw={canWithdraw(app)}
                withdrawLabel={t('applications.withdrawApplication')}
                viewJobLabel={t('applications.viewJob')}
                onCardClick={() => openJob(app)}
                onViewJob={(e) => {
                  e.stopPropagation();
                  openJob(app);
                }}
                onWithdraw={(e) => handleWithdraw(e, app)}
              />
            );
          })}
        </Stack>
      )}
    </Box>
  );
};

export default UserApplications;
