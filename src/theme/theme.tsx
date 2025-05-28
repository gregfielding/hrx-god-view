// theme.ts
import { createTheme, ThemeOptions } from '@mui/material/styles';
import { useMemo, useEffect, useState, createContext, useContext, ReactNode } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';

const getTheme = (mode: 'light' | 'dark'): ThemeOptions => ({
  palette: {
    mode,
    ...(mode === 'light'
      ? {
          primary: { main: '#287FA0' },
          secondary: { main: '#FFC700' },
          background: { default: '#f5f5f5', paper: '#ffffff' },
        }
      : {
          primary: { main: '#FFC700' },
          secondary: { main: '#287FA0' },
          background: { default: '#121212', paper: '#1e1e1e' },
        }),
  },
  typography: {
    fontFamily: ['Helvetica', 'Arial', 'sans-serif'].join(','),
    h1: { fontFamily: 'Poppins, Helvetica, Arial, sans-serif', fontWeight: 800 },
    h2: { fontFamily: 'Poppins, Helvetica, Arial, sans-serif', fontWeight: 800 },
    h3: { fontFamily: 'Poppins, Helvetica, Arial, sans-serif', fontWeight: 600 },
    h4: { fontFamily: 'Poppins, Helvetica, Arial, sans-serif', fontWeight: 600 },
    h5: { fontFamily: 'Poppins, Helvetica, Arial, sans-serif', fontWeight: 600 },
    h6: { fontFamily: 'Poppins, Helvetica, Arial, sans-serif', fontWeight: 400 },
  },
});

type ThemeContextType = {
  mode: 'light' | 'dark';
  toggleMode: () => void;
};

const ThemeModeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeModeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('hrx-theme-mode');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    localStorage.setItem('hrx-theme-mode', mode);
  }, [mode]);

  const theme = useMemo(() => createTheme(getTheme(mode)), [mode]);
  const toggleMode = () => setMode((prev) => (prev === 'light' ? 'dark' : 'light'));

  return (
    <ThemeModeContext.Provider value={{ mode, toggleMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
};

export const useThemeMode = () => {
  const context = useContext(ThemeModeContext);
  if (!context) throw new Error('useThemeMode must be used within a ThemeModeProvider');
  return context;
};
