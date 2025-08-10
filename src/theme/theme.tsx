import { createTheme, ThemeProvider } from '@mui/material/styles';
import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';

// HRX One Enterprise Design System Colors
const hrxColors = {
  // Core Theme Colors
  background: '#000000',
  surface: '#111111',
  surfaceLight: '#1C1C1E',
  textPrimary: '#FFFFFF',
  textSecondary: '#AAAAAA',
  border: '#2C2C2C',
  
  // HRX Blue Palette
  hrxBlue: '#4A90E2',
  hrxBlueDark: '#3273C6',
  hrxBlueDarker: '#235DA9',
  hrxBlueLight: '#6AA9F0',
  hrxBlueLighter: '#9BCBFF',
  
  // Module Accent Colors
  scheduler: '#F4B400',
  talent: '#2ECC71',
  intelligence: '#6C5CE7',
  
  // Message Tone Colors
  positive: '#2ECC71',
  informational: '#4A90E2',
  concern: '#F39C12',
  warning: '#E74C3C',
  
  // UI Colors
  disabled: '#555555',
  error: '#E74C3C',
  success: '#2ECC71',
  info: '#4A90E2',
};

// Light mode colors
const lightColors = {
  // Core Theme Colors
  background: '#FFFFFF',
  surface: '#F8F9FA',
  surfaceLight: '#E9ECEF',
  textPrimary: '#212529',
  textSecondary: '#6C757D',
  border: '#DEE2E6',
  
  // HRX Blue Palette (same for brand consistency)
  hrxBlue: '#4A90E2',
  hrxBlueDark: '#3273C6',
  hrxBlueDarker: '#235DA9',
  hrxBlueLight: '#6AA9F0',
  hrxBlueLighter: '#9BCBFF',
  
  // Module Accent Colors (same for brand consistency)
  scheduler: '#F4B400',
  talent: '#2ECC71',
  intelligence: '#6C5CE7',
  
  // Message Tone Colors (same for brand consistency)
  positive: '#2ECC71',
  informational: '#4A90E2',
  concern: '#F39C12',
  warning: '#E74C3C',
  
  // UI Colors (same for brand consistency)
  disabled: '#ADB5BD',
  error: '#E74C3C',
  success: '#2ECC71',
  info: '#4A90E2',
};

