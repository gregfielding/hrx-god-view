import React from 'react';
import { Alert, Box, Chip, CircularProgress, Stack, Typography, Link } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { isCertEngineTrustSurfacesEnabled } from '../../utils/certifications/certEngineFeatureFlags';
import { useWorkforceCertificationIntelligence } from '../../hooks/useWorkforceCertificationIntelligence';
import { PREVIEW_SAMPLE_CERTIFICATION_REQUIREMENTS } from '../../utils/certifications/previewSampleCertificationRequirements';

export type CertificationIntelligencePanelProps = {
  /** User ids to include (typically current filtered table slice). */
  workerIds: string[];
};

/**
 * Phase 5.5 — internal workforce certification intelligence (no automation).
 * Gated by `REACT_APP_CERT_ENGINE_TRUST_SURFACES` (same as Phase 5 trust surfaces).
 */
const CertificationIntelligencePanel: React.FC<CertificationIntelligencePanelProps> = ({ workerIds }) => {
  const enabled = isCertEngineTrustSurfacesEnabled();

  const { loading, error, summary, riskSignals, priorityQueue } = useWorkforceCertificationIntelligence({
    enabled,
    workerIds,
    requirements: PREVIEW_SAMPLE_CERTIFICATION_REQUIREMENTS,
    maxWorkers: 48,
  });

  if (!enabled) return null;

  return (
    <Box
      sx={{
        mx: 2,
        mb: 1.5,
        p: 1.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.paper',
      }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        Certification intelligence (preview catalog)
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Insights only — sample requirements & first {48} workers in view. Not execution gating.
      </Typography>

      {loading && (
        <Stack direction="row" alignItems="center" spacing={1}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            Aggregating certification records…
          </Typography>
        </Stack>
      )}

      {error && (
        <Alert severity="warning" sx={{ py: 0.5 }}>
          {error}
        </Alert>
      )}

      {!loading && !error && summary && (
        <Stack spacing={1.25}>
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', color: 'text.secondary' }}>
              Workforce coverage (sample certs)
            </Typography>
            {Object.entries(summary.certificationCoverage).map(([catalogId, c]) => (
              <Typography key={catalogId} variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                <strong>{catalogId}</strong>: approved {c.approved} · pending {c.pending} · missing {c.missing} ·
                expired/rejected {c.expired} · expiring in 30d: {summary.expiringSoon[catalogId] ?? 0}
              </Typography>
            ))}
            {Object.keys(summary.certificationCoverage).length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No catalog rows for this sample yet.
              </Typography>
            ) : null}
          </Box>

          {summary.highRiskGaps.length > 0 ? (
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', color: 'warning.dark' }}>
                High-risk gaps
              </Typography>
              {summary.highRiskGaps.map((g) => (
                <Typography key={g} variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                  • {g}
                </Typography>
              ))}
            </Box>
          ) : null}

          {riskSignals.filter((r) => r.riskLevel !== 'low').length > 0 ? (
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', color: 'text.secondary' }}>
                Top certification risks
              </Typography>
              {riskSignals
                .filter((r) => r.riskLevel !== 'low')
                .slice(0, 5)
                .map((r) => (
                  <Stack key={r.catalogEntryId} direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.5 }} flexWrap="wrap">
                    <Chip size="small" label={r.riskLevel.toUpperCase()} color={r.riskLevel === 'high' ? 'error' : 'warning'} />
                    <Typography variant="body2" color="text.secondary">
                      {r.displayName}: expiring soon {r.workersExpiringSoon}, expired bucket {r.workersExpired}. {r.recommendation}
                    </Typography>
                  </Stack>
                ))}
            </Box>
          ) : null}

          {priorityQueue.length > 0 ? (
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', color: 'text.secondary' }}>
                Workers needing certification attention (priority)
              </Typography>
              {priorityQueue.slice(0, 8).map((p) => (
                <Typography key={`${p.userId}:${p.catalogEntryId}:${p.issueType}`} variant="body2" sx={{ mt: 0.35 }}>
                  <Link component={RouterLink} to={`/users/${p.userId}`} underline="hover">
                    Worker
                  </Link>{' '}
                  · {p.catalogEntryId} · {p.issueType} (score {p.priorityScore}) — {p.reason}
                </Typography>
              ))}
            </Box>
          ) : null}
        </Stack>
      )}
    </Box>
  );
};

export default CertificationIntelligencePanel;
