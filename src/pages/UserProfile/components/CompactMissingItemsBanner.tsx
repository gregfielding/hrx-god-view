import React from 'react';
import { Box, Typography, Chip, Stack, IconButton, Tooltip } from '@mui/material';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import InfoIcon from '@mui/icons-material/Info';
import AddIcon from '@mui/icons-material/Add';

interface MissingItem {
  id: string;
  type: 'error' | 'warning' | 'info';
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface CompactMissingItemsBannerProps {
  items: MissingItem[];
  isAdminView?: boolean;
}

const CompactMissingItemsBanner: React.FC<CompactMissingItemsBannerProps> = ({
  items,
  isAdminView = false,
}) => {
  if (!isAdminView || items.length === 0) {
    return null;
  }

  // Sort by severity: error > warning > info
  const sortedItems = [...items].sort((a, b) => {
    const severityOrder = { error: 0, warning: 1, info: 2 };
    return severityOrder[a.type] - severityOrder[b.type];
  });

  // Limit to most critical 5 items for compact display
  const displayItems = sortedItems.slice(0, 5);

  const getSeverityColor = (type: 'error' | 'warning' | 'info') => {
    switch (type) {
      case 'error':
        return 'error';
      case 'warning':
        return 'warning';
      default:
        return 'info';
    }
  };

  const getSeverityIcon = (type: 'error' | 'warning' | 'info') => {
    switch (type) {
      case 'error':
        return <ErrorIcon sx={{ fontSize: 14 }} />;
      case 'warning':
        return <WarningIcon sx={{ fontSize: 14 }} />;
      default:
        return <InfoIcon sx={{ fontSize: 14 }} />;
    }
  };

  return (
    <Box
      sx={{
        mb: 1,
        py: 0.75,
        px: 1.25,
        maxHeight: 56,
        bgcolor: sortedItems[0]?.type === 'error' ? 'error.light' : sortedItems[0]?.type === 'warning' ? 'warning.light' : 'info.light',
        borderRadius: 0.5,
        border: '1px solid',
        borderColor: sortedItems[0]?.type === 'error' ? 'error.main' : sortedItems[0]?.type === 'warning' ? 'warning.main' : 'info.main',
        overflow: 'hidden',
      }}
    >
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'nowrap', gap: 0.5, overflowX: 'auto' }}>
        {getSeverityIcon(sortedItems[0]?.type || 'info')}
        {displayItems.map((item) => (
          <Tooltip key={item.id} title={item.action ? `Click to ${item.action.label.toLowerCase()}` : ''}>
            <Chip
              label={item.message}
              size="small"
              color={getSeverityColor(item.type)}
              icon={getSeverityIcon(item.type)}
              onClick={item.action?.onClick}
              deleteIcon={
                item.action ? (
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      item.action?.onClick();
                    }}
                    sx={{ color: 'inherit' }}
                  >
                    <AddIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                ) : undefined
              }
              onDelete={item.action?.onClick}
              sx={{
                height: 24,
                fontSize: '0.7rem',
                fontWeight: 500,
                cursor: item.action ? 'pointer' : 'default',
                '&:hover': item.action ? {
                  opacity: 0.8,
                } : {},
              }}
            />
          </Tooltip>
        ))}
        {sortedItems.length > 5 && (
          <Chip
            label={`+${sortedItems.length - 5}`}
            size="small"
            sx={{
              height: 24,
              fontSize: '0.7rem',
              bgcolor: 'rgba(0,0,0,0.1)',
              flexShrink: 0,
            }}
          />
        )}
      </Stack>
    </Box>
  );
};

export default CompactMissingItemsBanner;

