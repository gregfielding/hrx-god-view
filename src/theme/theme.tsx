import { createTheme, ThemeProvider } from '@mui/material/styles';
import React, { createContext, useContext, useMemo, useState } from 'react';

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
  const colors = mode === 'light' ? lightColors : hrxColors;
  
  return createTheme({
    palette: {
      mode,
      background: {
        default: colors.background,
        paper: colors.surface,
      },
      text: {
        primary: colors.textPrimary,
        secondary: colors.textSecondary,
      },
      primary: {
        main: colors.hrxBlue,
        dark: colors.hrxBlueDark,
        light: colors.hrxBlueLight,
        contrastText: mode === 'light' ? '#FFFFFF' : colors.textPrimary,
      },
      secondary: {
        main: colors.hrxBlueLight,
        dark: colors.hrxBlueDarker,
        light: colors.hrxBlueLighter,
        contrastText: mode === 'light' ? '#FFFFFF' : colors.textPrimary,
      },
      error: {
        main: colors.error,
      },
      success: {
        main: colors.success,
      },
      warning: {
        main: colors.warning,
      },
      info: {
        main: colors.info,
      },
      divider: colors.border,
    },
    typography: {
      fontFamily: 'Helvetica, Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      h1: {
        fontWeight: 700,
        fontSize: '2.5rem',
        letterSpacing: '-0.02em',
      },
      h2: {
        fontWeight: 700,
        fontSize: '2rem',
        letterSpacing: '-0.01em',
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
      body1: {
        fontWeight: 400,
        fontSize: '1rem',
        lineHeight: 1.5,
      },
      body2: {
        fontWeight: 400,
        fontSize: '0.875rem',
        lineHeight: 1.5,
      },
      caption: {
        fontWeight: 500,
        fontSize: '0.75rem',
        lineHeight: 1.4,
      },
      button: {
        fontWeight: 600,
        fontSize: '0.875rem',
        textTransform: 'none',
        letterSpacing: '0.01em',
      },
    },
    shape: {
      borderRadius: 8,
    },
    components: {
      // Button Overrides
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: '8px',
            textTransform: 'none',
            fontWeight: 600,
            fontSize: '0.875rem',
            padding: '8px 16px',
            minHeight: '40px',
            '&:hover': {
              boxShadow: 'none',
            },
            '&.Mui-disabled': {
              backgroundColor: colors.disabled,
              color: colors.textSecondary,
            },
          },
          contained: {
            backgroundColor: colors.hrxBlue,
            color: mode === 'light' ? '#FFFFFF' : colors.textPrimary,
            '&:hover': {
              backgroundColor: colors.hrxBlueDark,
            },
            '&:active': {
              backgroundColor: colors.hrxBlueDarker,
            },
          },
          outlined: {
            borderColor: colors.hrxBlue,
            color: colors.hrxBlue,
            '&:hover': {
              backgroundColor: `${colors.hrxBlue}10`,
              borderColor: colors.hrxBlueLight,
            },
          },
          text: {
            color: colors.hrxBlue,
            '&:hover': {
              backgroundColor: `${colors.hrxBlue}10`,
            },
          },
        },
      },
      
      // Card Overrides
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: '0',
            boxShadow: 'none',
            border: 'none',
            backgroundColor: 'transparent',
          },
        },
      },
                    MuiCardContent: {
                styleOverrides: {
                  root: {
                    padding: '0px 4px',
                    '&:last-child': {
                      paddingBottom: '0px 4px',
                    },
                    '&:first-of-type': {
                      padding: '0px 4px',
                    },
                  },
                },
              },
              MuiCardHeader: {
                styleOverrides: {
                  root: {
                    padding: '0px',
                    marginBottom: '16px',
                    marginTop: '16px',
                  },
                },
              },
      
      // Avatar Overrides
      MuiAvatar: {
        styleOverrides: {
          root: {
            borderRadius: '6px',
            backgroundColor: colors.surfaceLight,
            color: colors.textPrimary,
          },
        },
      },
      
      // TextField Overrides
      MuiTextField: {
        defaultProps: {
          variant: 'outlined',
        },
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              borderRadius: '12px',
              backgroundColor: colors.surfaceLight,
              '& fieldset': {
                borderColor: colors.border,
              },
              '&:hover fieldset': {
                borderColor: colors.hrxBlueLight,
              },
              '&.Mui-focused fieldset': {
                borderColor: colors.hrxBlue,
              },
            },
            '& .MuiInputLabel-root': {
              color: colors.textSecondary,
              '&.Mui-focused': {
                color: colors.hrxBlue,
              },
            },
            '& .MuiInputBase-input': {
              color: colors.textPrimary,
            },
          },
        },
      },
      
      // Table Overrides
      MuiTableContainer: {
        styleOverrides: {
          root: {
            background: 'transparent',
            boxShadow: mode === 'light' ? '0 2px 8px rgba(0, 0, 0, 0.1)' : 'none',
            border: `1px solid ${colors.border}`,
            borderRadius: '12px',
            overflow: 'hidden',
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
            backgroundColor: colors.surfaceLight,
            '& .MuiTableCell-root': {
              fontWeight: 600,
              textTransform: 'none',
              color: colors.textPrimary,
              borderBottom: `1px solid ${colors.border}`,
            },
          },
        },
      },
      MuiTableBody: {
        styleOverrides: {
          root: {
            '& .MuiTableRow-root:nth-of-type(even)': {
              backgroundColor: `${colors.surfaceLight}40`,
            },
            '& .MuiTableRow-root:hover': {
              backgroundColor: `${colors.hrxBlue}10`,
            },
            '& .MuiTableCell-root': {
              borderBottom: `1px solid ${colors.border}`,
              color: colors.textPrimary,
            },
          },
        },
      },
      
      // AppBar Overrides
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: colors.surface,
            borderBottom: `1px solid ${colors.border}`,
            boxShadow: mode === 'light' ? '0 2px 8px rgba(0, 0, 0, 0.1)' : 'none',
            color: colors.textPrimary, // Ensure text/icons use correct color
          },
        },
      },
      // Toolbar Overrides
      MuiToolbar: {
        styleOverrides: {
          root: {
            color: colors.textPrimary, // Ensure toolbar text/icons use correct color
          },
        },
      },
      
      // Drawer Overrides
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: colors.surface,
            borderRight: `1px solid ${colors.border}`,
            boxShadow: mode === 'light' ? '2px 0 8px rgba(0, 0, 0, 0.1)' : 'none',
          },
        },
      },
      
      // ListItem Overrides
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: '8px',
            margin: '2px 8px',
            '&:hover': {
              backgroundColor: `${colors.hrxBlue}20`,
            },
            '&.Mui-selected': {
              backgroundColor: `${colors.hrxBlue}30`,
              '&:hover': {
                backgroundColor: `${colors.hrxBlue}40`,
              },
            },
          },
        },
      },
      
      // Chip Overrides
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: '6px',
            fontWeight: 500,
          },
        },
      },
      
      // Dialog Overrides
      MuiDialog: {
        styleOverrides: {
          paper: {
            backgroundColor: colors.surface,
            borderRadius: '16px',
            border: `1px solid ${colors.border}`,
            boxShadow: mode === 'light' ? '0 8px 32px rgba(0, 0, 0, 0.15)' : '0 8px 32px rgba(0, 0, 0, 0.3)',
          },
        },
      },
      
      // Menu Overrides
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
      
      // Select Overrides
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
    },
  });
};

const ThemeModeContext = createContext({
  mode: 'dark' as 'light' | 'dark',
  toggleMode: () => {
    /* intentionally left blank */
  },
});

export const ThemeModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  console.log('ThemeModeProvider rendering');
  
  // Get initial mode from localStorage or default to dark
  const getInitialMode = (): 'light' | 'dark' => {
    try {
      const savedMode = localStorage.getItem('hrx-theme-mode');
      return savedMode === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  };
  
  const [mode, setMode] = useState<'light' | 'dark'>(getInitialMode);
  const theme = useMemo(() => getTheme(mode), [mode]);
  
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

export default getTheme('dark');
