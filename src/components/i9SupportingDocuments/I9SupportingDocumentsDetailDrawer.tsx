import React from 'react';
import { Box, Divider, Drawer, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import I9SupportingDocumentsWorkspace from './I9SupportingDocumentsWorkspace';
import type { I9SupportingDocRow } from '../../hooks/useWorkerI9SupportingDocumentsRows';
import { I9_DRAWER_REVIEW_HELPER } from '../../constants/i9SupportingDocumentsEmploymentStrings';

export interface I9SupportingDocumentsDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  workerUserId: string;
  rows: I9SupportingDocRow[];
  loading: boolean;
  error: string | null;
  requestedForEntityId?: string | null;
  employmentEntityKey?: string | null;
}

const I9SupportingDocumentsDetailDrawer: React.FC<I9SupportingDocumentsDetailDrawerProps> = ({
  open,
  onClose,
  tenantId,
  workerUserId,
  rows,
  loading,
  error,
  requestedForEntityId,
  employmentEntityKey,
}) => {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: { width: { xs: '100%', sm: 520, md: 720 }, maxWidth: '100vw' },
      }}
    >
      <Box sx={{ p: 2, pb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="h6" fontWeight={700}>
            I-9 supporting documents
          </Typography>
          <IconButton aria-label="Close" onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, lineHeight: 1.5 }}>
          {I9_DRAWER_REVIEW_HELPER}
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <I9SupportingDocumentsWorkspace
          tenantId={tenantId}
          workerUserId={workerUserId}
          variant="drawer"
          externalRows={rows}
          externalLoading={loading}
          externalError={error}
          requestedForEntityId={requestedForEntityId}
          employmentEntityKey={employmentEntityKey}
          showPageIntro={false}
          suppressStaffRequestButton
        />
      </Box>
    </Drawer>
  );
};

export default I9SupportingDocumentsDetailDrawer;
