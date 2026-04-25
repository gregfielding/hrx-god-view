/**
 * Task Detail Page
 * 
 * Deep link view for individual tasks at /task/:taskId
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Paper,
} from '@mui/material';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import PageHeader from '../components/PageHeader';
import UniversalBackButton from '../components/common/UniversalBackButton';
import UnifiedTaskCreateModal from '../components/UnifiedTaskCreateModal';
import { UnifiedTask } from '../types/UnifiedTask';

const TaskDetailPage: React.FC = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { user, activeTenant } = useAuth();
  const [task, setTask] = useState<UnifiedTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  const effectiveTenantId = activeTenant?.id || (user as any)?.activeTenantId;

  useEffect(() => {
    if (!taskId || !effectiveTenantId) {
      setLoading(false);
      return;
    }

    const loadTask = async () => {
      try {
        // Unified Tasks merges `tasks` + `crm_tasks`, so deep links should work for both.
        const taskRef = doc(db, 'tenants', effectiveTenantId, 'tasks', taskId);
        const taskSnap = await getDoc(taskRef);
        const taskSnapFinal = taskSnap.exists()
          ? taskSnap
          : await getDoc(doc(db, 'tenants', effectiveTenantId, 'crm_tasks', taskId));

        if (!taskSnapFinal.exists()) {
          setError(new Error('Task not found'));
          setLoading(false);
          return;
        }

        const taskData = taskSnapFinal.data();
        setTask({
          id: taskSnapFinal.id,
          ...taskData,
        } as UnifiedTask);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    };

    loadTask();
  }, [taskId, effectiveTenantId]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !task) {
    return (
      <Box sx={{ p: 3 }}>
        <PageHeader
          title="Task Not Found"
          showDivider={false}
        />
        <Alert severity="error" sx={{ mt: 2 }}>
          {error?.message || 'Task not found'}
        </Alert>
        <Box sx={{ mt: 2 }}>
          <UniversalBackButton to="/tasks" tooltip="Back to Tasks" />
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        title={task.title}
        subtitle="Task Details"
        showDivider={false}
        rightActions={
          <Button
            variant="contained"
            onClick={() => setShowEditModal(true)}
          >
            Edit Task
          </Button>
        }
      />

      <Box sx={{ flex: 1, overflow: 'auto', px: { xs: 2, md: 3 }, pb: 2 }}>
        <Paper variant="outlined" sx={{ p: 3 }}>
          {task.description && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Description
              </Typography>
              <Typography variant="body1">{task.description}</Typography>
            </Box>
          )}

          <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Status
              </Typography>
              <Typography variant="body1">{task.status}</Typography>
            </Box>

            <Box>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Priority
              </Typography>
              <Typography variant="body1">{task.priority}</Typography>
            </Box>

            <Box>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Type
              </Typography>
              <Typography variant="body1">{task.type}</Typography>
            </Box>

            {task.dueDate && (
              <Box>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Due Date
                </Typography>
                <Typography variant="body1">{task.dueDate}</Typography>
              </Box>
            )}
          </Box>
        </Paper>

        <Box sx={{ mt: 2 }}>
          <UniversalBackButton to="/tasks" tooltip="Back to Tasks" />
        </Box>
      </Box>

      {showEditModal && (
        <UnifiedTaskCreateModal
          open={showEditModal}
          onClose={() => setShowEditModal(false)}
          task={task}
          onSuccess={() => {
            setShowEditModal(false);
            // Reload task
            window.location.reload();
          }}
        />
      )}
    </Box>
  );
};

export default TaskDetailPage;

