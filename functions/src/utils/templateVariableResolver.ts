/**
 * Template Variable Resolver
 * 
 * Centralized system for resolving template variables from various data sources.
 * Handles inconsistent field names, missing data, and lookups via document IDs.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

const db = admin.firestore();

/**
 * Standard template variables available in SMS templates
 */
export interface TemplateVariableContext {
  // User/Applicant Info
  userId?: string;
  userData?: admin.firestore.DocumentData;
  
  // Application Info
  applicationId?: string;
  applicationData?: admin.firestore.DocumentData;
  
  // Job/Assignment Info
  jobOrderId?: string;
  jobOrderData?: admin.firestore.DocumentData;
  jobPostId?: string;
  jobPostData?: admin.firestore.DocumentData;
  assignmentId?: string;
  assignmentData?: admin.firestore.DocumentData;
  
  // Shift Info
  shiftId?: string;
  shiftData?: admin.firestore.DocumentData;
  
  // Location Info (may need lookup)
  locationId?: string;
  locationData?: admin.firestore.DocumentData;
  
  // Company Info (may need lookup)
  companyId?: string;
  companyData?: admin.firestore.DocumentData;
  
  // Tenant Info
  tenantId: string;
  tenantData?: admin.firestore.DocumentData;
  
  // Additional context
  status?: string;
  [key: string]: any;
}

/**
 * Resolved variables ready for template replacement
 */
export interface ResolvedVariables {
  // User variables
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  
  // Job variables
  jobTitle: string;
  jobOrderId: string;
  jobOrderName: string;
  jobPostId: string;
  jobPostTitle: string;
  
  // Location variables (multiple sources)
  locationCity: string;
  locationState: string;
  locationName: string;
  locationAddress: string;
  locationZipCode: string;
  
  // Company variables
  companyName: string;
  
  // Application variables
  applicationId: string;
  applicationStatus: string;
  applicationDate: string;
  
  // Assignment variables
  assignmentId: string;
  assignmentStatus: string;
  assignmentDate: string;
  assignmentTimeRange: string;
  
  // Shift variables
  shiftId: string;
  shiftDate: string;
  shiftTimeRange: string;
  shiftStartTime: string;
  shiftEndTime: string;
  
  // Tenant variables
  tenantName: string;
  
  // Additional variables
  [key: string]: string;
}

/**
 * Resolve all template variables from context
 * This is the main function that should be called by triggers
 */
export async function resolveTemplateVariables(
  context: TemplateVariableContext
): Promise<ResolvedVariables> {
  const {
    userId,
    userData,
    applicationId,
    applicationData,
    jobOrderId,
    jobOrderData,
    jobPostId,
    jobPostData,
    assignmentId,
    assignmentData,
    shiftId,
    shiftData,
    locationId,
    locationData,
    companyId,
    companyData,
    tenantId,
    tenantData,
    status,
  } = context;

  // Fetch missing data if we have IDs but not data
  const resolvedContext = await enrichContext(context);

  // Resolve all variables with fallback chains
  return {
    // User variables
    firstName: resolveFirstName(resolvedContext),
    lastName: resolveLastName(resolvedContext),
    fullName: resolveFullName(resolvedContext),
    email: resolveEmail(resolvedContext),
    phone: resolvePhone(resolvedContext),
    
    // Job variables
    jobTitle: resolveJobTitle(resolvedContext),
    jobOrderId: jobOrderId || '',
    jobOrderName: resolveJobOrderName(resolvedContext),
    jobPostId: jobPostId || '',
    jobPostTitle: resolveJobPostTitle(resolvedContext),
    
    // Location variables (tries multiple sources)
    locationCity: resolveLocationCity(resolvedContext),
    locationState: resolveLocationState(resolvedContext),
    locationName: resolveLocationName(resolvedContext),
    locationAddress: resolveLocationAddress(resolvedContext),
    locationZipCode: resolveLocationZipCode(resolvedContext),
    
    // Company variables
    companyName: resolveCompanyName(resolvedContext),
    
    // Application variables
    applicationId: applicationId || '',
    applicationStatus: status || applicationData?.status || '',
    applicationDate: resolveApplicationDate(resolvedContext),
    
    // Assignment variables
    assignmentId: assignmentId || '',
    assignmentStatus: assignmentData?.status || '',
    assignmentDate: resolveAssignmentDate(resolvedContext),
    assignmentTimeRange: resolveAssignmentTimeRange(resolvedContext),
    
    // Shift variables
    shiftId: shiftId || '',
    shiftDate: resolveShiftDate(resolvedContext),
    shiftTimeRange: resolveShiftTimeRange(resolvedContext),
    shiftStartTime: resolveShiftStartTime(resolvedContext),
    shiftEndTime: resolveShiftEndTime(resolvedContext),
    
    // Tenant variables
    tenantName: resolveTenantName(resolvedContext),
  };
}

