/**
 * Worker Document Card — single required/optional doc with status and actions.
 * Spec: HRX / C1 Worker Documents Page Spec — Section 4
 */

import React from 'react';
import { Card, CardContent, CardActions, Typography, Stack, Chip, Button } from '@mui/material';

export type DocStatus = 'missing' | 'submitted' | 'verified';

export interface WorkerDocumentItem {
  key: string;
  label: string;
  status: DocStatus;
  fileUrl?: string;
  /** Optional expiration for certifications; shows "Expires …" / "Expiring soon" badge */
  expiresAt?: Date | string | null;
}

const STATUS_CHIP: Record<DocStatus, { label: string; color: 'default' | 'warning' | 'success' }> = {
  missing: { label: 'Missing', color: 'warning' },
  submitted: { label: 'Submitted', color: 'default' },
  verified: { label: 'Verified', color: 'success' },
};

const HELPER_TEXT: Record<DocStatus, string> = {
  missing: 'Upload to unlock more shifts.',
  submitted: 'Review in progress.',
  verified: "You're all set.",
};

export interface WorkerDocumentCardProps {
  doc: WorkerDocumentItem;
  onUpload?: (key: string) => void;
  onReplace?: (key: string) => void;
  onView?: (key: string, fileUrl: string) => void;
}

function parseExpiresAt(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') return new Date(v);
  return null;
}

const WorkerDocumentCard: React.FC<WorkerDocumentCardProps> = ({
  doc,
  onUpload,
  onReplace,
  onView,
}) => {
  const chip = STATUS_CHIP[doc.status];
  const helperText = HELPER_TEXT[doc.status];
  const showUpload = doc.status === 'missing' && onUpload;
  const showReplace = (doc.status === 'submitted' || doc.status === 'verified') && onReplace;
  const showView = doc.status !== 'missing' && doc.fileUrl && onView;

  const expiresAt = parseExpiresAt(doc.expiresAt);
  const now = new Date();
  const isExpired = expiresAt != null && expiresAt.getTime() < now.getTime();
  const isExpiringSoon = expiresAt != null && !isExpired && (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000) <= 30;
  const expiresLabel = expiresAt ? expiresAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 2,
        borderColor: 'divider',
        boxShadow: 'none',
      }}
    >
      <CardContent sx={{ pb: 0 }}>
        <Stack spacing={0.5}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} flexWrap="wrap">
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {doc.label}
            </Typography>
            <Stack direction="row" alignItems="center" spacing={0.5} flexWrap="wrap">
              {expiresLabel && (isExpired || isExpiringSoon) && (
                <Chip
                  label={isExpired ? `Expired ${expiresLabel}` : `Expires ${expiresLabel}`}
                  color={isExpired ? 'error' : 'warning'}
                  size="small"
                  variant="outlined"
                />
              )}
              <Chip label={chip.label} color={chip.color} size="small" />
            </Stack>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {helperText}
          </Typography>
        </Stack>
      </CardContent>
      <CardActions sx={{ justifyContent: 'flex-end', px: 2, pt: 1, pb: 1.5 }}>
        {showUpload && (
          <Button size="small" variant="contained" onClick={() => onUpload(doc.key)}>
            Upload
          </Button>
        )}
        {showReplace && (
          <Button size="small" variant="outlined" onClick={() => onReplace(doc.key)}>
            Replace
          </Button>
        )}
        {showView && (
          <Button size="small" variant="text" onClick={() => onView(doc.key, doc.fileUrl!)}>
            View
          </Button>
        )}
      </CardActions>
    </Card>
  );
};

export default WorkerDocumentCard;
