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
import { useNavigate } from 'react-router-dom';
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
import TaskDetailsDialog from '../components/TaskDetailsDialog';
import { db } from '../firebase';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';

const UnifiedTasksPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, activeTenant } = useAuth();
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

  // --- Linked object lookups (Deal/Contact/Company names) for richer task cards ---
  const [associationLookups, setAssociationLookups] = useState<{
    deals: Record<string, string>;
    contacts: Record<string, string>;
    companies: Record<string, string>;
  }>({ deals: {}, contacts: {}, companies: {} });

  useEffect(() => {
    const allTasks: UnifiedTask[] = Array.isArray(groupedTasks)
      ? groupedTasks.flatMap((g: any) => (g?.tasks as UnifiedTask[]) || [])
      : (Object.values((groupedTasks as any) || {}) as UnifiedTask[][]).flat();

    const tenantId = activeTenant?.id || allTasks.find((t) => t?.tenantId)?.tenantId;
    if (!tenantId) return;

    const dealIds = new Set<string>();
    const contactIds = new Set<string>();
    const companyIds = new Set<string>();

    for (const t of allTasks) {
      const assoc: any = (t as any)?.associations;
      if (Array.isArray(assoc?.deals)) assoc.deals.forEach((id: any) => typeof id === 'string' && dealIds.add(id));
      if (Array.isArray(assoc?.contacts)) assoc.contacts.forEach((id: any) => typeof id === 'string' && contactIds.add(id));
      if (Array.isArray(assoc?.companies)) assoc.companies.forEach((id: any) => typeof id === 'string' && companyIds.add(id));

      // Also support the singular optimized "relatedTo" link if present
      if (assoc?.relatedTo?.type && typeof assoc.relatedTo.id === 'string') {
        if (assoc.relatedTo.type === 'deal') dealIds.add(assoc.relatedTo.id);
        if (assoc.relatedTo.type === 'contact') contactIds.add(assoc.relatedTo.id);
        if (assoc.relatedTo.type === 'company') companyIds.add(assoc.relatedTo.id);
      }
    }

    const chunk = <T,>(arr: T[], size: number) => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };

    const buildName = (docData: any, kind: 'deal' | 'contact' | 'company') => {
      if (!docData) return '';
      if (kind === 'company') return String(docData.companyName || docData.name || docData.displayName || '').trim();
      if (kind === 'deal') return String(docData.name || docData.title || docData.dealName || '').trim();
      // contact
      const full =
        docData.fullName ||
        docData.name ||
        (docData.firstName || docData.lastName ? `${docData.firstName || ''} ${docData.lastName || ''}`.trim() : '');
      return String(full || '').trim();
    };

    let cancelled = false;
    (async () => {
      try {
        const MAX_IN = 10; // Firestore 'in' clause limit

        const fetchMap = async (colPath: string, ids: string[], kind: 'deal' | 'contact' | 'company') => {
          const out: Record<string, string> = {};
          if (!ids.length) return out;
          const ref = collection(db, colPath);
          const chunks = chunk(ids, MAX_IN);
          const snaps = await Promise.all(
            chunks.map((c) => getDocs(query(ref, where(documentId(), 'in', c))))
          );
          for (const s of snaps) {
            s.docs.forEach((d) => {
              const nm = buildName(d.data(), kind);
              if (nm) out[d.id] = nm;
            });
          }
          return out;
        };

        const [deals, contacts, companies] = await Promise.all([
          fetchMap(`tenants/${tenantId}/crm_deals`, Array.from(dealIds), 'deal'),
          fetchMap(`tenants/${tenantId}/crm_contacts`, Array.from(contactIds), 'contact'),
          fetchMap(`tenants/${tenantId}/crm_companies`, Array.from(companyIds), 'company'),
        ]);

        if (cancelled) return;

        setAssociationLookups((prev) => ({
          deals: { ...prev.deals, ...deals },
          contacts: { ...prev.contacts, ...contacts },
          companies: { ...prev.companies, ...companies },
        }));
      } catch (e) {
        // Soft-fail: cards will fall back to IDs / relatedToName if present
        console.warn('Failed to load task association names:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTenant?.id, groupedTasks]);

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
    // Job order checklist tasks should navigate directly to Job Order → Checklist tab
    const taskAny = task as any;
    const isChecklistTask = taskAny.systemSource === 'job_order_checklist';
    const jobOrderId =
      taskAny.jobOrderId ||
      (isChecklistTask ? taskAny.sourceId : undefined) ||
      (taskAny.sourceType === 'recruiting' ? taskAny.sourceId : undefined);
    if (typeof jobOrderId === 'string' && jobOrderId.trim().length > 0 && isChecklistTask) {
      try {
        // RecruiterJobOrderDetail reads this key and defaults to 1 (Checklist).
        localStorage.setItem(`recruiter_job_order_tab_${jobOrderId}`, '1');
      } catch {
        // ignore
      }
      navigate(`/jobs/job-orders/${jobOrderId}`);
      return;
    }

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
                    associationLookups={associationLookups}
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

      {/* Edit Task Dialog - using TaskDetailsDialog like dashboard widget */}
      {selectedTask && (
        <TaskDetailsDialog
          open={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          task={selectedTask as any}
          onTaskUpdated={async (taskId: string) => {
            // Refresh tasks after update
            await refresh();
            setSelectedTask(null);
          }}
          salespersonId={selectedTask.assignedTo || user?.uid || ''}
          tenantId={activeTenant?.id || ''}
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

