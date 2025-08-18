import React, { useState } from 'react';
import {
  Card,
  Box,
  Typography,
  Chip,
  Button,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  Event as EventIcon,
  VideoCall as VideoCallIcon,
  Phone as PhoneIcon,
  Schedule as ScheduleIcon,
  MoreVert as MoreVertIcon,
  Person as PersonIcon,
  Business as BusinessIcon,
  AttachMoney as AttachMoneyIcon
} from '@mui/icons-material';

interface AppointmentCardProps {
  appointment: any;
  onAppointmentClick: (appointment: any) => void;
  onEditAppointment?: (appointment: any) => void;
  showCompany?: boolean;
  showDeal?: boolean;
  showContacts?: boolean;
  company?: any;
  deal?: any;
  contacts?: any[];
  salespeople?: any[];
  variant?: 'default' | 'compact';
  sx?: any;
}

/**
 * Reusable AppointmentCard component that adapts to different contexts
 * 
 * Usage Examples:
 * 
 * // In Deal Details - hide company/deal, show contacts
 * <AppointmentCard
 *   appointment={appointment}
 *   onAppointmentClick={handleAppointmentClick}
 *   onEditAppointment={handleEditAppointment}
 *   showCompany={false}
 *   showDeal={false}
 *   showContacts={true}
 *   contacts={associatedContacts}
 * />
 * 
 * // In Contact Details - hide company, show deal and contacts
 * <AppointmentCard
 *   appointment={appointment}
 *   onAppointmentClick={handleAppointmentClick}
 *   onEditAppointment={handleEditAppointment}
 *   showCompany={false}
 *   showDeal={true}
 *   showContacts={true}
 *   deal={deal}
 *   contacts={[contact]}
 * />
 */
