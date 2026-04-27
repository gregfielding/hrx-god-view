import React from 'react';
import { Box, Typography, Chip, Stack, Alert, AlertTitle, Button } from '@mui/material';
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

interface MissingItemsAlertProps {
  items: MissingItem[];
  isAdminView?: boolean;
}

const MissingItemsAlert: React.FC<MissingItemsAlertProps> = ({
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

  const errorItems = sortedItems.filter(item => item.type === 'error');
  const warningItems = sortedItems.filter(item => item.type === 'warning');
  const infoItems = sortedItems.filter(item => item.type === 'info');

  return (
    <Box sx={{ mb: 2 }}>
      {errorItems.length > 0 && (
        <Alert 
          severity="error" 
          icon={<ErrorIcon />}
          sx={{ mb: warningItems.length > 0 || infoItems.length > 0 ? 1 : 0 }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box sx={{ flex: 1 }}>
              <AlertTitle>Critical Missing Items</AlertTitle>
              <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
                {errorItems.map((item) => (
                  <Chip
                    key={item.id}
                    label={item.message}
                    size="small"
                    color="error"
                    icon={<ErrorIcon />}
                    sx={{ height: 24 }}
                  />
                ))}
              </Stack>
            </Box>
            <Stack direction="column" spacing={0.5} sx={{ ml: 2, alignItems: 'flex-end' }}>
              {errorItems.map((item) => (
                item.action && (
                  <Button
                    key={`action-${item.id}`}
                    size="small"
                    variant="contained"
                    color="error"
                    startIcon={<AddIcon />}
                    onClick={item.action.onClick}
                    sx={{
                      minWidth: 'auto',
                      px: 1.5,
                      py: 0.5,
                      fontSize: '0.75rem',
                      height: 28,
                      textTransform: 'none',
                    }}
                  >
                    {item.action.label}
                  </Button>
                )
              ))}
            </Stack>
          </Box>
        </Alert>
      )}

      {warningItems.length > 0 && (
        <Alert 
          severity="warning" 
          icon={<WarningIcon />}
          sx={{ mb: infoItems.length > 0 ? 1 : 0 }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box sx={{ flex: 1 }}>
              <AlertTitle>Items Requiring Attention</AlertTitle>
              <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
                {warningItems.map((item) => (
                  <Chip
                    key={item.id}
                    label={item.message}
                    size="small"
                    color="warning"
                    icon={<WarningIcon />}
                    sx={{ height: 24 }}
                  />
                ))}
              </Stack>
            </Box>
            <Stack direction="column" spacing={0.5} sx={{ ml: 2, alignItems: 'flex-end' }}>
              {warningItems.map((item) => (
                item.action && (
                  <Button
                    key={`action-${item.id}`}
                    size="small"
                    variant="contained"
                    color="warning"
                    startIcon={<AddIcon />}
                    onClick={item.action.onClick}
                    sx={{
                      minWidth: 'auto',
                      px: 1.5,
                      py: 0.5,
                      fontSize: '0.75rem',
                      height: 28,
                      textTransform: 'none',
                    }}
                  >
                    {item.action.label}
                  </Button>
                )
              ))}
            </Stack>
          </Box>
        </Alert>
      )}

      {infoItems.length > 0 && (
        <Alert severity="info" icon={<InfoIcon />}>
          <AlertTitle>Additional Information</AlertTitle>
          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
            {infoItems.map((item) => (
              <Chip
                key={item.id}
                label={item.message}
                size="small"
                color="info"
                icon={<InfoIcon />}
                onClick={item.action?.onClick}
                sx={{
                  cursor: item.action ? 'pointer' : 'default',
                  '&:hover': item.action ? {
                    bgcolor: 'info.dark',
                    color: 'white',
                  } : {},
                }}
              />
            ))}
          </Stack>
        </Alert>
      )}
    </Box>
  );
};

export default MissingItemsAlert;