/**
 * Enrich context by fetching missing documents
 */
async function enrichContext(
  context: TemplateVariableContext
): Promise<TemplateVariableContext> {
  const enriched = { ...context };

  try {
    // Fetch user if we have userId but no userData
    if (context.userId && !context.userData) {
      try {
        const userDoc = await db.doc(`users/${context.userId}`).get();
        enriched.userData = userDoc.data();
      } catch (err) {
        logger.warn(`Failed to fetch user ${context.userId}:`, err);
      }
    }

    // Fetch job order if we have jobOrderId but no jobOrderData
    if (context.jobOrderId && !context.jobOrderData && context.tenantId) {
      try {
        const jobOrderDoc = await db
          .doc(`tenants/${context.tenantId}/job_orders/${context.jobOrderId}`)
          .get();
        enriched.jobOrderData = jobOrderDoc.data();
        
        // Extract locationId/companyId if not already set
        if (!enriched.locationId && jobOrderDoc.data()?.worksiteId) {
          enriched.locationId = jobOrderDoc.data().worksiteId;
        }
        if (!enriched.companyId && jobOrderDoc.data()?.companyId) {
          enriched.companyId = jobOrderDoc.data().companyId;
        }
      } catch (err) {
        logger.warn(`Failed to fetch job order ${context.jobOrderId}:`, err);
      }
    }

    // Fetch job post if we have jobPostId but no jobPostData
    if (context.jobPostId && !context.jobPostData && context.tenantId) {
      try {
        const jobPostDoc = await db
          .doc(`tenants/${context.tenantId}/job_postings/${context.jobPostId}`)
          .get();
        enriched.jobPostData = jobPostDoc.data();
        
        // Extract IDs if not already set
        if (!enriched.jobOrderId && jobPostDoc.data()?.jobOrderId) {
          enriched.jobOrderId = jobPostDoc.data().jobOrderId;
        }
        if (!enriched.locationId && jobPostDoc.data()?.worksiteId) {
          enriched.locationId = jobPostDoc.data().worksiteId;
        }
        if (!enriched.companyId && jobPostDoc.data()?.companyId) {
          enriched.companyId = jobPostDoc.data().companyId;
        }
      } catch (err) {
        logger.warn(`Failed to fetch job post ${context.jobPostId}:`, err);
      }
    }

    // Fetch location if we have locationId but no locationData
    if (context.locationId && !context.locationData && context.tenantId) {
      try {
        // Try company location first (most common)
        if (context.companyId) {
          const locationDoc = await db
            .doc(`tenants/${context.tenantId}/crm_companies/${context.companyId}/locations/${context.locationId}`)
            .get();
          if (locationDoc.exists) {
            enriched.locationData = locationDoc.data();
          }
        }
        
        // If not found, try tenant-level locations (legacy)
        if (!enriched.locationData) {
          try {
            const locationDoc = await db
              .doc(`tenants/${context.tenantId}/locations/${context.locationId}`)
              .get();
            if (locationDoc.exists) {
              enriched.locationData = locationDoc.data();
            }
          } catch (err) {
            // Location not at tenant level, that's okay
          }
        }
      } catch (err) {
        logger.warn(`Failed to fetch location ${context.locationId}:`, err);
      }
    }

    // Fetch company if we have companyId but no companyData
    if (context.companyId && !context.companyData && context.tenantId) {
      try {
        const companyDoc = await db
          .doc(`tenants/${context.tenantId}/crm_companies/${context.companyId}`)
          .get();
        enriched.companyData = companyDoc.data();
      } catch (err) {
        logger.warn(`Failed to fetch company ${context.companyId}:`, err);
      }
    }

    // Fetch tenant if we have tenantId but no tenantData
    if (context.tenantId && !context.tenantData) {
      try {
        const tenantDoc = await db.doc(`tenants/${context.tenantId}`).get();
        enriched.tenantData = tenantDoc.data();
      } catch (err) {
        logger.warn(`Failed to fetch tenant ${context.tenantId}:`, err);
      }
    }
  } catch (error) {
    logger.error('Error enriching context:', error);
  }

  return enriched;
}

