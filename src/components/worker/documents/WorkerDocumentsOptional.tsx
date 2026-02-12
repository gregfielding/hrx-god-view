/**
 * Worker Documents Optional — certifications list or empty state.
 * Spec: HRX / C1 Worker Documents Page Spec — Section 5
 */

import React from 'react';
import { Typography, Stack, Button } from '@mui/material';
import WorkerDocumentCard from './WorkerDocumentCard';
import WorkerDocumentsEmptyState from './WorkerDocumentsEmptyState';
import type { WorkerDocumentItem } from './WorkerDocumentCard';

export interface WorkerDocumentsOptionalProps {
  optionalDocs: WorkerDocumentItem[];
  onAddCertification: () => void;
  onReplace?: (key: string) => void;
  onView?: (key: string, fileUrl: string) => void;
}

const WorkerDocumentsOptional: React.FC<WorkerDocumentsOptionalProps> = ({
  optionalDocs,
  onAddCertification,
  onReplace,
  onView,
}) => {
  return (
    <Stack spacing={2}>
      <Typography variant="h6" sx={{ fontWeight: 600 }}>
        Optional
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Adding certifications can qualify you for higher-paying roles.
      </Typography>
      {optionalDocs.length === 0 ? (
        <WorkerDocumentsEmptyState onAddCertification={onAddCertification} />
      ) : (
        <>
          <Stack spacing={1.5}>
            {optionalDocs.map((d) => (
              <WorkerDocumentCard
                key={d.key}
                doc={d}
                onReplace={onReplace}
                onView={onView}
              />
            ))}
          </Stack>
          <Button variant="outlined" size="small" onClick={onAddCertification}>
            Add certification
          </Button>
        </>
      )}
    </Stack>
  );
};

export default WorkerDocumentsOptional;
