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
  IconButton,
  Chip,
  Stack,
  Alert,
  CircularProgress,
  Grid,
  TextField,
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
  Check as CheckIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { JobsBoardService } from '../../services/recruiter/jobsBoardService';
import { useAuth } from '../../contexts/AuthContext';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, addMonths, subMonths, startOfWeek, endOfWeek, isToday } from 'date-fns';
import EditShiftForm from '../shifts/EditShiftForm';
export type ShiftStatus = 'open' | 'closed' | 'filled' | 'cancelled' | 'pending_indeed_approval';

export interface Shift {
  id: string;
  tenantId: string;
  jobOrderId: string;
  shiftTitle: string;
  status?: ShiftStatus; // open | closed | filled | cancelled; default open. Only Open show on Jobs Board.
  defaultJobTitle?: string;
  totalStaffRequested: number;
  overstaffCount?: number; // Optional padding used for auto-filled logic (assignments target = totalStaffRequested + overstaffCount)
  showStaffNeeded?: boolean; // Show staff count on jobs board
  poNumber?: string;
  shiftDate: string; // ISO date string (single-day date, or start date for multi-day)
  shiftMode?: 'single' | 'multi';
  endDate?: string; // ISO date string (only for multi-day)
  /**
   * Weekly schedule for multi-day shifts (Career recurring).
   * Keys are JS day-of-week numbers as strings: 0=Sun ... 6=Sat.
   * `workersNeeded` and `overstaff` are optional per-day staffing overrides;
   * fall back to shift-level `totalStaffRequested` / `overstaffCount` when unset.
   */
  weeklySchedule?: Record<
    string,
    { enabled: boolean; startTime: string; endTime: string; workersNeeded?: number; overstaff?: number }
  >;
  /**
   * Per-date schedule for GIG multi-day shifts. Keys are YYYY-MM-DD.
   * When present, worker views show only these dates (with hours).
   */
  dateSchedule?: Record<string, { startTime: string; endTime: string; workersNeeded?: number; overstaff?: number }>;
  defaultStartTime: string; // HH:mm format
  defaultEndTime: string; // HH:mm format
  shiftDescription?: string;
  emailIntro?: string;
  /** Optional URL for workers to clock in (shown on assignment + messages). */
  clockInUrl?: string;
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

function parseLocalYyyyMmDd(dateStr: string): Date | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* -------------------------------------------------------------------------
 * InlineTimeRangeCell — click-to-edit start/end time for the Shifts table.
 *
 * Edits `defaultStartTime` / `defaultEndTime` (HH:mm) directly on the shift
 * doc so a recruiter can tweak a shift's hours without opening the full
 * EditShiftForm dialog.
 *
 * **Single-day only.** Multi-day shifts (shiftMode === 'multi') carry their
 * real hours in `weeklySchedule` / `dateSchedule` (per-day maps); a single
 * start/end pair can't represent those, so we render them read-only and let
 * the row-click open the full dialog, which knows how to edit per-day
 * schedules. Editing the `default*` fields on a multi-day shift would
 * silently diverge from what candidates actually see on the jobs board.
 *
 * Save semantics: writes both fields + `updatedAt`, then re-syncs the linked
 * jobs-board postings (same call the dialog + delete paths make) so the
 * public listing reflects the new hours. Optimistic — the parent merges the
 * patch into local state so the cell updates without a full refetch.
 * ------------------------------------------------------------------------- */
const InlineTimeRangeCell: React.FC<{
  shift: Shift;
  tenantId: string;
  jobOrderId: string;
  formatTime: (t: string) => string;
  onSaved: (shiftId: string, patch: Partial<Shift>) => void;
}> = ({ shift, tenantId, jobOrderId, formatTime, onSaved }) => {
  const isMulti = shift.shiftMode === 'multi';
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(shift.defaultStartTime || '');
  const [end, setEnd] = useState(shift.defaultEndTime || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Multi-day → read-only display (see component doc-comment).
  if (isMulti) {
    return (
      <Stack direction="row" spacing={0.5} alignItems="center">
        <TimeIcon fontSize="small" color="action" />
        <Typography variant="body2">
          {shift.defaultStartTime
            ? `${formatTime(shift.defaultStartTime)} - ${formatTime(shift.defaultEndTime)}`
            : '—'}
        </Typography>
      </Stack>
    );
  }

  const beginEdit = (e: React.MouseEvent) => {
    e.stopPropagation(); // don't open the row's edit dialog
    setStart(shift.defaultStartTime || '');
    setEnd(shift.defaultEndTime || '');
    setErr(null);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!start || !end) {
      setErr('Both start and end times are required.');
      return;
    }
    // No-op if unchanged. (We allow end <= start — shifts legitimately
    // cross midnight, e.g. 18:00 → 02:00.)
    if (start === (shift.defaultStartTime || '') && end === (shift.defaultEndTime || '')) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await updateDoc(
        doc(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts', shift.id),
        { defaultStartTime: start, defaultEndTime: end, updatedAt: serverTimestamp() },
      );
      onSaved(shift.id, { defaultStartTime: start, defaultEndTime: end });
      // Keep the public jobs-board listing in sync — same call the
      // dialog-save and delete paths make.
      JobsBoardService.getInstance()
        .syncJobOrderToLinkedPostings(tenantId, jobOrderId)
        .catch(() => {});
      setEditing(false);
    } catch (e) {
      console.error('Error updating shift time:', e);
      setErr('Save failed — try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <Stack
        direction="row"
        spacing={0.5}
        alignItems="center"
        onClick={beginEdit}
        title="Click to edit shift time"
        sx={{
          cursor: 'text',
          borderRadius: 1,
          px: 0.5,
          mx: -0.5,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <TimeIcon fontSize="small" color="action" />
        <Typography variant="body2">
          {shift.defaultStartTime
            ? `${formatTime(shift.defaultStartTime)} - ${formatTime(shift.defaultEndTime)}`
            : 'Set time'}
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="center"
      onClick={(e) => e.stopPropagation()}
    >
      <TextField
        type="time"
        size="small"
        value={start}
        autoFocus
        disabled={saving}
        onChange={(e) => setStart(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleSave();
          if (e.key === 'Escape') setEditing(false);
        }}
        inputProps={{ 'aria-label': 'Shift start time', step: 300 }}
        sx={{ width: 120 }}
      />
      <Typography component="span" variant="body2" color="text.secondary">
        –
      </Typography>
      <TextField
        type="time"
        size="small"
        value={end}
        disabled={saving}
        onChange={(e) => setEnd(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleSave();
          if (e.key === 'Escape') setEditing(false);
        }}
        inputProps={{ 'aria-label': 'Shift end time', step: 300 }}
        sx={{ width: 120 }}
      />
      <IconButton size="small" color="primary" onClick={() => void handleSave()} disabled={saving} title="Save">
        {saving ? <CircularProgress size={16} /> : <CheckIcon fontSize="small" />}
      </IconButton>
      <IconButton size="small" onClick={() => setEditing(false)} disabled={saving} title="Cancel">
        <CloseIcon fontSize="small" />
      </IconButton>
      {err && (
        <Typography variant="caption" color="error" sx={{ ml: 0.5 }}>
          {err}
        </Typography>
      )}
    </Stack>
  );
};

interface ShiftSetupTabProps {
  tenantId: string;
  jobOrderId: string;
  jobOrder: any;
}

const ShiftSetupTab: React.FC<ShiftSetupTabProps> = ({ tenantId, jobOrderId, jobOrder }) => {
  const { user } = useAuth();
  const isGigJob = jobOrder?.jobType === 'gig';
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [shiftToDuplicate, setShiftToDuplicate] = useState<Shift | null>(null);
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [calendarMonth, setCalendarMonth] = useState(new Date());

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
      shiftsData.sort((a, b) => {
        const aDate = (a.shiftDate || a.endDate || '').toString();
        const bDate = (b.shiftDate || b.endDate || '').toString();
        return new Date(aDate).getTime() - new Date(bDate).getTime();
      });
      
      setShifts(shiftsData);
    } catch (err) {
      console.error('Error fetching shifts:', err);
      setError('Failed to load shifts');
    } finally {
      setLoading(false);
    }
  };

  // Open the dialog for create (no shift) or edit (with shift). All
  // form state lives inside <EditShiftForm/> now — we only track which
  // shift is being edited so we can pass it through.
  const handleOpenDialog = (shift?: Shift) => {
    setEditingShift(shift ?? null);
    setError('');
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingShift(null);
    setError('');
  };

  // Optimistic local patch after an inline cell save — avoids a full
  // refetch so the edited cell updates instantly.
  const mergeShiftUpdate = (shiftId: string, patch: Partial<Shift>) => {
    setShifts((prev) => prev.map((s) => (s.id === shiftId ? { ...s, ...patch } : s)));
  };

  // EditShiftForm bubbles success here; we surface the message and
  // refresh the shifts list.
  const handleShiftSaved = (message: string) => {
    setSuccess(message);
    handleCloseDialog();
    fetchShifts();
    setTimeout(() => setSuccess(''), 3000);
  };

  const handleDelete = async (shiftId: string) => {
    if (!window.confirm('Are you sure you want to delete this shift?')) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts', shiftId));
      setSuccess('Shift deleted successfully');
      fetchShifts();
      JobsBoardService.getInstance().syncJobOrderToLinkedPostings(tenantId, jobOrderId).catch(() => {});
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
      if (shiftToDuplicate.shiftMode === 'multi') {
        setError('Multi-day shifts can’t be duplicated by date yet. Create a new multi-day shift instead.');
        return;
      }
      const shiftsRef = collection(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts');
      
      // Create a shift for each selected date
      const promises = selectedDates.map(date => {
        const shiftDate = format(date, 'yyyy-MM-dd');
        const shiftData = {
          ...shiftToDuplicate,
          shiftDate,
          status: 'open' as const,
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
            <Typography variant="caption" color="text.secondary" display="block">
              Shifts are shown on the jobs board. When you add, edit, or remove shifts (or change the job order end date), the jobs board listing updates so candidates see current dates and shifts.
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
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
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
                            const startStr = shift.shiftDate;
                            const endStr =
                              shift.shiftMode === 'multi' && shift.endDate && shift.endDate !== shift.shiftDate
                                ? shift.endDate
                                : null;

                            const startLocal = parseLocalYyyyMmDd(startStr) || new Date(startStr);
                            const endLocal = endStr ? (parseLocalYyyyMmDd(endStr) || new Date(endStr)) : null;

                            if (endLocal) {
                              return `${format(startLocal, 'MMM dd, yyyy')} – ${format(endLocal, 'MMM dd, yyyy')}`;
                            }
                            if (shift.shiftMode === 'multi' && !shift.endDate) {
                              return `Starts ${format(startLocal, 'MMM dd, yyyy')}`;
                            }
                            return format(startLocal, 'MMM dd, yyyy');
                          } catch {
                            return shift.shiftDate || 'N/A';
                          }
                        })()}
                      </Typography>
                      {shift.shiftMode === 'multi' && shift.endDate && shift.endDate !== shift.shiftDate && (
                        <Chip size="small" label="Multi-day" sx={{ ml: 0.5 }} />
                      )}
                      {shift.shiftMode === 'multi' && !shift.endDate && (
                        <Chip size="small" label="Schedule" sx={{ ml: 0.5 }} />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <InlineTimeRangeCell
                      shift={shift}
                      tenantId={tenantId}
                      jobOrderId={jobOrderId}
                      formatTime={formatTime}
                      onSaved={mergeShiftUpdate}
                    />
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
                    {/* Status chip — mirrors the Status dropdown options on
                        the edit dialog (Open / Filled / Closed / Cancelled).
                        Missing / unknown values render as "Open" since that's
                        the default state on shift creation. */}
                    {(() => {
                      const raw = String((shift as any).status || 'open').toLowerCase();
                      const label =
                        raw === 'filled'
                          ? 'Filled'
                          : raw === 'closed'
                            ? 'Closed'
                            : raw === 'cancelled' || raw === 'canceled'
                              ? 'Cancelled'
                              : 'Open';
                      const color: 'success' | 'info' | 'default' | 'error' =
                        label === 'Open'
                          ? 'success'
                          : label === 'Filled'
                            ? 'info'
                            : label === 'Cancelled'
                              ? 'error'
                              : 'default';
                      return (
                        <Chip
                          label={label}
                          size="small"
                          color={color}
                          variant={color === 'default' ? 'outlined' : 'filled'}
                          sx={{ fontWeight: 500 }}
                        />
                      );
                    })()}
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
          {editingShift
            ? 'Edit Shift'
            : `Create New Shift - Type: ${jobOrder?.jobType || 'Gig'}`}
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <EditShiftForm
            tenantId={tenantId}
            jobOrderId={jobOrderId}
            jobOrder={jobOrder}
            shift={editingShift as any}
            onSaved={handleShiftSaved}
            onCancel={handleCloseDialog}
          />
        </DialogContent>
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

