/**
 * I-9 supporting documents (List A–C uploads): staff + worker UI on User Profile → Backgrounds & compliance (detail surface).
 * Primary actions also live on Employment → Tax and identity.
 * @see docs/I9_SUPPORTING_DOCUMENTS_ARCHITECTURE.md
 */
import React from 'react';
import { Paper, Stack, Typography } from '@mui/material';
import I9SupportingDocumentsWorkspace from './I9SupportingDocumentsWorkspace';

export interface I9SupportingDocumentsSectionProps {
  tenantId: string;
  /** Profile user (worker) whose documents are shown. */
  workerUserId: string;
}

const I9SupportingDocumentsSection: React.FC<I9SupportingDocumentsSectionProps> = ({ tenantId, workerUserId }) => {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={700}>
          I-9 supporting documents
        </Typography>
      </Stack>

      <Typography variant="body2" sx={{ mb: 1, lineHeight: 1.5 }}>
        Upload I-9 supporting documents here (List A/B/C). Primary requests and status also appear on the Employment tab.
      </Typography>

      <I9SupportingDocumentsWorkspace
        tenantId={tenantId}
        workerUserId={workerUserId}
        variant="page"
        showPageIntro
      />
    </Paper>
  );
};

export default I9SupportingDocumentsSection;
