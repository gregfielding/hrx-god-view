import React from 'react';
import { Box, Typography, Stack, Checkbox, FormControlLabel, IconButton, Tooltip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import AddIcon from '@mui/icons-material/Add';

interface MissingItemsChecklistProps {
  items: Array<{
    id: string;
    label: string;
    status: 'complete' | 'missing' | 'pending';
    onClick?: () => void;
  }>;
  isAdminView?: boolean;
}

const MissingItemsChecklist: React.FC<MissingItemsChecklistProps> = ({
  items,
  isAdminView = false,
}) => {
  if (!isAdminView) {
    return null;
  }

  const missingItems = items.filter(item => item.status === 'missing' || item.status === 'pending');
  if (missingItems.length === 0) {
    return null;
  }

  return (
    <Box
      sx={{
        p: 1.5,
        bgcolor: 'grey.50',
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary', mb: 1, display: 'block' }}>
        🔧 Status Checklist
      </Typography>
      <Stack spacing={0.5}>
        {items.map((item) => (
          <Box
            key={item.id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              py: 0.25,
            }}
          >
            <FormControlLabel
              control={
                <Checkbox
                  checked={item.status === 'complete'}
                  disabled
                  size="small"
                  icon={
                    item.status === 'missing' ? (
                      <ErrorIcon sx={{ fontSize: 16, color: 'error.main' }} />
                    ) : item.status === 'pending' ? (
                      <WarningIcon sx={{ fontSize: 16, color: 'warning.main' }} />
                    ) : undefined
                  }
                  checkedIcon={<CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />}
                />
              }
              label={
                <Typography variant="caption" sx={{ fontSize: '0.7rem', textDecoration: item.status === 'complete' ? 'none' : 'none' }}>
                  {item.label}
                </Typography>
              }
              sx={{ m: 0, flex: 1 }}
            />
            {item.status !== 'complete' && item.onClick && (
              <Tooltip title={`Add ${item.label}`}>
                <IconButton
                  size="small"
                  onClick={item.onClick}
                  sx={{
                    p: 0.5,
                    color: item.status === 'missing' ? 'error.main' : 'warning.main',
                  }}
                >
                  <AddIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        ))}
      </Stack>
    </Box>
  );
};

export default MissingItemsChecklist;

