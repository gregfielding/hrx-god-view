import React from 'react';
import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import type { HomeChecklistItem } from './types';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

interface NextStepsChecklistProps {
  items: HomeChecklistItem[];
  onSelectItem: (item: HomeChecklistItem) => void;
}

const chipColorByStatus: Record<HomeChecklistItem['status'], 'success' | 'warning' | 'default'> = {
  complete: 'success',
  missing: 'warning',
  in_progress: 'warning',
  recommended: 'default',
};

const priorityTitle: Record<HomeChecklistItem['priority'], string> = {
  required: 'Required',
  high_impact: 'High impact',
  optional: 'Optional',
};

const groupedPriorityOrder: HomeChecklistItem['priority'][] = ['required', 'high_impact', 'optional'];

const priorityChipColor: Record<HomeChecklistItem['priority'], 'error' | 'warning' | 'default'> = {
  required: 'error',
  high_impact: 'warning',
  optional: 'default',
};

const NextStepsChecklist: React.FC<NextStepsChecklistProps> = ({ items, onSelectItem }) => {
  const groups = groupedPriorityOrder
    .map((priority) => ({
      priority,
      items: items
        .filter((item) => item.priority === priority)
        .sort((a, b) => (a.status === 'complete' ? 1 : 0) - (b.status === 'complete' ? 1 : 0)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={1.5}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Complete these next
          </Typography>
          {groups.map((group) => (
            <Stack key={group.priority} spacing={1}>
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>
                {priorityTitle[group.priority]}
              </Typography>
              {group.items.map((item) => (
                <Box
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  sx={{
                    border: '1px solid',
                    borderColor: item.status === 'complete' ? 'success.light' : 'divider',
                    borderRadius: 2,
                    p: 1.25,
                    cursor: 'pointer',
                    transition: 'background-color 120ms ease, border-color 120ms ease, transform 120ms ease',
                    '&:hover': {
                      bgcolor: 'action.hover',
                      borderColor: item.status === 'complete' ? 'success.main' : 'primary.light',
                    },
                    '&:active': {
                      transform: 'translateY(1px)',
                    },
                  }}
                  onClick={() => onSelectItem(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectItem(item);
                    }
                  }}
                >
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {item.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {item.benefit}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Chip
                        size="small"
                        label={
                          item.status === 'complete'
                            ? 'Complete'
                            : priorityTitle[item.priority]
                        }
                        color={
                          item.status === 'complete'
                            ? chipColorByStatus.complete
                            : priorityChipColor[item.priority]
                        }
                        variant={item.status === 'complete' ? 'filled' : 'outlined'}
                      />
                      {item.status === 'complete' ? (
                        <CheckCircleIcon color="success" fontSize="small" />
                      ) : (
                        <ChevronRightIcon color="action" fontSize="small" />
                      )}
                    </Stack>
                  </Stack>
                </Box>
              ))}
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default NextStepsChecklist;
