/**
 * Shared base theme built from design tokens.
 * Admin and worker themes inherit from this; no interaction-specific overrides (no button press scale, no card tap).
 */

import { createTheme, type Shadows } from '@mui/material/styles';
import { designTokens } from './designTokens';

const t = designTokens;

const shadows = [
  'none',
  t.shadow.card,
  '0 2px 6px rgba(0,0,0,0.06)',
  '0 3px 8px rgba(0,0,0,0.06)',
  t.shadow.cardHover,
  '0 6px 16px rgba(0,0,0,0.07)',
  '0 8px 18px rgba(0,0,0,0.07)',
  '0 10px 20px rgba(0,0,0,0.08)',
  t.shadow.elevated,
  '0 8px 24px rgba(0,0,0,0.08)',
  '0 10px 28px rgba(0,0,0,0.09)',
  '0 12px 32px rgba(0,0,0,0.09)',
  t.shadow.modal,
  '0 14px 44px rgba(0,0,0,0.10)',
  '0 16px 48px rgba(0,0,0,0.10)',
  '0 18px 52px rgba(0,0,0,0.11)',
  '0 20px 56px rgba(0,0,0,0.11)',
  '0 22px 60px rgba(0,0,0,0.12)',
  '0 24px 64px rgba(0,0,0,0.12)',
  '0 26px 68px rgba(0,0,0,0.13)',
  '0 28px 72px rgba(0,0,0,0.13)',
  '0 30px 76px rgba(0,0,0,0.14)',
  '0 32px 80px rgba(0,0,0,0.14)',
  '0 34px 84px rgba(0,0,0,0.15)',
  '0 36px 88px rgba(0,0,0,0.15)',
] as Shadows;

export function getBaseTheme() {
  return createTheme({
    palette: {
      mode: 'light',
      ...t.palette,
    },
    typography: {
      fontFamily: t.typography.fontFamily,
      ...t.typography,
    },
    shape: {
      borderRadius: t.radius.md,
    },
    shadows,
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            borderRadius: t.radius.md,
            border: '1px solid rgba(0,0,0,0.06)',
            boxShadow: t.shadow.card,
            backgroundColor: '#FFFFFF',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: t.radius.md,
            border: '1px solid rgba(0,0,0,0.06)',
            boxShadow: t.shadow.card,
            backgroundColor: '#FFFFFF',
            padding: 24,
            boxSizing: 'border-box',
            transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
            '&:hover': {
              boxShadow: t.shadow.cardHover,
              borderColor: 'rgba(0,0,0,0.09)',
            },
            '&.MuiCard-tonal': {
              backgroundColor: '#F7F9FC',
              border: 'none',
            },
          },
        },
      },
      MuiCardContent: {
        styleOverrides: {
          root: {
            '&:last-child': { paddingBottom: 0 },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: t.radius.md,
            padding: '10px 20px',
            minHeight: 44,
            textTransform: 'none',
            fontWeight: 600,
            fontSize: '0.875rem',
            transition: 'box-shadow 0.2s ease',
            '& .MuiButton-startIcon': { marginRight: 8, marginLeft: -4 },
            '& .MuiButton-endIcon': { marginLeft: 8, marginRight: -4 },
          },
          contained: {
            '&:hover': { boxShadow: '0 2px 8px rgba(74, 144, 226, 0.35)' },
          },
          outlined: {
            borderWidth: 2,
            '&:hover': { borderWidth: 2 },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: t.radius.sm,
            transition: 'background-color 0.2s ease',
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: t.radius.pill,
            fontWeight: 600,
            fontSize: 12,
            height: 28,
            paddingLeft: 10,
            paddingRight: 10,
          },
          colorPrimary: { backgroundColor: '#4A90E2', color: '#FFFFFF' },
          colorSuccess: { backgroundColor: '#E7F7F0', color: '#1E9E6A' },
          colorWarning: { backgroundColor: '#FFF7E6', color: '#B88207' },
          colorError: { backgroundColor: '#FDECEC', color: '#D14343' },
          colorInfo: { backgroundColor: '#E8F3FC', color: '#1F6FC9' },
        },
      },
      MuiTabs: {
        styleOverrides: {
          root: {
            minHeight: 44,
            borderBottom: '1px solid rgba(0,0,0,0.06)',
          },
          indicator: {
            height: 3,
            borderRadius: '3px 3px 0 0',
            backgroundColor: '#4A90E2',
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 600,
            fontSize: '0.875rem',
            minHeight: 44,
            padding: '12px 16px',
          },
        },
      },
      MuiTextField: {
        defaultProps: { size: 'small', variant: 'filled' },
        styleOverrides: {
          root: {
            '& .MuiFilledInput-root': {
              backgroundColor: '#F7F9FC',
              borderRadius: t.radius.md,
              '&:hover': { backgroundColor: '#F0F2F5' },
              '&.Mui-focused': {
                backgroundColor: '#FFFFFF',
                border: '1px solid #4A90E2',
              },
            },
            '& .MuiInputLabel-root': {
              color: '#5A6372',
              '&.Mui-focused': { color: '#4A90E2' },
            },
            '& .MuiInputBase-input': { color: '#0B0D12' },
            '& .MuiFormHelperText-root': {
              color: '#8B94A3',
              fontSize: '0.75rem',
            },
          },
        },
      },
      MuiDivider: {
        styleOverrides: {
          root: { borderColor: 'rgba(0,0,0,0.06)' },
        },
      },
      MuiLink: {
        styleOverrides: {
          root: { fontWeight: 600 },
        },
      },
      MuiAvatar: {
        styleOverrides: {
          root: {
            borderRadius: t.radius.sm,
            backgroundColor: '#E9ECEF',
            color: '#0B0D12',
          },
        },
      },
      MuiTableContainer: {
        styleOverrides: {
          root: {
            background: 'transparent',
            boxShadow: 'none',
            border: 'none',
            borderRadius: 0,
            overflow: 'auto',
          },
        },
      },
      MuiTable: {
        styleOverrides: {
          root: { background: 'transparent' },
        },
      },
      MuiTableHead: {
        styleOverrides: {
          root: {
            '& .MuiTableCell-root': {
              fontWeight: 600,
              fontSize: 12,
              letterSpacing: '0.5px',
              color: '#5A6372',
              borderBottom: '1px solid rgba(0,0,0,0.08)',
              padding: '14px 12px',
            },
          },
        },
      },
      MuiTableBody: {
        styleOverrides: {
          root: {
            '& .MuiTableRow-root:hover': {
              backgroundColor: 'rgba(0,0,0,0.02)',
            },
            '& .MuiTableCell-root': {
              borderBottom: '1px solid rgba(0,0,0,0.06)',
              color: '#0B0D12',
              padding: '14px 12px',
            },
          },
        },
      },
      MuiSkeleton: {
        styleOverrides: {
          root: {
            borderRadius: t.radius.md,
            backgroundColor: 'rgba(0,0,0,0.06)',
          },
          rectangular: { borderRadius: t.radius.md },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: t.radius.md,
            border: '1px solid rgba(0,0,0,0.06)',
            '& .MuiAlert-icon': { fontSize: 20 },
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: t.radius.md,
            boxShadow: t.shadow.elevated,
            border: '1px solid rgba(0,0,0,0.06)',
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(0,0,0,0.23)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#4A90E2' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#4A90E2' },
          },
        },
      },
    },
  });
}

export default getBaseTheme;
