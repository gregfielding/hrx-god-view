import { createTheme, ThemeProvider } from '@mui/material/styles';
import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { getBaseTheme } from './createBaseTheme';
import { designTokens } from './designTokens';

// HRX One Enterprise Design System Colors (legacy / dark mode)
const hrxColors = {
  background: '#000000',
  surface: '#111111',
  surfaceLight: '#1C1C1E',
  textPrimary: '#FFFFFF',
  textSecondary: '#AAAAAA',
  border: '#2C2C2C',
  hrxBlue: '#4A90E2',
  hrxBlueDark: '#3273C6',
  hrxBlueDarker: '#235DA9',
  hrxBlueLight: '#6AA9F0',
  hrxBlueLighter: '#9BCBFF',
  scheduler: '#F4B400',
  talent: '#2ECC71',
  intelligence: '#6C5CE7',
  positive: '#2ECC71',
  informational: '#4A90E2',
  concern: '#F39C12',
  warning: '#E74C3C',
  disabled: '#555555',
  error: '#E74C3C',
  success: '#2ECC71',
  info: '#4A90E2',
  shell: { bg: '#333333', border: '#4A4A4A' },
  brandPrimary: '#0057B8',
};

// Light mode colors (legacy export)
const lightColors = {
  background: '#FFFFFF',
  surface: '#F8F9FA',
  surfaceLight: '#E9ECEF',
  textPrimary: '#212529',
  textSecondary: '#6C757D',
  border: '#DEE2E6',
  hrxBlue: '#4A90E2',
  hrxBlueDark: '#3273C6',
  hrxBlueDarker: '#235DA9',
  hrxBlueLight: '#6AA9F0',
  hrxBlueLighter: '#9BCBFF',
  scheduler: '#F4B400',
  talent: '#2ECC71',
  intelligence: '#6C5CE7',
  positive: '#2ECC71',
  informational: '#4A90E2',
  concern: '#F39C12',
  warning: '#E74C3C',
  disabled: '#ADB5BD',
  error: '#E74C3C',
  success: '#2ECC71',
  info: '#4A90E2',
  shell: { bg: '#333333', border: '#4A4A4A' },
  brandPrimary: '#0057B8',
  surfacePage: '#F5F5F7',
  surfaceRow: '#FFFFFF',
  surfaceRowHover: '#FFFFFF',
  textInverted: '#FFFFFF',
  rowHoverBorder: '#D0D7E2',
  unreadPillBg: '#0057B8',
  unreadPillText: '#FFFFFF',
  divider: '#E5E7EB',
};

const radius = designTokens.radius.md;

