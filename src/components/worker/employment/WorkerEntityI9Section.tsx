/**
 * Worker entity employment page — I-9 supporting uploads (same Firestore/rules as admin; worker-only actions).
 */
import React from 'react';
import { Box, Card, CardContent, Typography } from '@mui/material';
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
}

const WorkerEntityI9Section: React.FC<WorkerEntityI9SectionProps> = ({
  tenantId,
  workerUserId,
  employmentEntityKey,
  requestedForEntityId,
}) => {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
      <CardContent>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
          I-9 supporting documents
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25, lineHeight: 1.5 }}>
          Your employer needs identity and work-authorization documents for Form I-9. Upload{' '}
          <strong>one List A</strong> document, <strong>or</strong> <strong>one List B</strong> and{' '}
          <strong>one List C</strong> document.
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          component="div"
          sx={{ mb: 1.5, lineHeight: 1.5, whiteSpace: 'pre-line' }}
        >
          {I9_WORKER_ENTITY_EXAMPLES}
        </Typography>
        <Box sx={{ mt: 0.5 }}>
          <I9SupportingDocumentsWorkspace
            tenantId={tenantId}
            workerUserId={workerUserId}
            variant="page"
            requestedForEntityId={requestedForEntityId ?? null}
            employmentEntityKey={employmentEntityKey ?? null}
            suppressStaffRequestButton
            showPageIntro={false}
          />
        </Box>
      </CardContent>
    </Card>
  );
};

export default WorkerEntityI9Section;
