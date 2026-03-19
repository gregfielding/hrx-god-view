import React, { useEffect, useMemo, useState } from 'react';
import { Alert, AlertTitle, Box, Button, Stack } from '@mui/material';
import { doc, getDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

const SNOOZE_MS = 24 * 60 * 60 * 1000;

function dismissKey(uid: string): string {
  return `worker_sms_warning_dismiss_until_${uid}`;
}

const SmsWarningBanner: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const uid = user?.uid;

  const [loading, setLoading] = useState(true);
  const [smsDisabled, setSmsDisabled] = useState(false);
  const [hasPhone, setHasPhone] = useState(false);
  const [smsSystemAvailable, setSmsSystemAvailable] = useState(true);
  const [dismissUntil, setDismissUntil] = useState(0);

  useEffect(() => {
    if (!uid) return;
    try {
      const untilRaw = window.localStorage.getItem(dismissKey(uid));
      const until = untilRaw ? Number(untilRaw) : 0;
      setDismissUntil(Number.isFinite(until) ? until : 0);
    } catch {
      setDismissUntil(0);
    }
  }, [uid]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!uid) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (!snap.exists() || cancelled) {
          setLoading(false);
          return;
        }
        const data = snap.data() as Record<string, any>;
        const notifications = (data.notificationSettings || {}) as Record<string, any>;
        const smsPreference = notifications.smsNotifications;
        const phone = String(data.phone || '').trim();
        const unavailable =
          data?.smsSystemUnavailable === true ||
          notifications?.smsUnavailable === true;

        setSmsDisabled(smsPreference === false);
        setHasPhone(phone.length > 0);
        setSmsSystemAvailable(!unavailable);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const snoozed = useMemo(() => dismissUntil > Date.now(), [dismissUntil]);

  const showBanner = Boolean(!loading && uid && smsSystemAvailable && smsDisabled && !snoozed);

  const dismissForNow = () => {
    if (!uid) return;
    try {
      const nextUntil = Date.now() + SNOOZE_MS;
      window.localStorage.setItem(dismissKey(uid), String(nextUntil));
      setDismissUntil(nextUntil);
    } catch {
      // Ignore storage failures and continue without snooze persistence.
    }
  };

  if (!showBanner) return null;

  return (
    <Alert
      severity="warning"
      sx={{
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'warning.light',
      }}
      action={
        <Stack direction="row" spacing={1}>
          {hasPhone ? (
            <Button
              variant="contained"
              color="warning"
              size="small"
              onClick={() => navigate('/c1/workers/profile/app-language?focus=sms')}
            >
              Turn On SMS
            </Button>
          ) : (
            <Button
              variant="contained"
              color="warning"
              size="small"
              onClick={() => navigate('/c1/workers/profile/personal-details')}
            >
              Add phone number
            </Button>
          )}
          <Button size="small" color="inherit" onClick={dismissForNow}>
            Not now
          </Button>
        </Stack>
      }
    >
      <AlertTitle>Turn on text alerts</AlertTitle>
      <Box>Turn on text alerts to receive important job and shift updates.</Box>
    </Alert>
  );
};

export default SmsWarningBanner;
