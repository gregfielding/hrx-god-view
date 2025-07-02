import { createTheme, ThemeProvider } from '@mui/material/styles';
import React, { createContext, useContext, useMemo, useState } from 'react';

const getTheme = (mode: 'light' | 'dark') =>
  createTheme({
    palette: {
      mode,
    },
    components: {
      MuiTableContainer: {
        styleOverrides: {
          root: {
            background: 'transparent',
            boxShadow: 'none',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
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
    },
  });

const ThemeModeContext = createContext({
  mode: 'light' as 'light' | 'dark',
  toggleMode: () => { /* intentionally left blank */ },
});

export const ThemeModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<'light' | 'dark'>('dark');
  const theme = useMemo(() => getTheme(mode), [mode]);
  const toggleMode = () => setMode((prev) => (prev === 'light' ? 'dark' : 'light'));

  return (
    <ThemeModeContext.Provider value={{ mode, toggleMode }}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ThemeModeContext.Provider>
  );
};

export const useThemeMode = () => useContext(ThemeModeContext);

export default getTheme('dark'); 