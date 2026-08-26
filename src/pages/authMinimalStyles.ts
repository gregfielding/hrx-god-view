/**
 * Shared look for the stripped-down auth screens (Greg 2026-08-21): system
 * fonts, black on white, underline inputs, one black action, the C1 mark
 * small at the bottom. "High-end but utilitarian." Used by Login (email)
 * and PhoneLoginPage; no MUI theme involved on purpose.
 */
import type { CSSProperties } from 'react';

export const AUTH_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const A: Record<string, CSSProperties> = {
  page: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: '#fff',
    color: '#111',
    fontFamily: AUTH_FONT,
    WebkitFontSmoothing: 'antialiased',
  },
  top: { width: '100%', display: 'flex', justifyContent: 'flex-end', padding: '16px 20px', fontSize: 13 },
  main: {
    width: '100%',
    maxWidth: 360,
    padding: '0 24px',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  },
  h1: { fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em', margin: '0 0 28px' },
  label: { display: 'block', fontSize: 13, color: '#555', marginBottom: 8 },
  field: { marginBottom: 24 },
  input: {
    width: '100%',
    fontFamily: AUTH_FONT,
    fontSize: 20,
    padding: '12px 0',
    border: 'none',
    borderBottom: '1.5px solid #111',
    borderRadius: 0,
    outline: 'none',
    background: 'transparent',
    color: '#111',
  },
  hint: { fontSize: 13, color: '#666', margin: '10px 0 28px', lineHeight: 1.45 },
  button: {
    width: '100%',
    fontFamily: AUTH_FONT,
    fontSize: 16,
    fontWeight: 600,
    padding: '15px 0',
    background: '#111',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },
  buttonDisabled: { opacity: 0.45, cursor: 'default' },
  linkBtn: {
    background: 'none',
    border: 'none',
    padding: 0,
    fontFamily: AUTH_FONT,
    fontSize: 14,
    color: '#111',
    textDecoration: 'underline',
    cursor: 'pointer',
  },
  quietLink: { background: 'none', border: 'none', padding: 0, fontFamily: AUTH_FONT, fontSize: 12, color: '#888', cursor: 'pointer' },
  error: { fontSize: 14, color: '#b00020', margin: '12px 0 0', lineHeight: 1.4 },
  success: { fontSize: 14, color: '#1b5e20', margin: '12px 0 0', lineHeight: 1.4 },
  footer: { padding: '28px 0 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  logo: { width: 56, height: 'auto', display: 'block' },
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: '#666' },
  legal: { fontSize: 10, color: '#aaa', margin: '6px 0 0', textAlign: 'center', lineHeight: 1.4 },
};

export const langToggleStyle = (active: boolean): CSSProperties => ({
  ...A.linkBtn,
  textDecoration: 'none',
  color: active ? '#111' : '#999',
});
