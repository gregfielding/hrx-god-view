/**
 * /slack/oauth/callback — landing page for the "Natalie Brooks (HRX)" Slack
 * app's user-token OAuth (docs/claude/reference_slack_natalie_persona.md).
 *
 * Slack redirects here with `?code=…` after the persona clicks Allow. There
 * is no server-side handler on purpose: an operator copies the code (or the
 * whole URL) into `functions/.scratch/slack-natalie-token-exchange.cjs`,
 * which exchanges it with the client secret from Secret Manager. This page
 * exists so the SPA stops bouncing the callback to /login and losing the
 * code (2026-09-07: three authorizations lost that way). Public route — the
 * code is single-use, expires in ~10 minutes, and is useless without the
 * client secret.
 */
import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';

const SlackOAuthCallback: React.FC = () => {
  const [params] = useSearchParams();
  const code = (params.get('code') || '').trim();
  const error = (params.get('error') || '').trim();
  const [copied, setCopied] = useState<'code' | 'url' | null>(null);
  const fullUrl = useMemo(() => (typeof window !== 'undefined' ? window.location.href : ''), []);

  const copy = async (what: 'code' | 'url') => {
    const text = what === 'code' ? code : fullUrl;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2, bgcolor: 'background.default' }}>
      <Paper sx={{ p: 4, maxWidth: 640, width: '100%' }}>
        <Stack spacing={2}>
          <Typography variant="h5">Slack authorization</Typography>
          {error ? (
            <Typography color="error">Slack returned an error: {error}. Open the authorize link again and click Allow.</Typography>
          ) : code ? (
            <>
              <Typography>
                Slack approved the app. Copy the code below (it is single-use and expires in about 10 minutes) and
                hand it to the token exchange.
              </Typography>
              <TextField label="Authorization code" value={code} fullWidth InputProps={{ readOnly: true }} size="small" />
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={() => copy('code')}>
                  {copied === 'code' ? 'Copied' : 'Copy code'}
                </Button>
                <Button variant="outlined" onClick={() => copy('url')}>
                  {copied === 'url' ? 'Copied' : 'Copy full URL'}
                </Button>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Nothing was stored by this page. The exchange runs from the HRX functions workspace and keeps the
                resulting token in Secret Manager.
              </Typography>
            </>
          ) : (
            <Typography>No authorization code in the URL. Start from the Slack authorize link and click Allow.</Typography>
          )}
        </Stack>
      </Paper>
    </Box>
  );
};

export default SlackOAuthCallback;
