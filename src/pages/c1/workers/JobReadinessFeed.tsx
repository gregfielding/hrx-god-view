/**
 * Job Readiness card feed — top 3 profile improvements, swipeable.
 * After completing/skipping all, show confirmation and return to dashboard.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Stack, Typography, Button, CircularProgress } from '@mui/material';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useOnboarding } from '../../../hooks/useOnboarding';
import { useT } from '../../../i18n';
import { getImprovementTasks } from '../../../utils/jobReadinessTasks';
import type { ImprovementTask } from '../../../utils/jobReadinessTasks';
import JobReadinessCardRail from '../../../components/worker/jobReadiness/JobReadinessCardRail';

const JobReadinessFeed: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const [userDoc, setUserDoc] = useState<Record<string, unknown> | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const processedIds = useRef<Set<string>>(new Set());
  const { checklist } = useOnboarding(user?.uid);

  useEffect(() => {
    if (!user?.uid) return;
    const userRef = doc(db, 'users', user.uid);
    const unsub = onSnapshot(userRef, (snap) => {
      setUserDoc(snap.exists() ? (snap.data() as Record<string, unknown>) : null);
    });
    return () => unsub();
  }, [user?.uid]);

  const tasks = React.useMemo(
    () => getImprovementTasks(userDoc, checklist),
    [userDoc, checklist]
  );

  const handleComplete = useCallback(
    async (taskId: string, value?: string) => {
      if (value === 'upload' && taskId.includes('certification')) {
        navigate('/c1/workers/profile#readiness-certifications');
        return;
      }
      processedIds.current.add(taskId);
      if (user?.uid) {
        const userRef = doc(db, 'users', user.uid);
        if (taskId === 'education' && value) {
          await updateDoc(userRef, { educationLevel: value, updatedAt: serverTimestamp() });
        }
        if (taskId === 'background-check' && value) {
          await updateDoc(userRef, {
            backgroundCheckComfort: value === 'yes',
            updatedAt: serverTimestamp(),
          });
        }
      }
      if (processedIds.current.size >= tasks.length) {
        setShowConfirmation(true);
      }
    },
    [user?.uid, navigate, tasks.length]
  );

  const handleSkip = useCallback(
    (taskId: string) => {
      processedIds.current.add(taskId);
      if (processedIds.current.size >= tasks.length) {
        setShowConfirmation(true);
      }
    },
    [tasks.length]
  );

  const handleOpenDetails = useCallback(
    (task: ImprovementTask) => {
      const hash = task.profileSectionId ? `#${task.profileSectionId}` : '';
      navigate(`/c1/workers/profile${hash}`);
    },
    [navigate]
  );

  const handleReturnToJobs = useCallback(() => {
    navigate('/c1/workers/dashboard');
  }, [navigate]);

  if (userDoc === null && !user?.uid) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (showConfirmation) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', px: 2, py: 4 }}>
        <Stack spacing={3} alignItems="center" textAlign="center">
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {t('jobReadiness.confirmationTitle')}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t('jobReadiness.confirmationBody')}
          </Typography>
          <Button
            variant="contained"
            size="large"
            onClick={handleReturnToJobs}
            sx={{ mt: 2, px: 3, py: 1.5 }}
          >
            {t('jobReadiness.returnToJobs')}
          </Button>
        </Stack>
      </Box>
    );
  }

  if (tasks.length === 0) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', px: 2, py: 4 }}>
        <Stack spacing={3} alignItems="center" textAlign="center">
          <Typography variant="h6">{t('jobReadiness.allSet')}</Typography>
          <Button variant="contained" onClick={() => navigate('/c1/workers/dashboard')}>
            {t('jobReadiness.returnToJobs')}
          </Button>
        </Stack>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 480, mx: 'auto', px: 1, py: 2 }}>
      <Stack spacing={3}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          {t('jobReadiness.feedTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('jobReadiness.feedSubtitle', { count: tasks.length })}
        </Typography>
        <JobReadinessCardRail
          tasks={tasks}
          onComplete={handleComplete}
          onSkip={handleSkip}
          onOpenDetails={handleOpenDetails}
        />
      </Stack>
    </Box>
  );
};

export default JobReadinessFeed;
