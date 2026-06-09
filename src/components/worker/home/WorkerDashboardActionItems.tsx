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
import { formatHeadshotGateError } from '../../../utils/avatarVerification/formatHeadshotGateError';

const SMS_SNOOZE_MS = 24 * 60 * 60 * 1000;

/** Compact action-item button styling — smaller than MUI size="small". */
const COMPACT_BTN_SX = {
  py: 0.25,
  px: 1.25,
  fontSize: 12,
  lineHeight: 1.4,
  minWidth: 0,
  whiteSpace: 'nowrap' as const,
};

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
  /**
   * When the Accept-flow server gate rejects the worker's headshot, we surface a Retake CTA
   * alongside the localized error. `retakeLabel` + visible retake button are only shown while
   * this is non-null; clearing happens implicitly on the next Accept attempt.
   */
  const [assignmentHeadshotRetake, setAssignmentHeadshotRetake] = useState<
    { retakeLabel: string } | null
  >(null);

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
      setAssignmentHeadshotRetake(null);
      setAssignmentBusyId(assignmentId);
      try {
        await respondToAssignmentCallable({ tenantId, assignmentId, decision });
        onAfterFirestoreChange?.();
      } catch (e: unknown) {
        // Headshot gate: show the localized retake nudge + surface a Retake CTA so the
        // worker can get to their profile camera in one tap. Any other error falls through
        // to the generic message-extraction path below.
        const gate = formatHeadshotGateError(e);
        if (gate) {
          setAssignmentError(gate.message);
          setAssignmentHeadshotRetake({ retakeLabel: gate.retakeLabel });
        } else {
          const msg =
            e && typeof e === 'object' && 'message' in e
              ? String((e as { message?: string }).message)
              : 'Could not update assignment. Try again.';
          setAssignmentError(msg);
        }
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
      return;
    }
    if (item.primaryKind === 'external_open') {
      // External vendor portal (e.g. AccuSource applicant setup URL).
      if (item.href) window.open(item.href, '_blank', 'noopener,noreferrer');
      else onNavigate('/c1/workers/profile');
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
                <CardContent sx={{ py: 1, px: { xs: 1.25, sm: 1.5 }, '&:last-child': { pb: 1 } }}>
                  <Stack spacing={0.75}>
                    <Stack
                      direction="row"
                      spacing={1.25}
                      alignItems="center"
                      justifyContent="space-between"
                      useFlexGap
                      flexWrap="wrap"
                    >
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                          variant="subtitle2"
                          sx={{ fontWeight: 700, lineHeight: 1.25, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {t(item.titleKey)}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.35 }}
                        >
                          {t(item.descriptionKey)}
                        </Typography>
                        <Chip
                          size="small"
                          label={t(categoryLabelKey(item.category))}
                          color="error"
                          variant="filled"
                          sx={{ mt: 0.75, fontWeight: 600, height: 18, '& .MuiChip-label': { px: 0.75, fontSize: 10 } }}
                        />
                      </Box>
                      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
                        {item.secondaryKind === 'assignment_decline' && item.secondaryLabelKey ? (
                          <Button
                            variant="outlined"
                            color="inherit"
                            size="small"
                            sx={COMPACT_BTN_SX}
                            disabled={busy}
                            onClick={() => void runSecondary(item)}
                          >
                            {t(item.secondaryLabelKey)}
                          </Button>
                        ) : null}
                        <Button
                          variant="contained"
                          color="primary"
                          size="small"
                          sx={COMPACT_BTN_SX}
                          disabled={busy}
                          onClick={() => void runPrimary(item)}
                        >
                          {busy ? t('dashboard.actionItems.saving') : t(item.primaryLabelKey)}
                        </Button>
                      </Stack>
                    </Stack>
                    {assignmentError ? (
                      <Stack spacing={0.5} alignItems="flex-start">
                        <Typography variant="caption" color="error" sx={{ fontWeight: 600 }}>
                          {assignmentError}
                        </Typography>
                        {assignmentHeadshotRetake ? (
                          <Button
                            variant="outlined"
                            color="primary"
                            size="small"
                            onClick={() => onNavigate('/c1/workers/profile')}
                          >
                            {assignmentHeadshotRetake.retakeLabel}
                          </Button>
                        ) : null}
                      </Stack>
                    ) : null}
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
              {/* Compact tile: title + one-line description, the priority
                  chip on its own row BELOW the text, and a small action
                  button on the right. */}
              <CardContent
                sx={{
                  py: 1,
                  px: { xs: 1.25, sm: 1.5 },
                  '&:last-child': { pb: 1 },
                }}
              >
                <Stack
                  direction="row"
                  spacing={1.25}
                  alignItems="flex-start"
                  justifyContent="space-between"
                  useFlexGap
                  flexWrap="wrap"
                >
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography
                      variant="subtitle2"
                      sx={{ fontWeight: 700, lineHeight: 1.25, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {t(item.titleKey)}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 1,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        lineHeight: 1.35,
                      }}
                    >
                      {t(item.descriptionKey)}
                    </Typography>
                    <Chip
                      size="small"
                      label={t(categoryLabelKey(item.category))}
                      color={categoryChipColor[item.category]}
                      variant={isRecommended ? 'outlined' : 'filled'}
                      sx={{ mt: 0.75, fontWeight: 600, height: 18, '& .MuiChip-label': { px: 0.75, fontSize: 10 } }}
                    />
                  </Box>
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
                    {item.category === 'recommended' &&
                    item.secondaryKind === 'dismiss_firestore' &&
                    item.secondaryLabelKey ? (
                      <Button size="small" variant="text" color="inherit" sx={COMPACT_BTN_SX} onClick={() => void runSecondary(item)}>
                        {t(item.secondaryLabelKey)}
                      </Button>
                    ) : null}
                    {item.secondaryKind === 'snooze_sms' && item.secondaryLabelKey ? (
                      <Button size="small" color="inherit" sx={COMPACT_BTN_SX} onClick={() => void runSecondary(item)}>
                        {t(item.secondaryLabelKey)}
                      </Button>
                    ) : null}
                    <Button
                      variant={isRecommended ? 'outlined' : 'contained'}
                      color="primary"
                      size="small"
                      sx={COMPACT_BTN_SX}
                      onClick={() => void runPrimary(item)}
                    >
                      {t(item.primaryLabelKey)}
                    </Button>
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