const getTheme = (mode: 'light' | 'dark') => {
  const radius = 12;
  
  // Use modern colors for light mode, keep existing for dark mode
  const colors = mode === 'light' ? {
    // Modern light mode colors
    background: '#F7F8FB',
    surface: '#FFFFFF',
    surfaceLight: '#E9ECEF',
    textPrimary: '#0B0D12',
    textSecondary: '#5A6372',
    border: 'rgba(0,0,0,.06)',
    hrxBlue: '#4A90E2',
    hrxBlueDark: '#1F6FC9',
    hrxBlueDarker: '#235DA9',
    hrxBlueLight: '#E8F1FC',
    hrxBlueLighter: '#9BCBFF',
    error: '#D14343',
    errorLight: '#FDECEC',
    warning: '#B88207',
    warningLight: '#FFF7E6',
    success: '#1E9E6A',
    successLight: '#E7F7F0',
    info: '#2A7BBF',
    infoLight: '#E8F3FC',
    disabled: '#ADB5BD',
  } : hrxColors;
  
  return createTheme({
    palette: {
      mode,
      background: {
        default: '#F7F8FB',
        paper: '#FFFFFF',
      },
      text: {
        primary: '#0B0D12',
        secondary: '#5A6372',
        disabled: '#8B94A3',
      },
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
        light: '#FDECEC',
        contrastText: '#FFFFFF',
      },
      warning: {
        main: '#B88207',
        light: '#FFF7E6',
      },
      success: {
        main: '#1E9E6A',
        light: '#E7F7F0',
      },
      info: {
        main: '#2A7BBF',
        light: '#E8F3FC',
      },
      divider: 'rgba(0,0,0,.06)',
    },
    typography: {
      fontFamily: 'Poppins, Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
      h1: {
        fontSize: 32,
        fontWeight: 600,
        lineHeight: 1.25,
      },
      h2: {
        fontSize: 24,
        fontWeight: 600,
        lineHeight: 1.3,
      },
      h3: {
        fontWeight: 600,
        fontSize: '1.75rem',
        letterSpacing: '-0.01em',
      },
      h4: {
        fontWeight: 600,
        fontSize: '1.5rem',
        letterSpacing: '-0.01em',
      },
      h5: {
        fontWeight: 600,
        fontSize: '1.25rem',
        letterSpacing: '-0.01em',
      },
      h6: {
        fontWeight: 600,
        fontSize: '1.125rem',
        letterSpacing: '-0.01em',
      },
      subtitle1: {
        fontSize: 16,
        fontWeight: 600,
        color: '#5A6372',
      },
      body1: {
        fontSize: 14,
        lineHeight: 1.6,
      },
      body2: {
        fontWeight: 400,
        fontSize: '0.875rem',
        lineHeight: 1.6,
      },
      caption: {
        fontSize: 12,
        fontWeight: 500,
        color: '#8B94A3',
      },
      button: {
        textTransform: 'none',
        fontWeight: 600,
        letterSpacing: 0,
      },
    },
    shape: {
      borderRadius: radius,
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            boxShadow: 'none',
            border: '1px solid rgba(0,0,0,.08)',
            backgroundColor: '#FFFFFF'
          }
        }
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: radius,
            border: '1px solid rgba(0,0,0,.08)',
            boxShadow: 'none',
            backgroundColor: '#FFFFFF',
            padding: '24px',
            '&.MuiCard-tonal': {
              backgroundColor: '#F7F9FC',
              border: 'none',
            },
            '&:hover': {
              borderColor: 'rgba(0,0,0,.12)'
            }
          }
        }
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 999, // pill buttons
            padding: '6px 16px',
            textTransform: 'none',
            fontWeight: 600,
            fontSize: '0.875rem',
            minHeight: '40px',
            transition: 'all 200ms ease-in-out',
            '&:hover': {
              boxShadow: 'none',
            },
            '&.Mui-disabled': {
              backgroundColor: '#ADB5BD',
              color: '#8B94A3',
            },
            '&.MuiButton-sizeXsmall': {
              height: 24,
              minHeight: 24,
              padding: '0 8px',
              minWidth: 'auto',
              borderRadius: 999,
              fontSize: '0.8125rem',
              lineHeight: '24px',
              letterSpacing: 0,
            },
            '& .MuiButton-startIcon': { marginRight: 6, marginLeft: -2 },
            '& .MuiButton-endIcon': { marginLeft: 6, marginRight: -2 },
            '& .MuiButton-startIcon > *:nth-of-type(1)': { fontSize: 18 },
            '& .MuiButton-endIcon > *:nth-of-type(1)': { fontSize: 18 },
          },
          containedPrimary: {
            backgroundColor: '#4A90E2',
            color: '#FFFFFF',
            '&:hover': { 
              backgroundColor: '#1F6FC9' 
            },
            '&:active': {
              backgroundColor: '#235DA9',
            },
          },
          outlinedPrimary: {
            borderWidth: 2,
            borderColor: '#4A90E2',
            color: '#4A90E2',
            '&:hover': { 
              borderWidth: 2,
              backgroundColor: '#E8F1FC',
            },
          },
          textPrimary: {
            color: '#4A90E2',
            '&:hover': {
              backgroundColor: '#E8F1FC',
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 999, // full pill
            fontWeight: 600,
            paddingInline: 8,
            height: 28,
          },
          colorError: {
            backgroundColor: '#FDECEC',
            color: '#D14343',
            border: 'none'
          },
          colorSuccess: {
            backgroundColor: '#E7F7F0',
            color: '#1E9E6A',
            border: 'none'
          },
          colorWarning: {
            backgroundColor: '#FFF7E6',
            color: '#B88207',
            border: 'none'
          },
          colorInfo: {
            backgroundColor: '#E8F3FC',
            color: '#1F6FC9',
            border: 'none'
          }
        }
      },
      MuiTabs: {
        styleOverrides: {
          indicator: {
            height: 3,
            borderRadius: 2,
            backgroundColor: '#4A90E2'
          },
          root: {
            minHeight: 44,
            borderBottom: 'none',
            '& .MuiTabs-scroller': {
              paddingLeft: 0,
              paddingRight: 0
            }
          }
        }
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 600,
            color: '#5A6372',
            fontSize: '0.875rem',
            padding: '12px 16px',
            minHeight: 44,
            '&.Mui-selected': {
              color: '#0B0D12'
            },
            '&:hover': {
              color: '#4A90E2'
            }
          }
        }
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: radius,
            margin: '4px 8px',
            minHeight: '48px',
            color: '#5A6372',
            '&:hover': {
              backgroundColor: '#F7F9FC',
              color: '#4A90E2',
            },
            '&.Mui-selected': {
              backgroundColor: 'transparent',
              color: '#4A90E2',
              borderLeft: '4px solid #4A90E2',
              paddingLeft: '12px',
              '&:hover': {
                backgroundColor: '#F7F9FC',
              },
            },
            '& .MuiListItemIcon-root': {
              color: 'inherit',
              minWidth: '40px',
            },
            '& .MuiListItemText-root': {
              '& .MuiTypography-root': {
                fontWeight: 600,
                fontSize: '0.875rem',
              },
            },
          }
        }
      },
      MuiDivider: {
        styleOverrides: {
          root: {
            borderColor: 'rgba(0,0,0,.06)'
          }
        }
      },
      MuiLink: {
        styleOverrides: {
          root: {
            fontWeight: 600
          }
        }
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            transition: 'all 200ms ease-in-out'
          }
        }
      },
      MuiTextField: {
        defaultProps: {
          size: 'small',
          variant: 'filled'
        },
        styleOverrides: {
          root: {
            '& .MuiFilledInput-root': {
              backgroundColor: '#F7F9FC',
              borderRadius: radius,
              '&:hover': {
                backgroundColor: '#F0F2F5',
              },
              '&.Mui-focused': {
                backgroundColor: '#FFFFFF',
                border: '1px solid #4A90E2',
              },
            },
            '& .MuiInputLabel-root': {
              color: '#5A6372',
              '&.Mui-focused': {
                color: '#4A90E2',
              },
            },
            '& .MuiInputBase-input': {
              color: '#0B0D12',
            },
            '& .MuiFormHelperText-root': {
              color: '#8B94A3',
              fontSize: '0.75rem',
            },
          }
        }
      },
      MuiAccordionSummary: {
        styleOverrides: {
          root: {
            '& .MuiButton-root': {
              marginRight: '12px',
            },
          },
        },
      },
      MuiAvatar: {
        styleOverrides: {
          root: {
            borderRadius: '6px',
            backgroundColor: colors.surfaceLight,
            color: colors.textPrimary,
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
            overflow: 'visible',
          },
        },
      },
      MuiTable: {
        styleOverrides: {
          root: {
            background: 'transparent',
          },
        },
      },
      MuiTableHead: {
        styleOverrides: {
          root: {
            backgroundColor: 'transparent',
            '& .MuiTableCell-root': {
              fontWeight: 600,
              textTransform: 'uppercase',
              fontSize: '0.75rem',
              letterSpacing: '0.5px',
              color: '#5A6372',
              borderBottom: '1px solid rgba(0,0,0,.06)',
              padding: '16px 12px',
            },
          },
        },
      },
      MuiTableBody: {
        styleOverrides: {
          root: {
            '& .MuiTableRow-root': {
              '&:hover': {
                backgroundColor: '#F7F9FC',
                cursor: 'pointer',
              },
            },
            '& .MuiTableCell-root': {
              borderBottom: '1px solid rgba(0,0,0,.06)',
              color: '#0B0D12',
              padding: '16px 12px',
            },
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: colors.surface,
            borderBottom: `1px solid ${colors.border}`,
            boxShadow: mode === 'light' ? '0 2px 8px rgba(0, 0, 0, 0.1)' : 'none',
            color: colors.textPrimary,
          },
        },
      },
      MuiToolbar: {
        styleOverrides: {
          root: {
            color: colors.textPrimary,
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: '#FFFFFF',
            borderRight: '1px solid rgba(0,0,0,.06)',
            boxShadow: 'none',
            width: '72px',
            '&:hover': {
              width: '240px',
            },
            transition: 'width 200ms ease-in-out',
            '& .MuiListItemButton-root': {
              borderRadius: 12,
              margin: '4px 8px',
              minHeight: '48px',
              color: '#5A6372',
              '&:hover': {
                backgroundColor: '#F7F9FC',
                color: '#4A90E2'
              },
              '&.Mui-selected': {
                backgroundColor: 'transparent',
                color: '#4A90E2',
                borderLeft: '4px solid #4A90E2',
                paddingLeft: '12px',
                '&:hover': {
                  backgroundColor: '#F7F9FC'
                }
              }
            }
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            backgroundColor: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: '12px',
            boxShadow: mode === 'light' ? '0 8px 32px rgba(0, 0, 0, 0.15)' : '0 8px 32px rgba(0, 0, 0, 0.3)',
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: colors.border,
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: colors.hrxBlueLight,
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: colors.hrxBlue,
            },
          },
        },
      },
      MuiSkeleton: {
        styleOverrides: {
          root: {
            backgroundColor: '#F0F2F5',
            '&::after': {
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
            },
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            border: '1px solid rgba(0,0,0,.08)',
            '& .MuiAlert-icon': {
              fontSize: 20,
            },
          },
          standardInfo: {
            backgroundColor: '#E8F3FC',
            color: '#1F6FC9',
            '& .MuiAlert-icon': {
              color: '#1F6FC9',
            },
          },
          standardSuccess: {
            backgroundColor: '#E7F7F0',
            color: '#1E9E6A',
            '& .MuiAlert-icon': {
              color: '#1E9E6A',
            },
          },
          standardWarning: {
            backgroundColor: '#FFF7E6',
            color: '#B88207',
            '& .MuiAlert-icon': {
              color: '#B88207',
            },
          },
          standardError: {
            backgroundColor: '#FDECEC',
            color: '#D14343',
            '& .MuiAlert-icon': {
              color: '#D14343',
            },
          },
        },
      },
      MuiSnackbar: {
        styleOverrides: {
          root: {
            '& .MuiSnackbarContent-root': {
              borderRadius: 12,
              backgroundColor: '#0B0D12',
              color: '#FFFFFF',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15)',
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
  console.log('ThemeModeProvider rendering');
  
  // Force light mode for all users - clear any existing dark mode preferences
  const forceLightMode = () => {
    try {
      localStorage.removeItem('hrx-theme-mode');
    } catch {
      // Ignore localStorage errors
    }
  };
  
  // Get initial mode from localStorage or default to light
  const getInitialMode = (): 'light' | 'dark' => {
    try {
      const savedMode = localStorage.getItem('hrx-theme-mode');
      return savedMode === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  };
  
  const [mode, setMode] = useState<'light' | 'dark'>(getInitialMode);
  const theme = useMemo(() => getTheme(mode), [mode]);
  
  // Force light mode on component mount
  useEffect(() => {
    forceLightMode();
    if (mode === 'dark') {
      setMode('light');
    }
  }, []);
  
  const toggleMode = () => {
    const newMode = mode === 'light' ? 'dark' : 'light';
    setMode(newMode);
    try {
      localStorage.setItem('hrx-theme-mode', newMode);
    } catch {
      // Ignore localStorage errors
    }
  };

  return (
    <ThemeModeContext.Provider value={{ mode, toggleMode }}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ThemeModeContext.Provider>
  );
};

export const useThemeMode = () => useContext(ThemeModeContext);

// Export HRX colors for use in components
export { hrxColors, lightColors };

export default getTheme('light');
