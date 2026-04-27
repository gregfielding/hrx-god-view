import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Gig Shift Application Limits Utility
 * 
 * Implements a one-shift-per-day policy where users can only have one active
 * application per calendar day. This prevents double-booking and ensures
 * users can't apply to multiple shifts on the same day simultaneously.
 * 
 * Strategy:
 * - Users can apply to multiple shifts on different days
 * - Users can only have ONE active application per day
 * - If a user gets hired for a shift, other applications for that day are auto-withdrawn
 * - If a user's application is rejected/withdrawn, they can apply to another shift that day
 */

export interface ShiftDateConflict {
  hasConflict: boolean;
  conflictingApplication?: {
    applicationId: string;
    shiftDate: string;
    shiftId?: string;
    status: string;
    jobTitle?: string;
  };
}

/**
 * Extract the date (YYYY-MM-DD) from a shift date string
 */
export function extractDateFromShiftDate(shiftDate: string): string {
  // Handle ISO date strings like "2025-10-28" or "2025-10-28T00:00:00Z"
  return shiftDate.split('T')[0];
}

/**
 * Check if a user has an active application for a shift on the same date
 * 
 * @param userId - The user's UID
 * @param tenantId - The tenant ID
 * @param shiftDate - The shift date (ISO string "YYYY-MM-DD")
 * @param excludeApplicationId - Optional application ID to exclude from check (for updates)
 * @returns Conflict information if found
 */
export async function checkShiftDateConflict(
  userId: string,
  tenantId: string,
  shiftDate: string,
  excludeApplicationId?: string
): Promise<ShiftDateConflict> {
  try {
    const dateStr = extractDateFromShiftDate(shiftDate);
    
    // Query applications for this user in this tenant
    const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
    const userApplicationsQuery = query(
      applicationsRef,
      where('userId', '==', userId)
    );
    
    const snapshot = await getDocs(userApplicationsQuery);
    
    // Active statuses that should block new applications
    const activeStatuses = ['submitted', 'screened', 'advanced', 'interview', 'offer_pending', 'hired'];
    
    for (const docSnap of snapshot.docs) {
      const appId = docSnap.id;
      
      // Skip if this is the application we're updating
      if (excludeApplicationId && appId === excludeApplicationId) {
        continue;
      }
      
      const appData = docSnap.data();
      
      // Only check active applications
      if (!activeStatuses.includes(appData.status)) {
        continue;
      }
      
      // Check if this application is for a gig shift (has shiftId or shiftIds)
      if (appData.shiftId || (appData.shiftIds && appData.shiftIds.length > 0)) {
        // Get the shift date(s) for this application
        const shiftDates = await getShiftDatesForApplication(
          tenantId,
          appData.jobOrderId,
          appData.shiftId || appData.shiftIds[0]
        );
        
        // Check if any shift date matches
        for (const existingShiftDate of shiftDates) {
          const existingDateStr = extractDateFromShiftDate(existingShiftDate);
          
          if (existingDateStr === dateStr) {
            return {
              hasConflict: true,
              conflictingApplication: {
                applicationId: appId,
                shiftDate: existingShiftDate,
                shiftId: appData.shiftId || appData.shiftIds?.[0],
                status: appData.status,
                jobTitle: appData.jobTitle || appData.postTitle || 'Unknown Job'
              }
            };
          }
        }
      }
    }
    
    return { hasConflict: false };
  } catch (error) {
    console.error('Error checking shift date conflict:', error);
    // On error, allow the application (fail open) but log the error
    return { hasConflict: false };
  }
}

/**
 * Get shift date(s) for an application
 * 
 * @param tenantId - The tenant ID
 * @param jobOrderId - The job order ID
 * @param shiftId - The shift ID (or first shift ID if multiple)
 * @returns Array of shift dates
 */
