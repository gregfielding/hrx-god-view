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
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {doc.label}
            </Typography>
            <Chip label={chip.label} color={chip.color} size="small" />
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
