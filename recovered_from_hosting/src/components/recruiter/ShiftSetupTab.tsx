import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  FormControlLabel,
  IconButton,
  Chip,
  Stack,
  Alert,
  CircularProgress,
  Grid,
  Autocomplete,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  ContentCopy as DuplicateIcon,
  CalendarMonth as CalendarIcon,
  AccessTime as TimeIcon,
  Group as GroupIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';
import { collection, query, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, addMonths, subMonths, startOfWeek, endOfWeek, isToday } from 'date-fns';
interface Shift {
  id: string;
  tenantId: string;
  jobOrderId: string;
  shiftTitle: string;
  defaultJobTitle?: string;
  totalStaffRequested: number;
  showStaffNeeded?: boolean; // Show staff count on jobs board
  poNumber?: string;
  shiftDate: string; // ISO date string
  defaultStartTime: string; // HH:mm format
  defaultEndTime: string; // HH:mm format
  shiftDescription?: string;
  emailIntro?: string;
  sendNotification: boolean;
  files?: Array<{
    title: string;
    description: string;
    url: string;
    fileName: string;
  }>;
  createdAt: any;
  createdBy: string;
  updatedAt: any;
}

interface Position {
  jobTitle: string;
  payRate: string;
  workersNeeded?: number;
}

interface ShiftSetupTabProps {
  tenantId: string;
  jobOrderId: string;
  jobOrder: any;
}

