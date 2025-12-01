import React from 'react';
import { IconButton, Badge, Tooltip, Box, Stack } from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import VerifiedIcon from '@mui/icons-material/Verified';

interface DocumentIconBarProps {
  resume?: {
    fileName: string;
    downloadUrl?: string;
    storagePath?: string;
  } | null;
  certifications?: Array<{
    name: string;
    fileUrl?: string;
    fileName?: string;
  }>;
  onResumeClick: () => void;
  onCertificationsClick: () => void;
  isAdminView?: boolean;
}

const DocumentIconBar: React.FC<DocumentIconBarProps> = ({
  resume,
  certifications = [],
  onResumeClick,
  onCertificationsClick,
  isAdminView = false,
}) => {
  const certificationsCount = certifications?.length || 0;
  const hasResume = !!resume;
  const hasCertifications = certificationsCount > 0;

  if (!isAdminView) {
    return null;
  }

  return (
    <Stack 
      direction="row" 
      spacing={1} 
      alignItems="center"
      sx={{ 
        mt: 1,
        flexWrap: 'wrap',
        gap: 0.5
      }}
    >
      {/* Resume Icon */}
      <Tooltip title={hasResume ? `View Resume: ${resume?.fileName || 'Resume'}` : 'No resume uploaded'}>
        <span>
          <IconButton
            size="small"
            onClick={onResumeClick}
            disabled={!hasResume}
            sx={{
              color: hasResume ? 'primary.main' : 'action.disabled',
              '&:hover': {
                bgcolor: 'action.hover',
              },
            }}
          >
            <Badge badgeContent={hasResume ? 1 : 0} color="primary">
              <DescriptionIcon fontSize="small" />
            </Badge>
          </IconButton>
        </span>
      </Tooltip>

      {/* Certifications Icon */}
      <Tooltip 
        title={
          hasCertifications 
            ? `View ${certificationsCount} Certification${certificationsCount !== 1 ? 's' : ''}` 
            : 'No certifications'
        }
      >
        <span>
          <IconButton
            size="small"
            onClick={onCertificationsClick}
            disabled={!hasCertifications}
            sx={{
              color: hasCertifications ? 'primary.main' : 'action.disabled',
              '&:hover': {
                bgcolor: 'action.hover',
              },
            }}
          >
            <Badge badgeContent={certificationsCount} color="primary">
              <VerifiedIcon fontSize="small" />
            </Badge>
          </IconButton>
        </span>
      </Tooltip>

    </Stack>
  );
};

export default DocumentIconBar;