const AppointmentCard: React.FC<AppointmentCardProps> = ({
  appointment,
  onAppointmentClick,
  onEditAppointment,
  showCompany = true,
  showDeal = true,
  showContacts = true,
  company,
  deal,
  contacts = [],
  salespeople = [],
  variant = 'default',
  sx
}) => {
  const getAppointmentIcon = (type: string) => {
    switch (type) {
      case 'scheduled_meeting_virtual':
        return <VideoCallIcon sx={{ fontSize: '1.2rem', color: 'text.secondary' }} />;
      case 'phone_call':
        return <PhoneIcon sx={{ fontSize: '1.2rem', color: 'text.secondary' }} />;
      default:
        return <EventIcon sx={{ fontSize: '1.2rem', color: 'text.secondary' }} />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed': return 'success';
      case 'overdue': return 'error';
      case 'due': return 'warning';
      case 'pending': return 'info';
      case 'scheduled': return 'primary';
      default: return 'default';
    }
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority?.toLowerCase()) {
      case 'high': return 'error';
      case 'medium': return 'warning';
      case 'low': return 'success';
      default: return 'primary';
    }
  };

  const formatTime = (timeString: string) => {
    if (!timeString) return '';
    const date = new Date(timeString);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric' 
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

  const isCompact = variant === 'compact';
  const [isHovered, setIsHovered] = useState(false);

  const getContactDisplay = () => {
    // First, try to get contacts from appointment associations
    if (appointment.associations?.contacts && appointment.associations.contacts.length > 0) {
      // If we have contact IDs in appointment associations, try to resolve them
      const appointmentContactIds = appointment.associations.contacts;
      
      // If we have contacts prop (from contact context), try to match by ID
      if (contacts && contacts.length > 0) {
        const matchedContacts = contacts.filter((contact: any) => 
          appointmentContactIds.includes(contact.id)
        );
        
        if (matchedContacts.length > 0) {
          if (matchedContacts.length === 1) {
            return matchedContacts[0].fullName || `${matchedContacts[0].firstName} ${matchedContacts[0].lastName}`;
          }
          return `${matchedContacts.length} contacts`;
        }
      }
      
      // Fallback: show the number of contact IDs
      return `${appointmentContactIds.length} contacts`;
    }
    
    // Fallback to contacts prop (for backward compatibility)
    if (contacts && contacts.length > 0) {
      if (contacts.length === 1) {
        return contacts[0].fullName || `${contacts[0].firstName} ${contacts[0].lastName}`;
      }
      return `${contacts.length} contacts`;
    }
    
    return null;
  };

  const getSalespersonDisplay = () => {
    // Check if appointment has assignedTo field
    if (appointment.assignedTo) {
      // First, try to use the optimized assignedToName field (new optimization)
      if (appointment.assignedToName) {
        return appointment.assignedToName;
      }
      
      // Fallback: try to get salespeople from appointment associations
      if (appointment.associations?.salespeople && appointment.associations.salespeople.length > 0) {
        const appointmentSalespersonIds = appointment.associations.salespeople;
        
        // If we have salespeople prop (from contact context), try to match by ID
        if (salespeople && salespeople.length > 0) {
          const matchedSalesperson = salespeople.find((s: any) => 
            appointmentSalespersonIds.includes(s.id) && s.id === appointment.assignedTo
          );
          if (matchedSalesperson) {
            return matchedSalesperson.fullName || matchedSalesperson.name || matchedSalesperson.displayName || 'Unknown User';
          }
        }
      }
      
      // Fallback: try to find by assignedTo ID in salespeople prop
      if (salespeople && salespeople.length > 0) {
        const salesperson = salespeople.find((s: any) => s.id === appointment.assignedTo);
        if (salesperson) {
          return salesperson.fullName || salesperson.name || salesperson.displayName || 'Unknown User';
        }
      }
      
      // Fallback to just showing the ID if no name found
      return appointment.assignedTo;
    }
    return 'Unassigned';
  };

  const getDealDisplay = () => {
    // First try to get deal from props
    if (deal) {
      return deal.name || deal.title || 'Unknown Deal';
    }
    
    // Then try to get from appointment associations
    const associatedDeals = appointment.associations?.deals || [];
    if (associatedDeals.length > 0) {
      // For now, just show the number of deals since we don't have the full deal data
      return `${associatedDeals.length} deal${associatedDeals.length > 1 ? 's' : ''}`;
    }
    
    return null;
  };

  // Get appointment date and time info
  const getAppointmentDateTime = () => {
    // For appointments, prioritize startTime, then scheduledDate, then dueDate
    const date = appointment.startTime || appointment.scheduledDate || appointment.dueDate;
    if (!date) return null;
    
    try {
      const dateObj = new Date(date);
      if (isNaN(dateObj.getTime())) return null;
      
      const dateStr = dateObj.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });
      
      const timeStr = appointment.startTime ? 
        new Date(appointment.startTime).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        }) : '';
      
      const durationStr = appointment.duration ? `${appointment.duration} min` : '';
      
      return { dateStr, timeStr, durationStr };
    } catch (error) {
      return null;
    }
  };

  const dateTimeInfo = getAppointmentDateTime();

  // Clean design matching todo tile style with hover expansion
  return (
    <Box 
      sx={{ 
        display: 'flex', 
        flexDirection: 'column',
        p: 1.5,
        mb: 1,
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'background.paper',
        cursor: 'pointer',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          backgroundColor: 'action.hover',
          borderColor: 'primary.main'
        },
        ...sx
      }}
      onClick={() => onAppointmentClick(appointment)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Main row: Icon, Title, and Actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Left side: Icon and Title */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
          {getAppointmentIcon(appointment.type)}
          
          <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <Typography 
              variant="body1" 
              sx={{ 
                fontWeight: 'bold',
                color: 'text.primary'
              }}
            >
              {appointment.title || 'Untitled Appointment'}
            </Typography>
            
            {/* Second line: Date, Time, Duration */}
            {dateTimeInfo && (
              <Typography 
                variant="caption" 
                sx={{ 
                  color: 'text.secondary',
                  fontSize: '0.7rem',
                  mt: 0
                }}
              >
                {[dateTimeInfo.dateStr, dateTimeInfo.timeStr, dateTimeInfo.durationStr]
                  .filter(Boolean)
                  .join(' • ')}
              </Typography>
            )}
          </Box>
        </Box>

        {/* Right side: Status, Priority, and actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {/* Status chip */}
          <Chip 
            label={appointment.status || 'pending'} 
            size="small" 
            variant="outlined"
            color={getStatusColor(appointment.status) as any}
            sx={{ fontSize: '0.7rem', height: '20px' }}
          />
          
          {/* Priority chip */}
          {appointment.priority && (
            <Chip
              label={appointment.priority}
              color={getPriorityColor(appointment.priority) as any}
              size="small"
              variant="outlined"
              sx={{ 
                fontSize: '0.7rem', 
                height: '20px',
                ...(appointment.priority === 'low' ? {
                  backgroundColor: '#e3f2fd',
                  color: '#1976d2',
                  '&:hover': {
                    backgroundColor: '#bbdefb',
                  }
                } : {})
              }}
            />
          )}
          
          {/* Ellipsis menu for additional actions */}
          {onEditAppointment && (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onEditAppointment(appointment);
              }}
              sx={{ 
                color: 'text.secondary',
                '&:hover': {
                  color: 'primary.main',
                  backgroundColor: 'primary.50'
                }
              }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
      </Box>

      {/* Expanded details on hover */}
      {isHovered && (
        <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          {/* Description */}
          {appointment.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {appointment.description}
            </Typography>
          )}



          {/* Context Information */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {/* Assigned Person */}
            {appointment.assignedTo && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <PersonIcon fontSize="small" color="action" />
                <Typography variant="caption" color="text.secondary">
                  Assigned: {getSalespersonDisplay()}
                </Typography>
              </Box>
            )}
            
            {/* Contacts */}
            {showContacts && getContactDisplay() && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <PersonIcon fontSize="small" color="action" />
                <Typography variant="caption" color="text.secondary">
                  Contacts: {getContactDisplay()}
                </Typography>
              </Box>
            )}
            
            {/* Company */}
            {showCompany && company && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <BusinessIcon fontSize="small" color="action" />
                <Typography variant="caption" color="text.secondary">
                  Company: {company.companyName || company.name}
                </Typography>
              </Box>
            )}

            {/* Meeting Type */}
            {appointment.type && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <EventIcon fontSize="small" color="action" />
                <Typography variant="caption" color="text.secondary">
                  Type: {appointment.type}
                </Typography>
              </Box>
            )}

            {/* Category */}
            {appointment.category && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <ScheduleIcon fontSize="small" color="action" />
                <Typography variant="caption" color="text.secondary">
                  Category: {appointment.category}
                </Typography>
              </Box>
            )}

            {/* Deal */}
            {showDeal && deal && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <AttachMoneyIcon fontSize="small" color="action" />
                <Typography variant="caption" color="text.secondary">
                  Deal: {deal.name || deal.title}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default AppointmentCard;
