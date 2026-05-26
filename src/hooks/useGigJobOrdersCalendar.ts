/**
 * Hook to fetch Gig job order shifts and convert them to calendar events
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, documentId, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { CalendarEvent } from '../types/calendar';
import { eachDayOfInterval, endOfDay, isSameDay, isValid, parseISO, startOfDay } from 'date-fns';
import { formatWeeklyScheduleSummary } from '../utils/weeklySchedule';
import { formatHourlyPayRateForDisplay } from '../utils/hourlyPayDisplay';
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

/** Parse gig estimated date from string or Firestore Timestamp */
function normalizeGigEstimatedDate(value: any): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    const d = value.toDate();
    return formatLocalYyyyMmDd(d);
  }
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  return null;
}

function formatGigJobOrderBarSummary(jobOrder: any): string {
  const name = jobOrder?.jobOrderName || jobOrder?.jobTitle || 'Gig job order';
  const ev = jobOrder?.gigEstimatedValue;
  const m = jobOrder?.gigAverageMarkup;
  const parts: string[] = [name];
  if (ev != null && Number.isFinite(Number(ev))) {
    parts.push(
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(ev))
    );
  }
  if (
    ev != null &&
    Number.isFinite(Number(ev)) &&
    m != null &&
    Number.isFinite(Number(m))
  ) {
    const denom = 1 + Number(m) / 100;
    if (denom > 0) {
      const gp = Number(ev) - Number(ev) / denom;
      if (Number.isFinite(gp)) {
        parts.push(
          new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(gp)
        );
      }
    }
  }
  return parts.join(' · ');
}

/**
 * All-day span for gig job order estimated start/end (event window on Gig Calendar).
 */