// ============================================================================
// Variable Resolution Functions (with fallback chains)
// ============================================================================

function resolveFirstName(context: TemplateVariableContext): string {
  return (
    context.userData?.firstName ||
    context.applicationData?.applicantData?.firstName ||
    context.applicationData?.applicant?.firstName ||
    context.userData?.displayName?.split(' ')[0] ||
    'there'
  );
}

function resolveLastName(context: TemplateVariableContext): string {
  return (
    context.userData?.lastName ||
    context.applicationData?.applicantData?.lastName ||
    context.applicationData?.applicant?.lastName ||
    context.userData?.displayName?.split(' ').slice(1).join(' ') ||
    ''
  );
}

function resolveFullName(context: TemplateVariableContext): string {
  const first = resolveFirstName(context);
  const last = resolveLastName(context);
  if (last && last !== 'there') {
    return `${first} ${last}`;
  }
  return first;
}

function resolveEmail(context: TemplateVariableContext): string {
  return (
    context.userData?.email ||
    context.applicationData?.applicantData?.email ||
    context.applicationData?.applicant?.email ||
    ''
  );
}

function resolvePhone(context: TemplateVariableContext): string {
  return (
    context.userData?.phone ||
    context.userData?.phoneE164 ||
    context.applicationData?.applicantData?.phone ||
    context.applicationData?.applicant?.phone ||
    ''
  );
}

function resolveJobTitle(context: TemplateVariableContext): string {
  return (
    context.jobOrderData?.jobTitle ||
    context.jobPostData?.jobTitle ||
    context.assignmentData?.jobTitle ||
    context.shiftData?.jobTitle ||
    context.applicationData?.jobTitle ||
    context.applicationData?.data?.jobTitle ||
    'a position'
  );
}

function resolveJobOrderName(context: TemplateVariableContext): string {
  return (
    context.jobOrderData?.name ||
    context.jobOrderData?.jobTitle ||
    context.jobPostData?.jobOrderName ||
    ''
  );
}

function resolveJobPostTitle(context: TemplateVariableContext): string {
  return (
    context.jobPostData?.postTitle ||
    context.jobPostData?.title ||
    context.jobPostData?.jobTitle ||
    context.applicationData?.postTitle ||
    context.applicationData?.jobPostTitle ||
    ''
  );
}

function resolveLocationCity(context: TemplateVariableContext): string {
  // Try multiple sources and field names
  return (
    context.locationData?.city ||
    context.locationData?.locationCity ||
    context.jobOrderData?.locationCity ||
    context.jobOrderData?.worksiteCity ||
    context.jobPostData?.locationCity ||
    context.jobPostData?.worksiteCity ||
    context.assignmentData?.locationCity ||
    context.assignmentData?.worksiteCity ||
    context.shiftData?.locationCity ||
    context.shiftData?.worksiteCity ||
    context.applicationData?.locationCity ||
    context.applicationData?.data?.locationCity ||
    context.userData?.address?.city ||
    ''
  );
}

