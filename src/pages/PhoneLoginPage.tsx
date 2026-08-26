/**
 * Phone-number sign-in — THE DEFAULT /login since 2026-08-25 (via LoginGate;
 * /login/phone is a direct alias, email/password moved to /login/email).
 *
 * Deliberately
 * stripped down: system fonts, black on white, one action per screen, the C1
 * mark small at the bottom. No MUI theme, no card — utilitarian.
 *
 * Flow: phone → our Twilio Verify SMS (`sendOtp`) → 6-digit code →
 * `checkOtp({ signIn: true })` resolves the EXISTING account on that number
 * server-side (same-person duplicates collapse to the payroll survivor;
 * different people on one phone get a picker) and returns a custom token →
 * `signInWithCustomToken` → normal post-login redirect. No reCAPTCHA, no
 * Firebase phone provider, no password. See docs/claude/project_phone_auth.md.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signInWithCustomToken, onAuthStateChanged, type User } from 'firebase/auth';
import { setLastLoginMethod } from '../utils/lastLoginMethod';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { setLanguage } from '../i18n';
import { useGuestLanguage } from '../hooks/useGuestLanguage';
import { useWebOtpAutofill } from '../hooks/useWebOtpAutofill';

type Lang = 'en' | 'es';
const COPY: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Sign in',
    phoneLabel: 'Mobile number',
    phoneHint: 'We’ll text you a code. No password needed.',
    continue: 'Continue',
    codeLabel: 'Enter the 6-digit code',
    codeHint: 'Sent to',
    verify: 'Sign in',
    resend: 'Send a new code',
    changeNumber: 'Use a different number',
    sending: 'Sending…',
    verifying: 'Checking…',
    badPhone: 'Enter a 10-digit US mobile number.',
    badCode: 'That code didn’t match. Try again.',
    expired: 'That code expired. Send a new one.',
    tooMany: 'Too many attempts. Wait a few minutes and try again.',
    generic: 'Something went wrong. Try again.',
    chooseTitle: 'Who are you?',
    chooseHint: 'More than one person uses this number.',
    noAccountTitle: 'We don’t have an account with this number.',
    noAccountHint: 'New to C1? Create your account in a minute.',
    signUp: 'Create account',
    startOver: 'Start over',
    emailLogin: 'Sign in with email instead',
    numberChanged: 'My number changed — I already have an account',
    recoverTitle: 'Find your account',
    recoverHint: 'Tell us who you are and our team will move your account to this number.',
    firstName: 'First name',
    lastName: 'Last name',
    dobLabel: 'Date of birth',
    submitRecovery: 'Submit',
    recoverNotFound: 'We couldn’t find a matching account. Check the spelling and date of birth, or contact your recruiter.',
    recoverPendingTitle: 'Got it — we’re on it.',
    recoverPendingHint: 'Our team will verify your request and move your account to this number, usually within 1 business day. We’ll text you here when it’s done.',
  },
  es: {
    title: 'Iniciar sesión',
    phoneLabel: 'Número de celular',
    phoneHint: 'Te enviaremos un código por texto. Sin contraseña.',
    continue: 'Continuar',
    codeLabel: 'Ingresa el código de 6 dígitos',
    codeHint: 'Enviado a',
    verify: 'Iniciar sesión',
    resend: 'Enviar un código nuevo',
    changeNumber: 'Usar otro número',
    sending: 'Enviando…',
    verifying: 'Verificando…',
    badPhone: 'Ingresa un número de celular de EE. UU. de 10 dígitos.',
    badCode: 'Ese código no coincide. Inténtalo de nuevo.',
    expired: 'Ese código venció. Envía uno nuevo.',
    tooMany: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
    generic: 'Algo salió mal. Inténtalo de nuevo.',
    chooseTitle: '¿Quién eres?',
    chooseHint: 'Más de una persona usa este número.',
    noAccountTitle: 'No tenemos una cuenta con este número.',
    noAccountHint: '¿Nuevo en C1? Crea tu cuenta en un minuto.',
    signUp: 'Crear cuenta',
    startOver: 'Empezar de nuevo',
    emailLogin: 'Iniciar sesión con correo',
    numberChanged: 'Cambié de número — ya tengo una cuenta',
    recoverTitle: 'Encuentra tu cuenta',
    recoverHint: 'Dinos quién eres y nuestro equipo moverá tu cuenta a este número.',
    firstName: 'Nombre',
    lastName: 'Apellido',
    dobLabel: 'Fecha de nacimiento',
    submitRecovery: 'Enviar',
    recoverNotFound: 'No encontramos una cuenta que coincida. Revisa la ortografía y la fecha de nacimiento, o contacta a tu reclutador.',
    recoverPendingTitle: 'Listo — lo estamos revisando.',
    recoverPendingHint: 'Nuestro equipo verificará tu solicitud y moverá tu cuenta a este número, normalmente en 1 día hábil. Te enviaremos un texto aquí cuando esté listo.',
  },
};

const digitsOnly = (s: string) => s.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1').slice(0, 10);
const formatUs = (d: string) => {
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};

import { A as S, langToggleStyle } from './authMinimalStyles';

const PhoneLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // EN/ES choice is captured three ways: persisted for guests (localStorage,
  // same as Login/Jobs Board), applied to the app i18n immediately, and
  // stamped onto users/{uid}.preferredLanguage at sign-in (see below).
  const [lang, setLang] = useGuestLanguage();
  useEffect(() => { setLanguage(lang); }, [lang]);
  const t = COPY[lang];
  const [rawError, setRawError] = useState('');

  const [step, setStep] = useState<'phone' | 'code' | 'choose' | 'no_account' | 'recover' | 'recover_pending'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [choice, setChoice] = useState<{ selectionToken: string; candidates: Array<{ uid: string; firstName: string; lastInitial: string; email?: string }> } | null>(null);
  // Phone-change recovery (Slice 3): token proving THIS device just verified
  // the new number, handed back with no_account; name+DOB claim the account.
  const [recoveryToken, setRecoveryToken] = useState('');
  const [recFirst, setRecFirst] = useState('');
  const [recLast, setRecLast] = useState('');
  const [recDob, setRecDob] = useState('');
  const redirectedRef = useRef(false);
  const fns = useMemo(() => getFunctions(), []);

  const e164 = useMemo(() => (phone.length === 10 ? `+1${phone}` : ''), [phone]);

  // After sign-in (custom token → existing uid): capture language, redirect.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u: User | null) => {
      if (!u || redirectedRef.current) return;
      const snap = await getDoc(doc(db, 'users', u.uid));
      if (!snap.exists()) return; // not ours to handle (e.g. a stale session) — stay put
      redirectedRef.current = true;
      // Capture the EN/ES choice made on this screen as the worker's preference.
      if (snap.get('preferredLanguage') !== lang) {
        await setDoc(doc(db, 'users', u.uid), { preferredLanguage: lang, updatedAt: serverTimestamp() }, { merge: true }).catch(() => undefined);
      }
      const level = parseInt(String(snap.get('securityLevel') ?? snap.get('tenantIds')?.BCiP2bQ9CgVOCTfV6MhD?.securityLevel ?? '0'), 10);
      // Honor the auth-guard deep link (state.from) the way the email login
      // does — workers only, and only into worker routes.
      const state = location.state as { from?: { pathname?: string; search?: string; hash?: string } } | null;
      const from = state?.from;
      const deepLink =
        from && typeof from.pathname === 'string' && from.pathname.startsWith('/c1/')
          ? `${from.pathname}${from.search || ''}${from.hash || ''}`
          : '';
      // Workers land on THEIR OWN My Account view — never the internal
      // /users/:uid admin profile (activity log & scoring leaked there 8/23).
      navigate(level >= 5 ? '/' : deepLink || '/c1/workers/dashboard', { replace: true });
    });
    return unsub;
  }, [navigate, lang, location.state]);

  const mapError = (e: unknown): string => {
    const codeStr = String((e as { code?: string })?.code || '');
    const msg = String((e as { message?: string })?.message || '');
    setRawError(codeStr ? `${codeStr}${msg ? ' — ' + msg : ''}` : msg || String(e));
    if (codeStr.includes('invalid-argument') && /phone/i.test(msg)) return t.badPhone;
    if (codeStr.includes('permission-denied') || (codeStr.includes('invalid-argument') && /code/i.test(msg))) return t.badCode;
    if (codeStr.includes('deadline-exceeded')) return t.expired;
    if (codeStr.includes('resource-exhausted')) return t.tooMany;
    return t.generic;
  };

  const handleResolution = async (res: Record<string, unknown>) => {
    if (res.status === 'signed_in' && typeof res.token === 'string') {
      setLastLoginMethod('phone');
      await signInWithCustomToken(auth, res.token);
      return; // onAuthStateChanged redirects
    }
    if (res.status === 'choose') {
      setChoice({ selectionToken: String(res.selectionToken), candidates: (res.candidates as Array<{ uid: string; firstName: string; lastInitial: string; email?: string }>) ?? [] });
      setStep('choose');
      return;
    }
    setRecoveryToken(String(res.recoveryToken || ''));
    setStep('no_account');
  };

  const submitRecovery = async () => {
    if (!recoveryToken || !recFirst.trim() || !recLast.trim() || !recDob) return;
    setBusy(true);
    setError('');
    setRawError('');
    try {
      const r = await httpsCallable<unknown, Record<string, unknown>>(fns, 'checkOtp')({
        phoneE164: e164,
        phoneChange: true,
        recoveryToken,
        firstName: recFirst.trim(),
        lastName: recLast.trim(),
        dob: recDob,
      });
      const status = String((r.data ?? {}).status || '');
      if (status === 'pending_approval') {
        setStep('recover_pending');
      } else if (status === 'not_found') {
        setError(t.recoverNotFound);
      } else {
        setError(t.generic);
      }
    } catch (e) {
      setError(mapError(e));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    if (!e164) {
      setError(t.badPhone);
      return;
    }
    setBusy(true);
    setError('');
    setRawError('');
    try {
      await httpsCallable(fns, 'sendOtp')({ phoneE164: e164 });
      setCode('');
      setStep('code');
    } catch (e) {
      setError(mapError(e));
    } finally {
      setBusy(false);
    }
  };

  // Android one-tap code autofill (WebOTP); auto-verifies on receipt.
  useWebOtpAutofill(step === 'code', (otp) => {
    setCode(otp);
    void verifyCode(otp);
  });

  const verifyCode = async (codeOverride?: string) => {
    const codeToUse = codeOverride ?? code;
    if (codeToUse.length !== 6) {
      setError(t.badCode);
      return;
    }
    setBusy(true);
    setError('');
    setRawError('');
    try {
      const r = await httpsCallable<unknown, Record<string, unknown>>(fns, 'checkOtp')({ phoneE164: e164, code: codeToUse, signIn: true });
      await handleResolution(r.data);
    } catch (e) {
      setError(mapError(e));
    } finally {
      setBusy(false);
    }
  };

  const pickAccount = async (uid: string) => {
    if (!choice) return;
    setBusy(true);
    setError('');
    try {
      const r = await httpsCallable<unknown, Record<string, unknown>>(fns, 'checkOtp')({ phoneE164: e164, signIn: true, selectionToken: choice.selectionToken, pick: uid });
      await handleResolution(r.data);
    } catch (e) {
      setError(mapError(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep('phone');
    setCode('');
    setChoice(null);
    setError('');
    setRawError('');
    setRecoveryToken('');
    setRecFirst('');
    setRecLast('');
    setRecDob('');
  };

  const primaryStyle = (disabled: boolean) => ({ ...S.button, ...(disabled ? S.buttonDisabled : {}) });

  return (
    <div style={S.page}>
      <div style={S.top}>
        <button type="button" style={langToggleStyle(lang === 'en')} onClick={() => setLang('en')}>EN</button>
        <span style={{ color: '#ccc', margin: '0 8px' }}>|</span>
        <button type="button" style={langToggleStyle(lang === 'es')} onClick={() => setLang('es')}>ES</button>
      </div>

      <main style={S.main}>
        <h1 style={S.h1}>{t.title}</h1>

        {step === 'phone' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendCode();
            }}
          >
            <label style={S.label} htmlFor="phone-login-number">{t.phoneLabel}</label>
            <input
              id="phone-login-number"
              style={{ ...S.input, fontSize: 22, letterSpacing: '0.02em' }}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              autoFocus
              placeholder="(555) 555-5555"
              value={formatUs(phone)}
              onChange={(e) => setPhone(digitsOnly(e.target.value))}
            />
            <p style={S.hint}>{t.phoneHint}</p>
            <button type="submit" style={primaryStyle(busy || phone.length !== 10)} disabled={busy || phone.length !== 10}>
              {busy ? t.sending : t.continue}
            </button>
            {error && <p style={S.error}>{error}</p>}
            {rawError && <p style={S.mono}>{rawError}</p>}
          </form>
        )}

        {step === 'code' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verifyCode();
            }}
          >
            <label style={S.label} htmlFor="phone-login-code">{t.codeLabel}</label>
            <input
              id="phone-login-code"
              style={{ ...S.input, letterSpacing: '0.35em', fontSize: 26 }}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              placeholder="······"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <p style={S.hint}>
              {t.codeHint} {formatUs(phone)}
            </p>
            <button type="submit" style={primaryStyle(busy || code.length !== 6)} disabled={busy || code.length !== 6}>
              {busy ? t.verifying : t.verify}
            </button>
            {error && <p style={S.error}>{error}</p>}
            {rawError && <p style={S.mono}>{rawError}</p>}
            <div style={{ display: 'flex', gap: 20, marginTop: 24 }}>
              <button type="button" style={S.linkBtn} onClick={() => void sendCode()} disabled={busy}>{t.resend}</button>
              <button type="button" style={S.linkBtn} onClick={reset}>{t.changeNumber}</button>
            </div>
          </form>
        )}

        {step === 'choose' && choice && (
          <div>
            <p style={S.label}>{t.chooseHint}</p>
            <h2 style={{ ...S.h1, fontSize: 20, margin: '0 0 20px' }}>{t.chooseTitle}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {choice.candidates.map((c) => (
                <button
                  key={c.uid}
                  type="button"
                  disabled={busy}
                  style={{ ...S.button, background: '#fff', color: '#111', border: '1.5px solid #111', textAlign: 'left', padding: '14px 16px', ...(busy ? S.buttonDisabled : {}) }}
                  onClick={() => void pickAccount(c.uid)}
                >
                  <span style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>{c.firstName} {c.lastInitial}.</span>
                  {c.email ? <span style={{ display: 'block', fontSize: 13, color: '#666', fontWeight: 400, marginTop: 2 }}>{c.email}</span> : null}
                </button>
              ))}
            </div>
            {error && <p style={S.error}>{error}</p>}
            {rawError && <p style={S.mono}>{rawError}</p>}
            <div style={{ marginTop: 24 }}>
              <button type="button" style={S.linkBtn} onClick={reset}>{t.startOver}</button>
            </div>
          </div>
        )}

        {step === 'no_account' && (
          <div>
            <p style={{ fontSize: 16, lineHeight: 1.45, margin: '0 0 8px' }}>{t.noAccountTitle}</p>
            <p style={S.hint}>{t.noAccountHint}</p>
            <button
              type="button"
              style={S.button}
              onClick={() => navigate(`/c1/apply?phone=${encodeURIComponent(phone.replace(/\D/g, '').slice(-10))}`)}
            >{t.signUp}</button>
            <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
              {recoveryToken && (
                <button type="button" style={S.linkBtn} onClick={() => { setError(''); setStep('recover'); }}>
                  {t.numberChanged}
                </button>
              )}
              <button type="button" style={S.linkBtn} onClick={reset}>{t.startOver}</button>
            </div>
          </div>
        )}

        {step === 'recover' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitRecovery();
            }}
          >
            <h2 style={{ ...S.h1, fontSize: 20, margin: '0 0 8px' }}>{t.recoverTitle}</h2>
            <p style={S.hint}>{t.recoverHint}</p>
            <label style={S.label} htmlFor="recover-first">{t.firstName}</label>
            <input
              id="recover-first"
              style={S.input}
              type="text"
              autoComplete="given-name"
              autoFocus
              value={recFirst}
              onChange={(e) => setRecFirst(e.target.value)}
            />
            <label style={{ ...S.label, marginTop: 16 }} htmlFor="recover-last">{t.lastName}</label>
            <input
              id="recover-last"
              style={S.input}
              type="text"
              autoComplete="family-name"
              value={recLast}
              onChange={(e) => setRecLast(e.target.value)}
            />
            <label style={{ ...S.label, marginTop: 16 }} htmlFor="recover-dob">{t.dobLabel}</label>
            <input
              id="recover-dob"
              style={S.input}
              type="date"
              autoComplete="bday"
              value={recDob}
              onChange={(e) => setRecDob(e.target.value)}
            />
            <button
              type="submit"
              style={{ ...primaryStyle(busy || !recFirst.trim() || !recLast.trim() || !recDob), marginTop: 20 }}
              disabled={busy || !recFirst.trim() || !recLast.trim() || !recDob}
            >
              {busy ? t.sending : t.submitRecovery}
            </button>
            {error && <p style={S.error}>{error}</p>}
            {rawError && <p style={S.mono}>{rawError}</p>}
            <div style={{ marginTop: 24 }}>
              <button type="button" style={S.linkBtn} onClick={reset}>{t.startOver}</button>
            </div>
          </form>
        )}

        {step === 'recover_pending' && (
          <div>
            <h2 style={{ ...S.h1, fontSize: 20, margin: '0 0 8px' }}>{t.recoverPendingTitle}</h2>
            <p style={S.hint}>{t.recoverPendingHint}</p>
          </div>
        )}

      </main>

      <footer style={S.footer}>
        <img src="/C1.png" alt="C1 Staffing" style={S.logo} />
        <button type="button" style={S.quietLink} onClick={() => navigate('/login/email', { state: location.state })}>
          {t.emailLogin}
        </button>
      </footer>
    </div>
  );
};

export default PhoneLoginPage;
