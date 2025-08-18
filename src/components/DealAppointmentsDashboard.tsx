/* eslint-disable react/prop-types */
import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Chip,
  IconButton,
  List,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  LinearProgress,
  Collapse,
  Fade,
  Grow
} from '@mui/material';
import {
  Add as AddIcon,
  Event as EventIcon,
  Business as BusinessIcon,
  Person as PersonIcon,
  CalendarMonth as CalendarMonthIcon,
  MoreVert as MoreVertIcon,
  VideoCall as VideoCallIcon,
  Directions as DirectionsIcon,
  LocationOn as LocationOnIcon
} from '@mui/icons-material';

import { useAuth } from '../contexts/AuthContext';
import { TaskService } from '../utils/taskService';
import { getDealPrimaryCompanyId } from '../utils/associationsAdapter';
import { TaskClassification } from '../types/Tasks';

import CreateTaskDialog from './CreateTaskDialog';
import TaskDetailsDialog from './TaskDetailsDialog';
import AppointmentCard from './AppointmentCard';

interface DealAppointmentsDashboardProps {
  dealId: string;
  tenantId: string;
  deal: any; // Deal information
}

interface AppointmentData {
  id: string;
  title: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  date?: string;
  status: string;
  priority?: string;
  assignedTo?: string[];
  participants?: string[];
  classification: string;
  type: string;
  createdAt?: any;
  updatedAt?: any;
}