function resolveLocationState(context: TemplateVariableContext): string {
  return (
    context.locationData?.state ||
    context.locationData?.locationState ||
    context.jobOrderData?.locationState ||
    context.jobPostData?.locationState ||
    context.applicationData?.locationState ||
    context.userData?.address?.state ||
    ''
  );
}

function resolveLocationName(context: TemplateVariableContext): string {
  return (
    context.locationData?.name ||
    context.locationData?.locationName ||
    context.jobOrderData?.worksiteName ||
    context.jobOrderData?.locationName ||
    context.jobPostData?.worksiteName ||
    context.jobPostData?.locationName ||
    context.assignmentData?.worksiteName ||
    context.assignmentData?.locationName ||
    context.applicationData?.locationName ||
    ''
  );
}

function resolveLocationAddress(context: TemplateVariableContext): string {
  const parts: string[] = [];
  const street = context.locationData?.street || context.locationData?.address?.street;
  const city = resolveLocationCity(context);
  const state = resolveLocationState(context);
  
  if (street) parts.push(street);
  if (city) parts.push(city);
  if (state) parts.push(state);
  
  return parts.join(', ');
}

function resolveLocationZipCode(context: TemplateVariableContext): string {
  return (
    context.locationData?.zipCode ||
    context.locationData?.zip ||
    context.locationData?.address?.zipCode ||
    context.userData?.address?.zipCode ||
    ''
  );
}

function resolveCompanyName(context: TemplateVariableContext): string {
  return (
    context.companyData?.name ||
    context.companyData?.companyName ||
    context.jobOrderData?.companyName ||
    context.jobPostData?.companyName ||
    context.applicationData?.companyName ||
    ''
  );
}

function resolveApplicationDate(context: TemplateVariableContext): string {
  const timestamp = 
    context.applicationData?.createdAt ||
    context.applicationData?.submittedAt ||
    context.applicationData?.appliedAt;
  
  if (timestamp) {
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString();
    } catch {
      return new Date().toLocaleDateString();
    }
  }
  return new Date().toLocaleDateString();
}

function resolveAssignmentDate(context: TemplateVariableContext): string {
  const timestamp = 
    context.assignmentData?.date ||
    context.assignmentData?.assignmentDate ||
    context.assignmentData?.startDate;
  
  if (timestamp) {
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString();
    } catch {
      return '';
    }
  }
  return '';
}

function resolveAssignmentTimeRange(context: TemplateVariableContext): string {
  const start = context.assignmentData?.startTime || context.assignmentData?.timeStart;
  const end = context.assignmentData?.endTime || context.assignmentData?.timeEnd;
  
  if (start && end) {
    return `${formatTime(start)} - ${formatTime(end)}`;
  }
  return '';
}

function resolveShiftDate(context: TemplateVariableContext): string {
  const timestamp = 
    context.shiftData?.date ||
    context.shiftData?.shiftDate ||
    context.shiftData?.startDate;
  
  if (timestamp) {
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString();
    } catch {
      return '';
    }
  }
  return '';
}

function resolveShiftTimeRange(context: TemplateVariableContext): string {
  const start = resolveShiftStartTime(context);
  const end = resolveShiftEndTime(context);
  
  if (start && end) {
    return `${start} - ${end}`;
  }
  return start || end || '';
}

function resolveShiftStartTime(context: TemplateVariableContext): string {
  const time = 
    context.shiftData?.startTime ||
    context.shiftData?.timeStart;
  return formatTime(time);
}

function resolveShiftEndTime(context: TemplateVariableContext): string {
  const time = 
    context.shiftData?.endTime ||
    context.shiftData?.timeEnd;
  return formatTime(time);
}

