/**
 * Phone-number sign-in — alternate login layout (Greg 2026-08-21).
 *
 * Test surface for phone (OTP) identity, route `/login/phone`. Deliberately
 * stripped down: system fonts, black on white, one action per screen, the C1
 * mark small at the bottom. No MUI theme, no card — utilitarian.
 *
 * Flow: phone → Firebase sends the SMS (invisible reCAPTCHA) → 6-digit code →
 * signed in. After sign-in:
 *   - uid has a users/{uid} doc  → normal post-login redirect (same rules as
 *     Login.tsx: workers → their profile, staff → /).
 *   - uid is brand new (phone not attached to any Auth user yet) → we show what
 *     we found on that number (accounts matched by phone) and stop. The JIT
 *     claim/merge ("sign in as the existing account") ships in the next slice
 *     per docs/claude/project_phone_auth.md — nothing is written here.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ConfirmationResult,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, where, limit, setDoc, serverTimestamp } from 'firebase/firestore';
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
    newUidTitle: 'Signed in — but this number isn’t linked to an account yet.',
    newUidFound: 'Accounts on file with this number:',
    newUidNone: 'No accounts on file with this number.',
    newUidNote: 'Linking to your existing account is coming next (test build). Nothing was changed.',
    signOut: 'Sign out',
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
    newUidTitle: 'Sesión iniciada, pero este número aún no está vinculado a una cuenta.',
    newUidFound: 'Cuentas registradas con este número:',
    newUidNone: 'No hay cuentas registradas con este número.',
    newUidNote: 'La vinculación con tu cuenta existente viene en la próxima versión (prueba). No se cambió nada.',
    signOut: 'Cerrar sesión',
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

  const [step, setStep] = useState<'phone' | 'code' | 'unlinked'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [unlinked, setUnlinked] = useState<{ uid: string; matches: Array<{ name: string; role: string }> } | null>(null);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);
  const redirectedRef = useRef(false);

  const e164 = useMemo(() => (phone.length === 10 ? `+1${phone}` : ''), [phone]);

  // Invisible reCAPTCHA — created once, reset between sends.
  useEffect(() => {
    verifierRef.current = new RecaptchaVerifier(auth, 'phone-login-recaptcha', { size: 'invisible' });
    return () => {
      verifierRef.current?.clear();
      verifierRef.current = null;
    };
  }, []);

  // After sign-in: existing account → normal redirect; brand-new uid → show what we found, stop.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u: User | null) => {
      if (!u || redirectedRef.current) return;
      const snap = await getDoc(doc(db, 'users', u.uid));
      if (snap.exists()) {
        redirectedRef.current = true;
        // Capture the EN/ES choice made on this screen as the worker's preference.
        if (snap.get('preferredLanguage') !== lang) {
          await setDoc(doc(db, 'users', u.uid), { preferredLanguage: lang, updatedAt: serverTimestamp() }, { merge: true }).catch(() => undefined);
        }
        const level = parseInt(String(snap.get('securityLevel') ?? snap.get('tenantIds')?.BCiP2bQ9CgVOCTfV6MhD?.securityLevel ?? '0'), 10);
        navigate(level >= 5 ? '/' : `/c1/users/${u.uid}`, { replace: true });
        return;
      }
      const ph = u.phoneNumber || e164;
      const matches: Array<{ name: string; role: string }> = [];
      if (ph) {
        const ten = ph.replace(/\D/g, '').slice(-10);
        const variants = [ph, ten, `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`, `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`];
        for (const field of ['phoneE164', 'phone']) {
          const qs = await getDocs(query(collection(db, 'users'), where(field, 'in', variants), limit(10))).catch(() => null);
          qs?.forEach((d) => {
            const name = `${d.get('firstName') ?? ''} ${String(d.get('lastName') ?? '').slice(0, 1)}.`.trim();
            if (!matches.some((m) => m.name === name)) matches.push({ name, role: String(d.get('tenantIds')?.BCiP2bQ9CgVOCTfV6MhD?.role ?? d.get('role') ?? '') });
          });
        }
      }
      setUnlinked({ uid: u.uid, matches });
      setStep('unlinked');
    });
    return unsub;
  }, [navigate, e164, lang]);

  const mapError = (e: unknown): string => {
    const codeStr = String((e as { code?: string })?.code || '');
    setRawError(codeStr || String((e as { message?: string })?.message || e));
    if (codeStr.includes('invalid-phone-number')) return t.badPhone;
    if (codeStr.includes('invalid-verification-code')) return t.badCode;
    if (codeStr.includes('code-expired')) return t.expired;
    if (codeStr.includes('too-many-requests')) return t.tooMany;
    return t.generic;
  };

  const sendCode = async () => {
    if (!e164) {
      setError(t.badPhone);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const verifier = verifierRef.current!;
      const result = await signInWithPhoneNumber(auth, e164, verifier);
      setConfirmation(result);
      setCode('');
      setStep('code');
    } catch (e) {
      setError(mapError(e));
      // reCAPTCHA tokens are single-use; rebuild so the retry works.
      try {
        verifierRef.current?.clear();
        verifierRef.current = new RecaptchaVerifier(auth, 'phone-login-recaptcha', { size: 'invisible' });
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    if (!confirmation || code.length !== 6) {
      setError(t.badCode);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await confirmation.confirm(code);
      // onAuthStateChanged takes it from here.
    } catch (e) {
      setError(mapError(e));
    } finally {
      setBusy(false);
    }
  };

  const primaryStyle = (disabled: boolean) => ({ ...S.button, ...(disabled ? S.buttonDisabled : {}) });

  return (
    <div style={S.page}>
      <style>{'.grecaptcha-badge { visibility: hidden !important; }'}</style>
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
              <button type="button" style={S.linkBtn} onClick={() => { setStep('phone'); setError(''); setCode(''); }}>{t.changeNumber}</button>
            </div>
          </form>
        )}

        {step === 'unlinked' && unlinked && (
          <div>
            <p style={{ fontSize: 16, lineHeight: 1.45, margin: '0 0 16px' }}>{t.newUidTitle}</p>
            <p style={S.label}>{unlinked.matches.length ? t.newUidFound : t.newUidNone}</p>
            {unlinked.matches.length > 0 && (
              <ul style={{ margin: '0 0 16px', paddingLeft: 18, fontSize: 16, lineHeight: 1.6 }}>
                {unlinked.matches.map((m) => (
                  <li key={m.name}>{m.name}{m.role ? <span style={{ color: '#777' }}> · {m.role}</span> : null}</li>
                ))}
              </ul>
            )}
            <p style={S.hint}>{t.newUidNote}</p>
            <p style={S.mono}>uid {unlinked.uid}</p>
            <button
              type="button"
              style={{ ...S.button, marginTop: 20 }}
              onClick={async () => {
                await signOut(auth);
                setUnlinked(null);
                setConfirmation(null);
                setCode('');
                setStep('phone');
              }}
            >
              {t.signOut}
            </button>
          </div>
        )}

        <div id="phone-login-recaptcha" />
      </main>

      <footer style={S.footer}>
        <img src="/C1.png" alt="C1 Staffing" style={S.logo} />
        <button type="button" style={S.quietLink} onClick={() => navigate('/login')}>
          {t.emailLogin}
        </button>
        {/* Required when the reCAPTCHA badge is hidden (Google branding terms). */}
        <p style={S.legal}>
          Protected by reCAPTCHA ·{' '}
          <a href="https://policies.google.com/privacy" style={{ color: '#aaa' }} target="_blank" rel="noreferrer">Privacy</a> ·{' '}
          <a href="https://policies.google.com/terms" style={{ color: '#aaa' }} target="_blank" rel="noreferrer">Terms</a>
        </p>
      </footer>
    </div>
  );
};

export default PhoneLoginPage;
