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
  Switch,
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
  Clear as ClearIcon,
} from '@mui/icons-material';
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { JobsBoardService } from '../../services/recruiter/jobsBoardService';
import { getDateRange, formatDayAndDate, dateHasHours } from '../../utils/dateSchedule';
import { formatHourlyPayRateForDisplay } from '../../utils/hourlyPayDisplay';
import { useAuth } from '../../contexts/AuthContext';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, addMonths, subMonths, startOfWeek, endOfWeek, isToday } from 'date-fns';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import {
  buildScheduleNotifyText,
  computeShiftNotifyDiff,
  shouldPromptShiftWorkerNotify,
  type ShiftNotifyDiff,
} from '../../utils/shiftWorkerNotifyDiff';
export type ShiftStatus = 'open' | 'closed' | 'filled' | 'cancelled';

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
   * Keys are JS day-of-week numbers as strings: 0=Sun ... 6=Sat
   */
  weeklySchedule?: Record<string, { enabled: boolean; startTime: string; endTime: string }>;
  /**
   * Per-date schedule for GIG multi-day shifts. Keys are YYYY-MM-DD.
   * When present, worker views show only these dates (with hours).
   */
  dateSchedule?: Record<string, { startTime: string; endTime: string; workersNeeded?: number; overstaff?: number }>;
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

const DOWS: Array<{ dow: number; label: string; short: string }> = [
  { dow: 1, label: 'Monday', short: 'Mon' },
  { dow: 2, label: 'Tuesday', short: 'Tue' },
  { dow: 3, label: 'Wednesday', short: 'Wed' },
  { dow: 4, label: 'Thursday', short: 'Thu' },
  { dow: 5, label: 'Friday', short: 'Fri' },
  { dow: 6, label: 'Saturday', short: 'Sat' },
  { dow: 0, label: 'Sunday', short: 'Sun' },
];

function buildDefaultWeeklySchedule(start: string, end: string): Record<string, { enabled: boolean; startTime: string; endTime: string }> {
  const schedule: Record<string, { enabled: boolean; startTime: string; endTime: string }> = {};
  for (const { dow } of DOWS) {
    schedule[String(dow)] = { enabled: true, startTime: start, endTime: end };
  }
  return schedule;
}

