/**
 * Phone-first signup gate (phone-auth Slice 2, Greg approved 2026-08-25).
 *
 * The ONE account-creation UI for worker funnels: name + phone → Twilio OTP
 * → `checkOtp({ signup: true })` server resolution:
 *   - phone already has an account → signed into the EXISTING account
 *     (survivor rule / household picker) — never a duplicate;
 *   - no account → server mints Auth user with the verified phone (no
 *     password) + users doc, returns a custom token.
 * Renders nothing once authenticated. Used by the apply wizard step 0 and
 * the jobs-board AuthDialog — any new signup surface must use this gate
 * (guardrail: no client-side account creation).
 */
import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../../firebase';
import { setLastLoginMethod } from '../../utils/lastLoginMethod';
import { useT, getLanguage } from '../../i18n';

interface PhoneSignupGateProps {
  firstName: string;
  lastName: string;
  /** 10-digit US phone as typed in the personal-info form. */
  phone: string;
  signupSource: string;
  signupGroupId?: string | null;
  jobContext?: { tenantId?: string | null; tenantSlug?: string | null; jobId?: string | null } | null;
  /** Called after signInWithCustomToken succeeds. `existing` = claimed an
   *  account that already existed (welcome back) vs freshly created. */
  onAuthed?: (info: { existing: boolean; uid: string }) => void;
}

interface Candidate {
  uid: string;
  firstName: string;
  lastInitial: string;
  email: string | null;
}

function toE164(phone: string): string | null {
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

const PhoneSignupGate: React.FC<PhoneSignupGateProps> = ({
  firstName,
  lastName,
  phone,
  signupSource,
  signupGroupId = null,
  jobContext = null,
  onAuthed,
}) => {
  const t = useT();
  const [step, setStep] = useState<'idle' | 'code' | 'choose' | 'done'>('idle');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectionToken, setSelectionToken] = useState('');
  const [pick, setPick] = useState('');
  const [existingNotice, setExistingNotice] = useState(false);

  const phoneE164 = toE164(phone);
  const ready = Boolean(firstName.trim() && lastName.trim() && phoneE164);

  const finishSignIn = async (result: Record<string, unknown>) => {
    if (result.status === 'choose') {
      setCandidates((result.candidates as Candidate[]) ?? []);
      setSelectionToken(String(result.selectionToken ?? ''));
      setStep('choose');
      return;
    }
    if (result.status === 'signed_in' && result.token) {
      const existing = result.existing === true;
      if (existing) setExistingNotice(true);
      setLastLoginMethod('phone');
      await signInWithCustomToken(auth, String(result.token));
      setStep('done');
      onAuthed?.({ existing, uid: String(result.uid ?? '') });
      return;
    }
    setError(t('phoneSignup.genericError'));
  };

  const sendCode = async () => {
    if (!phoneE164) return;
    setBusy(true);
    setError(null);
    try {
      await httpsCallable(getFunctions(), 'sendOtp')({ phoneE164 });
      setStep('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('phoneSignup.genericError'));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!phoneE164 || !/^\d{6}$/.test(code.trim())) return;
    setBusy(true);
    setError(null);
    try {
      const res = await httpsCallable(getFunctions(), 'checkOtp')({
        phoneE164,
        code: code.trim(),
        signup: true,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        preferredLanguage: getLanguage(),
        signupSource,
        signupGroupId,
        jobContext,
      });
      await finishSignIn((res.data ?? {}) as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('phoneSignup.genericError'));
    } finally {
      setBusy(false);
    }
  };

  const confirmPick = async () => {
    if (!phoneE164 || !selectionToken || !pick) return;
    setBusy(true);
    setError(null);
    try {
      const res = await httpsCallable(getFunctions(), 'checkOtp')({
        phoneE164,
        signIn: true,
        selectionToken,
        pick,
      });
      const data = (res.data ?? {}) as Record<string, unknown>;
      await finishSignIn({ ...data, existing: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('phoneSignup.genericError'));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done') {
    return existingNotice ? (
      <Alert severity="success" sx={{ mt: 2 }}>
        {t('phoneSignup.welcomeBack')}
      </Alert>
    ) : (
      <Alert severity="success" sx={{ mt: 2 }}>
        {t('phoneSignup.accountReady')}
      </Alert>
    );
  }

  return (
    <Card variant="outlined" sx={{ mt: 2 }}>
      <CardContent>
        <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
          {t('phoneSignup.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t('phoneSignup.subtitle')}
        </Typography>

        {step === 'idle' && (
          <Button variant="contained" disabled={!ready || busy} onClick={() => void sendCode()}>
            {busy ? <CircularProgress size={20} /> : t('phoneSignup.sendCode')}
          </Button>
        )}
        {step === 'idle' && !ready && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {t('phoneSignup.fillNamePhone')}
          </Typography>
        )}

        {step === 'code' && (
          <Stack spacing={1.5} sx={{ maxWidth: 320 }}>
            <TextField
              label={t('phoneSignup.codeLabel')}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputProps={{ inputMode: 'numeric', autoComplete: 'one-time-code' }}
              autoFocus
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                disabled={busy || code.trim().length !== 6}
                onClick={() => void verify()}
              >
                {busy ? <CircularProgress size={20} /> : t('phoneSignup.verify')}
              </Button>
              <Button variant="text" disabled={busy} onClick={() => void sendCode()}>
                {t('phoneSignup.resend')}
              </Button>
            </Stack>
          </Stack>
        )}

        {step === 'choose' && (
          <Stack spacing={1.5}>
            <Typography variant="body2">{t('phoneSignup.choosePrompt')}</Typography>
            <RadioGroup value={pick} onChange={(e) => setPick(e.target.value)}>
              {candidates.map((c) => (
                <FormControlLabel
                  key={c.uid}
                  value={c.uid}
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography variant="body1">
                        {c.firstName} {c.lastInitial}.
                      </Typography>
                      {c.email ? (
                        <Typography variant="caption" color="text.secondary">
                          {c.email}
                        </Typography>
                      ) : null}
                    </Box>
                  }
                />
              ))}
            </RadioGroup>
            <Button
              variant="contained"
              disabled={busy || !pick}
              onClick={() => void confirmPick()}
              sx={{ alignSelf: 'flex-start' }}
            >
              {busy ? <CircularProgress size={20} /> : t('phoneSignup.continue')}
            </Button>
          </Stack>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

export default PhoneSignupGate;
