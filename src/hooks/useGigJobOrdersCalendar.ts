/**
 * Hook to fetch Gig job order shifts and convert them to calendar events
 */

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { CalendarEvent } from '../types/calendar';
import { format, parseISO, isValid, parse } from 'date-fns';

interface UseGigJobOrdersCalendarOptions {
  tenantId: string;
  timeMin: Date;
  timeMax: Date;
  enabled?: boolean;
}

interface UseGigJobOrdersCalendarReturn {
  events: CalendarEvent[];
  loading: boolean;
  error: Error | null;
}

const GIG_JOB_ORDERS_CALENDAR_ID = 'gig-job-orders';

// Color palette for gig job orders (one color per job order)
const GIG_COLORS = [
  '#FF9800', // Orange
  '#F44336', // Red
  '#9C27B0', // Purple
  '#3F51B5', // Indigo
  '#009688', // Teal
  '#4CAF50', // Green
  '#FF5722', // Deep Orange
  '#E91E63', // Pink
  '#00BCD4', // Cyan
  '#8BC34A', // Light Green
];

/**
 * Generate a consistent color for a job order ID
 */
function getColorForJobOrder(jobOrderId: string): string {
  // Simple hash function to get consistent color per job order
  let hash = 0;
  for (let i = 0; i < jobOrderId.length; i++) {
    hash = jobOrderId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % GIG_COLORS.length;
  return GIG_COLORS[index];
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
}: UseGigJobOrdersCalendarOptions): UseGigJobOrdersCalendarReturn {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled || !tenantId) {
      setEvents([]);
      setLoading(false);
      return;
    }

    // Check if we should disable this feature due to previous Firestore errors
    // This prevents cascading failures
    const errorKey = `firestore_error_${tenantId}`;
    const hasRecentError = sessionStorage.getItem(errorKey);
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
        // Step 1: Get all Gig job orders
        const jobOrdersRef = collection(db, 'tenants', tenantId, 'job_orders');
        const gigQuery = query(
          jobOrdersRef,
          where('jobType', '==', 'gig')
        );

        let jobOrdersSnapshot;
        try {
          jobOrdersSnapshot = await getDocs(gigQuery);
        } catch (err: any) {
          // Catch Firestore internal errors at the top level
          if (err?.message?.includes('INTERNAL ASSERTION') || 
              err?.message?.includes('Unexpected state')) {
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

        const jobOrders = jobOrdersSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as any[];

        // Step 2: For each job order, fetch its shifts
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

          // Parse shift date to check if it's in range
          if (!shift.shiftDate) continue;

          let shiftDate: Date;
          try {
            // Parse YYYY-MM-DD format
            const [year, month, day] = shift.shiftDate.split('-').map(Number);
            shiftDate = new Date(year, month - 1, day);
          } catch (e) {
            console.warn('Invalid shift date format:', shift.shiftDate);
            continue;
          }

          if (!isValid(shiftDate)) continue;

          // Check if shift overlaps with the date range
          // We need to check the full datetime range, not just the date
          const shiftStartTime = shift.defaultStartTime || '00:00';
          const shiftEndTime = shift.defaultEndTime || '23:59';
          
          const [startHour, startMin] = shiftStartTime.split(':').map(Number);
          const [endHour, endMin] = shiftEndTime.split(':').map(Number);
          
          const shiftStartDateTime = new Date(shiftDate);
          shiftStartDateTime.setHours(startHour, startMin, 0, 0);
          
          let shiftEndDateTime = new Date(shiftDate);
          shiftEndDateTime.setHours(endHour, endMin, 0, 0);
          
          // If end time is before start time, assume next day
          if (shiftEndDateTime < shiftStartDateTime) {
            shiftEndDateTime = new Date(shiftEndDateTime);
            shiftEndDateTime.setDate(shiftEndDateTime.getDate() + 1);
          }

          // Check if shift overlaps with the requested time range
          const overlaps = shiftStartDateTime <= timeMax && shiftEndDateTime >= timeMin;

          if (overlaps) {
            const event = shiftToCalendarEvent(shift, jobOrder, jobOrderColor);
            if (event) {
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
  }, [tenantId, timeMin, timeMax, enabled]);

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
