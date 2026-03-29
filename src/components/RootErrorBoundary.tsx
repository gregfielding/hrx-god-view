import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';

type Props = { children: ReactNode };

type State = { hasError: boolean; error: Error | null };

/**
 * Catches render errors at the root so a failed deploy or runtime bug shows a message
 * instead of a blank white screen (common when the main bundle throws before paint).
 */
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[RootErrorBoundary]', error, info.componentStack);
  }

  render(): ReactNode {
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
