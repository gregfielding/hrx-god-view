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
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Link,
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
import { useWebOtpAutofill } from '../../hooks/useWebOtpAutofill';
import { useT, getLanguage } from '../../i18n';

interface PhoneSignupGateProps {
  firstName: string;
  lastName: string;
  /** 10-digit US phone as typed in the personal-info form. */
  phone: string;
  /** DOB as typed (MM/DD/YYYY or YYYY-MM-DD). Sent with signup so the server
   *  persists it — step 0 auto-filters after auth, so its own save never runs. */
  dob?: string;
  /** Require a valid 18+ DOB before the code can be sent (wizard step 0). */
  dobRequired?: boolean;
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
  dob = '',
  dobRequired = false,
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
  // Twilio 10DLC (2026-09-09): SMS consent is a separate, unchecked, optional box shown where the number is collected.
  const [smsConsent, setSmsConsent] = useState(false);
  // Third-party AI consent, its own unchecked box (App Store 5.1.2(i) parity with the app, 2026-09-10).
  const [aiConsent, setAiConsent] = useState(false);

  const phoneE164 = toE164(phone);

  // Android one-tap code autofill; auto-verifies on receipt.
  useWebOtpAutofill(step === 'code', (otp) => {
    setCode(otp);
    void verify(otp);
  });
  // 18+ (W-2 staffing, Greg 2026-08-25). Server enforces the same rule.
  // Accepts MM/DD/YYYY (slashes, dashes or dots), bare MMDDYYYY and YYYY-MM-DD: a worker
  // who typed 04051990 sat on a dead "Text me a code" button (Deborah, 2026-09-10).
  const dobIso = (() => {
    const t = dob.trim();
    const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/) ?? t.match(/^(\d{2})(\d{2})(\d{4})$/);
    return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : t;
  })();
  const dobAge = (() => {
    const m = dobIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
      return null;
    }
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    if (
      now.getMonth() < d.getMonth() ||
      (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())
    )
      age -= 1;
    return age;
  })();
  const dobAdult = dobAge != null && dobAge >= 18 && dobAge <= 100;
  const dobOk = !dobRequired || dobAdult;
  const underage = dobRequired && dobAge != null && dobAge < 18;
  const dobUnreadable = dobRequired && Boolean(dob.trim()) && dobAge == null;
  const ready = Boolean(firstName.trim() && lastName.trim() && phoneE164 && dobOk);

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

  const verify = async (codeOverride?: string) => {
    const codeToUse = (codeOverride ?? code).trim();
    if (!phoneE164 || !/^\d{6}$/.test(codeToUse)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await httpsCallable(getFunctions(), 'checkOtp')({
        phoneE164,
        code: codeToUse,
        signup: true,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dob: dobAge != null ? dobIso : dob.trim(),
        preferredLanguage: getLanguage(),
        smsConsent,
        aiConsent,
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
          <Box sx={{ mb: 1.5 }}>
            <FormControlLabel
              sx={{ alignItems: 'flex-start' }}
              control={<Checkbox checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} sx={{ mt: -0.5 }} inputProps={{ 'aria-label': t('phoneSignup.smsConsentLabel') }} />}
              label={
                <Box>
                  <Typography variant="body2">{t('phoneSignup.smsConsentLabel')}</Typography>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {t('phoneSignup.smsConsentDisclosure')} {t('phoneSignup.smsConsentLinks')}{' '}
                    <Link href="/privacy" target="_blank" rel="noopener">Privacy Policy</Link>,{' '}
                    <Link href="/terms" target="_blank" rel="noopener">Terms of Use</Link>{' '}
                    &amp; <Link href="/consent" target="_blank" rel="noopener">SMS Consent</Link>.
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              sx={{ alignItems: 'flex-start', mt: 1 }}
              control={<Checkbox checked={aiConsent} onChange={(e) => setAiConsent(e.target.checked)} sx={{ mt: -0.5 }} inputProps={{ 'aria-label': t('phoneSignup.aiConsentLabel') }} />}
              label={
                <Box>
                  <Typography variant="body2">{t('phoneSignup.aiConsentLabel')}</Typography>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {t('phoneSignup.aiConsentDisclosure')}{' '}
                    <Link href="/privacy" target="_blank" rel="noopener">Privacy Policy</Link>.
                  </Typography>
                </Box>
              }
            />
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
              {t('phoneSignup.otpNote')}
            </Typography>
          </Box>
        )}
        {step === 'idle' && (
          <Button variant="contained" disabled={!ready || busy} onClick={() => void sendCode()}>
            {busy ? <CircularProgress size={20} /> : t('phoneSignup.sendCode')}
          </Button>
        )}
        {step === 'idle' && !ready && (
          <Typography
            variant="caption"
            color={underage ? 'error' : 'text.secondary'}
            sx={{ display: 'block', mt: 1 }}
          >
            {underage
              ? t('phoneSignup.mustBe18')
              : dobUnreadable
                ? t('phoneSignup.dobFormat')
                : t('phoneSignup.fillNamePhone')}
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
