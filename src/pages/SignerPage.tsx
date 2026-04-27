/**
 * HRX Signatures — signer page (Phase S0).
 * Route: /sign/s/:sessionId
 * Loads session, shows placeholder (or iframe when provider URL is returned).
 */

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Typography, Button, CircularProgress, Alert } from '@mui/material';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

interface SessionInfo {
  sessionId: string;
  tenantId: string;
  envelopeId: string;
  signerId: string;
  returnUrl: string;
  status: string;
  expiresAt: string;
  expired: boolean;
}

const SignerPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [signingUrl, setSigningUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setError('Missing session ID');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const getSessionFn = httpsCallable<{ sessionId: string }, SessionInfo>(functions, 'signatureGetSession');
        const res = await getSessionFn({ sessionId: sessionId! });
        const data = res.data;
        if (cancelled) return;
        if (data.expired) {
          setError('This signing link has expired.');
          setLoading(false);
          return;
        }
        setSession(data);
        const getUrlFn = httpsCallable<{ sessionId: string }, { url: string }>(functions, 'signatureGetSigningUrl');
        const urlRes = await getUrlFn({ sessionId: sessionId! });
        if (cancelled) return;
        setSigningUrl(urlRes.data?.url ?? null);
      } catch (err: unknown) {
        if (!cancelled) {
          setError((err as { message?: string })?.message ?? 'Failed to load signing session');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const handleDone = () => {
    if (session?.returnUrl) {
      window.location.href = session.returnUrl;
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '40vh', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error) {
    return (
      <Box sx={{ p: 3, maxWidth: 480, mx: 'auto' }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }
  if (!session) return null;

  return (
    <Box sx={{ p: 3, maxWidth: 720, mx: 'auto' }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Sign documents
      </Typography>
      <Box
        sx={{
          border: '1px dashed',
          borderColor: 'divider',
          borderRadius: 2,
          p: 4,
          textAlign: 'center',
          bgcolor: 'action.hover',
        }}
      >
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Signing experience will appear here (Phase S1: Dropbox Sign embedded signing).
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Session: {session.sessionId.slice(0, 8)}… · Envelope: {session.envelopeId.slice(0, 8)}…
        </Typography>
        {signingUrl && (
          <Typography variant="caption" display="block" sx={{ mt: 1 }} color="text.secondary">
            URL: {signingUrl}
          </Typography>
        )}
      </Box>
      <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
        <Button variant="contained" onClick={handleDone}>
          Done (return)
        </Button>
      </Box>
    </Box>
  );
};

export default SignerPage;
