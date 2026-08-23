/**
 * Phone-number sign-in — alternate login layout (Greg 2026-08-21).
 *
 * Test surface for phone (OTP) identity, route `/login/phone`. Deliberately
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
import { useNavigate } from 'react-router-dom';
import { signInWithCustomToken, onAuthStateChanged, type User } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { setLanguage } from '../i18n';
import { useGuestLanguage } from '../hooks/useGuestLanguage';

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
  // EN/ES choice is captured three ways: persisted for guests (localStorage,
  // same as Login/Jobs Board), applied to the app i18n immediately, and
  // stamped onto users/{uid}.preferredLanguage at sign-in (see below).
  const [lang, setLang] = useGuestLanguage();
  useEffect(() => { setLanguage(lang); }, [lang]);
  const t = COPY[lang];
  const [rawError, setRawError] = useState('');

  const [step, setStep] = useState<'phone' | 'code' | 'choose' | 'no_account'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [choice, setChoice] = useState<{ selectionToken: string; candidates: Array<{ uid: string; firstName: string; lastInitial: string }> } | null>(null);
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
      navigate(level >= 5 ? '/' : `/c1/users/${u.uid}`, { replace: true });
    });
    return unsub;
  }, [navigate, lang]);

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
      await signInWithCustomToken(auth, res.token);
      return; // onAuthStateChanged redirects
    }
    if (res.status === 'choose') {
      setChoice({ selectionToken: String(res.selectionToken), candidates: (res.candidates as Array<{ uid: string; firstName: string; lastInitial: string }>) ?? [] });
      setStep('choose');
      return;
    }
    setStep('no_account');
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

  const verifyCode = async () => {
    if (code.length !== 6) {
      setError(t.badCode);
      return;
    }
    setBusy(true);
    setError('');
    setRawError('');
    try {
      const r = await httpsCallable<unknown, Record<string, unknown>>(fns, 'checkOtp')({ phoneE164: e164, code, signIn: true });
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
                  {c.firstName} {c.lastInitial}.
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
            <button type="button" style={S.button} onClick={() => navigate('/c1/apply')}>{t.signUp}</button>
            <div style={{ marginTop: 24 }}>
              <button type="button" style={S.linkBtn} onClick={reset}>{t.startOver}</button>
            </div>
          </div>
        )}

      </main>

      <footer style={S.footer}>
        <img src="/C1.png" alt="C1 Staffing" style={S.logo} />
        <button type="button" style={S.quietLink} onClick={() => navigate('/login')}>
          {t.emailLogin}
        </button>
      </footer>
    </div>
  );
};

export default PhoneLoginPage;
