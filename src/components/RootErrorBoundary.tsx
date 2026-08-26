import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, CircularProgress, Typography, Button, Paper } from '@mui/material';

type Props = { children: ReactNode };

type State = { hasError: boolean; error: Error | null; autoReloading: boolean };

/**
 * A lazy route chunk 404s whenever a tab loaded before a hosting deploy
 * navigates after it (old hashed chunks are purged by the new release, and
 * the SPA rewrite serves index.html for the missing file). index.html is
 * no-cache, so one reload always recovers — do it automatically, at most
 * once per minute so a genuinely broken deploy still surfaces the card.
 */
const isChunkLoadError = (error: Error): boolean =>
  error.name === 'ChunkLoadError' ||
  /Loading (CSS )?chunk .+ failed/i.test(error.message) ||
  /Unexpected token '<'/.test(error.message);

const CHUNK_RELOAD_KEY = 'hrx_chunk_reload_at';

const shouldAutoReload = (): boolean => {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
};

/**
 * Catches render errors at the root so a failed deploy or runtime bug shows a message
 * instead of a blank white screen (common when the main bundle throws before paint).
 */
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, autoReloading: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[RootErrorBoundary]', error, info.componentStack);
    if (isChunkLoadError(error) && shouldAutoReload()) {
      this.setState({ autoReloading: true });
      window.location.reload();
    }
  }

  render(): ReactNode {
    if (this.state.autoReloading) {
      return (
        <Box
          sx={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            bgcolor: 'background.default',
          }}
        >
          <CircularProgress size={28} />
          <Typography variant="body2" color="text.secondary">
            A new version of HRX ONE was just released — updating…
          </Typography>
        </Box>
      );
    }
    if (this.state.hasError && this.state.error) {
      return (
        <Box
          sx={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 2,
            bgcolor: 'background.default',
          }}
        >
          <Paper elevation={2} sx={{ p: 3, maxWidth: 560 }}>
            <Typography variant="h6" gutterBottom>
              Something went wrong loading HRX ONE
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2, wordBreak: 'break-word' }}>
              {this.state.error.message}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
              If this appeared right after a release, try a hard refresh (Shift+Reload) or clear site data for
              this domain, then reload. Stale cached HTML can point at old JavaScript files.
            </Typography>
            <Button variant="contained" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </Paper>
        </Box>
      );
    }
    return this.props.children;
  }
}
