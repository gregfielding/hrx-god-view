/**
 * UnifiedTaskFilters Component
 * 
 * Advanced filter UI for the Unified Tasks Hub.
 */

import React from 'react';
import {
  Box,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  OutlinedInput,
  Typography,
  Paper,
} from '@mui/material';
import { TaskFilters, UnifiedTask } from '../types/UnifiedTask';
import { TaskStatus, TaskPriority, TaskType, TaskCategory } from '../types/Tasks';

interface UnifiedTaskFiltersProps {
  filters: TaskFilters;
  onUpdateFilter: <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => void;
}

const UnifiedTaskFilters: React.FC<UnifiedTaskFiltersProps> = ({
  filters,
  onUpdateFilter,
}) => {
  const statusOptions: TaskStatus[] = ['scheduled', 'upcoming', 'due', 'overdue', 'completed', 'cancelled'];
  const priorityOptions: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
  const typeOptions: TaskType[] = [
    'email',
    'phone_call',
    'linkedin_message',
    'scheduled_meeting_virtual',
    'scheduled_meeting_in_person',
    'research',
    'custom',
    'follow_up',
    'prospecting',
    'presentation',
    'demo',
    'proposal',
    'contract',
    'onboarding',
    'training',
    'admin',
    'activity',
    'other',
  ];
  const categoryOptions: TaskCategory[] = [
    'general',
    'follow_up',
    'prospecting',
    'presentation',
    'demo',
    'proposal',
    'contract',
    'onboarding',
    'training',
    'admin',
    'other',
  ];
  const sourceTypeOptions = ['crm', 'recruiting', 'onboarding', 'admin', 'google_tasks', 'other'];
  const dueWindowOptions = [
    { value: 'overdue', label: 'Overdue' },
    { value: 'today', label: 'Today' },
    { value: 'this_week', label: 'This Week' },
    { value: 'next_week', label: 'Next Week' },
    { value: 'this_month', label: 'This Month' },
    { value: 'all', label: 'All Time' },
  ];

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
        Filter Tasks
      </Typography>

      <Grid container spacing={2}>
        {/* Status Filter */}
        <Grid item xs={12} sm={6} md={3}>
          <FormControl fullWidth size="small">
            <InputLabel>Status</InputLabel>
            <Select
              multiple
              value={filters.status || []}
              onChange={(e) => onUpdateFilter('status', e.target.value as TaskStatus[])}
              input={<OutlinedInput label="Status" />}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {(selected as TaskStatus[]).map((value) => (
                    <Chip key={value} label={value} size="small" />
                  ))}
                </Box>
              )}
            >
              {statusOptions.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        {/* Priority Filter */}
        <Grid item xs={12} sm={6} md={3}>
          <FormControl fullWidth size="small">
            <InputLabel>Priority</InputLabel>
            <Select
              multiple
              value={filters.priority || []}
              onChange={(e) => onUpdateFilter('priority', e.target.value as TaskPriority[])}
              input={<OutlinedInput label="Priority" />}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {(selected as TaskPriority[]).map((value) => (
                    <Chip key={value} label={value} size="small" />
                  ))}
                </Box>
              )}
            >
              {priorityOptions.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        {/* Type Filter */}
        <Grid item xs={12} sm={6} md={3}>
          <FormControl fullWidth size="small">
            <InputLabel>Type</InputLabel>
            <Select
              multiple
              value={filters.type || []}
              onChange={(e) => onUpdateFilter('type', e.target.value as TaskType[])}
              input={<OutlinedInput label="Type" />}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {(selected as TaskType[]).slice(0, 2).map((value) => (
                    <Chip key={value} label={value} size="small" />
                  ))}
                  {(selected as TaskType[]).length > 2 && (
                    <Chip label={`+${(selected as TaskType[]).length - 2}`} size="small" />
                  )}
                </Box>
              )}
            >
              {typeOptions.map((option) => (
                <MenuItem key={option} value={option}>
                  {option.replace(/_/g, ' ')}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        {/* Category Filter */}
        <Grid item xs={12} sm={6} md={3}>
          <FormControl fullWidth size="small">
            <InputLabel>Category</InputLabel>
            <Select
              multiple
              value={filters.category || []}
              onChange={(e) => onUpdateFilter('category', e.target.value as TaskCategory[])}
              input={<OutlinedInput label="Category" />}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {(selected as TaskCategory[]).map((value) => (
                    <Chip key={value} label={value} size="small" />
                  ))}
                </Box>
              )}
            >
              {categoryOptions.map((option) => (
                <MenuItem key={option} value={option}>
                  {option.replace(/_/g, ' ')}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        {/* Source Type Filter */}
        <Grid item xs={12} sm={6} md={3}>
          <FormControl fullWidth size="small">
            <InputLabel>Source</InputLabel>
            <Select
              multiple
              value={filters.sourceType || []}
              onChange={(e) => {
                const value = e.target.value;
                onUpdateFilter('sourceType', (typeof value === 'string' ? [value] : value) as UnifiedTask['sourceType'][]);
              }}
              input={<OutlinedInput label="Source" />}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {(selected as string[]).map((value) => (
                    <Chip key={value} label={value} size="small" />
                  ))}
                </Box>
              )}
            >
              {sourceTypeOptions.map((option) => (
                <MenuItem key={option} value={option}>
                  {option.replace(/_/g, ' ')}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        {/* Due Window Filter */}
        <Grid item xs={12} sm={6} md={3}>
          <FormControl fullWidth size="small">
            <InputLabel>Due Window</InputLabel>
            <Select
              value={filters.dueWindow || 'all'}
              onChange={(e) => onUpdateFilter('dueWindow', e.target.value as TaskFilters['dueWindow'])}
              label="Due Window"
            >
              {dueWindowOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
      </Grid>
    </Paper>
  );
};

export default UnifiedTaskFilters;

