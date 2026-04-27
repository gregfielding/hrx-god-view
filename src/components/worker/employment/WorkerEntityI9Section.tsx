/**
 * Worker entity employment page — I-9 supporting uploads (same Firestore/rules as admin; worker-only actions).
 */
import React from 'react';
import { Alert, Box, Typography } from '@mui/material';
import I9SupportingDocumentsWorkspace from '../../i9SupportingDocuments/I9SupportingDocumentsWorkspace';
import { I9_WORKER_ENTITY_EXAMPLES } from '../../../constants/i9SupportingDocumentsEmploymentStrings';

export interface WorkerEntityI9SectionProps {
  tenantId: string;
  workerUserId: string;
  /** `entity_employments` doc id (same as URL segment / pipeline id). */
  employmentRecordId: string;
  /** `entity_employments.entityKey` (e.g. select, workforce). */
  employmentEntityKey?: string | null;
  /** `entity_employments.entityId` — scopes requests when set. */
  requestedForEntityId?: string | null;
  /** Recruiter confirmed supporting docs outside HRX — hide upload UI. */
  i9SupportingManualComplete?: boolean;
}

const WorkerEntityI9Section: React.FC<WorkerEntityI9SectionProps> = ({
  tenantId,
  workerUserId,
  employmentEntityKey,
  requestedForEntityId,
  i9SupportingManualComplete = false,
}) => {
  if (i9SupportingManualComplete) {
    return (
      <Box>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
          I-9 supporting documents
        </Typography>
        <Alert severity="success" variant="outlined" sx={{ mt: 0.5 }}>
          <Typography variant="body2" sx={{ lineHeight: 1.45 }}>
            Your employer confirmed your I-9 supporting documents. You do not need to upload documents here.
          </Typography>
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
        I-9 supporting documents
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25, lineHeight: 1.45 }}>
        Upload the documents your employer needs for Form I-9: one List A, or one List B plus one List C.
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        sx={{ mb: 1.25, lineHeight: 1.45, whiteSpace: 'pre-line', display: { xs: 'none', sm: 'block' } }}
      >
        {I9_WORKER_ENTITY_EXAMPLES}
      </Typography>
      <I9SupportingDocumentsWorkspace
        tenantId={tenantId}
        workerUserId={workerUserId}
        variant="page"
        requestedForEntityId={requestedForEntityId ?? null}
        employmentEntityKey={employmentEntityKey ?? null}
        suppressStaffRequestButton
        showPageIntro={false}
        flatWorkerUploadSurface
      />
    </Box>
  );
};

export default WorkerEntityI9Section;
