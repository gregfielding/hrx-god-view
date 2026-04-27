import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Alert,
  Switch,
  FormControlLabel,
  CircularProgress,
  Tooltip,
  Grid,
} from '@mui/material';
import {
  Bolt as BoltIcon,
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';

import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface CalendarWebhookManagerProps {
  tenantId: string;
}

/**
 * Calendar real-time sync toggle.
 *
 * Wires into the new `startCalendarPush` / `stopCalendarPush` callables
 * (backed by Google Calendar `events.watch()` with webhook delivery) and
 * subscribes to the caller's user doc via onSnapshot for live status —
 * mirrors the Gmail real-time sync toggle pattern in `GmailSettings.tsx`.
 */
const CalendarWebhookManager: React.FC<CalendarWebhookManagerProps> = ({ tenantId }) => {
  const { user } = useAuth();
  const functions = getFunctions();

  const startCalendarPushFn = httpsCallable(functions, 'startCalendarPush');
  const stopCalendarPushFn = httpsCallable(functions, 'stopCalendarPush');

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  // Push notification (real-time sync) state — sourced from user doc, updated via onSnapshot
  const [pushState, setPushState] = useState<{
    enabled: boolean;
    expiration: number | null;
    lastPushAt: Date | null;
    lastError: string | null;
    lastErrorAt: Date | null;
  }>({
    enabled: false,
    expiration: null,
    lastPushAt: null,
    lastError: null,
    lastErrorAt: null,
  });

  // Subscribe to user doc for live calendar push status.
  useEffect(() => {
    if (!user?.uid) return;
    const userRef = doc(db, 'users', user.uid);
    const unsub = onSnapshot(
      userRef,
      (snap) => {
        const d: any = snap.data() || {};
        const toDate = (v: any): Date | null => {
          if (!v) return null;
          if (v instanceof Timestamp) return v.toDate();
          if (v instanceof Date) return v;
          if (typeof v === 'number') return new Date(v);
          if (typeof v?.toDate === 'function') return v.toDate();
          return null;
        };
        setPushState({
          enabled: !!d.calendarPushEnabled,
          expiration:
            typeof d.calendarWatchExpiration === 'number'
              ? d.calendarWatchExpiration
              : d.calendarWatchExpiration?.toMillis
                ? d.calendarWatchExpiration.toMillis()
                : null,
          lastPushAt: toDate(d.calendarLastPushAt),
          lastError: typeof d.calendarWatchLastError === 'string' ? d.calendarWatchLastError : null,
          lastErrorAt: toDate(d.calendarWatchLastErrorAt),
        });
      },
      (err) => {
        console.warn('CalendarWebhookManager: user doc onSnapshot failed', err);
      }
    );
    return () => {
      try {
        unsub();
      } catch {
        /* noop */
      }
    };
  }, [user?.uid]);

  const handleTogglePushSync = async (nextEnabled: boolean) => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }
    if (!tenantId) {
      setError('Missing tenantId — cannot toggle calendar real-time sync.');
      return;
    }
    setPushBusy(true);
    setError(null);
    setSuccess(null);
    try {
      if (nextEnabled) {
        const res: any = await startCalendarPushFn({ tenantId });
        const data = res?.data || {};
        if (data?.success) {
          setSuccess('Real-time calendar sync enabled.');
        } else {
          setError('Could not enable real-time calendar sync.');
        }
      } else {
        const res: any = await stopCalendarPushFn({ tenantId });
        const data = res?.data || {};
        if (data?.success) {
          setSuccess('Real-time calendar sync disabled. Events will still refresh via the periodic sync.');
        } else {
          setError(`Could not disable real-time calendar sync${data?.reason ? `: ${data.reason}` : ''}.`);
        }
      }
    } catch (err: any) {
      console.error('Error toggling Calendar push sync:', err);
      setError(`Real-time calendar sync toggle failed: ${err?.message || 'unknown error'}`);
    } finally {
      setPushBusy(false);
    }
  };

  const formatRelative = (d: Date | null): string => {
    if (!d) return '—';
    const diffMs = Date.now() - d.getTime();
    if (diffMs < 0) return d.toLocaleString();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return d.toLocaleString();
  };

  return (
    <Card>
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={1}>
          <BoltIcon color={pushState.enabled ? 'primary' : 'disabled'} />
          <Typography variant="h6">Real-time Calendar Sync</Typography>
          <Chip
            size="small"
            label={pushState.enabled ? 'On' : 'Off'}
            color={pushState.enabled ? 'success' : 'default'}
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          When enabled, event changes are delivered instantly via Google Calendar push notifications,
          with automatic incremental sync into HRX. The watch auto-renews daily.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        )}

        <FormControlLabel
          control={
            <Switch
              checked={pushState.enabled}
              disabled={pushBusy}
              onChange={(e) => handleTogglePushSync(e.target.checked)}
            />
          }
          label={pushState.enabled ? 'Enabled' : 'Enable real-time sync'}
        />

        {pushState.enabled && (
          <Box mt={2}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <Typography variant="body2" color="text.secondary">
                  <strong>Last push received:</strong> {formatRelative(pushState.lastPushAt)}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Tooltip title="Calendar watches expire after ~7 days; we auto-renew daily.">
                  <Typography variant="body2" color="text.secondary">
                    <strong>Watch expires:</strong>{' '}
                    {pushState.expiration
                      ? new Date(pushState.expiration).toLocaleString()
                      : '—'}
                  </Typography>
                </Tooltip>
              </Grid>
            </Grid>
          </Box>
        )}

        {pushState.lastError && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            <Typography variant="body2">
              <strong>Last error:</strong> {pushState.lastError}
              {pushState.lastErrorAt && (
                <Box component="span" ml={1} color="text.secondary">
                  ({formatRelative(pushState.lastErrorAt)})
                </Box>
              )}
            </Typography>
          </Alert>
        )}

        {pushBusy && (
          <Box mt={2} display="flex" alignItems="center" gap={1}>
            <CircularProgress size={16} />
            <Typography variant="caption" color="text.secondary">
              Updating real-time calendar sync…
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default CalendarWebhookManager;
