/**
 * UnifiedTaskCreateModal Component
 * 
 * Wrapper around CreateTaskDialog for the Unified Tasks Hub.
 */

import React from 'react';
import CreateTaskDialog from './CreateTaskDialog';
import { UnifiedTask } from '../types/UnifiedTask';
import { useAuth } from '../contexts/AuthContext';
import { TaskService } from '../utils/taskService';

interface UnifiedTaskCreateModalProps {
  open: boolean;
  onClose: () => void;
  task?: UnifiedTask | null; // If provided, edit mode
  onSuccess: () => void;
}

const UnifiedTaskCreateModal: React.FC<UnifiedTaskCreateModalProps> = ({
  open,
  onClose,
  task,
  onSuccess,
}) => {
  const { user, activeTenant } = useAuth();
  const effectiveTenantId = activeTenant?.id || (user as any)?.activeTenantId || '';

  const handleSubmit = async (taskData: any) => {
    try {
      const taskService = TaskService.getInstance();

      if (task) {
        // Update existing task
        await taskService.updateTask(task.id, taskData, effectiveTenantId);
      } else {
        // Create new task
        await taskService.createTask({
          ...taskData,
          tenantId: effectiveTenantId,
          assignedTo: user?.uid || '',
          createdBy: user?.uid || '',
        });
      }

      onSuccess();
    } catch (error) {
      console.error('Error saving task:', error);
      throw error;
    }
  };

  return (
    <CreateTaskDialog
      open={open}
      onClose={onClose}
      onSubmit={handleSubmit}
      prefilledData={task ? {
        title: task.title,
        description: task.description,
        type: task.type,
        priority: task.priority,
        status: task.status,
        classification: task.classification,
        scheduledDate: task.scheduledDate,
        dueDate: task.dueDate,
        startTime: task.startTime,
        duration: task.duration,
        category: task.category,
        quotaCategory: task.quotaCategory,
        associations: task.associations,
        notes: task.notes,
        tags: task.tags,
      } : undefined}
      currentUserId={user?.uid || ''}
    />
  );
};

export default UnifiedTaskCreateModal;

