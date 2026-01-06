/**
 * Unified Tasks Hub (My Work Page)
 * 
 * A single page where users can see and manage every task assigned to them
 * across CRM, recruiting, onboarding, admin workflows, and Google Tasks sync.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Chip,
  TextField,
  InputAdornment,
  Collapse,
  Paper,
  Divider,
  Stack,
  CircularProgress,
  Alert,
  Fade,
} from '@mui/material';
import {
  Add as AddIcon,
  Search as SearchIcon,
  FilterList as FilterListIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Clear as ClearIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import PageHeader from '../components/PageHeader';
import { useMyTasks } from '../hooks/useMyTasks';
import { useTaskFilters } from '../hooks/useTaskFilters';
import { useTaskMutations } from '../hooks/useTaskMutations';
import { UnifiedTask, TaskSnoozeOptions } from '../types/UnifiedTask';
import UnifiedTaskCard from '../components/UnifiedTaskCard';
import UnifiedTaskCreateModal from '../components/UnifiedTaskCreateModal';
import UnifiedTaskFilters from '../components/UnifiedTaskFilters';
import UnifiedTaskSnoozeDialog from '../components/UnifiedTaskSnoozeDialog';

const UnifiedTasksPage: React.FC = () => {
  const { user } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [completedCollapsed, setCompletedCollapsed] = useState(true);
  const [selectedTask, setSelectedTask] = useState<UnifiedTask | null>(null);
  const [snoozeTask, setSnoozeTask] = useState<UnifiedTask | null>(null);
  const [showSnoozeDialog, setShowSnoozeDialog] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const taskFilters = useTaskFilters();
  
  // Smart defaults: Hide completed tasks on first load unless explicitly shown
  const [showCompleted, setShowCompleted] = useState(() => {
    try {
      const stored = localStorage.getItem('unifiedTasksShowCompleted');
      return stored !== null ? stored === 'true' : false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('unifiedTasksShowCompleted', String(showCompleted));
    } catch (err) {
      console.warn('Failed to save showCompleted state:', err);
    }
  }, [showCompleted]);

  const { groupedTasks, loading, error, refresh } = useMyTasks({
    filters: taskFilters.filters,
    includeCompleted: showCompleted,
  });
  const mutations = useTaskMutations();

  const handleCompleteTask = async (task: UnifiedTask) => {
    setCompletingTaskId(task.id);
    try {
      if (task.status === 'completed') {
        await mutations.uncompleteTask(task.id);
      } else {
        await mutations.completeTask(task.id);
      }
      // Small delay for animation before clearing
      setTimeout(() => {
        setCompletingTaskId(null);
      }, 300);
    } catch (err) {
      console.error('Error completing task:', err);
      setCompletingTaskId(null);
    }
  };

  const handleTaskClick = (task: UnifiedTask) => {
    // Close create modal if open, and open edit modal
    setShowCreateModal(false);
    setSelectedTask(task);
  };

  const handleNewTaskClick = () => {
    // Close edit modal if open, and open create modal
    setSelectedTask(null);
    setShowCreateModal(true);
  };

  const handleSnoozeClick = (task: UnifiedTask) => {
    setSnoozeTask(task);
    setShowSnoozeDialog(true);
  };

  const handleSnoozeConfirm = async (options: TaskSnoozeOptions) => {
    if (!snoozeTask) return;
    try {
      await mutations.snoozeTask(snoozeTask.id, options);
      setShowSnoozeDialog(false);
      setSnoozeTask(null);
    } catch (err) {
      console.error('Error snoozing task:', err);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (window.confirm('Are you sure you want to delete this task?')) {
      try {
        await mutations.deleteTask(taskId);
      } catch (err) {
        console.error('Error deleting task:', err);
      }
    }
  };

  const renderTaskGroup = (
    label: string,
    tasks: UnifiedTask[],
    color = 'primary',
    showCount = true
  ) => {
    // Don't render Completed group if showCompleted is false
    if (label === 'Completed' && !showCompleted) {
      return null;
    }

    if (tasks.length === 0) return null;

    return (
      <Box sx={{ mb: 4 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              label={label}
              color={color as any}
              size="small"
              sx={{ fontWeight: 600 }}
            />
            {showCount && (
              <Typography variant="body2" color="text.secondary">
                {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
              </Typography>
            )}
          </Box>
          {label === 'Completed' && (
            <IconButton
              size="small"
              onClick={() => setCompletedCollapsed(!completedCollapsed)}
            >
              {completedCollapsed ? <ExpandMoreIcon /> : <ExpandLessIcon />}
            </IconButton>
          )}
        </Box>

        <Collapse in={label !== 'Completed' || !completedCollapsed}>
          <Stack spacing={1.5}>
            {tasks.map((task) => (
              <Fade
                key={task.id}
                in={completingTaskId !== task.id}
                timeout={300}
              >
                <Box>
                  <UnifiedTaskCard
                    task={task}
                    onComplete={() => handleCompleteTask(task)}
                    onSnooze={() => {}} // Legacy prop, using onSnoozeClick instead
                    onSnoozeClick={handleSnoozeClick}
                    onEdit={() => handleTaskClick(task)}
                    onDelete={() => handleDeleteTask(task.id)}
                    onView={() => handleTaskClick(task)}
                  />
                </Box>
              </Fade>
            ))}
          </Stack>
        </Collapse>
      </Box>
    );
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        title="My Tasks"
        subtitle="All your tasks in one place"
        filters={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button
              variant={taskFilters.hasActiveFilters ? 'contained' : 'outlined'}
              startIcon={<FilterListIcon />}
              onClick={() => setShowFilters(!showFilters)}
              size="small"
              sx={{ flexShrink: 0 }}
            >
              Filters {taskFilters.filterCount > 0 && `(${taskFilters.filterCount})`}
            </Button>
            {taskFilters.hasActiveFilters && (
              <Button
                variant="text"
                size="small"
                onClick={taskFilters.clearFilters}
              >
                Clear All
              </Button>
            )}
          </Box>
        }
        rightActions={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <TextField
              inputRef={searchInputRef}
              placeholder="Search tasks... (Press 'N' to add)"
              size="small"
              value={taskFilters.filters.search || ''}
              onChange={(e) => taskFilters.updateFilter('search', e.target.value)}
              onKeyDown={(e) => {
                // Quick add: Press 'N' when search is empty and focused
                if (
                  e.key === 'n' &&
                  !taskFilters.filters.search &&
                  !e.shiftKey &&
                  !e.ctrlKey &&
                  !e.metaKey &&
                  !e.altKey
                ) {
                e.preventDefault();
                handleNewTaskClick();
                }
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
                endAdornment: taskFilters.filters.search && (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={() => taskFilters.updateFilter('search', '')}
                    >
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
              sx={{ minWidth: 200 }}
            />
            <Button
              variant="contained"
              startIcon={<EditIcon />}
              onClick={handleNewTaskClick}
              sx={{
                textTransform: 'none',
                borderRadius: '24px',
                px: 2.5,
                py: 1,
                height: '40px',
                fontWeight: 500,
                fontSize: '14px',
                bgcolor: '#0057B8',
                boxShadow: '0 2px 8px rgba(0, 87, 184, 0.25)',
                '&:hover': {
                  bgcolor: '#004a9f',
                  boxShadow: '0 4px 12px rgba(0, 87, 184, 0.35)',
                },
                whiteSpace: 'nowrap',
              }}
            >
              New Task
            </Button>
          </Box>
        }
        showDivider={true}
      />

      {/* Advanced Filters Panel */}
      <Collapse in={showFilters}>
        <Box sx={{ px: { xs: 2, md: 3 }, pt: 2, pb: 1 }}>
          <UnifiedTaskFilters
            filters={taskFilters.filters}
            onUpdateFilter={taskFilters.updateFilter}
          />
        </Box>
      </Collapse>

      {/* Task List */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          px: { xs: 2, md: 3 },
          pt: 2, // 16px top padding
          pb: 2,
        }}
      >
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Error loading tasks: {error.message}
          </Alert>
        )}

        {!loading && !error && (
          <>
            {renderTaskGroup('Overdue', groupedTasks.overdue, 'error')}
            {renderTaskGroup('Today', groupedTasks.today, 'warning')}
            {renderTaskGroup('Upcoming', groupedTasks.upcoming, 'info')}
            {renderTaskGroup('Snoozed', groupedTasks.snoozed, 'default')}
            {renderTaskGroup('Completed', groupedTasks.completed, 'success')}

            {/* Toggle to show/hide completed tasks */}
            {!showCompleted && groupedTasks.completed.length > 0 && (
              <Box sx={{ mt: 2, textAlign: 'center' }}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => setShowCompleted(true)}
                >
                  Show {groupedTasks.completed.length} Completed Task{groupedTasks.completed.length !== 1 ? 's' : ''}
                </Button>
              </Box>
            )}

            {groupedTasks.overdue.length === 0 &&
              groupedTasks.today.length === 0 &&
              groupedTasks.upcoming.length === 0 &&
              groupedTasks.snoozed.length === 0 &&
              groupedTasks.completed.length === 0 && (
                <Box
                  sx={{
                    textAlign: 'center',
                    py: 8,
                    color: 'text.secondary',
                  }}
                >
                  <Typography variant="h6" gutterBottom>
                    No tasks found
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 2 }}>
                    {taskFilters.hasActiveFilters
                      ? 'Try adjusting your filters'
                      : 'Create your first task to get started'}
                  </Typography>
                  {!taskFilters.hasActiveFilters && (
                    <Button
                      variant="contained"
                      startIcon={<AddIcon />}
                      onClick={handleNewTaskClick}
                    >
                      Create Task
                    </Button>
                  )}
                </Box>
              )}
          </>
        )}
      </Box>

      {/* Create Task Modal */}
      {showCreateModal && (
        <UnifiedTaskCreateModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            refresh();
          }}
        />
      )}

      {/* Edit Task Modal */}
      {selectedTask && (
        <UnifiedTaskCreateModal
          open={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          task={selectedTask}
          onSuccess={() => {
            setSelectedTask(null);
            refresh();
          }}
        />
      )}

      {/* Snooze Dialog */}
      {snoozeTask && (
        <UnifiedTaskSnoozeDialog
          open={showSnoozeDialog}
          onClose={() => {
            setShowSnoozeDialog(false);
            setSnoozeTask(null);
          }}
          onConfirm={handleSnoozeConfirm}
          taskTitle={snoozeTask.title}
        />
      )}
    </Box>
  );
};

export default UnifiedTasksPage;