async function getShiftDatesForApplication(
  tenantId: string,
  jobOrderId: string | null | undefined,
  shiftId: string | null | undefined
): Promise<string[]> {
  if (!jobOrderId || !shiftId) {
    return [];
  }
  
  try {
    // Try to get shift date from shift document
    const shiftRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts', shiftId);
    const shiftSnap = await getDoc(shiftRef);
    
    if (shiftSnap.exists()) {
      const shiftData = shiftSnap.data();
      if (shiftData.shiftDate) {
        return [shiftData.shiftDate];
      }
    }
    
    // If shift document doesn't exist or doesn't have shiftDate, return empty
    return [];
  } catch (error) {
    console.error('Error getting shift date:', error);
    return [];
  }
}

/**
 * Check conflicts for multiple shifts (for applications with multiple shifts)
 * 
 * @param userId - The user's UID
 * @param tenantId - The tenant ID
 * @param shiftIds - Array of shift IDs to check
 * @param jobOrderId - The job order ID
 * @param excludeApplicationId - Optional application ID to exclude from check
 * @returns Conflict information if found
 */
export async function checkMultipleShiftDateConflicts(
  userId: string,
  tenantId: string,
  shiftIds: string[],
  jobOrderId: string,
  excludeApplicationId?: string
): Promise<ShiftDateConflict> {
  // Get shift dates for all shifts
  const shiftDates: string[] = [];
  
  for (const shiftId of shiftIds) {
    try {
      const shiftRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts', shiftId);
      const shiftSnap = await getDoc(shiftRef);
      
      if (shiftSnap.exists()) {
        const shiftData = shiftSnap.data();
        if (shiftData.shiftDate) {
          shiftDates.push(shiftData.shiftDate);
        }
      }
    } catch (error) {
      console.error(`Error getting shift date for ${shiftId}:`, error);
    }
  }
  
  // Check each shift date for conflicts
  for (const shiftDate of shiftDates) {
    const conflict = await checkShiftDateConflict(
      userId,
      tenantId,
      shiftDate,
      excludeApplicationId
    );
    
    if (conflict.hasConflict) {
      return conflict;
    }
  }
  
  // Also check if any of the new shifts conflict with each other (same date)
  const dateSet = new Set(shiftDates.map(d => extractDateFromShiftDate(d)));
  if (dateSet.size < shiftDates.length) {
    // Multiple shifts on the same date - this is allowed but should be handled
    // by the business logic (user can apply to multiple shifts on same day via one application)
    // but we won't allow multiple separate applications for the same date
  }
  
  return { hasConflict: false };
}

/**
 * Get all active applications for a user on a specific date
 * 
 * @param userId - The user's UID
 * @param tenantId - The tenant ID
 * @param shiftDate - The shift date (ISO string "YYYY-MM-DD")
 * @returns Array of application IDs
 */
export async function getActiveApplicationsForDate(
  userId: string,
  tenantId: string,
  shiftDate: string
): Promise<string[]> {
  try {
    const dateStr = extractDateFromShiftDate(shiftDate);
    const applicationIds: string[] = [];
    
    const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
    const userApplicationsQuery = query(
      applicationsRef,
      where('userId', '==', userId)
    );
    
    const snapshot = await getDocs(userApplicationsQuery);
    const activeStatuses = ['submitted', 'screened', 'advanced', 'interview', 'offer_pending', 'hired'];
    
    for (const docSnap of snapshot.docs) {
      const appData = docSnap.data();
      
      if (!activeStatuses.includes(appData.status)) {
        continue;
      }
      
      if (appData.shiftId || (appData.shiftIds && appData.shiftIds.length > 0)) {
        // Check if application has shiftDate stored (for quick lookup)
        if (appData.shiftDate) {
          const appDateStr = extractDateFromShiftDate(appData.shiftDate);
          if (appDateStr === dateStr) {
            applicationIds.push(docSnap.id);
            continue;
          }
        }
        
        // Fallback: fetch shift date from shift document
        const shiftDates = await getShiftDatesForApplication(
          tenantId,
          appData.jobOrderId,
          appData.shiftId || appData.shiftIds[0]
        );
        
        for (const existingShiftDate of shiftDates) {
          const existingDateStr = extractDateFromShiftDate(existingShiftDate);
          if (existingDateStr === dateStr) {
            applicationIds.push(docSnap.id);
            break;
          }
        }
      }
    }
    
    return applicationIds;
  } catch (error) {
    console.error('Error getting active applications for date:', error);
    return [];
  }
}

