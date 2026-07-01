import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { logJobApplicationActivity } from './activityLogger';
import { updateUserSmartGroupOnApply } from '../services/smartGroupService';
import { checkShiftDateConflict, checkMultipleShiftDateConflicts, extractDateFromShiftDate } from './gigShiftApplicationLimits';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { computeJobScoreSummary } from './jobScore';
import { getUserScore } from './scoreSummary';

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

    // Prefer the canonical `homeAddress` shape (written by the wizard /
    // quick-apply Phase 2 update). Fall back to legacy `address` /
    // `addressInfo` so workers who applied before the canonical write landed
    // still pass the "has applied before" check and don't get pushed into a
    // re-collection flow on every visit.
    const canonicalHome =
      userData.homeAddress && typeof userData.homeAddress === 'object'
        ? (userData.homeAddress as any)
        : null;
    const legacyAddress = userData.address || userData.addressInfo || {};
    const hasAddress = canonicalHome
      ? !!(canonicalHome.street && canonicalHome.city && canonicalHome.state && canonicalHome.postalCode)
      : !!(legacyAddress.street || legacyAddress.streetAddress) &&
        !!legacyAddress.city &&
        !!legacyAddress.state &&
        !!(legacyAddress.zip || legacyAddress.zipCode);

    const hasCoordinates = canonicalHome
      ? Number.isFinite(Number(canonicalHome?.coordinates?.lat)) &&
        Number.isFinite(Number(canonicalHome?.coordinates?.lng))
      : !!(userData.homeLat && userData.homeLng) ||
        !!(legacyAddress.coordinates?.lat && legacyAddress.coordinates?.lng) ||
        !!(legacyAddress.homeLat && legacyAddress.homeLng);

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
  returnTo?: string,
  /** Career-only: which of the JO's 2+ open shifts the applicant picked when the
   *  posting offered a choice. Stamped as-is with no gig-style conflict-check or
   *  spot-limit side effects — deliberately NOT routed through `selectedShifts`. */
  preferredShiftId?: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Gig jobs: applicant must apply to at least one specific shift (see docs/career-vs-gig-placements-assignments.md)
    const isGig = String(jobPosting?.jobType || '').toLowerCase() === 'gig';
    if (isGig && (!selectedShifts || selectedShifts.length === 0)) {
      return { success: false, error: 'Please select at least one shift to apply to.' };
    }

    // Load user data
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      return { success: false, error: 'User not found' };
    }
    
    const userData = userSnap.data();

    // Ensure tenant membership is set for this tenant (applicants should have tenantIds + activeTenantId)
    try {
      const existingTenantMeta = (userData as any)?.tenantIds?.[tenantId] || {};
      await setDoc(
        userRef,
        {
          activeTenantId: (userData as any)?.activeTenantId || tenantId,
          tenantIds: {
            ...((userData as any)?.tenantIds || {}),
            [tenantId]: {
              ...existingTenantMeta,
              role: existingTenantMeta?.role || 'Applicant',
              securityLevel: existingTenantMeta?.securityLevel || '2',
              addedAt: existingTenantMeta?.addedAt || serverTimestamp(),
            },
          },
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('Quick apply: failed to ensure tenant membership', e);
    }
    
    // Validate required fields
    if (!userData.firstName || !userData.lastName || !userData.email || !userData.phone) {
      return { success: false, error: 'Missing required personal information' };
    }
    
    // Address resolution. The new canonical shape (`users/{uid}.homeAddress`)
    // is preferred; we fall back to legacy `address` / `addressInfo` /
    // top-level fields so workers who applied before the canonical write
    // landed (and whose profile still only has the legacy structures) can
    // still quick-apply. New applicants always go through the wizard, which
    // populates `homeAddress` from a verified Google Place.
    const canonicalHome =
      userData.homeAddress && typeof userData.homeAddress === 'object'
        ? (userData.homeAddress as any)
        : null;
    const legacyAddress = userData.address || userData.addressInfo || {};
    const street =
      canonicalHome?.street ||
      legacyAddress.street ||
      legacyAddress.streetAddress ||
      '';
    const city = canonicalHome?.city || legacyAddress.city || '';
    const state = canonicalHome?.state || legacyAddress.state || '';
    const zip =
      canonicalHome?.postalCode || legacyAddress.zip || legacyAddress.zipCode || '';

    if (!street || !city || !state || !zip) {
      return { success: false, error: 'Missing required address information' };
    }

    const lat =
      Number(canonicalHome?.coordinates?.lat) ||
      Number(userData.homeLat) ||
      Number(legacyAddress.coordinates?.lat) ||
      Number(legacyAddress.homeLat);
    const lng =
      Number(canonicalHome?.coordinates?.lng) ||
      Number(userData.homeLng) ||
      Number(legacyAddress.coordinates?.lng) ||
      Number(legacyAddress.homeLng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) {
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
    
    // Job Match Score: v1 rubric if pack has v1 definition, else legacy
    const requirementPackId = jobPosting?.requirementPackId || jobPosting?.jobOrder?.requirementPackId;
    let jobScoreSummaryPayload: any = undefined;
    if (requirementPackId) {
      const { getRequirementPackV1 } = await import('../data/jobRequirementPacksV1');
      const { computeJobScoreSummaryV1 } = await import('./jobScoreV1');
      const packV1 = getRequirementPackV1(requirementPackId);
      if (packV1) {
        const summaryV1 = computeJobScoreSummaryV1(
          userData as any,
          requirementPackId,
          getUserScore(userData as any),
          new Date()
        );
        if (summaryV1) {
          jobScoreSummaryPayload = { ...summaryV1, computedAt: serverTimestamp(), writtenAt: serverTimestamp() };
        }
      } else {
        const summary = computeJobScoreSummary(
          userData as any,
          requirementPackId,
          getUserScore(userData as any),
          new Date()
        );
        if (summary) {
          jobScoreSummaryPayload = { ...summary, computedAt: serverTimestamp() } as any;
        }
      }
    }

    // Mirror the canonical `homeAddress` onto the application doc when the
    // user profile already has the new shape. Quick-apply doesn't ask for a
    // fresh address (returning applicants), so the field is best-effort —
    // `onApplicationCreatedPush` will still re-load the user doc for its
    // address preflight if this is missing.
    const applicationHomeAddress =
      canonicalHome &&
      typeof canonicalHome.formattedAddress === 'string' &&
      canonicalHome.coordinates &&
      Number.isFinite(Number(canonicalHome.coordinates?.lat)) &&
      Number.isFinite(Number(canonicalHome.coordinates?.lng))
        ? canonicalHome
        : null;

    // Create application document
    await setDoc(tRef, {
      userId,
      tenantId,
      jobId,
      jobOrderId: jobPosting?.jobOrderId || null,
      // Denormalized hiringEntityId so triggers can branch without a JO read.
      hiringEntityId: jobPosting?.hiringEntityId ?? null,
      status: 'submitted',
      appliedAt: serverTimestamp(),
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(applicationHomeAddress ? { homeAddress: applicationHomeAddress } : {}),
      ...(jobScoreSummaryPayload ? { jobScoreSummary: jobScoreSummaryPayload } : {}),
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
      ...(preferredShiftId ? { preferredShiftId } : {}),
    }, { merge: true });

    // Auto-add to user groups if specified in job posting (matches wizard behavior)
    try {
      const groupIdsToAdd: string[] = [];
      if (Array.isArray(jobPosting?.autoAddToUserGroups) && jobPosting.autoAddToUserGroups.length > 0) {
        groupIdsToAdd.push(...jobPosting.autoAddToUserGroups);
      } else if (typeof jobPosting?.autoAddToUserGroup === 'string' && jobPosting.autoAddToUserGroup.trim()) {
        groupIdsToAdd.push(jobPosting.autoAddToUserGroup.trim());
      }

      // Fallback: resolve groups by jobOrderId if missing on the passed posting
      if (groupIdsToAdd.length === 0 && jobPosting?.jobOrderId) {
        const q = query(
          collection(db, 'tenants', tenantId, 'job_postings'),
          where('jobOrderId', '==', jobPosting.jobOrderId),
          limit(1)
        );
        const qsnap = await getDocs(q);
        if (!qsnap.empty) {
          const p = qsnap.docs[0].data() as any;
          if (Array.isArray(p?.autoAddToUserGroups) && p.autoAddToUserGroups.length > 0) {
            groupIdsToAdd.push(...p.autoAddToUserGroups);
          } else if (typeof p?.autoAddToUserGroup === 'string' && p.autoAddToUserGroup.trim()) {
            groupIdsToAdd.push(p.autoAddToUserGroup.trim());
          }
        }
      }

      if (groupIdsToAdd.length > 0) {
        const functions = getFunctions();
        const addUsersToGroups = httpsCallable(functions as any, 'addUsersToGroups');
        await addUsersToGroups({ userId, groupIds: groupIdsToAdd, tenantId });
      }
    } catch (e) {
      // Don't fail the application if group add fails, but log it loudly.
      console.error('Quick apply: failed to auto-add user to groups', e);
    }
    
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

    try {
      const worksite = jobPosting?.worksiteAddress ?? { city: (jobPosting as any)?.city, state: (jobPosting as any)?.state, zipCode: (jobPosting as any)?.worksiteAddress?.zipCode };
      const wsAddr = jobPosting?.worksiteAddress;
      await updateUserSmartGroupOnApply(userId, tenantId, applicationId, {
        worksite: { city: worksite?.city, state: worksite?.state, zipCode: worksite?.zipCode },
        jobTitle: jobPosting?.jobTitle || jobPosting?.postTitle || '',
        userAddressCity: city,
        userGeocoordinates: lat != null && lng != null ? { lat, lng } : undefined,
        skills: Array.isArray(userData.skills) ? userData.skills : [],
        certifications: Array.isArray(userData.certifications)
          ? userData.certifications.map((c: any) => (typeof c === 'string' ? c : c?.name || '')).filter(Boolean)
          : [],
        companyName: jobPosting?.companyName,
        companyId: jobPosting?.companyId,
        worksiteName: jobPosting?.worksiteName,
        worksiteId: jobPosting?.worksiteId,
        worksiteAddress: wsAddr ? { street: wsAddr.street, city: wsAddr.city, state: wsAddr.state, zipCode: wsAddr.zipCode } : undefined,
        worksiteGeocoordinates: (wsAddr as any)?.coordinates ? { lat: (wsAddr as any).coordinates.lat, lng: (wsAddr as any).coordinates.lng } : undefined,
      });
    } catch (sgErr) {
      console.warn('Smart Groups: failed to update on apply', sgErr);
    }
    
    return { success: true };
  } catch (error: any) {
    console.error('Error submitting quick application:', error);
    return { success: false, error: error?.message || 'Failed to submit application' };
  }
}