function resolveTenantName(context: TemplateVariableContext): string {
  return (
    context.tenantData?.name ||
    context.tenantData?.companyName ||
    context.tenantId ||
    ''
  );
}

/**
 * Format time value (handles various formats)
 */
function formatTime(time: any): string {
  if (!time) return '';
  
  try {
    // If it's a Timestamp
    if (time.toDate) {
      const date = time.toDate();
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    
    // If it's a Date
    if (time instanceof Date) {
      return time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    
    // If it's a string (e.g., "09:00" or "9:00 AM")
    if (typeof time === 'string') {
      // Try to parse as time string
      const parts = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (parts) {
        return time;
      }
      // Try HH:MM format
      const timeParts = time.split(':');
      if (timeParts.length === 2) {
        const hours = parseInt(timeParts[0]);
        const minutes = timeParts[1];
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
        return `${displayHours}:${minutes} ${ampm}`;
      }
      return time;
    }
    
    // If it's a number (minutes since midnight or timestamp)
    if (typeof time === 'number') {
      const hours = Math.floor(time / 60);
      const minutes = time % 60;
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
      return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
    }
    
    return String(time);
  } catch (err) {
    logger.warn(`Failed to format time ${time}:`, err);
    return String(time);
  }
}

/**
 * Get list of all available template variables for documentation
 */
export function getAvailableVariables(): Array<{ name: string; description: string; example: string }> {
  return [
    { name: 'firstName', description: "Applicant's first name", example: 'John' },
    { name: 'lastName', description: "Applicant's last name", example: 'Doe' },
    { name: 'fullName', description: "Applicant's full name", example: 'John Doe' },
    { name: 'email', description: "Applicant's email address", example: 'john@example.com' },
    { name: 'phone', description: "Applicant's phone number", example: '+17025550147' },
    { name: 'jobTitle', description: 'Job position title', example: 'Server' },
    { name: 'jobOrderId', description: 'Job order ID', example: 'abc123' },
    { name: 'jobOrderName', description: 'Job order name', example: 'Q4 Server Staffing' },
    { name: 'jobPostId', description: 'Job posting ID', example: 'post456' },
    { name: 'jobPostTitle', description: 'Job posting title', example: 'Server Position - Las Vegas' },
    { name: 'locationCity', description: 'City where job is located', example: 'Las Vegas' },
    { name: 'locationState', description: 'State where job is located', example: 'NV' },
    { name: 'locationName', description: 'Worksite/location name', example: 'Main Location' },
    { name: 'locationAddress', description: 'Full location address', example: '123 Main St, Las Vegas, NV' },
    { name: 'locationZipCode', description: 'Location ZIP code', example: '89101' },
    { name: 'companyName', description: 'Company/client name', example: 'Acme Corp' },
    { name: 'applicationId', description: 'Application ID', example: 'app789' },
    { name: 'applicationStatus', description: 'Current application status', example: 'screened' },
    { name: 'applicationDate', description: 'Application submission date', example: '12/15/2024' },
    { name: 'assignmentId', description: 'Assignment ID', example: 'assign123' },
    { name: 'assignmentStatus', description: 'Assignment status', example: 'confirmed' },
    { name: 'assignmentDate', description: 'Assignment date', example: '12/20/2024' },
    { name: 'assignmentTimeRange', description: 'Assignment time range', example: '9:00 AM - 5:00 PM' },
    { name: 'shiftId', description: 'Shift ID', example: 'shift456' },
    { name: 'shiftDate', description: 'Shift date', example: '12/25/2024' },
    { name: 'shiftTimeRange', description: 'Shift time range', example: '8:00 AM - 4:00 PM' },
    { name: 'shiftStartTime', description: 'Shift start time', example: '8:00 AM' },
    { name: 'shiftEndTime', description: 'Shift end time', example: '4:00 PM' },
    { name: 'tenantName', description: 'Tenant/company name', example: 'HRX Staffing' },
  ];
}

