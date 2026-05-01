/**
 * Shared core design tokens for HRX UI (admin and worker).
 * Typography, spacing, radius, shadows, palette, and visual styles for buttons, chips, forms.
 * Worker and admin themes inherit from the base theme built from these tokens.
 */

export const designTokens = {
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    pill: 9999,
  },
  shadow: {
    card: '0 1px 3px rgba(0,0,0,0.06)',
    cardHover: '0 4px 12px rgba(0,0,0,0.08)',
    elevated: '0 4px 20px rgba(0,0,0,0.08)',
    modal: '0 12px 40px rgba(0,0,0,0.12)',
  },
  spacing: {
    pageY: 24,
    pageX: 24,
    pageXSm: 16,
  },
  palette: {
    background: { default: '#F7F8FB', paper: '#FFFFFF' },
    text: { primary: '#0B0D12', secondary: '#5A6372', disabled: '#8B94A3' },
    primary: {
      main: '#4A90E2',
      dark: '#1F6FC9',
      light: '#E8F1FC',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#8B94A3',
      dark: '#5A6372',
      light: '#C9CFD8',
      contrastText: '#FFFFFF',
    },
    error: {
      main: '#D14343',
      dark: '#B71C1C',
      light: '#FDECEC',
      contrastText: '#FFFFFF',
    },
    warning: {
      main: '#B88207',
      dark: '#8B6B05',
      light: '#FFF7E6',
      contrastText: '#FFFFFF',
    },
    success: {
      main: '#1E9E6A',
      dark: '#158A5A',
      light: '#E7F7F0',
      contrastText: '#FFFFFF',
    },
    info: {
      main: '#2A7BBF',
      dark: '#1F6FC9',
      light: '#E8F3FC',
      contrastText: '#FFFFFF',
    },
    divider: 'rgba(0,0,0,0.06)',
  },
  typography: {
    fontFamily: 'Poppins, Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
    h1: { fontSize: 24, fontWeight: 700, lineHeight: 1.25, letterSpacing: '-0.02em' },
    h2: { fontSize: 20, fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.02em' },
    h3: { fontSize: 18, fontWeight: 600, lineHeight: 1.35, letterSpacing: '-0.01em' },
    h4: { fontSize: 16, fontWeight: 600, lineHeight: 1.4 },
    h5: { fontSize: 18, fontWeight: 600, lineHeight: 1.35 },
    h6: { fontSize: 16, fontWeight: 600, lineHeight: 1.4 },
    subtitle1: { fontSize: 16, fontWeight: 600, lineHeight: 1.5, color: '#5A6372' },
    subtitle2: { fontSize: 14, fontWeight: 600, lineHeight: 1.5, color: '#5A6372' },
    body1: { fontSize: 14, fontWeight: 400, lineHeight: 1.6 },
    body2: { fontSize: 12, fontWeight: 400, lineHeight: 1.5 },
    caption: { fontSize: '0.6875rem', fontWeight: 500, lineHeight: 1.4, color: '#8B94A3' },
    button: { textTransform: 'none' as const, fontWeight: 600, letterSpacing: 0 },
  },
};

export type DesignTokens = typeof designTokens;
