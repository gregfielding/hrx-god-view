/**
 * Worker UI theme — design system for C1 worker view (securityLevel 0–4).
 * Inherits shared design tokens and base theme; adds worker-specific interaction
 * (card tap, button press, nav selected state) and layout (hero card, outlined inputs).
 * See docs/DESIGN_SYSTEM_WORKER.md for tokens and rules.
 */

import { createTheme } from '@mui/material/styles';
import { getBaseTheme } from './createBaseTheme';
import { designTokens } from './designTokens';

const t = designTokens;

/** Motion: press 150ms, page 140ms, bottom sheet 180ms, hover 120ms. Easing: cubic-bezier(.2,.8,.2,1). */
const motionEasing = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** Re-export shared tokens for backward compatibility; worker uses same radius/shadow/spacing as base. */
export const workerDesignTokens = {
  radius: t.radius,
  shadow: t.shadow,
  pageY: t.spacing.pageY,
  pageX: t.spacing.pageX,
  pageXSm: t.spacing.pageXSm,
} as const;

export function getWorkerTheme() {
  return createTheme(getBaseTheme(), {
    palette: {
      text: {
        // Ink, not slate (P1 theme pass — phone-login language).
        primary: '#16181A',
        secondary: '#6B6B6B',
      },
      background: {
        // Warm near-white (P1 theme pass 2026-08-23, phone-login language) —
        // the old #F7F9FC read blue and made every card float on a tint.
        default: '#FAFAF8',
        paper: '#FFFFFF',
      },
    },
    typography: {
      // System stack (phone-login language) — no webfont download, native feel.
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      h5: { fontWeight: 650, letterSpacing: '-0.01em', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
      h6: { fontWeight: 650, letterSpacing: '-0.01em', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
      h1: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
      h2: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
      h3: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
      h4: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
      subtitle1: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', color: '#16181A' },
      subtitle2: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', color: '#16181A' },
      body2: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
      caption: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
      overline: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
      body1: {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 1.5,
      },
      button: {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        textTransform: 'none' as const,
        fontWeight: 600,
        fontSize: 15,
        letterSpacing: 0,
        lineHeight: 1.2,
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            fontFeatureSettings: '"cv02", "cv03", "cv04", "cv11"',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            // Phone-login language: hairline border, no shadow, quieter radius.
            borderRadius: t.radius.md,
            border: '1px solid #E9E9E5',
            // The base (admin) theme pads every Card 24px; on worker screens that
            // stacked with CardContent's 16px into 40px insets. CardContent alone
            // owns the padding here.
            padding: 0,
            boxShadow: 'none',
            transition: `border-color 120ms ${motionEasing}, transform 150ms ${motionEasing}`,
            '&:hover': { boxShadow: 'none' },
            '&:active': { transform: 'scale(0.985)' },
            '&.worker-hero-card': {
              borderRadius: t.radius.lg,
              padding: 24,
            },
          },
        },
      },
      MuiCardContent: {
        styleOverrides: {
          root: {
            // Uniform card inset (the old mix of 18–24px + a 0px last-child
            // from the base theme made every page's cards inset differently).
            padding: 16,
            '&:last-child': { paddingBottom: 16 },
          },
        },
      },
      MuiCardActionArea: {
        styleOverrides: {
          root: {
            minHeight: 44,
            transition: `background-color 120ms ${motionEasing}, transform 150ms ${motionEasing}`,
            '&:active': { backgroundColor: 'rgba(0,0,0,0.04)' },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          containedPrimary: {
            // Phone-login language: the one solid button is ink, not blue.
            backgroundColor: '#111111',
            color: '#FFFFFF',
            '&:hover': { backgroundColor: '#000000' },
          },
          root: {
            fontSize: 15,
            minHeight: 44,
            transition: `transform 150ms ${motionEasing}, box-shadow 120ms ${motionEasing}`,
            '&:active': { transform: 'scale(0.98)' },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            minWidth: 44,
            minHeight: 44,
            transition: `transform 150ms ${motionEasing}`,
            '&:active': { transform: 'scale(0.98)' },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            minHeight: 44,
            paddingLeft: 16,
            paddingRight: 16,
            '&.Mui-selected': {
              backgroundColor: 'rgba(74, 144, 226, 0.1)',
              borderLeft: '4px solid #1F6FC9',
              paddingLeft: 12,
              '&:hover': {
                backgroundColor: 'rgba(74, 144, 226, 0.12)',
              },
            },
          },
        },
      },
      MuiListItemIcon: {
        styleOverrides: {
          root: {
            minWidth: 40,
            '& > *': { fontSize: 22 },
          },
        },
      },
      MuiTextField: {
        defaultProps: {
          size: 'medium',
          variant: 'outlined',
        },
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              borderRadius: t.radius.md,
              minHeight: 44,
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderWidth: 2,
                borderColor: '#4A90E2',
              },
            },
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          root: {
            minHeight: 48,
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            fontSize: 15,
            minHeight: 48,
            padding: '12px 20px',
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            // Flat, full-width hairline bar (the base MuiPaper radius was
            // rounding it into a floating card).
            borderRadius: 0,
            boxShadow: 'none',
            borderBottom: '1px solid #E9E9E5',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            borderRadius: 0,
            borderRight: '1px solid rgba(0,0,0,0.06)',
            boxShadow: 'none',
          },
        },
      },
      MuiTable: {
        styleOverrides: {
          root: {
            '& .MuiTableCell-root': {
              padding: '16px 12px',
            },
          },
        },
      },
      MuiSkeleton: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            backgroundColor: 'rgba(0,0,0,0.06)',
            backgroundImage:
              'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)',
            backgroundSize: '200% 100%',
            animation: 'workerShimmer 1.6s infinite linear',
            '@keyframes workerShimmer': {
              '0%': { backgroundPosition: '200% 0' },
              '100%': { backgroundPosition: '-200% 0' },
            },
          },
          rectangular: {
            borderRadius: 12,
          },
        },
      },
    },
  });
}

export default getWorkerTheme;
