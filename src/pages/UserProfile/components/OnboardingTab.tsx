import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  CardHeader,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Snackbar,
  Checkbox,
  TextField,
  Chip,
  LinearProgress,
  Stack,
  Divider,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tooltip,
  IconButton,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Edit as EditIcon,
  Check as CheckIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import {
  type OnboardingTask,
  type OnboardingStatus,
  type OnboardingType,
  initializeOnboardingTasks,
  areRequiredTasksComplete,
  getTaskCompletionPercentage,
} from '../utils/onboardingTasks';
import {
  completeOnboarding,
  cancelOnboarding,
  getActiveOnboardingType,
} from '../utils/onboardingHelpers';
import { logUserActivity } from '../../../utils/activityLogger';
import AssignmentRequirementsCard from './AssignmentRequirementsCard';

interface OnboardingTabProps {
  uid: string;
  tenantId: string;
}

const OnboardingTab: React.FC<OnboardingTabProps> = ({ uid, tenantId }) => {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  
  // Onboarding state
  const [employeeOnboardStatus, setEmployeeOnboardStatus] = useState<OnboardingStatus | undefined>();
  const [contractorOnboardStatus, setContractorOnboardStatus] = useState<OnboardingStatus | undefined>();
  const [onboardingType, setOnboardingType] = useState<OnboardingType | null>(null);
  const [tasks, setTasks] = useState<OnboardingTask[]>([]);
  
  // Editing state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskNotes, setTaskNotes] = useState<string>('');
  
  // Status change dialog
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<OnboardingStatus>('In Progress');

  useEffect(() => {
    loadOnboardingData();
  }, [uid]);

  const loadOnboardingData = async () => {
    setLoading(true);
    try {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
        const userData = userSnap.data();
        
        setEmployeeOnboardStatus(userData.employeeOnboardStatus);
        setContractorOnboardStatus(userData.contractorOnboardStatus);
        
        // Determine active onboarding type
        const activeType = getActiveOnboardingType(
          userData.employeeOnboardStatus,
          userData.contractorOnboardStatus
        );
        setOnboardingType(activeType);
        
        // Load tasks
        const existingTasks = userData.onboardingTasks || [];
        if (activeType) {
          const initializedTasks = initializeOnboardingTasks(activeType, existingTasks);
          setTasks(initializedTasks);
        } else {
          setTasks(existingTasks);
        }
        
      }
    } catch (error) {
      console.error('Error loading onboarding data:', error);
      setErrorMessage('Failed to load onboarding data');
      setShowError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleTaskToggle = async (taskId: string) => {
    if (!onboardingType) return;
    
    setLoading(true);
    try {
      const updatedTasks = tasks.map(task => {
        if (task.id === taskId) {
          return {
            ...task,
            completed: !task.completed,
            completedAt: !task.completed ? new Date() : undefined,
            completedBy: !task.completed ? currentUser?.uid : undefined,
          };
        }
        return task;
      });
      
      setTasks(updatedTasks);
      
      // Save to Firestore
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        onboardingTasks: updatedTasks.map(t => ({
          ...t,
          completedAt: t.completedAt instanceof Date ? t.completedAt : t.completedAt,
        })),
        updatedAt: serverTimestamp(),
      });
      
      // Check if all required tasks are complete
      if (areRequiredTasksComplete(updatedTasks)) {
        setSuccessMessage('All required tasks are complete! You can mark onboarding as completed.');
        setShowSuccess(true);
      }
    } catch (error) {
      console.error('Error updating task:', error);
      setErrorMessage('Failed to update task');
      setShowError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleTaskNotesSave = async (taskId: string) => {
    if (!onboardingType) return;
    
    setLoading(true);
    try {
      const updatedTasks = tasks.map(task => {
        if (task.id === taskId) {
          return { ...task, notes: taskNotes };
        }
        return task;
      });
      
      setTasks(updatedTasks);
      
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        onboardingTasks: updatedTasks,
        updatedAt: serverTimestamp(),
      });
      
      setEditingTaskId(null);
      setTaskNotes('');
      setSuccessMessage('Task notes saved');
      setShowSuccess(true);
    } catch (error) {
      console.error('Error saving task notes:', error);
      setErrorMessage('Failed to save task notes');
      setShowError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async () => {
    if (!onboardingType) return;
    
    setLoading(true);
    try {
      if (newStatus === 'Completed') {
        // Verify all required tasks are complete
        if (!areRequiredTasksComplete(tasks)) {
          setErrorMessage('Cannot complete onboarding: All required tasks must be completed first.');
          setShowError(true);
          setStatusDialogOpen(false);
          setLoading(false);
          return;
        }
        
        await completeOnboarding(uid, tenantId, onboardingType, currentUser?.uid);
        setSuccessMessage(`Onboarding marked as completed. User security level has been updated.`);
        
        // Log activity
        await logUserActivity({
          userId: uid,
          action: 'Onboarding Completed',
          actionType: 'other',
          description: `Employee onboarding completed`,
          severity: 'medium',
          source: 'web',
          metadata: {
            tenantId,
            onboardingType: onboardingType,
            completedBy: currentUser?.uid,
          },
        });
      } else if (newStatus === 'Cancelled') {
        await cancelOnboarding(uid, tenantId, onboardingType, currentUser?.uid);
        setSuccessMessage('Onboarding cancelled');
        
        await logUserActivity({
          userId: uid,
          action: 'Onboarding Cancelled',
          actionType: 'other',
          description: `Onboarding cancelled`,
          severity: 'medium',
          source: 'web',
          metadata: {
            tenantId,
            onboardingType: onboardingType,
            cancelledBy: currentUser?.uid,
          },
        });
      }
      
      // Update local state
      if (onboardingType === 'employee') {
        setEmployeeOnboardStatus(newStatus);
      } else {
        setContractorOnboardStatus(newStatus);
      }
      
      setStatusDialogOpen(false);
      await loadOnboardingData(); // Reload to get updated data
    } catch (error: any) {
      console.error('Error changing onboarding status:', error);
      setErrorMessage(error.message || 'Failed to change onboarding status');
      setShowError(true);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status?: OnboardingStatus) => {
    switch (status) {
      case 'Completed':
        return 'success';
      case 'In Progress':
        return 'warning';
      case 'Cancelled':
        return 'error';
      default:
        return 'default';
    }
  };

  const groupTasksByCategory = (tasks: OnboardingTask[]) => {
    const grouped: Record<string, OnboardingTask[]> = {};
    tasks.forEach(task => {
      if (!grouped[task.category]) {
        grouped[task.category] = [];
      }
      grouped[task.category].push(task);
    });
    return grouped;
  };

  if (loading && !onboardingType) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>Loading onboarding data...</Typography>
      </Box>
    );
  }

  if (!onboardingType) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">
          No active onboarding process. Start onboarding from the user profile header.
        </Alert>
      </Box>
    );
  }

  const currentStatus = onboardingType === 'employee' ? employeeOnboardStatus : contractorOnboardStatus;
  const completionPercentage = getTaskCompletionPercentage(tasks);
  const allRequiredTasksComplete = areRequiredTasksComplete(tasks);
  const groupedTasks = groupTasksByCategory(tasks);

  return (
    <Box sx={{ py: 4 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h6" fontWeight={700}>
            {onboardingType === 'employee' ? 'Employee' : 'Contractor'} Onboarding
          </Typography>
          <Stack direction="row" spacing={2} alignItems="center">
            <Chip
              label={currentStatus || 'Unknown'}
              color={getStatusColor(currentStatus) as any}
              size="medium"
            />
            {currentStatus === 'In Progress' && (
              <Button
                variant="outlined"
                onClick={() => {
                  setNewStatus(currentStatus === 'In Progress' ? 'Completed' : 'In Progress');
                  setStatusDialogOpen(true);
                }}
              >
                Change Status
              </Button>
            )}
          </Stack>
        </Stack>

        {/* Progress Bar */}
        <Box sx={{ mb: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Progress
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              {completionPercentage}%
            </Typography>
          </Stack>
          <LinearProgress variant="determinate" value={completionPercentage} sx={{ height: 8, borderRadius: 1 }} />
        </Box>
      </Box>

      {/* Assignment Requirements Card */}
      <AssignmentRequirementsCard userId={uid} tenantId={tenantId} />

      {/* Tasks by Category */}
      {Object.entries(groupedTasks).map(([category, categoryTasks]) => (
        <Card key={category} sx={{ mb: 3 }}>
          <CardHeader
            title={category}
            titleTypographyProps={{ variant: 'h6', fontWeight: 700 }}
          />
          <CardContent>
            <Grid container spacing={2}>
              {categoryTasks.map((task) => (
                <Grid item xs={12} key={task.id}>
                  <Box
                    sx={{
                      p: 2,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      backgroundColor: task.completed ? 'action.selected' : 'background.paper',
                    }}
                  >
                    <Stack direction="row" spacing={2} alignItems="flex-start">
                      <Checkbox
                        checked={task.completed}
                        onChange={() => handleTaskToggle(task.id)}
                        disabled={loading || currentStatus !== 'In Progress'}
                        icon={<CheckCircleIcon />}
                        checkedIcon={<CheckCircleIcon color="success" />}
                      />
                      <Box sx={{ flexGrow: 1 }}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="body1" fontWeight={task.completed ? 400 : 600}>
                            {task.label}
                          </Typography>
                          {task.required && (
                            <Chip label="Required" size="small" color="primary" variant="outlined" />
                          )}
                        </Stack>
                        
                        {task.completed && task.completedAt && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                            Completed: {new Date(task.completedAt).toLocaleDateString()}
                          </Typography>
                        )}
                        
                        {task.notes && (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                            {task.notes}
                          </Typography>
                        )}
                        
                        {editingTaskId === task.id ? (
                          <Box sx={{ mt: 2 }}>
                            <TextField
                              fullWidth
                              multiline
                              rows={3}
                              value={taskNotes}
                              onChange={(e) => setTaskNotes(e.target.value)}
                              placeholder="Add notes..."
                              size="small"
                            />
                            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                              <Button
                                size="small"
                                variant="contained"
                                startIcon={<CheckIcon />}
                                onClick={() => handleTaskNotesSave(task.id)}
                                disabled={loading}
                              >
                                Save
                              </Button>
                              <Button
                                size="small"
                                onClick={() => {
                                  setEditingTaskId(null);
                                  setTaskNotes('');
                                }}
                              >
                                Cancel
                              </Button>
                            </Stack>
                          </Box>
                        ) : (
                          <Button
                            size="small"
                            startIcon={<EditIcon />}
                            onClick={() => {
                              setEditingTaskId(task.id);
                              setTaskNotes(task.notes || '');
                            }}
                            sx={{ mt: 1 }}
                          >
                            {task.notes ? 'Edit Notes' : 'Add Notes'}
                          </Button>
                        )}
                      </Box>
                    </Stack>
                  </Box>
                </Grid>
              ))}
            </Grid>
          </CardContent>
        </Card>
      ))}

      {/* Completion Alert */}
      {allRequiredTasksComplete && currentStatus === 'In Progress' && (
        <Alert severity="success" sx={{ mt: 3 }}>
          All required tasks are complete! You can now mark onboarding as completed.
        </Alert>
      )}

      {/* Status Change Dialog */}
      <Dialog open={statusDialogOpen} onClose={() => setStatusDialogOpen(false)}>
        <DialogTitle>Change Onboarding Status</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel>New Status</InputLabel>
            <Select
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value as OnboardingStatus)}
              label="New Status"
            >
              <MenuItem value="In Progress">In Progress</MenuItem>
              <MenuItem value="Completed">Completed</MenuItem>
              <MenuItem value="Cancelled">Cancelled</MenuItem>
            </Select>
          </FormControl>
          {newStatus === 'Completed' && !allRequiredTasksComplete && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              All required tasks must be completed before marking onboarding as complete.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatusDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleStatusChange}
            variant="contained"
            disabled={loading || (newStatus === 'Completed' && !allRequiredTasksComplete)}
          >
            Update Status
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success/Error Snackbars */}
      <Snackbar
        open={showSuccess}
        autoHideDuration={6000}
        onClose={() => setShowSuccess(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={() => setShowSuccess(false)} severity="success" sx={{ width: '100%' }}>
          {successMessage}
        </Alert>
      </Snackbar>

      <Snackbar
        open={showError}
        autoHideDuration={6000}
        onClose={() => setShowError(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={() => setShowError(false)} severity="error" sx={{ width: '100%' }}>
          {errorMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default OnboardingTab;

