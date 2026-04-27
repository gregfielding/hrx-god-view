/**
 * Worker Documents Required — list of required doc cards.
 * Spec: HRX / C1 Worker Documents Page Spec — Section 4
 */

import React from 'react';
import { Typography, Stack } from '@mui/material';
import WorkerDocumentCard from './WorkerDocumentCard';
import type { WorkerDocumentItem } from './WorkerDocumentCard';

export interface WorkerDocumentsRequiredProps {
  requiredDocs: WorkerDocumentItem[];
  onUpload?: (key: string) => void;
  onReplace?: (key: string) => void;
  onView?: (key: string, fileUrl: string) => void;
}

const WorkerDocumentsRequired: React.FC<WorkerDocumentsRequiredProps> = ({
  requiredDocs,
  onUpload,
  onReplace,
  onView,
}) => {
  return (
    <Stack spacing={2}>
      <Typography variant="h6" sx={{ fontWeight: 600 }}>
        Required
      </Typography>
      <Typography variant="body2" color="text.secondary">
        These are required before you can be scheduled.
      </Typography>
      <Stack spacing={1.5}>
        {requiredDocs.map((d) => (
          <WorkerDocumentCard
            key={d.key}
            doc={d}
            onUpload={onUpload}
            onReplace={onReplace}
            onView={onView}
          />
        ))}
      </Stack>
    </Stack>
  );
};

export default WorkerDocumentsRequired;