const getTheme = (mode: 'light' | 'dark') => {
  const base = getBaseTheme();
  const colors = mode === 'light' ? lightColors : hrxColors;

  return createTheme(base, {
    palette:
      mode === 'dark'
        ? {
            mode: 'dark',
            background: {
              default: hrxColors.background,
              paper: hrxColors.surface,
            },
            text: {
              primary: hrxColors.textPrimary,
              secondary: hrxColors.textSecondary,
              disabled: hrxColors.disabled,
            },
            divider: hrxColors.border,
          }
        : {},
    components: {
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: radius,
            margin: '4px 8px',
            minHeight: 48,
            color: mode === 'light' ? '#5A6372' : '#AAAAAA',
            '&:hover': {
              backgroundColor: mode === 'light' ? '#F7F9FC' : '#1C1C1E',
              color: '#4A90E2',
            },
            '&.Mui-selected': {
              backgroundColor: 'transparent',
              color: '#4A90E2',
              borderLeft: '4px solid #4A90E2',
              paddingLeft: 12,
              '&:hover': {
                backgroundColor: mode === 'light' ? '#F7F9FC' : '#1C1C1E',
              },
            },
            '& .MuiListItemIcon-root': { color: 'inherit', minWidth: 40 },
            '& .MuiListItemText-root .MuiTypography-root': {
              fontWeight: 600,
              fontSize: '0.875rem',
            },
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: mode === 'light' ? '#FFFFFF' : '#111111',
            borderRight:
              mode === 'light' ? '1px solid rgba(0,0,0,0.06)' : '1px solid #2C2C2C',
            boxShadow: 'none',
            '& .MuiListItemButton-root': {
              borderRadius: radius,
              margin: '4px 8px',
              minHeight: 48,
              color: mode === 'light' ? '#5A6372' : '#AAAAAA',
              '&:hover': {
                backgroundColor: mode === 'light' ? '#F7F9FC' : '#1C1C1E',
                color: '#4A90E2',
              },
              '&.Mui-selected': {
                backgroundColor: 'transparent',
                color: '#4A90E2',
                borderLeft: '4px solid #4A90E2',
                paddingLeft: 12,
                '&:hover': {
                  backgroundColor: mode === 'light' ? '#F7F9FC' : '#1C1C1E',
                },
              },
            },
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: colors.surface,
            borderBottom: `1px solid ${colors.border}`,
            boxShadow:
              mode === 'light' ? designTokens.shadow.card : 'none',
            color: colors.textPrimary,
          },
        },
      },
      MuiTextField:
        mode === 'dark'
          ? {
              styleOverrides: {
                root: {
                  '& .MuiFilledInput-root': {
                    backgroundColor: '#1C1C1E',
                    '&:hover': { backgroundColor: '#2C2C2C' },
                    '&.Mui-focused': {
                      backgroundColor: '#111111',
                      border: '1px solid #4A90E2',
                    },
                  },
                  '& .MuiInputLabel-root': { color: '#AAAAAA' },
                  '& .MuiInputBase-input': { color: '#FFFFFF' },
                  '& .MuiFormHelperText-root': { color: '#555555' },
                },
              },
            }
          : {},
      MuiTableHead:
        mode === 'dark'
          ? {
              styleOverrides: {
                root: {
                  '& .MuiTableCell-root': {
                    color: '#AAAAAA',
                    borderBottom: '1px solid #2C2C2C',
                  },
                },
              },
            }
          : {},
      MuiTableBody:
        mode === 'dark'
          ? {
              styleOverrides: {
                root: {
                  '& .MuiTableRow-root:nth-of-type(odd)': {
                    backgroundColor: '#121212',
                  },
                  '& .MuiTableRow-root:hover': {
                    backgroundColor: '#1C1C1E',
                  },
                  '& .MuiTableCell-root': {
                    borderBottom: '1px solid #2C2C2C',
                    color: '#FFFFFF',
                  },
                },
              },
            }
          : {},
      MuiDivider:
        mode === 'dark'
          ? { styleOverrides: { root: { borderColor: '#2C2C2C' } } }
          : {},
      MuiSkeleton:
        mode === 'dark'
          ? {
              styleOverrides: {
                root: {
                  backgroundColor: '#2C2C2C',
                  '&::after': {
                    background:
                      'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
                  },
                },
              },
            }
          : {},
      MuiAlert:
        mode === 'dark'
          ? {
              styleOverrides: {
                root: { border: '1px solid #2C2C2C' },
                standardInfo: {
                  backgroundColor: '#4A90E2',
                  color: '#FFFFFF',
                  '& .MuiAlert-icon': { color: '#FFFFFF' },
                },
                standardSuccess: {
                  backgroundColor: '#2ECC71',
                  color: '#FFFFFF',
                  '& .MuiAlert-icon': { color: '#FFFFFF' },
                },
                standardWarning: {
                  backgroundColor: '#F39C12',
                  color: '#FFFFFF',
                  '& .MuiAlert-icon': { color: '#FFFFFF' },
                },
                standardError: {
                  backgroundColor: '#E74C3C',
                  color: '#FFFFFF',
                  '& .MuiAlert-icon': { color: '#FFFFFF' },
                },
              },
            }
          : {},
      MuiAccordionSummary: {
        styleOverrides: {
          root: {
            '& .MuiButton-root': { marginRight: 12 },
          },
        },
      },
      MuiSnackbar: {
        styleOverrides: {
          root: {
            '& .MuiSnackbarContent-root': {
              borderRadius: radius,
              backgroundColor: '#0B0D12',
              color: '#FFFFFF',
              boxShadow: designTokens.shadow.modal,
            },
          },
        },
      },
    },
  });
};

const ThemeModeContext = createContext({
  mode: 'light' as 'light' | 'dark',
  toggleMode: () => {
    /* intentionally left blank */
  },
});

export const ThemeModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const forceLightMode = () => {
    try {
      localStorage.removeItem('hrx-theme-mode');
    } catch {
      // ignore
    }
  };
  const getInitialMode = (): 'light' | 'dark' => {
    try {
      const saved = localStorage.getItem('hrx-theme-mode');
      return saved === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  };
  const [mode, setMode] = useState<'light' | 'dark'>(getInitialMode);
  const theme = useMemo(() => getTheme(mode), [mode]);

  useEffect(() => {
    forceLightMode();
    if (mode === 'dark') setMode('light');
  }, []);

  const toggleMode = () => {
    const next = mode === 'light' ? 'dark' : 'light';
    setMode(next);
    try {
      localStorage.setItem('hrx-theme-mode', next);
    } catch {
      // ignore
    }
  };

  return (
    <ThemeModeContext.Provider value={{ mode, toggleMode }}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ThemeModeContext.Provider>
  );
};

export const useThemeMode = () => useContext(ThemeModeContext);
export { hrxColors, lightColors };
export default getTheme('light');
