/**
 * AccuSource applicant self-service URL — Backgrounds tab (recruiter/staff).
 */
import React, { useCallback, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { BackgroundCheckRecord } from '../../types/backgroundCheck';
import { Timestamp } from 'firebase/firestore';
import {
  applicantSetupStatusSummary,
  resolveApplicantPortalUrl,
  shouldShowApplicantPortalCta,
} from '../../utils/backgroundCheckApplicantPortal';

function formatTs(value: unknown): string {
  if (value == null) return '—';
  if (value instanceof Timestamp) return value.toDate().toLocaleString();
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as Timestamp).toDate === 'function') {
    try {
      return (value as Timestamp).toDate().toLocaleString();
    } catch {
      return '—';
    }
  }
  return '—';
}

export interface AccusourceApplicantSetupPanelProps {
  record: BackgroundCheckRecord;
}

const AccusourceApplicantSetupPanel: React.FC<AccusourceApplicantSetupPanelProps> = ({ record }) => {
  const url = resolveApplicantPortalUrl(record);
  const summary = applicantSetupStatusSummary(record);
  const showPortalCta = shouldShowApplicantPortalCta(record);
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [url]);

  return (
    <Box>
      <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
        <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: 'uppercase' }}>
          AccuSource — applicant setup
        </Typography>
        <Chip
          size="small"
          color={showPortalCta ? 'success' : url && record.hrxStatus === 'awaiting_applicant' ? 'warning' : 'default'}
          label={summary.headline}
        />
        {record.hrxStatus ? (
          <Chip size="small" variant="outlined" label={`HRX: ${record.hrxStatus}`} />
        ) : null}
        {record.providerStatus ? (
          <Chip size="small" variant="outlined" label={`Provider: ${record.providerStatus}`} />
        ) : null}
      </Stack>

      {summary.detail ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1, lineHeight: 1.45 }}>
          {summary.detail}
        </Typography>
      ) : null}

      <Stack direction="row" flexWrap="wrap" gap={2} sx={{ mb: url ? 1 : 0 }}>
        <Box>
          <Typography variant="caption" color="text.secondary" display="block">
            Profile ID
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
            {record.providerProfileId != null && String(record.providerProfileId).trim() !== ''
              ? String(record.providerProfileId)
              : '—'}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary" display="block">
            Last webhook
          </Typography>
          <Typography variant="body2">{formatTs(record.lastWebhookAt)}</Typography>
          {record.lastWebhookType ? (
            <Typography variant="caption" color="text.secondary" display="block">
              {record.lastWebhookType}
            </Typography>
          ) : null}
        </Box>
      </Stack>

      {record.hrxStatus === 'awaiting_applicant' && !url ? (
        <Alert severity="info" sx={{ mt: 0.5 }}>
          Waiting for AccuSource to deliver the applicant setup link (partial_profile_link webhook). Provider status:{' '}
          {record.providerStatus || '—'}.
        </Alert>
      ) : null}

      {url && showPortalCta ? (
        <Stack direction="row" flexWrap="wrap" alignItems="flex-start" gap={1} sx={{ mt: 0.5 }}>
          <Typography
            variant="body2"
            sx={{
              wordBreak: 'break-all',
              flex: '1 1 220px',
              bgcolor: 'action.hover',
              px: 1,
              py: 0.75,
              borderRadius: 1,
              border: 1,
              borderColor: 'divider',
            }}
          >
            {url}
          </Typography>
          <Tooltip title="Open in new tab">
            <IconButton
              size="small"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ alignSelf: 'center' }}
            >
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={copied ? 'Copied' : 'Copy URL'}>
            <IconButton size="small" onClick={() => void copy()} sx={{ alignSelf: 'center' }}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ) : url && !showPortalCta ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Portal link omitted — HRX status is no longer “awaiting applicant.” If you still need the URL, open AccuSource or check audit logs.
        </Typography>
      ) : null}
    </Box>
  );
};

export default AccusourceApplicantSetupPanel;
