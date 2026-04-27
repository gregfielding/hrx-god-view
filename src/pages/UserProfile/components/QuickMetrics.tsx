import React from 'react';
import { Box, Typography, Tooltip, Chip } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

interface QuickMetricsProps {
  profileScore?: number;
  certificationsCount?: number;
  activeApplicationsCount?: number;
  resumeCompleteness?: number;
  isAdminView?: boolean;
}

const QuickMetrics: React.FC<QuickMetricsProps> = ({
  profileScore,
  certificationsCount = 0,
  activeApplicationsCount = 0,
  resumeCompleteness,
  isAdminView = false,
}) => {
  if (!isAdminView) {
    return null;
  }

  const metrics = [];

  if (profileScore !== undefined) {
    metrics.push({
      label: 'Profile Score',
      value: profileScore,
      tooltip: 'Profile completeness score based on resume, skills, certifications, and work history',
    });
  }

  if (certificationsCount > 0) {
    metrics.push({
      label: 'Certifications',
      value: certificationsCount,
      tooltip: 'Number of certifications and licenses on file',
    });
  }

  if (activeApplicationsCount > 0) {
    metrics.push({
      label: 'Active Applications',
      value: activeApplicationsCount,
      tooltip: 'Number of active job applications',
    });
  }

  if (resumeCompleteness !== undefined) {
    metrics.push({
      label: 'Resume Complete',
      value: `${resumeCompleteness}%`,
      tooltip: 'Resume completeness percentage',
    });
  }

  if (metrics.length === 0) {
    return null;
  }

  return (
    <Box
      sx={{
        mt: 1,
        pt: 1,
        borderTop: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', fontWeight: 500 }}>
          QUICK METRICS
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {metrics.map((metric) => (
          <Tooltip key={metric.label} title={metric.tooltip} arrow>
            <Chip
              size="small"
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {metric.label}:
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {metric.value}
                  </Typography>
                </Box>
              }
              sx={{
                height: 22,
                fontSize: '0.7rem',
                bgcolor: 'grey.100',
                '& .MuiChip-label': {
                  px: 1,
                },
              }}
            />
          </Tooltip>
        ))}
      </Box>
    </Box>
  );
};

export default QuickMetrics;