const ShiftSetupTab: React.FC<ShiftSetupTabProps> = ({ tenantId, jobOrderId, jobOrder }) => {
  const { user } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [formData, setFormData] = useState({
    shiftTitle: '',
    defaultJobTitle: '',
    totalStaffRequested: 1,
    showStaffNeeded: false,
    poNumber: '',
    shiftDate: '',
    defaultStartTime: '',
    defaultEndTime: '',
    shiftDescription: '',
    emailIntro: '',
    sendNotification: true,
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [shiftToDuplicate, setShiftToDuplicate] = useState<Shift | null>(null);
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [calendarMonth, setCalendarMonth] = useState(new Date());

  // Get available positions from job order (gigPositions for gig jobs, or single position for career jobs)
  const getAvailablePositions = (): Position[] => {
    if (!jobOrder) return [];
    
    // For gig jobs, use gigPositions array
    if (jobOrder.jobType === 'gig' && jobOrder.gigPositions && Array.isArray(jobOrder.gigPositions)) {
      return jobOrder.gigPositions.map((pos: any) => ({
        jobTitle: pos.jobTitle || '',
        payRate: pos.payRate || '',
        workersNeeded: pos.workersNeeded
      }));
    }
    
    // For career jobs, create a single position from job order fields
    if (jobOrder.jobTitle) {
      return [{
        jobTitle: jobOrder.jobTitle,
        payRate: String(jobOrder.payRate || ''),
        workersNeeded: jobOrder.workersNeeded
      }];
    }
    
    return [];
  };

  const availablePositions = getAvailablePositions();

  useEffect(() => {
    fetchShifts();
  }, [tenantId, jobOrderId]);

  const fetchShifts = async () => {
    try {
      setLoading(true);
      // Use tenant/job_order subcollection path
      const shiftsRef = collection(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts');
      const q = query(shiftsRef);
      const snapshot = await getDocs(q);
      
      const shiftsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Shift[];
      
      // Sort by date
      shiftsData.sort((a, b) => new Date(a.shiftDate).getTime() - new Date(b.shiftDate).getTime());
      
      setShifts(shiftsData);
    } catch (err) {
      console.error('Error fetching shifts:', err);
      setError('Failed to load shifts');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (shift?: Shift) => {
    if (shift) {
      setEditingShift(shift);
      setFormData({
        shiftTitle: shift.shiftTitle,
        defaultJobTitle: shift.defaultJobTitle || '',
        totalStaffRequested: shift.totalStaffRequested,
        showStaffNeeded: shift.showStaffNeeded || false,
        poNumber: shift.poNumber || '',
        shiftDate: shift.shiftDate,
        defaultStartTime: shift.defaultStartTime,
        defaultEndTime: shift.defaultEndTime,
        shiftDescription: shift.shiftDescription || '',
        emailIntro: shift.emailIntro || '',
        sendNotification: shift.sendNotification,
      });
    } else {
      setEditingShift(null);
      // Get available positions and use first one's job title as default, or job order's job title
      const positions = getAvailablePositions();
      const defaultJobTitle = positions.length > 0 
        ? positions[0].jobTitle 
        : (jobOrder?.jobTitle || '');
      
      setFormData({
        shiftTitle: '',
        defaultJobTitle: defaultJobTitle,
        totalStaffRequested: 1,
        showStaffNeeded: false,
        poNumber: '',
        shiftDate: '',
        defaultStartTime: '',
        defaultEndTime: '',
        shiftDescription: '',
        emailIntro: '',
        sendNotification: true,
      });
    }
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingShift(null);
    setError('');
  };

  const handleSubmit = async () => {
    try {
      // Validation
      if (!formData.shiftTitle.trim()) {
        setError('Shift title is required');
        return;
      }
      if (!formData.shiftDate) {
        setError('Shift date is required');
        return;
      }
      if (!formData.defaultStartTime || !formData.defaultEndTime) {
        setError('Start and end times are required');
        return;
      }
      if (formData.totalStaffRequested < 1) {
        setError('Total staff requested must be at least 1');
        return;
      }

      const shiftData = {
        ...formData,
        tenantId,
        jobOrderId,
        updatedAt: serverTimestamp(),
        ...(editingShift ? {} : {
          createdAt: serverTimestamp(),
          createdBy: user?.uid || 'unknown',
        }),
      };

      if (editingShift) {
        // Update existing shift
        await updateDoc(doc(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts', editingShift.id), shiftData);
        setSuccess('Shift updated successfully');
      } else {
        // Create new shift in tenant/job_order subcollection
        await addDoc(collection(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts'), shiftData);
        setSuccess('Shift created successfully');
      }

      handleCloseDialog();
      fetchShifts();
      
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error saving shift:', err);
      setError('Failed to save shift');
    }
  };

  const handleDelete = async (shiftId: string) => {
    if (!window.confirm('Are you sure you want to delete this shift?')) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts', shiftId));
      setSuccess('Shift deleted successfully');
      fetchShifts();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error deleting shift:', err);
      setError('Failed to delete shift');
    }
  };

  const formatTime = (time: string) => {
    if (!time) return '';
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const handleOpenDuplicateModal = (shift: Shift) => {
    setShiftToDuplicate(shift);
    setSelectedDates([]);
    setCalendarMonth(new Date());
    setDuplicateModalOpen(true);
    setError('');
  };

  const handleCloseDuplicateModal = () => {
    setDuplicateModalOpen(false);
    setShiftToDuplicate(null);
    setSelectedDates([]);
    setError('');
  };

  const handleDateClick = (date: Date) => {
    setSelectedDates(prev => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const existingIndex = prev.findIndex(d => format(d, 'yyyy-MM-dd') === dateStr);
      if (existingIndex >= 0) {
        // Remove if already selected
        return prev.filter((_, index) => index !== existingIndex);
      } else {
        // Add if not selected
        return [...prev, date];
      }
    });
  };

  const handleDuplicateShifts = async () => {
    if (!shiftToDuplicate || selectedDates.length === 0) {
      setError('Please select at least one date');
      return;
    }

    try {
      const shiftsRef = collection(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts');
      
      // Create a shift for each selected date
      const promises = selectedDates.map(date => {
        const shiftDate = format(date, 'yyyy-MM-dd');
        const shiftData = {
          ...shiftToDuplicate,
          shiftDate,
          createdAt: serverTimestamp(),
          createdBy: user?.uid || 'unknown',
          updatedAt: serverTimestamp(),
        };
        // Remove the id field so a new document is created
        const { id, ...dataWithoutId } = shiftData;
        return addDoc(shiftsRef, dataWithoutId);
      });

      await Promise.all(promises);
      setSuccess(`Successfully duplicated shift to ${selectedDates.length} date${selectedDates.length > 1 ? 's' : ''}`);
      handleCloseDuplicateModal();
      fetchShifts();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error duplicating shifts:', err);
      setError('Failed to duplicate shifts');
    }
  };

  // Get calendar days for the current month
  const getCalendarDays = () => {
    const monthStart = startOfMonth(calendarMonth);
    const monthEnd = endOfMonth(calendarMonth);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h6" fontWeight={700}>
            Shift Setup
          </Typography>
          {jobOrder?.jobType === 'gig' && (
            <Typography variant="caption" color="text.secondary">
              Shifts are automatically shown on the jobs board for the next 30 days
            </Typography>
          )}
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
        >
          Add Shift
        </Button>
      </Stack>

      {/* Success/Error Messages */}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}
      {error && !dialogOpen && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {/* Shifts Table */}
      {shifts.length === 0 ? (
        <Alert severity="info">
          No shifts created yet. Click "Add Shift" to create your first shift.
        </Alert>
      ) : (
        <TableContainer component={Paper} sx={{ boxShadow: 1 }}>
          <Table>
            <TableHead sx={{ bgcolor: 'grey.50' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Shift Title</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Time</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Job Title</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Staff Needed</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>PO Number</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shifts.map((shift) => (
                <TableRow
                  key={shift.id}
                  hover
                  sx={{ cursor: 'pointer', '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}
                  onClick={() => handleOpenDialog(shift)}
                >
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {shift.shiftTitle}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <CalendarIcon fontSize="small" color="action" />
                      <Typography variant="body2">
                        {(() => {
                          try {
                            // Parse date string in local time to avoid timezone issues
                            const dateStr = shift.shiftDate;
                            if (dateStr && dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                              const [year, month, day] = dateStr.split('-').map(Number);
                              const date = new Date(year, month - 1, day); // month is 0-indexed
                              return format(date, 'MMM dd, yyyy');
                            }
                            return format(new Date(shift.shiftDate), 'MMM dd, yyyy');
                          } catch {
                            return shift.shiftDate || 'N/A';
                          }
                        })()}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TimeIcon fontSize="small" color="action" />
                      <Typography variant="body2">
                        {formatTime(shift.defaultStartTime)} - {formatTime(shift.defaultEndTime)}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {shift.defaultJobTitle || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <GroupIcon fontSize="small" color="action" />
                      <Typography variant="body2">
                        {shift.totalStaffRequested}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {shift.poNumber || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenDialog(shift);
                      }}
                      title="Edit"
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenDuplicateModal(shift);
                      }}
                      title="Duplicate"
                    >
                      <DuplicateIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(shift.id);
                      }}
                      title="Delete"
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Add/Edit Shift Dialog */}
      <Dialog 
        open={dialogOpen} 
        onClose={handleCloseDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {editingShift ? 'Edit Shift' : `Create New Shift - Type: ${jobOrder?.jobType || 'Gig'}`}
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
            {/* Shift Title */}
            <TextField
              fullWidth
              label="Shift Title"
              placeholder="(ex: Night Shift Janitor)"
              value={formData.shiftTitle}
              onChange={(e) => setFormData({ ...formData, shiftTitle: e.target.value })}
              required
            />

            {/* Default Job for Shift - Autocomplete (limited to positions from Overview tab) */}
            <Autocomplete
              fullWidth
              options={availablePositions}
              getOptionLabel={(option) => {
                if (typeof option === 'string') return option;
                return option.jobTitle || '';
              }}
              value={availablePositions.find(p => p.jobTitle === formData.defaultJobTitle) || null}
              onChange={(event, newValue) => {
                setFormData({ ...formData, defaultJobTitle: newValue ? newValue.jobTitle : '' });
              }}
              renderOption={(props, option) => (
                <Box component="li" {...props} key={option.jobTitle}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <Typography>{option.jobTitle}</Typography>
                    {option.payRate && (
                      <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
                        ${option.payRate}/hr
                      </Typography>
                    )}
                  </Box>
                </Box>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Set Default Job for Shift"
                  helperText={availablePositions.length > 0 
                    ? `Select from ${availablePositions.length} position${availablePositions.length > 1 ? 's' : ''} defined in Overview tab`
                    : 'No positions defined in Overview tab. Please add positions first.'}
                />
              )}
              disabled={availablePositions.length === 0}
            />

            {/* Total Staff Requested with Toggle */}
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Total Staff Requested"
                  type="number"
                  value={formData.totalStaffRequested}
                  onChange={(e) => setFormData({ ...formData, totalStaffRequested: parseInt(e.target.value) || 1 })}
                  inputProps={{ min: 1 }}
                  required
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={formData.showStaffNeeded}
                      onChange={(e) => setFormData({ ...formData, showStaffNeeded: e.target.checked })}
                    />
                  }
                  label="Show Staff Needed on Jobs Board"
                  sx={{ mt: 1.5 }}
                />
              </Grid>
            </Grid>

            {/* PO Number */}
            <TextField
              fullWidth
              label="PO Number"
              value={formData.poNumber}
              onChange={(e) => setFormData({ ...formData, poNumber: e.target.value })}
            />

            {/* Select Day */}
            <TextField
              fullWidth
              label="Select day"
              type="date"
              value={formData.shiftDate}
              onChange={(e) => setFormData({ ...formData, shiftDate: e.target.value })}
              InputLabelProps={{ shrink: true }}
              required
            />

            {/* Time Fields */}
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                fullWidth
                label="Default Start Time"
                type="time"
                value={formData.defaultStartTime}
                onChange={(e) => setFormData({ ...formData, defaultStartTime: e.target.value })}
                InputLabelProps={{ shrink: true }}
                required
              />
              <TextField
                fullWidth
                label="Default End Time"
                type="time"
                value={formData.defaultEndTime}
                onChange={(e) => setFormData({ ...formData, defaultEndTime: e.target.value })}
                InputLabelProps={{ shrink: true }}
                required
              />
            </Box>

            {/* Shift Description */}
            <TextField
              fullWidth
              label="Shift-Specific Details or Job Description"
              multiline
              rows={4}
              value={formData.shiftDescription}
              onChange={(e) => setFormData({ ...formData, shiftDescription: e.target.value })}
            />

            {/* Email Intro */}
            <TextField
              fullWidth
              label="Shift Info to Email Staff"
              multiline
              rows={4}
              value={formData.emailIntro}
              onChange={(e) => setFormData({ ...formData, emailIntro: e.target.value })}
            />

            {/* TODO: File attachments will be added in next phase */}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleCloseDialog}>
            Cancel
          </Button>
          <Button 
            variant="contained" 
            onClick={handleSubmit}
            disabled={!formData.shiftTitle || !formData.shiftDate || !formData.defaultStartTime || !formData.defaultEndTime}
          >
            {editingShift ? 'Update Shift' : 'Add Shift'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Duplicate Shift Modal */}
      <Dialog
        open={duplicateModalOpen}
        onClose={handleCloseDuplicateModal}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Duplicate Shift: {shiftToDuplicate?.shiftTitle}
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select the dates you want to copy this shift to:
          </Typography>

          {/* Calendar Navigation */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <IconButton
              size="small"
              onClick={() => setCalendarMonth(subMonths(calendarMonth, 1))}
            >
              <ChevronLeftIcon />
            </IconButton>
            <Typography variant="h6" fontWeight={600}>
              {format(calendarMonth, 'MMMM yyyy')}
            </Typography>
            <IconButton
              size="small"
              onClick={() => setCalendarMonth(addMonths(calendarMonth, 1))}
            >
              <ChevronRightIcon />
            </IconButton>
          </Box>

          {/* Calendar Grid */}
          <Box>
            {/* Day headers */}
            <Grid container spacing={0.5} sx={{ mb: 0.5 }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <Grid item xs={12 / 7} key={day}>
                  <Typography
                    variant="caption"
                    fontWeight={600}
                    color="text.secondary"
                    align="center"
                    sx={{ display: 'block', py: 0.5 }}
                  >
                    {day}
                  </Typography>
                </Grid>
              ))}
            </Grid>

            {/* Calendar days */}
            <Grid container spacing={0.5}>
              {getCalendarDays().map((date) => {
                const isCurrentMonth = isSameMonth(date, calendarMonth);
                const isSelected = selectedDates.some(d => format(d, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd'));
                const isTodayDate = isToday(date);
                
                return (
                  <Grid item xs={12 / 7} key={date.toISOString()}>
                    <Box
                      onClick={() => handleDateClick(date)}
                      sx={{
                        aspectRatio: '1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        borderRadius: 1,
                        bgcolor: isSelected
                          ? 'primary.main'
                          : isTodayDate
                          ? 'action.selected'
                          : 'transparent',
                        color: isSelected
                          ? 'primary.contrastText'
                          : isCurrentMonth
                          ? 'text.primary'
                          : 'text.disabled',
                        '&:hover': {
                          bgcolor: isSelected ? 'primary.dark' : 'action.hover',
                        },
                        border: isTodayDate && !isSelected ? '1px solid' : 'none',
                        borderColor: 'primary.main',
                      }}
                    >
                      <Typography
                        variant="body2"
                        fontWeight={isSelected || isTodayDate ? 600 : 400}
                      >
                        {format(date, 'd')}
                      </Typography>
                    </Box>
                  </Grid>
                );
              })}
            </Grid>

            {/* Selected dates summary */}
            {selectedDates.length > 0 && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                  Selected Dates ({selectedDates.length}):
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {selectedDates
                    .sort((a, b) => a.getTime() - b.getTime())
                    .map((date) => (
                      <Chip
                        key={format(date, 'yyyy-MM-dd')}
                        label={format(date, 'MMM dd, yyyy')}
                        size="small"
                        onDelete={() => handleDateClick(date)}
                      />
                    ))}
                </Box>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleCloseDuplicateModal}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleDuplicateShifts}
            disabled={selectedDates.length === 0}
          >
            Duplicate to {selectedDates.length} Date{selectedDates.length !== 1 ? 's' : ''}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ShiftSetupTab;

