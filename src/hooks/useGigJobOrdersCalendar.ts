/**
 * Hook to fetch Gig job order shifts and convert them to calendar events
 */

import { useState, useEffect, useMemo } from 'react';
import { collection, documentId, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { CalendarEvent } from '../types/calendar';
import { eachDayOfInterval, format, isValid, parse, parseISO } from 'date-fns';
import { formatWeeklyScheduleSummary } from '../utils/weeklySchedule';
import { getDateScheduleEntriesWithHours, formatDateScheduleEntry } from '../utils/dateSchedule';

function parseLocalYyyyMmDd(dateStr: string): Date | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatLocalYyyyMmDd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftToRangeBarEvent(shift: any, jobOrder: any, jobOrderColor: string): CalendarEvent | null {
  const start = (shift?.shiftDate || '').toString();
  const end = (shift?.endDate || '').toString();
  if (!start || !end || end === start) return null;
  const startD = parseLocalYyyyMmDd(start);
  const endD = parseLocalYyyyMmDd(end);
  if (!startD || !endD || !isValid(startD) || !isValid(endD)) return null;

  // Google all-day end dates are exclusive: add 1 day for the end.date
  const endExclusive = new Date(endD);
  endExclusive.setDate(endExclusive.getDate() + 1);

  const title = jobOrder?.jobOrderName || jobOrder?.jobTitle || shift.shiftTitle || 'Gig Shift';
  const scheduleSummary = (shift as any).dateSchedule
    ? getDateScheduleEntriesWithHours((shift as any).dateSchedule, start, end).map((e) => formatDateScheduleEntry(e.date, e.startTime, e.endTime)).join('; ')
    : formatWeeklyScheduleSummary(shift.weeklySchedule);
  const description = scheduleSummary ? `Schedule: ${scheduleSummary}` : undefined;

  return {
    id: `gig-shift-range-${jobOrder?.id || 'unknown'}-${shift.id}`,
    calendarId: GIG_JOB_ORDERS_CALENDAR_ID,
    status: 'confirmed',
    summary: title,
    description,
    start: { date: start, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    end: { date: formatLocalYyyyMmDd(endExclusive), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    isAllDay: true,
    isRecurringInstance: false,
    createdAt: shift.createdAt instanceof Timestamp
      ? shift.createdAt.toDate().toISOString()
      : shift.createdAt instanceof Date
        ? shift.createdAt.toISOString()
        : new Date().toISOString(),
    updatedAt: shift.updatedAt instanceof Timestamp
      ? shift.updatedAt.toDate().toISOString()
      : shift.updatedAt instanceof Date
        ? shift.updatedAt.toISOString()
        : new Date().toISOString(),
    colorId: jobOrder?.id || shift.jobOrderId || undefined,
    hrx: {
      gigShiftId: shift.id,
      gigShiftRange: true,
    },
  };
}

interface UseGigJobOrdersCalendarOptions {
  tenantId: string;
  timeMin: Date;
  timeMax: Date;
  enabled?: boolean;
  /** When set, only fetch shifts for these job order IDs (e.g. account + child account job orders). Omit to fetch all gig job orders. */
  jobOrderIds?: string[];
}

interface UseGigJobOrdersCalendarReturn {
  events: CalendarEvent[];
  loading: boolean;
  error: Error | null;
}

const GIG_JOB_ORDERS_CALENDAR_ID = 'gig-job-orders';

function hslToHex(h: number, s: number, l: number): string {
  // h: 0-360, s/l: 0-100
  const _h = ((h % 360) + 360) % 360;
  const _s = Math.max(0, Math.min(100, s)) / 100;
  const _l = Math.max(0, Math.min(100, l)) / 100;

  const c = (1 - Math.abs(2 * _l - 1)) * _s;
  const x = c * (1 - Math.abs(((_h / 60) % 2) - 1));
  const m = _l - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (_h < 60) [r, g, b] = [c, x, 0];
  else if (_h < 120) [r, g, b] = [x, c, 0];
  else if (_h < 180) [r, g, b] = [0, c, x];
  else if (_h < 240) [r, g, b] = [0, x, c];
  else if (_h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Generate a consistent color for a job order ID
 */
function getColorForJobOrder(jobOrderId: string): string {
  // Deterministic "random" color per job order (stable for the same ID).
  // We intentionally keep the lightness low so white text remains readable.
  let hash = 0;
  for (let i = 0; i < jobOrderId.length; i++) {
    hash = jobOrderId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const seed = Math.abs(hash);

  const hue = seed % 360; // 0..359
  const sat = 70 + (seed % 16); // 70..85
  const light = 28 + ((seed >> 4) % 10); // 28..37 (dark)

  return hslToHex(hue, sat, light);
}

/**
 * Convert a shift to a calendar event
 */
function shiftToCalendarEvent(shift: any, jobOrder: any, jobOrderColor: string): CalendarEvent | null {
  if (!shift.shiftDate || !shift.defaultStartTime || !shift.defaultEndTime) {
    return null;
  }

  // Parse shift date (YYYY-MM-DD format)
  const shiftDate = shift.shiftDate;
  
  // Parse start and end times (HH:mm format)
  const startTime = shift.defaultStartTime;
  const endTime = shift.defaultEndTime;

  // Combine date and time to create full datetime
  const startDateTimeStr = `${shiftDate}T${startTime}:00`;
  const endDateTimeStr = `${shiftDate}T${endTime}:00`;

  let startDateTime: Date;
  let endDateTime: Date;

  try {
    // Try parsing as ISO string first
    startDateTime = parseISO(startDateTimeStr);
    endDateTime = parseISO(endDateTimeStr);

    // If parsing failed, try manual parsing
    if (!isValid(startDateTime) || !isValid(endDateTime)) {
      const [startHour, startMin] = startTime.split(':').map(Number);
      const [endHour, endMin] = endTime.split(':').map(Number);
      const [year, month, day] = shiftDate.split('-').map(Number);
      
      startDateTime = new Date(year, month - 1, day, startHour, startMin);
      endDateTime = new Date(year, month - 1, day, endHour, endMin);
    }

    // If end time is before start time, assume it's the next day
    if (endDateTime < startDateTime) {
      endDateTime = new Date(endDateTime);
      endDateTime.setDate(endDateTime.getDate() + 1);
    }
  } catch (e) {
    console.error('Error parsing shift date/time:', e, shift);
    return null;
  }

  if (!isValid(startDateTime) || !isValid(endDateTime)) {
    return null;
  }

  // Create event title - use job order name for gigs (e.g., "Crystal Falls Cooks")
  const title = jobOrder?.jobOrderName || jobOrder?.jobTitle || shift.shiftTitle || `Shift - ${shiftDate}`;
  
  // Create description
  const descriptionParts: string[] = [];
  if (jobOrder?.companyName) descriptionParts.push(`Company: ${jobOrder.companyName}`);
  if (jobOrder?.worksiteName) descriptionParts.push(`Location: ${jobOrder.worksiteName}`);
  if (shift.shiftDescription) descriptionParts.push(`\n${shift.shiftDescription}`);
  if (shift.totalStaffRequested) descriptionParts.push(`\nStaff Needed: ${shift.totalStaffRequested}`);
  if (jobOrder?.payRate) descriptionParts.push(`Pay Rate: $${jobOrder.payRate}/hr`);
  if (shift.poNumber) descriptionParts.push(`PO: ${shift.poNumber}`);

  const description = descriptionParts.join('\n');

  // Create location string
  const locationParts: string[] = [];
  if (jobOrder?.worksiteName) locationParts.push(jobOrder.worksiteName);
  if (jobOrder?.worksiteAddress) {
    const addr = jobOrder.worksiteAddress;
    if (addr.street) locationParts.push(addr.street);
    if (addr.city && addr.state) {
      locationParts.push(`${addr.city}, ${addr.state}`);
    }
  }
  const location = locationParts.join(', ') || undefined;

  // Create timed event (not all-day)
  // Store jobOrderId in the event ID for easy extraction: gig-shift-{jobOrderId}-{shiftId}
  const event: CalendarEvent = {
    id: `gig-shift-${jobOrder?.id || 'unknown'}-${shift.id}`,
    calendarId: GIG_JOB_ORDERS_CALENDAR_ID,
    status: 'confirmed',
    summary: title,
    description: description || undefined,
    location: location,
    start: {
      dateTime: startDateTime.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    end: {
      dateTime: endDateTime.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    isAllDay: false,
    isRecurringInstance: false,
    createdAt: shift.createdAt instanceof Timestamp 
      ? shift.createdAt.toDate().toISOString()
      : shift.createdAt instanceof Date
      ? shift.createdAt.toISOString()
      : new Date().toISOString(),
    updatedAt: shift.updatedAt instanceof Timestamp
      ? shift.updatedAt.toDate().toISOString()
      : shift.updatedAt instanceof Date
      ? shift.updatedAt.toISOString()
      : new Date().toISOString(),
    // Store job order ID in colorId for color lookup (reusing existing optional field)
    colorId: jobOrder?.id || '',
  };

  return event;
}

/**
 * Hook to fetch Gig job order shifts as calendar events
 */
export function useGigJobOrdersCalendar({
  tenantId,
  timeMin,
  timeMax,
  enabled = true,
  jobOrderIds,
}: UseGigJobOrdersCalendarOptions): UseGigJobOrdersCalendarReturn {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Important: if caller passes an explicit empty list, treat it as "show none",
  // not "show all". This prevents cross-account event leakage.
  const filterByAccount = Array.isArray(jobOrderIds);

  useEffect(() => {
    if (!enabled || !tenantId) {
      setEvents([]);
      setLoading(false);
      return;
    }
    if (filterByAccount && (!jobOrderIds || jobOrderIds.length === 0)) {
      setEvents([]);
      setLoading(false);
      return;
    }

    const errorKey = `firestore_error_${tenantId}`;
    const hasRecentError = !filterByAccount && sessionStorage.getItem(errorKey);
    if (hasRecentError) {
      console.warn('Gig Job Orders calendar disabled due to previous Firestore errors');
      setEvents([]);
      setLoading(false);
      setError(new Error('Calendar temporarily disabled due to Firestore errors'));
      return;
    }

    let cancelled = false;

    async function fetchShifts() {
      setLoading(true);
      setError(null);

      try {
        const jobOrdersRef = collection(db, 'tenants', tenantId, 'job_orders');
        let jobOrders: any[];

        if (filterByAccount && jobOrderIds!.length > 0) {
          jobOrders = [];
          for (let i = 0; i < jobOrderIds!.length; i += 30) {
            if (cancelled) return;
            const batch = jobOrderIds!.slice(i, i + 30);
            const q = query(jobOrdersRef, where(documentId(), 'in', batch));
            const snap = await getDocs(q);
            snap.docs.forEach((d) => jobOrders.push({ id: d.id, ...d.data() }));
          }
        } else {
          const gigQuery = query(jobOrdersRef, where('jobType', '==', 'gig'));
          let jobOrdersSnapshot;
          try {
            jobOrdersSnapshot = await getDocs(gigQuery);
          } catch (err: any) {
            if (err?.message?.includes('INTERNAL ASSERTION') || err?.message?.includes('Unexpected state')) {
              console.warn('Firestore internal error when fetching job orders, returning empty events');
              if (!cancelled) {
                setEvents([]);
                setLoading(false);
              }
              return;
            }
            throw err;
          }
          if (cancelled) return;
          jobOrders = jobOrdersSnapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
        }

        // For each job order, fetch its shifts
        // Use fully sequential processing (one at a time) to avoid Firestore internal assertion errors
        // This is slower but much more reliable
        const allShifts: Array<{ shift: any; jobOrder: any }> = [];
        let queryAborted = false;
        
        // Process job orders sequentially to avoid overwhelming Firestore
        for (const jobOrder of jobOrders) {
          if (cancelled || queryAborted) break;
          
          try {
            // Validate jobOrder.id exists and is a valid string
            if (!jobOrder.id || typeof jobOrder.id !== 'string') {
              continue;
            }
            
            const shiftsRef = collection(db, 'tenants', tenantId, 'job_orders', jobOrder.id, 'shifts');
            
            // Use a timeout and wrap in try-catch to handle Firestore internal errors
            let shiftsSnapshot;
            try {
              shiftsSnapshot = await Promise.race([
                getDocs(shiftsRef),
                new Promise((_, reject) => 
                  setTimeout(() => reject(new Error('Query timeout')), 3000)
                )
              ]) as any;
            } catch (queryError: any) {
              // Catch Firestore internal assertion errors specifically
              if (queryError?.message?.includes('INTERNAL ASSERTION') || 
                  queryError?.message?.includes('Unexpected state') ||
                  queryError?.message?.includes('FIRESTORE')) {
                console.warn(`Firestore internal error detected, aborting shift queries`);
                queryAborted = true;
                // Return what we have so far rather than failing completely
                break;
              }
              // For other errors, just skip this job order
              if (queryError?.code === 'permission-denied' || 
                  queryError?.code === 'not-found' || 
                  queryError?.message === 'Query timeout') {
                continue;
              }
              // Re-throw unexpected errors
              throw queryError;
            }
            
            // Only process if we got a valid snapshot
            if (shiftsSnapshot && shiftsSnapshot.docs) {
              shiftsSnapshot.docs.forEach((shiftDoc: any) => {
                allShifts.push({
                  shift: { id: shiftDoc.id, ...shiftDoc.data() },
                  jobOrder,
                });
              });
            }
            
            // Small delay between queries to prevent overwhelming Firestore
            await new Promise(resolve => setTimeout(resolve, 50));
          } catch (err: any) {
            // Catch any other errors and skip this job order
            if (err?.message?.includes('INTERNAL ASSERTION') || 
                err?.message?.includes('Unexpected state') ||
                err?.message?.includes('FIRESTORE')) {
              console.warn(`Firestore internal error detected, aborting shift queries`);
              queryAborted = true;
              break;
            }
            console.warn(`Error fetching shifts for job order ${jobOrder.id}:`, err);
            // Continue with next job order
            continue;
          }
        }

        if (cancelled) return;

        // Step 3: Convert shifts to calendar events and filter by date range
        const calendarEvents: CalendarEvent[] = [];
        const jobOrderColors = new Map<string, string>();
        
        for (const { shift, jobOrder } of allShifts) {
          // Get or assign color for this job order
          if (!jobOrderColors.has(jobOrder.id)) {
            jobOrderColors.set(jobOrder.id, getColorForJobOrder(jobOrder.id));
          }
          const jobOrderColor = jobOrderColors.get(jobOrder.id)!;

          if (!shift.shiftDate) continue;

          const isMulti =
            (shift as any)?.shiftMode === 'multi' &&
            !!(shift as any)?.endDate &&
            (shift as any).endDate !== shift.shiftDate;

          // For month view spanning bars, emit a single all-day "range" event
          // and hide the per-day occurrences in month view (handled in CalendarPage).
          if (isMulti) {
            const rangeEvent = shiftToRangeBarEvent(shift, jobOrder, jobOrderColor);
            if (rangeEvent) calendarEvents.push(rangeEvent);
          }

          const occurrences: Array<{ dateStr: string; startTime: string; endTime: string }> = [];

          if (isMulti) {
            const startD = parseLocalYyyyMmDd(shift.shiftDate);
            const endD = parseLocalYyyyMmDd((shift as any).endDate);
            if (!startD || !endD || !isValid(startD) || !isValid(endD)) continue;

            const dateSched = (shift as any).dateSchedule;
            if (dateSched && typeof dateSched === 'object') {
              const entries = getDateScheduleEntriesWithHours(dateSched, shift.shiftDate, (shift as any).endDate);
              for (const e of entries) {
                occurrences.push({ dateStr: e.date, startTime: e.startTime, endTime: e.endTime });
              }
            } else {
              for (const day of eachDayOfInterval({ start: startD, end: endD })) {
                const dateStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
                const dowKey = String(day.getDay()); // 0=Sun..6=Sat
                const sched = (shift as any).weeklySchedule?.[dowKey];
                if (sched && sched.enabled === false) continue;

                occurrences.push({
                  dateStr,
                  startTime: (sched?.startTime || shift.defaultStartTime || '00:00') as string,
                  endTime: (sched?.endTime || shift.defaultEndTime || '23:59') as string,
                });
              }
            }
          } else {
            occurrences.push({
              dateStr: shift.shiftDate,
              startTime: shift.defaultStartTime || '00:00',
              endTime: shift.defaultEndTime || '23:59',
            });
          }

          for (const occ of occurrences) {
            const occDate = parseLocalYyyyMmDd(occ.dateStr);
            if (!occDate || !isValid(occDate)) continue;

            const [startHour, startMin] = occ.startTime.split(':').map(Number);
            const [endHour, endMin] = occ.endTime.split(':').map(Number);

            const shiftStartDateTime = new Date(occDate);
            shiftStartDateTime.setHours(startHour, startMin, 0, 0);

            let shiftEndDateTime = new Date(occDate);
            shiftEndDateTime.setHours(endHour, endMin, 0, 0);

            // If end time is before start time, assume next day
            if (shiftEndDateTime < shiftStartDateTime) {
              shiftEndDateTime = new Date(shiftEndDateTime);
              shiftEndDateTime.setDate(shiftEndDateTime.getDate() + 1);
            }

            const overlaps = shiftStartDateTime <= timeMax && shiftEndDateTime >= timeMin;
            if (!overlaps) continue;

            // Ensure unique IDs per day for a single multi-day shift
            const syntheticShift = {
              ...shift,
              id: `${shift.id}_${occ.dateStr}`,
              shiftDate: occ.dateStr,
              defaultStartTime: occ.startTime,
              defaultEndTime: occ.endTime,
            };
            const event = shiftToCalendarEvent(syntheticShift, jobOrder, jobOrderColor);
            if (event) {
              event.hrx = {
                gigShiftId: shift.id,
                gigShiftRange: false,
              };
              calendarEvents.push(event);
            }
          }
        }

        if (!cancelled) {
          setEvents(calendarEvents);
          // If we aborted due to Firestore errors, set a warning but don't fail completely
          if (queryAborted) {
            console.warn('Some shifts may not be displayed due to Firestore internal errors');
          }
        }
      } catch (err: any) {
        // Catch Firestore internal errors at the top level
        if (err?.message?.includes('INTERNAL ASSERTION') || 
            err?.message?.includes('Unexpected state') ||
            err?.message?.includes('FIRESTORE')) {
          console.warn('Firestore internal error when fetching shifts, disabling feature for this session');
          // Mark this tenant as having Firestore errors to prevent further attempts
          sessionStorage.setItem(errorKey, 'true');
          if (!cancelled) {
            setEvents([]);
            setError(new Error('Firestore internal error - feature disabled for this session. Please refresh the page.'));
          }
        } else {
          console.error('Error fetching Gig job order shifts for calendar:', err);
          if (!cancelled) {
            setError(err instanceof Error ? err : new Error('Failed to fetch Gig job order shifts'));
            setEvents([]);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchShifts();

    return () => {
      cancelled = true;
    };
  }, [tenantId, timeMin, timeMax, enabled, jobOrderIds]);

  return {
    events,
    loading,
    error,
  };
}

/**
 * Get the calendar summary for Gig Job Orders
 */
export function getGigJobOrdersCalendarSummary() {
  return {
    id: GIG_JOB_ORDERS_CALENDAR_ID,
    summary: 'Gig Calendar',
    description: 'All Gig job order shifts from your tenant',
    accessRole: 'reader' as const,
    backgroundColor: '#FF9800', // Default orange color
    foregroundColor: '#FFFFFF',
  };
}

/**
 * Get the color for a specific job order's shifts
 * This should match the color used in the calendar events
 */
export function getColorForJobOrderId(jobOrderId: string): string {
  return getColorForJobOrder(jobOrderId);
}
