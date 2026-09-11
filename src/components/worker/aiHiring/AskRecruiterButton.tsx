import React, { useState } from 'react';
import { Button } from '@mui/material';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import RecruiterReviewRequestDialog from './RecruiterReviewRequestDialog';

type Props = {
  label: string;
  tenantId: string;
  jobId?: string | null;
  jobOrderId?: string | null;
  applicationId?: string | null;
  postingTitle?: string | null;
};

/** "Ask a recruiter" row action for a worker's Illinois application (opens the request dialog). */
const AskRecruiterButton: React.FC<Props> = ({ label, tenantId, jobId, jobOrderId, applicationId, postingTitle }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="small"
        variant="text"
        startIcon={<SupportAgentOutlinedIcon fontSize="small" />}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <RecruiterReviewRequestDialog
        open={open}
        onClose={() => setOpen(false)}
        tenantId={tenantId}
        jobId={jobId}
        jobOrderId={jobOrderId}
        applicationId={applicationId}
        postingTitle={postingTitle}
      />
    </>
  );
};

export default AskRecruiterButton;
