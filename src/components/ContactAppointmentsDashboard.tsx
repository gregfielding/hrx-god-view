import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Alert,
  LinearProgress,
  Button
} from '@mui/material';
import {
  Schedule as ScheduleIcon,
  Event as EventIcon
} from '@mui/icons-material';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import AppointmentCard from './AppointmentCard';
import TaskDetailsDialog from './TaskDetailsDialog';

interface ContactAppointmentsDashboardProps {
  contactId: string;
  tenantId: string;
  contact: any;
  // Pre-loaded associations to prevent duplicate calls
  preloadedContacts?: any[];
  preloadedSalespeople?: any[];
  preloadedCompany?: any;
}

const ContactAppointmentsDashboard: React.FC<ContactAppointmentsDashboardProps> = ({
  contactId,
  tenantId,
  contact,
  preloadedContacts,
  preloadedSalespeople,
  preloadedCompany
}) => {
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<any>(null);

  const loadAppointments = async () => {
    if (!contactId || !tenantId) return;
    
    setLoading(true);
    try {
      // Query for appointments associated with this contact
      const appointmentsQuery = query(
        collection(db, 'tenants', tenantId, 'tasks'),
        where('classification', '==', 'appointment'),
        where('associations.contacts', 'array-contains', contactId),
        orderBy('dueDate', 'asc')
      );
      
      const appointmentsSnapshot = await getDocs(appointmentsQuery);
      const appointmentsData = appointmentsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      setAppointments(appointmentsData);
    } catch (err) {
      console.error('Error loading appointments:', err);
      setError('Failed to load appointments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAppointments();
  }, [contactId, tenantId]);

  // Removed unused functions - now handled by AppointmentCard component

  if (loading) {
    return (
      <Box sx={{ p: 2 }}>
        <LinearProgress />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Loading appointments...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error" action={
          <Button color="inherit" size="small" onClick={loadAppointments}>
            Retry
          </Button>
        }>
          {error}
        </Alert>
      </Box>
    );
  }

  if (appointments.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <ScheduleIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
        <Typography variant="body2" color="text.secondary">
          No appointments scheduled
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Create appointments using the + button above
        </Typography>
      </Box>
    );
  }

  const handleAppointmentClick = (appointment: any) => {
    // Handle appointment click - could open details dialog
    console.log('Appointment clicked:', appointment);
  };

  const handleEditAppointment = (appointment: any) => {
    setSelectedAppointment(appointment);
    setShowDetailsDialog(true);
  };

  return (
    <Box>
      {appointments.map((appointment) => (
        <AppointmentCard
          key={appointment.id}
          appointment={appointment}
          onAppointmentClick={handleAppointmentClick}
          onEditAppointment={handleEditAppointment}
          showCompany={true}
          showDeal={true}
          showContacts={true}
          contacts={preloadedContacts || []}
          company={preloadedCompany}
          salespeople={preloadedSalespeople || []}
          variant="default"
        />
      ))}

      {/* Edit Appointment Dialog */}
      {showDetailsDialog && selectedAppointment && (
        <TaskDetailsDialog
          open={showDetailsDialog}
          onClose={() => {
            setShowDetailsDialog(false);
            setSelectedAppointment(null);
          }}
          task={selectedAppointment}
          onTaskUpdated={async (taskId: string) => {
            // Refresh appointments after update
            await loadAppointments();
            setShowDetailsDialog(false);
            setSelectedAppointment(null);
          }}
          salespersonId={contact?.salesOwnerId || ''}
          tenantId={tenantId}
        />
      )}
    </Box>
  );
};

export default ContactAppointmentsDashboard;