const DealAppointmentsDashboard: React.FC<DealAppointmentsDashboardProps> = React.memo(function DealAppointmentsDashboard({
  dealId,
  tenantId,
  deal
}) {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState<AppointmentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentData | null>(null);
  const [associatedContacts, setAssociatedContacts] = useState<any[]>([]);
  const [associatedSalespeople, setAssociatedSalespeople] = useState<any[]>([]);
  const [hoveredAppointment, setHoveredAppointment] = useState<string | null>(null);

  // Load appointments data
  const loadAppointments = () => {
    try {
      setLoading(true);
      const taskService = TaskService.getInstance();
      
      // Subscribe to tasks for this deal, filtered by classification: 'appointment'
      const unsubscribe = taskService.subscribeToTasks(
        user?.uid || '',
        tenantId,
        { dealId },
        (tasks) => {
          // REMOVED: Excessive logging causing re-renders
          
          // Filter for appointment classification
          const appointmentTasks = tasks.filter(task => {
            const taskClassification = task.classification?.toLowerCase() || '';
            const isAppointment = taskClassification === 'appointment';
            return isAppointment;
          });
          
                      // REMOVED: Excessive logging causing re-renders
          
          setAppointments(appointmentTasks);
          setLoading(false);
          setError(null);
        }
      );

      return unsubscribe;
    } catch (error) {
      console.error('Error setting up appointments subscription:', error);
      setError('Failed to load appointments');
      setLoading(false);
    }
  };

  // Load associated data for task creation
  const loadAssociatedData = async () => {
    try {
      // Load contacts and salespeople associated with this deal
      // This would typically come from your association service
      // For now, using empty arrays - you may need to implement this based on your data structure
      setAssociatedContacts([]);
      setAssociatedSalespeople([]);
    } catch (error) {
      console.error('Error loading associated data:', error);
    }
  };

  useEffect(() => {
    const unsubscribe = loadAppointments();
    loadAssociatedData();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [dealId]);

  const handleCreateAppointment = async (taskData: any) => {
    try {
      const taskService = TaskService.getInstance();
      const primaryCompanyId = getDealPrimaryCompanyId(deal);
      await taskService.createTask({
        ...taskData,
        classification: 'appointment', // Ensure it's marked as appointment
        tenantId: tenantId,
        createdBy: user?.uid || '',
        status: 'pending',
        associations: {
          ...taskData.associations,
          deals: [dealId],
          companies: primaryCompanyId ? [primaryCompanyId] : [],
          contacts: taskData.associations?.contacts || [],
          salespeople: taskData.associations?.salespeople || []
        }
      });
      setShowCreateDialog(false);
    } catch (error) {
      console.error('Error creating appointment:', error);
      setError('Failed to create appointment');
    }
  };

  const handleAppointmentClick = (appointment: AppointmentData) => {
    setSelectedAppointment(appointment);
    setShowDetailsDialog(true);
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return 'success';
      case 'in_progress':
        return 'warning';
      case 'pending':
        return 'info';
      default:
        return 'primary';
    }
  };



  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const formatTime = (timeString?: string) => {
    if (!timeString) return '';
    const date = new Date(timeString);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const getRelativeDate = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const today = new Date();
    const diffTime = date.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'tomorrow';
    if (diffDays === -1) return 'yesterday';
    if (diffDays > 1) return `in ${diffDays} days`;
    if (diffDays < -1) return `${Math.abs(diffDays)} days ago`;
    return '';
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority?.toLowerCase()) {
      case 'high': return 'error';
      case 'medium': return 'warning';
      case 'low': return 'success';
      default: return 'primary';
    }
  };

  const getStatusChipBackground = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed': return 'success.main';
      case 'overdue': return 'error.main';
      case 'due': return 'warning.main';
      case 'pending': return 'info.main';
      default: return 'grey.500';
    }
  };

  const isAppointmentOverdue = (startTime: string) => {
    if (!startTime) return false;
    const appointmentTime = new Date(startTime);
    const now = new Date();
    return appointmentTime < now;
  };

  const formatAppointmentDate = (startTime: string) => {
    if (!startTime) return null;
    const date = new Date(startTime);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const isToday = date.toDateString() === today.toDateString();
    const isTomorrow = date.toDateString() === tomorrow.toDateString();
    
    let dayFormat = date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    });
    
    let relativeText = '';
    if (isToday) {
      dayFormat = 'Today';
      relativeText = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else if (isTomorrow) {
      dayFormat = 'Tomorrow';
      relativeText = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else {
      relativeText = getRelativeDate(startTime);
    }
    
    return { dayFormat, relativeText, isToday };
  };

  if (loading) {
    return (
      <Box sx={{ p: 0 }}>
        <LinearProgress />
        <Typography variant="body2" sx={{ mt: 2 }}>
          Loading appointments...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert 
          severity="error" 
          onClose={() => setError(null)}
          action={
            <Button 
              color="inherit" 
              size="small" 
              onClick={() => {
                setError(null);
                loadAppointments();
              }}
            >
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      {/* Appointments List */}
      <List sx={{ p: 0 }}>
        {appointments.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              No upcoming appointments
            </Typography>
            <Button 
              variant="contained" 
              startIcon={<EventIcon />}
              size="small"
              onClick={() => setShowCreateDialog(true)}
            >
              Schedule Meeting
            </Button>
          </Box>
        ) : (
          appointments.map((appointment) => (
            <AppointmentCard
              key={appointment.id}
              appointment={appointment}
              onAppointmentClick={handleAppointmentClick}
              showCompany={false}
              showDeal={false}
              showContacts={true}
              contacts={associatedContacts}
              variant="default"
            />
          ))
        )}
      </List>

      {/* Dialogs */}
      {showCreateDialog && (
        <CreateTaskDialog
          open={showCreateDialog}
          onClose={() => setShowCreateDialog(false)}
          onSubmit={handleCreateAppointment}
          prefilledData={{
            classification: 'appointment',
            type: 'scheduled_meeting_virtual',
            title: 'New Meeting',
            associations: {
              deals: [dealId],
              companies: getDealPrimaryCompanyId(deal) ? [getDealPrimaryCompanyId(deal) as string] : [],
              contacts: [],
              salespeople: []
            }
          }}
          salespeople={associatedSalespeople}
          contacts={associatedContacts}
          currentUserId={user?.uid || ''}
        />
      )}

      {showDetailsDialog && selectedAppointment && (
        <TaskDetailsDialog
          open={showDetailsDialog}
          task={selectedAppointment}
          onClose={() => {
            setShowDetailsDialog(false);
            setSelectedAppointment(null);
          }}
          onTaskUpdated={async (taskId: string) => {
            await loadAppointments();
            setShowDetailsDialog(false);
            setSelectedAppointment(null);
          }}
          salespersonId={user?.uid || ''}
          tenantId={tenantId}
          contacts={associatedContacts}
          salespeople={associatedSalespeople}
        />
      )}
    </Box>
  );
});

export default React.memo(DealAppointmentsDashboard);