function jobOrderEstimatedRangeToEvent(jobOrder: any, timeMin: Date, timeMax: Date): CalendarEvent | null {
  const startStr = normalizeGigEstimatedDate(jobOrder?.gigEstimatedStartDate);
  const endStr = normalizeGigEstimatedDate(jobOrder?.gigEstimatedEndDate);
  if (!startStr || !endStr) return null;

  const startD = parseLocalYyyyMmDd(startStr);
  const endD = parseLocalYyyyMmDd(endStr);
  if (!startD || !endD || !isValid(startD) || !isValid(endD)) return null;
  if (endD < startD) return null;

  const rangeStart = startOfDay(startD);
  const rangeEnd = endOfDay(endD);
  if (rangeEnd < timeMin || rangeStart > timeMax) return null;

  const endExclusive = new Date(endD);
  endExclusive.setDate(endExclusive.getDate() + 1);

  const multiDay = !isSameDay(startD, endD);
  const summary = formatGigJobOrderBarSummary(jobOrder);

  const created =
    jobOrder?.createdAt instanceof Timestamp
      ? jobOrder.createdAt.toDate().toISOString()
      : jobOrder?.createdAt instanceof Date
        ? jobOrder.createdAt.toISOString()
        : new Date().toISOString();
  const updated =
    jobOrder?.updatedAt instanceof Timestamp
      ? jobOrder.updatedAt.toDate().toISOString()
      : jobOrder?.updatedAt instanceof Date
        ? jobOrder.updatedAt.toISOString()
        : created;

  return {
    id: `gig-job-order-estimated-${jobOrder.id}`,
    calendarId: GIG_JOB_ORDERS_CALENDAR_ID,
    status: 'confirmed',
    summary,
    description: multiDay ? 'Estimated event window (from job order)' : undefined,
    start: { date: startStr, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    end: { date: formatLocalYyyyMmDd(endExclusive), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    isAllDay: true,
    isRecurringInstance: false,
    createdAt: created,
    updatedAt: updated,
    colorId: jobOrder?.id || undefined,
    hrx: {
      gigJobOrderRange: multiDay,
      gigJobOrderId: jobOrder.id,
    },
  };
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

  const requestedStaff =
    typeof shift?.totalStaffRequested === 'number' ? shift.totalStaffRequested : undefined;

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
      worksiteName: jobOrder?.worksiteName || undefined,
      shiftStartTime: shift?.defaultStartTime || undefined,
      shiftEndTime: shift?.defaultEndTime || undefined,
      requestedStaff,
      // `assignedStaff` is back-filled by the hook after the batched assignment lookup.
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
  const payLine = formatHourlyPayRateForDisplay(jobOrder?.payRate);
  if (payLine) descriptionParts.push(`Pay Rate: ${payLine}`);
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
/* -------------------------------------------------------------------------
 * Stale-while-revalidate cache (sessionStorage)
 *
 * The gig-calendar query is expensive: for an entity-wide view it walks
 * every gig JO under the tenant (often 50–200 docs) and sequentially
 * loads each one's shifts sub-collection. Every cold mount of
 * `/calendar` paid the full bill, which is why navigating away and back
 * showed the empty grid with a "Upcoming" spinner for several seconds.
 *
 * Mirrors `useCalendarEvents`'s cache pattern (session-scoped so it
 * survives within-tab navigation, but a fresh tab gets fresh data):
 *   - Cache-first render → events appear instantly on revisit.
 *   - Background refresh after `BACKGROUND_REFRESH_MIN_AGE_MS` to pick
 *     up new shifts without a visible spinner.
 *   - Cache miss → normal fetch with the loading state.
 * ------------------------------------------------------------------------- */

type GigCalendarCacheEntryV1 = {
  v: 1;
  fetchedAt: number; // epoch ms
  events: CalendarEvent[];
};

const BACKGROUND_REFRESH_MIN_AGE_MS = 30_000;

function safeReadCache(key: string): GigCalendarCacheEntryV1 | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GigCalendarCacheEntryV1;
    if (
      !parsed ||
      parsed.v !== 1 ||
      !Array.isArray(parsed.events) ||
      typeof parsed.fetchedAt !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function safeWriteCache(key: string, entry: GigCalendarCacheEntryV1): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Quota / serialization / private-mode — silent. Cache is an
    // optimization, not a correctness requirement.
  }
}

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

  const cacheKey = useMemo(() => {
    if (!tenantId) return null;
    const tm = timeMin?.toISOString?.() ?? '';
    const tx = timeMax?.toISOString?.() ?? '';
    const ids = Array.isArray(jobOrderIds)
      ? [...jobOrderIds].filter(Boolean).sort().join(',')
      : '*';
    return `gigJobOrdersCalendar.v1:${tenantId}:${tm}:${tx}:${ids}`;
  }, [tenantId, timeMin, timeMax, jobOrderIds]);

  // Snapshot the cache-hit decision for the next effect run. Without
  // this, the effect can't distinguish "cache miss — show spinner"
  // from "cache hit — silent revalidation" since both branches share
  // the same fetch body.
  const seedFromCache = useCallback((): boolean => {
    if (!cacheKey) return false;
    const cached = safeReadCache(cacheKey);
    if (!cached) return false;
    setEvents(cached.events ?? []);
    setLoading(false);
    return true;
  }, [cacheKey]);

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

    // Cache-first render: paint from sessionStorage immediately, then
    // decide whether to revalidate. If the cache is younger than the
    // revalidation threshold, skip the network call entirely.
    const cached = cacheKey ? safeReadCache(cacheKey) : null;
    const cacheIsFresh = !!cached && Date.now() - cached.fetchedAt < BACKGROUND_REFRESH_MIN_AGE_MS;
    const seeded = seedFromCache();
    if (cacheIsFresh && seeded) {
      return; // Cache hit + fresh → no fetch needed this render.
    }

    let cancelled = false;

    async function fetchShifts() {
      // Silent revalidation when we have cached events on screen —
      // avoid flipping the grid back to the loading skeleton mid-view.
      if (!seeded) {
        setLoading(true);
      }
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

          const occurrences: Array<{
            dateStr: string;
            startTime: string;
            endTime: string;
            workersNeeded?: number;
          }> = [];

          if (isMulti) {
            const startD = parseLocalYyyyMmDd(shift.shiftDate);
            const endD = parseLocalYyyyMmDd((shift as any).endDate);
            if (!startD || !endD || !isValid(startD) || !isValid(endD)) continue;

            const dateSched = (shift as any).dateSchedule;
            if (dateSched && typeof dateSched === 'object') {
              const entries = getDateScheduleEntriesWithHours(dateSched, shift.shiftDate, (shift as any).endDate);
              for (const e of entries) {
                const wn = typeof (e as any).workersNeeded === 'number' ? Number((e as any).workersNeeded) : undefined;
                occurrences.push({
                  dateStr: e.date,
                  startTime: e.startTime,
                  endTime: e.endTime,
                  workersNeeded: wn,
                });
              }
            } else {
              for (const day of eachDayOfInterval({ start: startD, end: endD })) {
                const dateStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
                const dowKey = String(day.getDay()); // 0=Sun..6=Sat
                const sched = (shift as any).weeklySchedule?.[dowKey];
                if (sched && sched.enabled === false) continue;

                const wn =
                  sched && typeof sched.workersNeeded === 'number'
                    ? Number(sched.workersNeeded)
                    : undefined;
                occurrences.push({
                  dateStr,
                  startTime: (sched?.startTime || shift.defaultStartTime || '00:00') as string,
                  endTime: (sched?.endTime || shift.defaultEndTime || '23:59') as string,
                  workersNeeded: wn,
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
              // Per-day workersNeeded (from weeklySchedule[dow] or
              // dateSchedule[iso]) takes precedence over the shift-level
              // totalStaffRequested for calendar display.
              const requestedStaff =
                typeof occ.workersNeeded === 'number' && Number.isFinite(occ.workersNeeded)
                  ? occ.workersNeeded
                  : typeof shift?.totalStaffRequested === 'number'
                    ? shift.totalStaffRequested
                    : undefined;
              event.hrx = {
                gigShiftId: shift.id,
                gigShiftRange: false,
                worksiteName: jobOrder?.worksiteName || undefined,
                shiftStartTime: occ.startTime,
                shiftEndTime: occ.endTime,
                requestedStaff,
                // assignedStaff back-filled below from a single batched query.
              };
              calendarEvents.push(event);
            }
          }
        }

        // Gig job orders: estimated event window (Financials — start/end dates)
        for (const jobOrder of jobOrders) {
          if ((jobOrder as any).jobType !== 'gig') continue;
          const evt = jobOrderEstimatedRangeToEvent(jobOrder, timeMin, timeMax);
          if (evt) calendarEvents.push(evt);
        }

        // --------------------------------------------------------------------
        // Back-fill `hrx.assignedStaff` for each shift-derived event.
        //
        // jobs-board service currently hard-codes `staffFilled: 0` as a TODO.
        // For the Account Calendar tooltip we compute it on demand: one
        // `where('shiftId', 'in', [...])` query per 30 shifts against
        // `tenants/{tid}/assignments` (and the same against placements, to
        // match how PlacementsTab counts "workers on this shift"). We dedupe
        // by userId per shiftId so multi-day occurrences don't double-count.
        // Assignment cancellations are excluded.
        // --------------------------------------------------------------------
        const shiftIds = Array.from(
          new Set(
            allShifts
              .map(({ shift }) => (shift?.id ? String(shift.id) : null))
              .filter((id): id is string => Boolean(id)),
          ),
        );
        if (shiftIds.length > 0 && !cancelled && !queryAborted) {
          try {
            const uniqByShift = new Map<string, Set<string>>();
            const eatChunk = (docs: any[]) => {
              for (const d of docs) {
                const data = d.data ? d.data() : d;
                const sid = typeof data?.shiftId === 'string' ? data.shiftId : null;
                const uid = typeof data?.userId === 'string' ? data.userId : null;
                if (!sid || !uid) continue;
                // Skip cancelled assignments — they shouldn't count as filled.
                const status =
                  typeof data?.status === 'string' ? data.status.toLowerCase() : '';
                if (status === 'cancelled' || status === 'canceled') continue;
                if (!uniqByShift.has(sid)) uniqByShift.set(sid, new Set());
                uniqByShift.get(sid)!.add(uid);
              }
            };

            const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');
            const placementsRef = collection(db, 'tenants', tenantId, 'placements');
            for (let i = 0; i < shiftIds.length; i += 30) {
              if (cancelled) break;
              const batch = shiftIds.slice(i, i + 30);
              try {
                const [aSnap, pSnap] = await Promise.all([
                  getDocs(query(assignmentsRef, where('shiftId', 'in', batch))),
                  getDocs(query(placementsRef, where('shiftId', 'in', batch))),
                ]);
                eatChunk(aSnap.docs);
                eatChunk(pSnap.docs);
              } catch (batchErr) {
                // Non-fatal: tooltip falls back to "— assigned" for these shifts.
                console.warn('[Gig calendar] assigned-count batch failed', batchErr);
              }
            }

            for (const event of calendarEvents) {
              const sid = event.hrx?.gigShiftId;
              if (!sid || !event.hrx) continue;
              event.hrx.assignedStaff = uniqByShift.get(sid)?.size ?? 0;
            }
          } catch (err) {
            // Swallow — counts are a nice-to-have, not a blocker for rendering.
            console.warn('[Gig calendar] assigned-count enrichment failed', err);
          }
        }

        if (!cancelled) {
          setEvents(calendarEvents);
          if (cacheKey) {
            safeWriteCache(cacheKey, {
              v: 1,
              fetchedAt: Date.now(),
              events: calendarEvents,
            });
          }
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
    // `cacheKey` and `seedFromCache` are derived from these same
    // inputs (tenantId, timeMin, timeMax, jobOrderIds) so adding them
    // to the dep array doesn't introduce extra firings, but it satisfies
    // exhaustive-deps and keeps the effect honest if the cache shape
    // is refactored later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, timeMin, timeMax, enabled, jobOrderIds, cacheKey, seedFromCache]);

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
    description: 'Gig job order shifts and estimated event windows (from job order dates)',
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
