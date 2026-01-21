import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { logJobApplicationActivity } from './activityLogger';
import { checkShiftDateConflict, checkMultipleShiftDateConflicts, extractDateFromShiftDate } from './gigShiftApplicationLimits';

/**
 * Check if user has existing application data (has applied before)
 */
export async function hasExistingApplicationData(userId: string): Promise<boolean> {
  try {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return false;
    
    const userData = userSnap.data();
    // Check if user has basic required fields filled out
    const hasPersonalInfo = !!(userData.firstName && userData.lastName && userData.email && userData.phone);
    
    // Check address - support multiple address formats
    const address = userData.address || userData.addressInfo || {};
    const hasAddress = !!(address.street || address.streetAddress) && 
                       !!(address.city) && 
                       !!(address.state) && 
                       !!(address.zip || address.zipCode);
    
    // Check coordinates - support multiple coordinate formats
    const hasCoordinates = !!(userData.homeLat && userData.homeLng) || 
                          !!(address.coordinates?.lat && address.coordinates?.lng) ||
                          !!(address.homeLat && address.homeLng);
    
    return hasPersonalInfo && hasAddress && hasCoordinates;
  } catch (error) {
    console.error('Error checking existing application data:', error);
    return false;
  }
}

/**
 * Check if job requires certifications that user doesn't have
 */
export async function getMissingRequiredCertifications(
  userId: string,
  jobPosting: any
): Promise<string[]> {
  try {
    // Get required certifications from job posting
    const requiredCerts = jobPosting?.licensesCerts || 
                         jobPosting?.requiredCertifications || 
                         (jobPosting?.requirements && Array.isArray(jobPosting.requirements.certifications) 
                           ? jobPosting.requirements.certifications 
                           : []) || [];
    
    if (!Array.isArray(requiredCerts) || requiredCerts.length === 0) {
      return [];
    }
    
    // Get user's certifications
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return requiredCerts;
    
    const userData = userSnap.data();
    const userCerts = Array.isArray(userData?.certifications) 
      ? userData.certifications.map((c: any) => {
          if (typeof c === 'string') return c;
          if (c && typeof c === 'object') return c.name || String(c);
          return String(c);
        }).filter(Boolean)
      : [];
    
    // Check which required certs are missing (case-insensitive partial matching)
    const missing: string[] = [];
    for (const requiredCert of requiredCerts) {
      const reqLower = String(requiredCert).toLowerCase();
      const hasCert = userCerts.some((userCert: string) => {
        const userCertLower = String(userCert).toLowerCase();
        return userCertLower.includes(reqLower) || reqLower.includes(userCertLower);
      });
      if (!hasCert) {
        missing.push(String(requiredCert));
      }
    }
    
    return missing;
  } catch (error) {
    console.error('Error checking missing certifications:', error);
    return [];
  }
}

/**
 * Submit application directly without wizard (for returning applicants)
 */
