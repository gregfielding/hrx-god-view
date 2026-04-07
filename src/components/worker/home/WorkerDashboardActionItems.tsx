import React, { useCallback, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../../firebase';
import { useT } from '../../../i18n';
import type {
  WorkerDashboardActionItem,
  WorkerDashboardPriorityTier,
} from '../../../utils/workerDashboardActionItems';
import { persistWorkerDashboardActionDismiss } from '../../../utils/workerDashboardDismissals';

const SMS_SNOOZE_MS = 24 * 60 * 60 * 1000;

function smsSnoozeStorageKey(uid: string): string {
  return `worker_sms_warning_dismiss_until_${uid}`;
}

const categoryChipColor: Record<
  WorkerDashboardPriorityTier,
  'primary' | 'info' | 'default' | 'warning' | 'error'
> = {
  blocking: 'error',
  important: 'warning',
  recommended: 'info',
  snoozable: 'default',
};

export interface WorkerDashboardActionItemsProps {
  uid: string;
  items: WorkerDashboardActionItem[];
  onAfterFirestoreChange?: () => void;
  onNavigate: (path: string) => void;
}

const respondToAssignmentCallable = httpsCallable(functions, 'respondToAssignment');

const WorkerDashboardActionItems: React.FC<WorkerDashboardActionItemsProps> = ({
  uid,
  items,
  onAfterFirestoreChange,
  onNavigate,
}) => {
  const t = useT();
  const [smsEnabling, setSmsEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  const [assignmentBusyId, setAssignmentBusyId] = useState<string | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

  const snoozeSms = useCallback(() => {
    try {
      const nextUntil = Date.now() + SMS_SNOOZE_MS;
      window.localStorage.setItem(smsSnoozeStorageKey(uid), String(nextUntil));
    } catch {
      /* ignore */
    }
    onAfterFirestoreChange?.();
  }, [uid, onAfterFirestoreChange]);

  const enableSmsHere = useCallback(async () => {
    if (!uid) return;
    setEnableError(null);
    setSmsEnabling(true);
    try {
      await updateDoc(doc(db, 'users', uid), {
        'notificationSettings.smsNotifications': true,
        smsOptIn: true,
        smsBlockedSystem: false,
        updatedAt: serverTimestamp(),
      });
      onAfterFirestoreChange?.();
    } catch (e: unknown) {
      setEnableError(e instanceof Error ? e.message : 'Could not turn on SMS. Try again.');
    } finally {
      setSmsEnabling(false);
    }
  }, [uid, onAfterFirestoreChange]);

  const dismissFirestore = useCallback(
    async (actionId: string) => {
      if (!uid) return;
      await persistWorkerDashboardActionDismiss(uid, actionId);
      onAfterFirestoreChange?.();
    },
    [uid, onAfterFirestoreChange]
  );

  const markTempworksStarted = useCallback(async () => {
    if (!uid) return;
    await updateDoc(doc(db, 'users', uid), {
      'onboarding.tempworksStartedAt': serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    onAfterFirestoreChange?.();
  }, [uid, onAfterFirestoreChange]);

  const respondAssignment = useCallback(
    async (item: WorkerDashboardActionItem, decision: 'accept' | 'decline') => {
      const tenantId = item.qaEvaluatedFields.tenantId as string | undefined;
      const assignmentId = item.qaEvaluatedFields.assignmentId as string | undefined;
      if (!tenantId || !assignmentId) return;
      setAssignmentError(null);
      setAssignmentBusyId(assignmentId);
      try {
        await respondToAssignmentCallable({ tenantId, assignmentId, decision });
        onAfterFirestoreChange?.();
      } catch (e: unknown) {
        const msg =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message?: string }).message)
            : 'Could not update assignment. Try again.';
        setAssignmentError(msg);
      } finally {
        setAssignmentBusyId(null);
      }
    },
    [onAfterFirestoreChange]
  );

  const runPrimary = async (item: WorkerDashboardActionItem) => {
    if (item.primaryKind === 'navigate') {
      if (item.href) onNavigate(item.href);
      else onNavigate('/c1/workers/profile');
      return;
    }
    if (item.primaryKind === 'enable_sms') {
      await enableSmsHere();
      return;
    }
    if (item.primaryKind === 'assignment_accept') {
      await respondAssignment(item, 'accept');
      return;
    }
    if (item.primaryKind === 'tempworks_open') {
      await markTempworksStarted();
      if (item.href) {
        window.open(item.href, '_blank', 'noopener,noreferrer');
      } else {
        onNavigate('/c1/workers/profile');
      }
    }
  };

  const runSecondary = async (item: WorkerDashboardActionItem) => {
    if (item.secondaryKind === 'snooze_sms') {
      snoozeSms();
      return;
    }
    if (item.secondaryKind === 'dismiss_firestore') {
      await dismissFirestore(item.id);
      return;
    }
    if (item.secondaryKind === 'assignment_decline') {
      await respondAssignment(item, 'decline');
    }
  };

  const categoryLabelKey = (c: WorkerDashboardPriorityTier) => {
    if (c === 'blocking') return 'dashboard.priorityStack.categoryBlocking';
    if (c === 'important') return 'dashboard.priorityStack.categoryImportant';
    if (c === 'recommended') return 'dashboard.priorityStack.categoryRecommended';
    return 'dashboard.priorityStack.categorySnoozable';
  };

  const sectionHeading = (
    <Typography
      variant="h5"
      component="h1"
      sx={{ fontWeight: 700, letterSpacing: -0.02, mb: 0 }}
    >
      {t('dashboard.actionItems.sectionTitle')}
    </Typography>
  );

  if (items.length === 0) {
    return (
      <Stack id="worker-dashboard-action-items-region" spacing={2}>
        {sectionHeading}
        <Card variant="outlined" id="worker-dashboard-action-items-empty" sx={{ bgcolor: 'background.paper', boxShadow: 'none' }}>
          <CardContent sx={{ py: 2.25, px: 2.25, '&:last-child': { pb: 2.25 } }}>
            <Stack spacing={1.75} alignItems="flex-start">
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {t('dashboard.actionItems.caughtUpTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.65, maxWidth: '40ch' }}>
                {t('dashboard.actionItems.caughtUpBody')}
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ pt: 1, width: '100%' }}>
                <Button
                  variant="contained"
                  color="primary"
                  size="large"
                  fullWidth
                  sx={{ maxWidth: { sm: 220 } }}
                  onClick={() => onNavigate('/c1/jobs-board')}
                >
                  {t('nav.findWork')}
                </Button>
                <Button
                  variant="outlined"
                  color="primary"
                  size="large"
                  fullWidth
                  sx={{ maxWidth: { sm: 220 } }}
                  onClick={() => onNavigate('/c1/workers/profile')}
                >
                  {t('dashboard.actionItems.viewProfile')}
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    );
  }

  const renderSmsEnableCard = (item: WorkerDashboardActionItem, opts: { showSnooze: boolean }) => (
    <Alert
      key={item.id}
      severity="warning"
      data-priority-category={item.category}
      data-action-id={item.id}
      sx={{
        borderRadius: 2,
        alignItems: 'flex-start',
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'warning.light',
        boxShadow: 'none',
      }}
      action={
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ flexShrink: 0, ml: 1 }}>
          {opts.showSnooze && item.secondaryKind === 'snooze_sms' ? (
            <Button size="small" color="inherit" onClick={() => void runSecondary(item)}>
              {t(item.secondaryLabelKey || 'dashboard.actionItems.notNow')}
            </Button>
          ) : null}
          <Button
            variant="contained"
            color="warning"
            size="small"
            disabled={smsEnabling}
            onClick={() => void runPrimary(item)}
          >
            {smsEnabling ? t('dashboard.actionItems.saving') : t(item.primaryLabelKey)}
          </Button>
        </Stack>
      }
    >
      <Box sx={{ pr: { xs: 0, sm: 1 }, minWidth: 0 }}>
        <AlertTitle sx={{ mb: 0.5, fontWeight: 700 }}>{t(item.titleKey)}</AlertTitle>
        <Typography variant="body2" color="text.secondary" component="div" sx={{ lineHeight: 1.6 }}>
          {t(item.descriptionKey)}
        </Typography>
        {enableError ? (
          <Typography variant="body2" color="error" sx={{ mt: 1, fontWeight: 600 }}>
            {enableError}
          </Typography>
        ) : null}
      </Box>
    </Alert>
  );

  return (
    <Stack id="worker-dashboard-action-items-region" spacing={2}>
      {sectionHeading}
      <Stack spacing={2} id="worker-dashboard-action-items">
        {items.map((item) => {
          if (item.id === 'sms_opt_in') {
            return renderSmsEnableCard(item, { showSnooze: true });
          }
          if (item.id === 're_enable_sms_notifications') {
            return renderSmsEnableCard(item, { showSnooze: false });
          }

          if (item.id === 'assignment_confirmation_required') {
            const aid = String(item.qaEvaluatedFields.assignmentId ?? '');
            const busy = assignmentBusyId === aid;
            return (
              <Card
                key={`assignment-confirm-${aid}`}
                variant="outlined"
                data-priority-category={item.category}
                data-action-id={item.id}
                sx={{
                  bgcolor: 'background.paper',
                  overflow: 'visible',
                  borderColor: 'error.light',
                  borderWidth: 1,
                  boxShadow: (theme) => `0 0 0 1px ${theme.palette.error.main}22`,
                }}
              >
                <CardContent sx={{ py: 2.25, px: { xs: 2, sm: 2.5 }, '&:last-child': { pb: 2.25 } }}>
                  <Stack spacing={1.5}>
                    <Chip
                      size="small"
                      label={t(categoryLabelKey(item.category))}
                      color="error"
                      variant="filled"
                      sx={{ alignSelf: 'flex-start', fontWeight: 600, height: 26 }}
                    />
                    <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.35 }}>
                      {t(item.titleKey)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.65, maxWidth: '62ch' }}>
                      {t(item.descriptionKey)}
                    </Typography>
                    {assignmentError ? (
                      <Typography variant="body2" color="error" sx={{ fontWeight: 600 }}>
                        {assignmentError}
                      </Typography>
                    ) : null}
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap flexWrap="wrap" sx={{ pt: 0.5 }}>
                      <Button
                        variant="contained"
                        color="primary"
                        size="medium"
                        disabled={busy}
                        onClick={() => void runPrimary(item)}
                      >
                        {busy ? t('dashboard.actionItems.saving') : t(item.primaryLabelKey)}
                      </Button>
                      {item.secondaryKind === 'assignment_decline' && item.secondaryLabelKey ? (
                        <Button
                          variant="outlined"
                          color="inherit"
                          size="medium"
                          disabled={busy}
                          onClick={() => void runSecondary(item)}
                        >
                          {t(item.secondaryLabelKey)}
                        </Button>
                      ) : null}
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            );
          }

          const isBlocking = item.category === 'blocking';
          const isImportant = item.category === 'important';
          const isRecommended = item.category === 'recommended';

          return (
            <Card
              key={item.id}
              variant="outlined"
              data-priority-category={item.category}
              data-action-id={item.id}
              sx={{
                bgcolor: 'background.paper',
                boxShadow: 'none',
                overflow: 'visible',
                ...(isBlocking
                  ? {
                      borderColor: 'error.light',
                      borderWidth: 1,
                      boxShadow: (theme) => `0 0 0 1px ${theme.palette.error.main}18`,
                    }
                  : isImportant
                    ? {
                        borderColor: 'warning.light',
                        borderWidth: 1,
                        boxShadow: (theme) => `0 0 0 1px ${theme.palette.warning.main}18`,
                      }
                    : isRecommended
                      ? {
                          borderColor: 'divider',
                          opacity: 1,
                          bgcolor: (theme) =>
                            theme.palette.mode === 'dark' ? 'action.selected' : 'grey.50',
                        }
                      : {}),
              }}
            >
              <CardContent
                sx={{
                  py: 2.25,
                  px: { xs: 2, sm: 2.5 },
                  '&:last-child': { pb: 2.25 },
                }}
              >
                <Stack spacing={1.5}>
                  <Chip
                    size="small"
                    label={t(categoryLabelKey(item.category))}
                    color={categoryChipColor[item.category]}
                    variant={isRecommended ? 'outlined' : 'filled'}
                    sx={{ alignSelf: 'flex-start', fontWeight: 600, height: 26 }}
                  />
                  <Typography
                    variant={isRecommended ? 'subtitle1' : 'h6'}
                    sx={{ fontWeight: 700, lineHeight: 1.35 }}
                  >
                    {t(item.titleKey)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.65, maxWidth: '62ch' }}>
                    {t(item.descriptionKey)}
                  </Typography>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    flexWrap="wrap"
                    useFlexGap
                    sx={{ pt: 0.5, alignItems: { xs: 'stretch', sm: 'center' } }}
                  >
                    <Button
                      variant={isRecommended ? 'outlined' : 'contained'}
                      color="primary"
                      size="medium"
                      fullWidth
                      sx={{ maxWidth: { sm: 220 } }}
                      onClick={() => void runPrimary(item)}
                    >
                      {t(item.primaryLabelKey)}
                    </Button>
                    {item.secondaryKind === 'snooze_sms' && item.secondaryLabelKey ? (
                      <Button size="medium" color="inherit" onClick={() => void runSecondary(item)}>
                        {t(item.secondaryLabelKey)}
                      </Button>
                    ) : null}
                    {item.category === 'recommended' &&
                    item.secondaryKind === 'dismiss_firestore' &&
                    item.secondaryLabelKey ? (
                      <Button size="medium" variant="text" color="inherit" onClick={() => void runSecondary(item)}>
                        {t(item.secondaryLabelKey)}
                      </Button>
                    ) : null}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          );
        })}
      </Stack>
    </Stack>
  );
};

export default WorkerDashboardActionItems;
