import React from 'react';
import { Box, Typography, Chip, Stack, IconButton, Tooltip, Card, CardContent } from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { format } from 'date-fns';

interface ResumePreviewCardProps {
  resume?: {
    fileName: string;
    timestamp?: Date | any;
    downloadUrl?: string;
    storagePath?: string;
    size?: number;
    sizeKB?: number;
  } | null;
  onView?: () => void;
  onReplace?: () => void;
  verified?: boolean;
}

const ResumePreviewCard: React.FC<ResumePreviewCardProps> = ({
  resume,
  onView,
  onReplace,
  verified = false,
}) => {
  if (!resume || !resume.fileName) {
    return (
      <Card variant="outlined" sx={{ bgcolor: 'grey.50' }}>
        <CardContent sx={{ py: 2, px: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <DescriptionIcon sx={{ color: 'text.disabled' }} />
            <Typography variant="body2" color="text.secondary">
              No resume uploaded
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  const formatDate = (timestamp: any): string => {
    if (!timestamp) return 'Unknown';
    try {
      const date = timestamp instanceof Date 
        ? timestamp 
        : timestamp?.toDate 
        ? timestamp.toDate() 
        : new Date(timestamp);
      return format(date, 'MMM d, yyyy');
    } catch {
      return 'Unknown';
    }
  };

  const formatFileSize = (sizeKB?: number, size?: number): string => {
    if (sizeKB) {
      if (sizeKB < 1024) return `${sizeKB} KB`;
      return `${(sizeKB / 1024).toFixed(1)} MB`;
    }
    if (size) {
      const kb = size / 1024;
      if (kb < 1024) return `${Math.round(kb)} KB`;
      return `${(kb / 1024).toFixed(1)} MB`;
    }
    return '';
  };

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
      <CardContent sx={{ py: 2, px: 2 }}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
              <DescriptionIcon sx={{ color: 'primary.main', flexShrink: 0 }} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>
                  {resume.fileName}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    Uploaded: {formatDate(resume.timestamp)}
                  </Typography>
                  {formatFileSize(resume.sizeKB, resume.size) && (
                    <>
                      <Typography variant="caption" color="text.secondary">•</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatFileSize(resume.sizeKB, resume.size)}
                      </Typography>
                    </>
                  )}
                </Stack>
              </Box>
            </Stack>
            <Stack direction="row" spacing={0.5}>
              {onView && (
                <Tooltip title="View Resume">
                  <IconButton
                    size="small"
                    onClick={onView}
                    sx={{
                      color: 'primary.main',
                      '&:hover': {
                        bgcolor: 'action.hover',
                      },
                    }}
                  >
                    <VisibilityIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {onReplace && (
                <Tooltip title="Replace Resume">
                  <IconButton
                    size="small"
                    onClick={onReplace}
                    sx={{
                      color: 'primary.main',
                      '&:hover': {
                        bgcolor: 'action.hover',
                      },
                    }}
                  >
                    <CloudUploadIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          </Stack>
          
          {verified && (
            <Stack direction="row" spacing={0.5} alignItems="center">
              <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
              <Typography variant="caption" color="success.main" sx={{ fontWeight: 500 }}>
                Verified
              </Typography>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default ResumePreviewCard;