export async function submitQuickApplication(
  userId: string,
  tenantId: string,
  jobId: string,
  jobPosting: any,
  selectedShifts: string[] = [],
  returnTo?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Load user data
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      return { success: false, error: 'User not found' };
    }
    
    const userData = userSnap.data();
    
    // Validate required fields
    if (!userData.firstName || !userData.lastName || !userData.email || !userData.phone) {
      return { success: false, error: 'Missing required personal information' };
    }
    
    // Support multiple address formats
    const address = userData.address || userData.addressInfo || {};
    const street = address.street || address.streetAddress || '';
    const city = address.city || '';
    const state = address.state || '';
    const zip = address.zip || address.zipCode || '';
    
    if (!street || !city || !state || !zip) {
      return { success: false, error: 'Missing required address information' };
    }
    
    // Support multiple coordinate formats
    const lat = userData.homeLat || address.coordinates?.lat || address.homeLat;
    const lng = userData.homeLng || address.coordinates?.lng || address.homeLng;
    
    if (!lat || !lng) {
      return { success: false, error: 'Missing address coordinates' };
    }
    
    // Check for shift date conflicts if this is a gig job with shifts
    if (selectedShifts.length > 0 && jobPosting?.jobOrderId) {
      let conflict: any = null;
      
      if (selectedShifts.length === 1) {
        try {
          const shiftRef = doc(db, 'tenants', tenantId, 'job_orders', jobPosting.jobOrderId, 'shifts', selectedShifts[0]);
          const shiftSnap = await getDoc(shiftRef);
          
          if (shiftSnap.exists()) {
            const shiftData = shiftSnap.data();
            if (shiftData.shiftDate) {
              conflict = await checkShiftDateConflict(userId, tenantId, shiftData.shiftDate);
            }
          }
        } catch (error) {
          console.error('Error checking shift date conflict:', error);
        }
      } else {
        conflict = await checkMultipleShiftDateConflicts(
          userId,
          tenantId,
          selectedShifts,
          jobPosting.jobOrderId
        );
      }
      
      if (conflict?.hasConflict) {
        const conflictDate = conflict.conflictingApplication?.shiftDate 
          ? new Date(conflict.conflictingApplication.shiftDate).toLocaleDateString()
          : 'this date';
        return { 
          success: false, 
          error: `You already have an active application for a shift on ${conflictDate}. You can only apply to one shift per day.` 
        };
      }
    }
    
    // Build application document
    const tidAppId = `${userId}_${jobId}`;
    const tRef = doc(db, 'tenants', tenantId, 'applications', tidAppId);
    
    // Extract shift dates for gig jobs
    let shiftDate: string | undefined;
    const shiftDates: string[] = [];
    if (selectedShifts.length > 0 && jobPosting?.jobOrderId) {
      for (const shiftId of selectedShifts) {
        try {
          const shiftRef = doc(db, 'tenants', tenantId, 'job_orders', jobPosting.jobOrderId, 'shifts', shiftId);
          const shiftSnap = await getDoc(shiftRef);
          
          if (shiftSnap.exists()) {
            const shiftData = shiftSnap.data();
            if (shiftData.shiftDate) {
              const dateStr = extractDateFromShiftDate(shiftData.shiftDate);
              if (selectedShifts.length === 1) {
                shiftDate = dateStr;
              } else {
                shiftDates.push(dateStr);
              }
            }
          }
        } catch (error) {
          console.error(`Error getting shift date for ${shiftId}:`, error);
        }
      }
    }
    
    // Build shift assignments map for Gig jobs
    const shiftAssignments: Record<string, string> = {};
    if (selectedShifts.length > 0) {
      selectedShifts.forEach(shiftId => {
        shiftAssignments[shiftId] = 'pending';
      });
    }
    
    // Get company name
    let companyName = jobPosting?.companyName || null;
    const companyId = jobPosting?.companyId || null;
    
    if (!companyName && companyId && tenantId) {
      try {
        const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
        const companySnap = await getDoc(companyRef);
        if (companySnap.exists()) {
          const companyData = companySnap.data();
          companyName = companyData.companyName || companyData.name || null;
        }
      } catch (err) {
        console.warn('Failed to fetch company name from CRM:', err);
      }
    }
    
    // Create application document
    await setDoc(tRef, {
      userId,
      tenantId,
      jobId,
      jobOrderId: jobPosting?.jobOrderId || null,
      status: 'submitted',
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      data: {
        personal: {
          firstName: userData.firstName,
          lastName: userData.lastName,
          email: userData.email,
          phone: userData.phone,
          dob: userData.dob || userData.dateOfBirth,
          street: street,
          city: city,
          state: state,
          zip: zip,
          homeLat: lat,
          homeLng: lng,
        },
        eligibility: {
          workAuthorized: userData.workEligibility || false,
        },
        qualifications: {
          skills: userData.skills || [],
          education: userData.education || [],
          certifications: userData.certifications || [],
          workExperience: userData.workExperience || userData.workHistory || [],
          languages: userData.languages || [],
        },
        preferences: userData.preferences || {},
        requirements: {
          acks: {},
          uploaded: {},
        },
      },
      applicant: {
        firstName: userData.firstName,
        lastName: userData.lastName,
        email: userData.email,
        phone: userData.phone,
      },
      ...(selectedShifts.length === 1 ? { shiftId: selectedShifts[0] } : {}),
      ...(selectedShifts.length > 1 ? { shiftIds: selectedShifts } : {}),
      ...(shiftDate ? { shiftDate } : {}),
      ...(shiftDates.length > 0 ? { shiftDates: [...new Set(shiftDates)] } : {}),
      ...(Object.keys(shiftAssignments).length > 0 ? { shiftAssignments } : {}),
    }, { merge: true });
    
    // Log job application activity
    try {
      const jobTitle = jobPosting?.jobTitle || jobPosting?.postTitle || 'Unknown Job';
      await logJobApplicationActivity(
        userId,
        jobId,
        jobTitle,
        {
          applicationId: `${tenantId}_${jobId}`,
          tenantId,
          jobOrderId: jobPosting?.jobOrderId || null,
          status: 'submitted',
          ...(selectedShifts.length > 0 ? { shiftIds: selectedShifts } : {}),
        }
      );
    } catch (logError) {
      console.warn('Failed to log job application activity:', logError);
    }
    
    // Update user's applicationIds array
    const applicationId = `${tenantId}_${jobId}`;
    const currentApplicationIds = Array.isArray(userData.applicationIds) ? userData.applicationIds : [];
    if (!currentApplicationIds.includes(applicationId)) {
      await setDoc(userRef, {
        applicationIds: [...currentApplicationIds, applicationId],
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
    
    // Prepare denormalized application data for quick lookups
    const applicationQuickData: any = {
      applicationId,
      jobId,
      jobOrderId: jobPosting?.jobOrderId || null,
      jobTitle: jobPosting?.jobTitle || jobPosting?.postTitle || null,
      jobOrderName: jobPosting?.postTitle || jobPosting?.jobTitle || null,
      postTitle: jobPosting?.postTitle || null,
      companyName,
      companyId,
      location: jobPosting?.worksiteName || jobPosting?.location || null,
      payRate: jobPosting?.payRate || null,
      appliedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      status: 'submitted',
      ...(selectedShifts.length > 0 ? { shiftIds: selectedShifts, shiftAssignments } : {}),
    };
    
    // Update applicationData in user document
    const applicationDataKey = `applicationData.${applicationId}`;
    await setDoc(userRef, {
      [applicationDataKey]: applicationQuickData,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    
    return { success: true };
  } catch (error: any) {
    console.error('Error submitting quick application:', error);
    return { success: false, error: error?.message || 'Failed to submit application' };
  }
}