function parseLocalYyyyMmDd(dateStr: string): Date | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return Number.isNaN(d.getTime()) ? null : d;
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
  const isGigJob = jobOrder?.jobType === 'gig';
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [formData, setFormData] = useState<{
    shiftTitle: string;
    status: ShiftStatus;
    defaultJobTitle: string;
    totalStaffRequested: number;
    overstaffCount: number;
    showStaffNeeded: boolean;
    poNumber: string;
    shiftMode: 'single' | 'multi';
    shiftDate: string;
    endDate: string;
    weeklySchedule: Record<string, { enabled: boolean; startTime: string; endTime: string }>;
    dateSchedule: Record<string, { startTime: string; endTime: string; workersNeeded?: number; overstaff?: number }>;
    defaultStartTime: string;
    defaultEndTime: string;
    shiftDescription: string;
    emailIntro: string;
    sendNotification: boolean;
  }>({
    shiftTitle: '',
    status: 'open',
    defaultJobTitle: '',
    totalStaffRequested: 1,
    overstaffCount: 0,
    showStaffNeeded: false,
    poNumber: '',
    shiftMode: 'single',
    shiftDate: '',
    endDate: '',
    weeklySchedule: buildDefaultWeeklySchedule('', ''),
    dateSchedule: {},
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
  const [workerNotifyDialogOpen, setWorkerNotifyDialogOpen] = useState(false);
  const [pendingWorkerSave, setPendingWorkerSave] = useState<{
    shiftData: any;
    plainNext: Record<string, unknown>;
    diff: ShiftNotifyDiff;
    shiftId: string;
  } | null>(null);
  const [workerNotifySaving, setWorkerNotifySaving] = useState(false);

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

  const handleOpenDialog = (shift?: Shift) => {
    if (shift) {
      setEditingShift(shift);
      const mode: 'single' | 'multi' = shift.shiftMode === 'multi' ? 'multi' : 'single';
      const weeklySchedule =
        mode === 'multi'
          ? (shift.weeklySchedule || buildDefaultWeeklySchedule(shift.defaultStartTime || '', shift.defaultEndTime || ''))
          : buildDefaultWeeklySchedule('', '');
      const endDateVal = mode === 'multi' ? (isGigJob ? (shift.endDate || shift.shiftDate) : '') : '';
      const dateSchedule: Record<string, { startTime: string; endTime: string; workersNeeded?: number; overstaff?: number }> = {};
      if (isGigJob && mode === 'multi' && shift.shiftDate && endDateVal) {
        if ((shift as any).dateSchedule && typeof (shift as any).dateSchedule === 'object') {
          const raw = (shift as any).dateSchedule;
          Object.keys(raw).forEach((iso) => {
            const e = raw[iso];
            dateSchedule[iso] = {
              startTime: e?.startTime ?? '',
              endTime: e?.endTime ?? '',
              workersNeeded: e?.workersNeeded != null ? Number(e.workersNeeded) : 1,
              overstaff: e?.overstaff != null ? Math.max(0, Number(e.overstaff)) : 0,
            };
          });
        } else {
          const range = getDateRange(shift.shiftDate, endDateVal);
          const defStart = shift.defaultStartTime || '';
          const defEnd = shift.defaultEndTime || '';
          range.forEach((iso) => {
            const d = new Date(iso + 'T12:00:00');
            const dow = d.getDay();
            const ws = shift.weeklySchedule?.[String(dow)];
            dateSchedule[iso] = {
              startTime: ws?.enabled ? (ws.startTime || defStart) : defStart,
              endTime: ws?.enabled ? (ws.endTime || defEnd) : defEnd,
              workersNeeded: 1,
              overstaff: 0,
            };
          });
        }
      }
      setFormData({
        shiftTitle: shift.shiftTitle,
        status: (shift.status || 'open') as ShiftStatus,
        defaultJobTitle: shift.defaultJobTitle || '',
        totalStaffRequested: shift.totalStaffRequested,
        overstaffCount: Math.max(0, Number((shift as any).overstaffCount ?? 0) || 0),
        showStaffNeeded: shift.showStaffNeeded || false,
        poNumber: shift.poNumber || '',
        shiftMode: mode,
        shiftDate: shift.shiftDate,
        endDate: endDateVal,
        weeklySchedule,
        dateSchedule,
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
        status: 'open',
        defaultJobTitle: defaultJobTitle,
        totalStaffRequested: 1,
        overstaffCount: 0,
        showStaffNeeded: jobOrder?.showWorkersNeeded === true,
        poNumber: '',
        shiftMode: 'single',
        shiftDate: '',
        endDate: '',
        weeklySchedule: buildDefaultWeeklySchedule('', ''),
        dateSchedule: {},
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
    setWorkerNotifyDialogOpen(false);
    setPendingWorkerSave(null);
  };

  const finalizeShiftSave = (message: string) => {
    setSuccess(message);
    handleCloseDialog();
    fetchShifts();
    JobsBoardService.getInstance().syncJobOrderToLinkedPostings(tenantId, jobOrderId).catch(() => {});
    setTimeout(() => setSuccess(''), 3000);
  };

  const persistNewShift = async (shiftData: any, isSchedule: boolean, isGigJob: boolean) => {
    const dataForAdd = { ...shiftData };
    if (!isSchedule) {
      delete dataForAdd.endDate;
      delete dataForAdd.weeklySchedule;
      delete dataForAdd.dateSchedule;
    } else if (!isGigJob) {
      delete dataForAdd.endDate;
    }
    await addDoc(collection(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts'), dataForAdd);
  };

  const handleWorkerNotifyChoice = async (sendNotify: boolean) => {
    const pending = pendingWorkerSave;
    if (!pending || workerNotifySaving) return;
    setWorkerNotifySaving(true);
    setWorkerNotifyDialogOpen(false);
    setPendingWorkerSave(null);
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts', pending.shiftId), pending.shiftData);
      let notifyFailed = false;
      if (sendNotify) {
        try {
          const jobTitle =
            formData.defaultJobTitle?.trim() ||
            jobOrder?.jobTitle?.trim() ||
            'your role';
          const scheduleSection = pending.diff.scheduleChanged
            ? buildScheduleNotifyText(
                {
                  shiftMode: pending.plainNext.shiftMode as 'single' | 'multi' | undefined,
                  shiftDate: pending.plainNext.shiftDate as string | undefined,
                  endDate: pending.plainNext.endDate as string | undefined,
                  defaultStartTime: pending.plainNext.defaultStartTime as string | undefined,
                  defaultEndTime: pending.plainNext.defaultEndTime as string | undefined,
                  dateSchedule: pending.plainNext.dateSchedule as
                    | Record<string, { startTime: string; endTime: string }>
                    | undefined,
                  weeklySchedule: pending.plainNext.weeklySchedule as
                    | Record<string, { enabled?: boolean; startTime: string; endTime: string }>
                    | undefined,
                },
                formatTime
              )
            : '';
          const instructionsSection = pending.diff.instructionsChanged
            ? [formData.shiftDescription?.trim(), formData.emailIntro?.trim()].filter(Boolean).join('\n\n')
            : '';
          const notifyFn = httpsCallable(functions, 'notifyShiftWorkersUpdated');
          await notifyFn({
            tenantId,
            jobOrderId,
            shiftId: pending.shiftId,
            jobTitle,
            scheduleSection,
            instructionsSection,
          });
        } catch (notifyErr) {
          console.error('notifyShiftWorkersUpdated failed:', notifyErr);
          notifyFailed = true;
        }
      }
      finalizeShiftSave('Shift updated successfully');
      if (notifyFailed) {
        setTimeout(() => setError('Shift saved, but worker notifications could not be sent.'), 0);
      }
    } catch (err) {
      console.error('Error saving shift:', err);
      setError('Failed to save shift');
    } finally {
      setWorkerNotifySaving(false);
    }
  };

  const handleSubmit = async () => {
    try {
      setError('');
      // Validation
      if (!formData.shiftTitle.trim()) {
        setError('Shift title is required');
        return;
      }
      if (!isGigJob && (!formData.defaultStartTime || !formData.defaultEndTime)) {
        setError('Start and end times are required');
        return;
      }
      if (!isGigJob && formData.totalStaffRequested < 1) {
        setError('Total staff requested must be at least 1');
        return;
      }

      // Normalize mode:
      // - Gig multi-day requires an end date and spans a date range.
      // - Career "multi-day" means an open-ended weekly schedule (no end date).
      const isSchedule = formData.shiftMode === 'multi' && (!isGigJob || (!!formData.endDate && formData.endDate !== formData.shiftDate));

      if (!formData.shiftDate) {
        setError(isSchedule ? 'Start date is required' : 'Shift date is required');
        return;
      }
      if (isGigJob && isSchedule && !formData.endDate) {
        setError('End date is required');
        return;
      }
      if (isGigJob && isSchedule && formData.endDate < formData.shiftDate) {
        setError('End date must be on or after start date');
        return;
      }

      // Validate schedule for multi-day shifts
      if (isSchedule) {
        if (isGigJob) {
          const range = getDateRange(formData.shiftDate, formData.endDate);
          const dateSchedule = formData.dateSchedule || {};
          const withHours = range.filter((iso) => dateHasHours(dateSchedule[iso]));
          if (withHours.length === 0) {
            setError('Enter start and end times for at least one date in the range');
            return;
          }
          for (const iso of withHours) {
            const d = dateSchedule[iso];
            if (!d?.startTime?.trim() || !d?.endTime?.trim()) {
              setError(`Start and end times are required for ${formatDayAndDate(iso)}`);
              return;
            }
          }
        } else {
          const schedule = formData.weeklySchedule || {};
          const enabledDays = Object.values(schedule).filter((d) => d?.enabled);
          if (enabledDays.length === 0) {
            setError('Select at least one day of the week for this multi-day shift');
            return;
          }
          for (const [k, d] of Object.entries(schedule)) {
            if (!d?.enabled) continue;
            if (!d.startTime || !d.endTime) {
              setError(`Start and end times are required for ${DOWS.find((x) => String(x.dow) === k)?.label || 'a selected day'}`);
              return;
            }
          }
        }
      }

      const baseShiftData: any = {
        shiftTitle: formData.shiftTitle,
        status: formData.status,
        defaultJobTitle: formData.defaultJobTitle,
        totalStaffRequested: formData.totalStaffRequested,
        overstaffCount: Math.max(0, Number(formData.overstaffCount || 0)),
        showStaffNeeded: formData.showStaffNeeded,
        poNumber: formData.poNumber,
        shiftDate: formData.shiftDate, // single-day date OR start date for multi
        defaultStartTime: formData.defaultStartTime,
        defaultEndTime: formData.defaultEndTime,
        shiftDescription: formData.shiftDescription,
        emailIntro: formData.emailIntro,
        sendNotification: formData.sendNotification,
        tenantId,
        jobOrderId,
        updatedAt: serverTimestamp(),
        ...(editingShift
          ? {}
          : {
              createdAt: serverTimestamp(),
              createdBy: user?.uid || 'unknown',
            }),
      };

      const shiftData: any = {
        ...baseShiftData,
        shiftMode: isSchedule ? 'multi' : 'single',
      };

      let mergedGigDateSchedule: Record<
        string,
        { startTime: string; endTime: string; workersNeeded?: number; overstaff?: number }
      > | undefined;

      if (isSchedule) {
        if (isGigJob) {
          shiftData.endDate = formData.endDate;
          const range = getDateRange(formData.shiftDate, formData.endDate);
          mergedGigDateSchedule = {};
          range.forEach((iso) => {
            const existing = formData.dateSchedule?.[iso];
            mergedGigDateSchedule![iso] = {
              startTime: existing?.startTime ?? formData.defaultStartTime,
              endTime: existing?.endTime ?? formData.defaultEndTime,
              workersNeeded: existing?.workersNeeded != null ? Math.max(1, Number(existing.workersNeeded)) : 1,
              overstaff: existing?.overstaff != null ? Math.max(0, Number(existing.overstaff)) : 0,
            };
          });
          shiftData.dateSchedule = mergedGigDateSchedule;
          // GIG: derive totalStaffRequested from sum of (workers + over) per day for backward compatibility
          const gigTotal = range.reduce((sum, iso) => {
            const e = mergedGigDateSchedule![iso];
            return sum + (e?.workersNeeded ?? 1) + (e?.overstaff ?? 0);
          }, 0);
          shiftData.totalStaffRequested = Math.max(1, gigTotal);
          shiftData.overstaffCount = 0; // GIG uses per-day over
        } else {
          // Open-ended schedule: no endDate. Only use deleteField for updateDoc (not allowed with addDoc).
          if (editingShift) shiftData.endDate = deleteField();
        }
        if (!isGigJob) {
          shiftData.weeklySchedule = formData.weeklySchedule || buildDefaultWeeklySchedule(formData.defaultStartTime, formData.defaultEndTime);
        } else {
          if (editingShift) shiftData.weeklySchedule = deleteField();
        }
      } else {
        // Single-day: no endDate, weeklySchedule, or dateSchedule.
        if (editingShift) {
          shiftData.endDate = deleteField();
          shiftData.weeklySchedule = deleteField();
          if (isGigJob) shiftData.dateSchedule = deleteField();
        }
      }

      const plainNext: Record<string, unknown> = {
        shiftDate: formData.shiftDate,
        shiftMode: isSchedule ? 'multi' : 'single',
        defaultStartTime: formData.defaultStartTime,
        defaultEndTime: formData.defaultEndTime,
        shiftDescription: formData.shiftDescription,
        emailIntro: formData.emailIntro,
      };
      if (isSchedule) {
        if (isGigJob) {
          plainNext.endDate = formData.endDate;
          plainNext.dateSchedule = mergedGigDateSchedule || {};
          plainNext.weeklySchedule = {};
        } else {
          plainNext.endDate = '';
          plainNext.weeklySchedule =
            formData.weeklySchedule || buildDefaultWeeklySchedule(formData.defaultStartTime, formData.defaultEndTime);
          plainNext.dateSchedule = {};
        }
      } else {
        plainNext.endDate = '';
        plainNext.weeklySchedule = {};
        plainNext.dateSchedule = {};
      }

      if (!editingShift) {
        await persistNewShift(shiftData, isSchedule, isGigJob);
        finalizeShiftSave('Shift created successfully');
        return;
      }

      const diff = computeShiftNotifyDiff(editingShift, plainNext);
      if (shouldPromptShiftWorkerNotify(diff)) {
        setPendingWorkerSave({
          shiftData,
          plainNext,
          diff,
          shiftId: editingShift.id,
        });
        setWorkerNotifyDialogOpen(true);
        return;
      }

      await updateDoc(doc(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts', editingShift.id), shiftData);
      finalizeShiftSave('Shift updated successfully');
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
            {/* Shift Title (left) + Status (right) */}
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Shift Title"
                  placeholder="(ex: Night Shift Janitor)"
                  value={formData.shiftTitle}
                  onChange={(e) => setFormData({ ...formData, shiftTitle: e.target.value })}
                  required
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Status</InputLabel>
                  <Select
                    label="Status"
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as ShiftStatus })}
                  >
                    <MenuItem value="open">Open</MenuItem>
                    <MenuItem value="closed">Closed</MenuItem>
                    <MenuItem value="filled">Filled</MenuItem>
                    <MenuItem value="cancelled">Cancelled</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

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
              renderOption={(props, option) => {
                const positionPayLabel = formatHourlyPayRateForDisplay(option.payRate);
                return (
                  <Box component="li" {...props} key={option.jobTitle}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <Typography>{option.jobTitle}</Typography>
                      {positionPayLabel && (
                        <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
                          {positionPayLabel}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                );
              }}
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

            {/* Total Staff Requested + Overstaff + Toggle — career only; GIG single-day uses the boxed row below times; GIG multi-day uses per-date rows */}
            {!isGigJob && (
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}>
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
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="Overstaff (extra)"
                    type="number"
                    value={formData.overstaffCount}
                    onChange={(e) => setFormData({ ...formData, overstaffCount: parseInt(e.target.value) || 0 })}
                    inputProps={{ min: 0 }}
                    helperText={`Filled target: ${Math.max(1, (formData.totalStaffRequested || 1) + (formData.overstaffCount || 0))} assignments`}
                  />
                </Grid>
                <Grid item xs={12} md={4}>
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
            )}
            {isGigJob && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.showStaffNeeded}
                    onChange={(e) => setFormData({ ...formData, showStaffNeeded: e.target.checked })}
                  />
                }
                label="Show Staff Needed on Jobs Board"
              />
            )}

            {/* PO Number */}
            <TextField
              fullWidth
              label="PO Number"
              value={formData.poNumber}
              onChange={(e) => setFormData({ ...formData, poNumber: e.target.value })}
            />

            {/* Single-day vs Multi-day */}
            <FormControlLabel
              control={
                <Switch
                  checked={formData.shiftMode === 'multi'}
                  onChange={(e) => {
                    const nextMode: 'single' | 'multi' = e.target.checked ? 'multi' : 'single';
                    const nextStart = formData.shiftDate;
                    const nextEnd =
                      nextMode === 'multi'
                        ? (isGigJob ? (formData.endDate || nextStart) : '')
                        : '';
                    const nextSchedule =
                      nextMode === 'multi'
                        ? (formData.weeklySchedule && Object.keys(formData.weeklySchedule).length > 0
                            ? formData.weeklySchedule
                            : buildDefaultWeeklySchedule(formData.defaultStartTime, formData.defaultEndTime))
                        : buildDefaultWeeklySchedule('', '');
                    setFormData({
                      ...formData,
                      shiftMode: nextMode,
                      endDate: nextEnd,
                      weeklySchedule: nextSchedule,
                    });
                  }}
                />
              }
              label={
                isGigJob
                  ? 'Multi-day shift (one assignment covering multiple days)'
                  : 'Weekly schedule (recurring)'
              }
            />

            {/* Dates */}
            {isGigJob ? (
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label={formData.shiftMode === 'multi' ? 'Start date' : 'Select day'}
                    type="date"
                    value={formData.shiftDate}
                    onChange={(e) => {
                      const nextStart = e.target.value;
                      let nextEnd = formData.endDate;
                      if (formData.shiftMode === 'multi') {
                        if (!nextEnd) nextEnd = nextStart;
                        if (nextEnd && nextStart && nextEnd < nextStart) nextEnd = nextStart;
                      } else {
                        nextEnd = '';
                      }
                      setFormData({ ...formData, shiftDate: nextStart, endDate: nextEnd });
                    }}
                    InputLabelProps={{ shrink: true }}
                    required
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  {formData.shiftMode === 'multi' ? (
                    <TextField
                      fullWidth
                      label="End date"
                      type="date"
                      value={formData.endDate}
                      onChange={(e) => {
                        const nextEnd = e.target.value;
                        const nextStart = formData.shiftDate;
                        setFormData({ ...formData, endDate: nextStart && nextEnd && nextEnd < nextStart ? nextStart : nextEnd });
                      }}
                      InputLabelProps={{ shrink: true }}
                      required
                    />
                  ) : (
                    <Box />
                  )}
                </Grid>
              </Grid>
            ) : (
              <TextField
                fullWidth
                label="Start date"
                type="date"
                value={formData.shiftDate}
                onChange={(e) => setFormData({ ...formData, shiftDate: e.target.value, endDate: '' })}
                InputLabelProps={{ shrink: true }}
                required
              />
            )}

            {/* Time Fields — hidden for GIG single-day once a date is set (times move into &quot;Shift hours for this day&quot; below). */}
            {!(isGigJob && formData.shiftMode === 'single' && formData.shiftDate) && (
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  fullWidth
                  label="Default Start Time"
                  type="time"
                  value={formData.defaultStartTime}
                  onChange={(e) => {
                    const next = e.target.value;
                    const nextSchedule =
                      formData.shiftMode === 'multi'
                        ? (() => {
                            const prev = formData.weeklySchedule || {};
                            const out: typeof prev = { ...prev };
                            for (const k of Object.keys(out)) {
                              if (!out[k]) continue;
                              if (!out[k].startTime) out[k] = { ...out[k], startTime: next };
                            }
                            return out;
                          })()
                        : formData.weeklySchedule;
                    setFormData({ ...formData, defaultStartTime: next, weeklySchedule: nextSchedule });
                  }}
                  InputLabelProps={{ shrink: true }}
                  required={!isGigJob}
                />
                <TextField
                  fullWidth
                  label="Default End Time"
                  type="time"
                  value={formData.defaultEndTime}
                  onChange={(e) => {
                    const next = e.target.value;
                    const nextSchedule =
                      formData.shiftMode === 'multi'
                        ? (() => {
                            const prev = formData.weeklySchedule || {};
                            const out: typeof prev = { ...prev };
                            for (const k of Object.keys(out)) {
                              if (!out[k]) continue;
                              if (!out[k].endTime) out[k] = { ...out[k], endTime: next };
                            }
                            return out;
                          })()
                        : formData.weeklySchedule;
                    setFormData({ ...formData, defaultEndTime: next, weeklySchedule: nextSchedule });
                  }}
                  InputLabelProps={{ shrink: true }}
                  required={!isGigJob}
                />
              </Box>
            )}

            {/* GIG single-day: same grid as multi-day &quot;Shift hours by date&quot; — one row (Start, End, Over, Workers). */}
            {isGigJob && formData.shiftMode === 'single' && formData.shiftDate && (
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 2 }}>
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                  Shift hours for this day
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Set start and end times and workers needed for this date — same fields as when multi-day is on; only one day is listed.
                </Typography>
                <Grid container spacing={1} sx={{ alignItems: 'center' }}>
                  <Grid item xs={12} md={2}>
                    <Typography variant="body2" fontWeight={600}>
                      {formatDayAndDate(formData.shiftDate)}
                    </Typography>
                  </Grid>
                  <Grid item xs={3} md={2}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Start"
                      type="time"
                      value={formData.defaultStartTime || ''}
                      onChange={(e) => setFormData({ ...formData, defaultStartTime: e.target.value })}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                  <Grid item xs={3} md={2}>
                    <TextField
                      fullWidth
                      size="small"
                      label="End"
                      type="time"
                      value={formData.defaultEndTime || ''}
                      onChange={(e) => setFormData({ ...formData, defaultEndTime: e.target.value })}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                  <Grid item xs={3} md={1.5}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Over"
                      type="number"
                      inputProps={{ min: 0, max: 999 }}
                      value={formData.overstaffCount ?? 0}
                      onChange={(e) =>
                        setFormData({ ...formData, overstaffCount: Math.max(0, parseInt(e.target.value, 10) || 0) })
                      }
                    />
                  </Grid>
                  <Grid item xs={3} md={1.5}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Workers"
                      type="number"
                      inputProps={{ min: 1, max: 999 }}
                      value={formData.totalStaffRequested ?? 1}
                      onChange={(e) =>
                        setFormData({ ...formData, totalStaffRequested: Math.max(1, parseInt(e.target.value, 10) || 1) })
                      }
                    />
                  </Grid>
                  <Grid item xs={12} md={2}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<ClearIcon />}
                      onClick={() =>
                        setFormData({
                          ...formData,
                          defaultStartTime: '',
                          defaultEndTime: '',
                        })
                      }
                      title="Clear times for this day (date will not appear on job posting)"
                      aria-label="Clear times for this day"
                      sx={{ minWidth: 'fit-content' }}
                    >
                      Clear
                    </Button>
                  </Grid>
                </Grid>
              </Box>
            )}

            {/* GIG multi-day: per-date schedule (first day = start date, last = end date). */}
            {formData.shiftMode === 'multi' && isGigJob && formData.shiftDate && formData.endDate && formData.endDate >= formData.shiftDate && (
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 2 }}>
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                  Shift hours by date
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Set start and end times and workers needed for each date. Only dates with times set will appear on the job posting for workers.
                </Typography>
                <Grid container spacing={1} sx={{ alignItems: 'center' }}>
                  {getDateRange(formData.shiftDate, formData.endDate).map((iso) => {
                    const entry = formData.dateSchedule?.[iso] ?? { startTime: formData.defaultStartTime, endTime: formData.defaultEndTime, workersNeeded: 1, overstaff: 0 };
                    return (
                      <React.Fragment key={iso}>
                        <Grid item xs={12} md={2}>
                          <Typography variant="body2" fontWeight={600}>
                            {formatDayAndDate(iso)}
                          </Typography>
                        </Grid>
                        <Grid item xs={3} md={2}>
                          <TextField
                            fullWidth
                            size="small"
                            label="Start"
                            type="time"
                            value={entry.startTime || ''}
                            onChange={(e) => {
                              const next = { ...(formData.dateSchedule || {}), [iso]: { ...entry, startTime: e.target.value } };
                              setFormData({ ...formData, dateSchedule: next });
                            }}
                            InputLabelProps={{ shrink: true }}
                          />
                        </Grid>
                        <Grid item xs={3} md={2}>
                          <TextField
                            fullWidth
                            size="small"
                            label="End"
                            type="time"
                            value={entry.endTime || ''}
                            onChange={(e) => {
                              const next = { ...(formData.dateSchedule || {}), [iso]: { ...entry, endTime: e.target.value } };
                              setFormData({ ...formData, dateSchedule: next });
                            }}
                            InputLabelProps={{ shrink: true }}
                          />
                        </Grid>
                        <Grid item xs={3} md={1.5}>
                          <TextField
                            fullWidth
                            size="small"
                            label="Over"
                            type="number"
                            inputProps={{ min: 0, max: 999 }}
                            value={entry.overstaff ?? 0}
                            onChange={(e) => {
                              const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                              const next = { ...(formData.dateSchedule || {}), [iso]: { ...entry, overstaff: v } };
                              setFormData({ ...formData, dateSchedule: next });
                            }}
                          />
                        </Grid>
                        <Grid item xs={3} md={1.5}>
                          <TextField
                            fullWidth
                            size="small"
                            label="Workers"
                            type="number"
                            inputProps={{ min: 1, max: 999 }}
                            value={entry.workersNeeded ?? 1}
                            onChange={(e) => {
                              const v = Math.max(1, parseInt(e.target.value, 10) || 1);
                              const next = { ...(formData.dateSchedule || {}), [iso]: { ...entry, workersNeeded: v } };
                              setFormData({ ...formData, dateSchedule: next });
                            }}
                          />
                        </Grid>
                        <Grid item xs={12} md={2}>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<ClearIcon />}
                            onClick={() => {
                              const next = { ...(formData.dateSchedule || {}), [iso]: { startTime: '', endTime: '', workersNeeded: entry.workersNeeded ?? 1, overstaff: 0 } };
                              setFormData({ ...formData, dateSchedule: next });
                            }}
                            title="Clear times for this day (date will not appear on job posting)"
                            aria-label="Clear times for this day"
                            sx={{ minWidth: 'fit-content' }}
                          >
                            Clear
                          </Button>
                        </Grid>
                      </React.Fragment>
                    );
                  })}
                </Grid>
              </Box>
            )}

            {/* Career multi-day: weekly schedule (Mon–Sun). */}
            {formData.shiftMode === 'multi' && !isGigJob && (
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 2 }}>
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                  Weekly schedule (recurring)
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Choose which days are worked and set start/end times per day (e.g., Wed 10–6).
                </Typography>

                <Grid container spacing={1} sx={{ alignItems: 'center' }}>
                  {DOWS.map(({ dow, short }) => {
                    const key = String(dow);
                    const day = formData.weeklySchedule?.[key] || { enabled: false, startTime: formData.defaultStartTime, endTime: formData.defaultEndTime };
                    return (
                      <React.Fragment key={key}>
                        <Grid item xs={12} md={3}>
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={!!day.enabled}
                                onChange={(e) => {
                                  const enabled = e.target.checked;
                                  const nextSchedule = {
                                    ...(formData.weeklySchedule || {}),
                                    [key]: {
                                      enabled,
                                      startTime: day.startTime || formData.defaultStartTime,
                                      endTime: day.endTime || formData.defaultEndTime,
                                    },
                                  };
                                  setFormData({ ...formData, weeklySchedule: nextSchedule });
                                }}
                              />
                            }
                            label={`${short}`}
                          />
                        </Grid>
                        <Grid item xs={6} md={4.5}>
                          <TextField
                            fullWidth
                            size="small"
                            label="Start"
                            type="time"
                            value={day.startTime || ''}
                            onChange={(e) => {
                              const nextSchedule = {
                                ...(formData.weeklySchedule || {}),
                                [key]: { ...day, startTime: e.target.value },
                              };
                              setFormData({ ...formData, weeklySchedule: nextSchedule });
                            }}
                            InputLabelProps={{ shrink: true }}
                            disabled={!day.enabled}
                          />
                        </Grid>
                        <Grid item xs={6} md={4.5}>
                          <TextField
                            fullWidth
                            size="small"
                            label="End"
                            type="time"
                            value={day.endTime || ''}
                            onChange={(e) => {
                              const nextSchedule = {
                                ...(formData.weeklySchedule || {}),
                                [key]: { ...day, endTime: e.target.value },
                              };
                              setFormData({ ...formData, weeklySchedule: nextSchedule });
                            }}
                            InputLabelProps={{ shrink: true }}
                            disabled={!day.enabled}
                          />
                        </Grid>
                      </React.Fragment>
                    );
                  })}
                </Grid>
              </Box>
            )}

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
            disabled={
              workerNotifySaving ||
              !formData.shiftTitle ||
              !formData.shiftDate ||
              (!isGigJob && (!formData.defaultStartTime || !formData.defaultEndTime)) ||
              (isGigJob && formData.shiftMode === 'multi' && (!formData.endDate || formData.endDate < formData.shiftDate))
            }
          >
            {editingShift ? 'Update Shift' : 'Add Shift'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={workerNotifyDialogOpen}
        onClose={() => {
          if (workerNotifySaving) return;
          setWorkerNotifyDialogOpen(false);
          setPendingWorkerSave(null);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Notify assigned workers?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            The schedule or instructions for this shift changed. Send an update by SMS, email, and push to workers assigned to this shift?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => handleWorkerNotifyChoice(false)} disabled={workerNotifySaving}>
            No, don&apos;t notify
          </Button>
          <Button variant="contained" onClick={() => handleWorkerNotifyChoice(true)} disabled={workerNotifySaving}>
            Yes, notify workers
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

