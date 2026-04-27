import React, { useState } from 'react';
import { Box, Button, Card, Divider, IconButton, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useCertificationShadowStats } from '../../hooks/useCertificationShadowStats';
import {
  CERT_SHADOW_AUTOMATION_MISMATCH_RATE_MAX,
  certificationShadowMeetsAutomationThreshold,
} from '../../utils/certifications/buildCertificationShadowStatsThresholds';

/**
 * Dev-only: mismatch rate + top unmapped / mismatch keys. Requires HRX Firestore read + shadow events written
 * (`REACT_APP_CERT_SHADOW_PERSISTENCE=true`).
 *
 * Production: not imported — `App.tsx` only `lazy`-loads this module when `NODE_ENV === 'development'`.
 */
export default function CertEngineShadowDebugPanel() {
  const { stats, loading, error, refresh } = useCertificationShadowStats({ queryLimit: 1500 });
  const [collapsed, setCollapsed] = useState(false);
  const gate = certificationShadowMeetsAutomationThreshold({
    mismatchRate: stats.mismatchRate,
    totalEvents: stats.totalEvents,
    topUnmappedStrings: stats.topUnmappedStrings,
  });

  if (collapsed) {
    return (
      <Box
        sx={{
          position: 'fixed',
          bottom: 8,
          right: 8,
          zIndex: (theme) => theme.zIndex.tooltip + 2,
        }}
      >
        <Button size="small" variant="outlined" onClick={() => setCollapsed(false)}>
          Cert shadow
        </Button>
      </Box>
    );
  }

  return (
    <Card
      elevation={6}
      sx={{
        position: 'fixed',
        bottom: 8,
        right: 8,
        zIndex: (theme) => theme.zIndex.tooltip + 2,
        maxWidth: 360,
        p: 1.5,
        fontSize: 12,
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="subtitle2">Cert shadow (sample)</Typography>
        <Stack direction="row" spacing={0}>
          <IconButton size="small" aria-label="refresh" onClick={() => refresh()}>
            <RefreshIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" aria-label="close" onClick={() => setCollapsed(true)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Last ~1500 events. Flip switch? Target mismatch &lt; {CERT_SHADOW_AUTOMATION_MISMATCH_RATE_MAX * 100}% + low unmapped volume.
      </Typography>
      {loading && <Typography variant="body2">Loading…</Typography>}
      {error && (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      )}
      {!loading && !error && (
        <>
          <Typography variant="body2">
            Events: {stats.totalEvents} · Mismatch rate:{' '}
            <strong>{(stats.mismatchRate * 100).toFixed(1)}%</strong>
          </Typography>
          <Typography variant="caption" color="text.secondary">
            By surface — apply: {stats.bySurface.apply} · placement: {stats.bySurface.placement} · readiness:{' '}
            {stats.bySurface.readiness}
          </Typography>
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" fontWeight="bold">
            Top unmapped strings
          </Typography>
          {stats.topUnmappedStrings.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              (none in sample)
            </Typography>
          ) : (
            stats.topUnmappedStrings.map((u) => (
              <Typography key={u.label} variant="caption" display="block">
                {u.label.slice(0, 48)}
                {u.label.length > 48 ? '…' : ''} — {u.count}
              </Typography>
            ))
          )}
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" fontWeight="bold">
            Top mismatch certs
          </Typography>
          {stats.topMismatchCerts.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              (none in sample)
            </Typography>
          ) : (
            stats.topMismatchCerts.map((c, i) => (
              <Typography key={`${c.catalogEntryId ?? c.legacyLabel ?? i}`} variant="caption" display="block">
                {c.catalogEntryId ?? c.legacyLabel ?? '?'} — {c.count}
              </Typography>
            ))
          )}
          <Divider sx={{ my: 1 }} />
          <Typography
            variant="body2"
            color={gate.ok ? 'success.main' : 'warning.main'}
            fontWeight="medium"
          >
            Phase 7 automation: {gate.ok ? 'thresholds OK (review reasons anyway)' : 'NOT READY'}
          </Typography>
          {!gate.ok && (
            <Typography variant="caption" color="text.secondary" component="div">
              {gate.reasons.join(' · ')}
            </Typography>
          )}
        </>
      )}
    </Card>
  );
}
