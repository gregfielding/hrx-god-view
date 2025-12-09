/**
 * Recruiter Phone Number Management
 * Manage Twilio phone number assignments to recruiters
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import twilio from 'twilio';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

import { defineSecret } from 'firebase-functions/params';

// Twilio secrets
const twilioAccountSid = defineSecret('TWILIO_ACCOUNT_SID');
const twilioAuthToken = defineSecret('TWILIO_AUTH_TOKEN');

/**
 * Get Twilio client
 */
function getTwilioClient() {
  return twilio(twilioAccountSid.value(), twilioAuthToken.value());
}

export interface RecruiterNumber {
  recruiterId: string;
  tenantId: string;
  twilioNumber?: string; // E.164 format
  twilioNumberSid?: string; // Twilio number SID
  useMainNumber: boolean; // Fallback to tenant's main number
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
}

/**
 * Get available phone numbers from Twilio (numbers not in use)
 */
export const getAvailableTwilioNumbers = onCall(
  {
    secrets: [twilioAccountSid, twilioAuthToken],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    // Check permissions
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    const userData = userDoc.data();
    
    // Check root security level
    const rootSecurityLevel = parseInt(userData?.securityLevel || '0');
    
    // Also check if user has admin access in any tenant
    let hasTenantAdminAccess = false;
    if (userData?.tenantIds && typeof userData.tenantIds === 'object') {
      const tenantIds = userData.tenantIds;
      for (const tenantId in tenantIds) {
        const tenantData = tenantIds[tenantId];
        const tenantSecurityLevel = typeof tenantData === 'object' && tenantData?.securityLevel
          ? parseInt(String(tenantData.securityLevel))
          : 0;
        if (tenantSecurityLevel >= 5) {
          hasTenantAdminAccess = true;
          break;
        }
      }
    }
    
    if (rootSecurityLevel < 5 && !hasTenantAdminAccess) {
      throw new HttpsError('permission-denied', 'Only admins can view available numbers');
    }

    try {
      const client = getTwilioClient();

      // Get all phone numbers from Twilio account
      const numbers = await client.incomingPhoneNumbers.list({ limit: 100 });

      // Get all assigned numbers from Firestore
      // Note: collectionGroup queries require an index, but we'll try to get all assignments
      // For now, we'll search within tenant subcollections
      // TODO: Create Firestore index for collectionGroup query if needed
      const assignedNumbers = new Set<string>();
      
      // Get assignments from all tenants (iterate through tenants)
      // Alternative: Use a more specific query if we know tenantIds
      try {
        const tenantsSnapshot = await db.collection('tenants').limit(100).get();
        for (const tenantDoc of tenantsSnapshot.docs) {
          const assignmentsSnapshot = await db
            .collection(`tenants/${tenantDoc.id}/recruiterNumbers`)
            .where('twilioNumber', '!=', null)
            .get();
          
          assignmentsSnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.twilioNumber) {
              assignedNumbers.add(data.twilioNumber);
            }
          });
        }
      } catch (error) {
        // If collectionGroup query fails, log warning but continue
        logger.warn('Could not fetch all assigned numbers, some numbers may appear available');
      }

      // Filter to available numbers
      const available = numbers
        .filter((num) => !assignedNumbers.has(num.phoneNumber))
        .map((num) => ({
          phoneNumber: num.phoneNumber,
          sid: num.sid,
          friendlyName: num.friendlyName || num.phoneNumber,
        }));

      return {
        success: true,
        available,
        total: numbers.length,
        assigned: assignedNumbers.size,
      };
    } catch (error: any) {
      logger.error('Error fetching available Twilio numbers:', error);
      throw new HttpsError('internal', `Failed to fetch numbers: ${error.message}`);
    }
  }
);

/**
 * Search for available phone numbers to purchase from Twilio
 */
export const searchAvailableTwilioNumbers = onCall(
  {
    secrets: [twilioAccountSid, twilioAuthToken],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    // Check permissions
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    const userData = userDoc.data();
    
    // Check root security level
    const rootSecurityLevel = parseInt(userData?.securityLevel || '0');
    
    // Also check if user has admin access in any tenant
    let hasTenantAdminAccess = false;
    if (userData?.tenantIds && typeof userData.tenantIds === 'object') {
      const tenantIds = userData.tenantIds;
      for (const tenantId in tenantIds) {
        const tenantData = tenantIds[tenantId];
        const tenantSecurityLevel = typeof tenantData === 'object' && tenantData?.securityLevel
          ? parseInt(String(tenantData.securityLevel))
          : 0;
        if (tenantSecurityLevel >= 5) {
          hasTenantAdminAccess = true;
          break;
        }
      }
    }
    
    if (rootSecurityLevel < 5 && !hasTenantAdminAccess) {
      throw new HttpsError('permission-denied', 'Only admins can search for numbers');
    }

    const { areaCode, country, limit = 20 } = request.data as {
      areaCode?: string;
      country?: string;
      limit?: number;
    };

    try {
      const client = getTwilioClient();

      // Search for available numbers
      const searchParams: any = {
        limit: Math.min(limit, 50), // Max 50 results
      };

      if (areaCode) {
        searchParams.areaCode = parseInt(areaCode);
      } else {
        searchParams.areaCode = undefined;
      }

      if (country) {
        searchParams.country = country;
      } else {
        searchParams.country = 'US';
      }

      // Search for local numbers (SMS capable)
      const availableNumbers = await client.availablePhoneNumbers(country || 'US')
        .local
        .list({
          ...searchParams,
          smsEnabled: true,
          voiceEnabled: true, // Usually required for SMS
        });

      return {
        success: true,
        numbers: availableNumbers.map((num) => ({
          phoneNumber: num.phoneNumber,
          friendlyName: num.friendlyName || num.phoneNumber,
          locality: num.locality,
          region: num.region,
          postalCode: num.postalCode,
          isoCountry: num.isoCountry,
          capabilities: {
            voice: num.capabilities?.voice || false,
            sms: num.capabilities?.sms || false,
            mms: num.capabilities?.mms || false,
          },
        })),
        count: availableNumbers.length,
      };
    } catch (error: any) {
      logger.error('Error searching for available Twilio numbers:', error);
      throw new HttpsError('internal', `Failed to search numbers: ${error.message}`);
    }
  }
);

/**
 * Purchase a Twilio phone number
 */
export const purchaseTwilioNumber = onCall(
  {
    secrets: [twilioAccountSid, twilioAuthToken],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    // Check permissions
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    const userData = userDoc.data();
    
    // Check root security level
    const rootSecurityLevel = parseInt(userData?.securityLevel || '0');
    
    // Also check if user has admin access in any tenant
    let hasTenantAdminAccess = false;
    if (userData?.tenantIds && typeof userData.tenantIds === 'object') {
      const tenantIds = userData.tenantIds;
      for (const tenantId in tenantIds) {
        const tenantData = tenantIds[tenantId];
        const tenantSecurityLevel = typeof tenantData === 'object' && tenantData?.securityLevel
          ? parseInt(String(tenantData.securityLevel))
          : 0;
        if (tenantSecurityLevel >= 5) {
          hasTenantAdminAccess = true;
          break;
        }
      }
    }
    
    if (rootSecurityLevel < 5 && !hasTenantAdminAccess) {
      throw new HttpsError('permission-denied', 'Only admins can purchase numbers');
    }

    const { phoneNumber } = request.data as { phoneNumber: string };

    if (!phoneNumber) {
      throw new HttpsError('invalid-argument', 'phoneNumber is required');
    }

    try {
      const client = getTwilioClient();

      // Purchase the number
      const purchasedNumber = await client.incomingPhoneNumbers.create({
        phoneNumber: phoneNumber,
        smsUrl: `https://us-central1-hrx1-d3beb.cloudfunctions.net/handleInboundSms`,
        smsMethod: 'POST',
      });

      logger.info(`Purchased Twilio number: ${purchasedNumber.phoneNumber} (${purchasedNumber.sid})`);

      return {
        success: true,
        phoneNumber: purchasedNumber.phoneNumber,
        sid: purchasedNumber.sid,
        friendlyName: purchasedNumber.friendlyName,
      };
    } catch (error: any) {
      logger.error('Error purchasing Twilio number:', error);
      
      // Handle specific Twilio errors
      if (error.code === 21217) {
        throw new HttpsError('invalid-argument', 'Phone number is not available for purchase');
      } else if (error.code === 21216) {
        throw new HttpsError('permission-denied', 'Insufficient account balance to purchase number');
      }
      
      throw new HttpsError('internal', `Failed to purchase number: ${error.message}`);
    }
  }
);

/**
 * Assign a Twilio number to a recruiter
 */
export const assignRecruiterNumber = onCall(
  {
    secrets: [twilioAccountSid, twilioAuthToken],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const { tenantId, recruiterId, twilioNumberSid } = request.data as {
      tenantId: string;
      recruiterId: string;
      useMainNumber?: boolean;
      twilioNumberSid?: string;
    };

    if (!tenantId || !recruiterId) {
      throw new HttpsError('invalid-argument', 'tenantId and recruiterId are required');
    }

    // Check permissions
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    const userData = userDoc.data();
    
    // Check tenant-specific security level first, then fallback to root
    const tenantSecurityLevel = userData?.tenantIds?.[tenantId]?.securityLevel;
    const rootSecurityLevel = userData?.securityLevel;
    const securityLevelStr = tenantSecurityLevel || rootSecurityLevel || '0';
    const securityLevel = typeof securityLevelStr === 'string' ? parseInt(securityLevelStr) : securityLevelStr;

    if (!securityLevel || securityLevel < 5) {
      throw new HttpsError('permission-denied', 'Only admins can assign numbers');
    }

    try {
      // Verify recruiter exists and has appropriate role
      const recruiterDoc = await db.doc(`users/${recruiterId}`).get();
      const recruiterData = recruiterDoc.data();

      if (!recruiterData) {
        throw new HttpsError('not-found', 'Recruiter not found');
      }

      // Check if user has access to this tenant
      const hasTenantAccess = 
        recruiterData.tenantId === tenantId ||
        recruiterData.activeTenantId === tenantId ||
        (recruiterData.tenantIds && (
          (Array.isArray(recruiterData.tenantIds) && recruiterData.tenantIds.includes(tenantId)) ||
          (typeof recruiterData.tenantIds === 'object' && tenantId in recruiterData.tenantIds)
        ));

      if (!hasTenantAccess) {
        throw new HttpsError('invalid-argument', 'Recruiter does not have access to this tenant');
      }

      // Check recruiter flag
      if (recruiterData.recruiter !== true) {
        throw new HttpsError('invalid-argument', 'User is not marked as a recruiter');
      }

      // Check security level (5-7)
      const rootSecurityLevel = parseInt(recruiterData.securityLevel || '0');
      const tenantSecurityLevel = recruiterData.tenantIds?.[tenantId]?.securityLevel
        ? parseInt(String(recruiterData.tenantIds[tenantId].securityLevel))
        : null;
      
      const effectiveSecurityLevel = tenantSecurityLevel !== null ? tenantSecurityLevel : rootSecurityLevel;

      if (effectiveSecurityLevel < 5 || effectiveSecurityLevel > 7) {
        throw new HttpsError('invalid-argument', 'Recruiter must have security level 5-7');
      }

      // Check if number is already assigned
      if (twilioNumberSid) {
        // Check across all tenants for this number
        const tenantsSnapshot = await db.collection('tenants').limit(100).get();
        for (const tenantDoc of tenantsSnapshot.docs) {
          const existingAssignment = await db
            .collection(`tenants/${tenantDoc.id}/recruiterNumbers`)
            .where('twilioNumberSid', '==', twilioNumberSid)
            .limit(1)
            .get();

          if (!existingAssignment.empty) {
            throw new HttpsError('already-exists', 'This number is already assigned to another recruiter');
          }
        }

        // Get number details from Twilio
        const client = getTwilioClient();
        const number = await client.incomingPhoneNumbers(twilioNumberSid).fetch();
        
        // Configure webhook for inbound SMS
        await client.incomingPhoneNumbers(twilioNumberSid).update({
          smsUrl: `https://us-central1-hrx1-d3beb.cloudfunctions.net/handleInboundSms`,
          smsMethod: 'POST',
        });

        // Store assignment
        const recruiterNumberRef = db.doc(`tenants/${tenantId}/recruiterNumbers/${recruiterId}`);
        await recruiterNumberRef.set(
          {
            recruiterId,
            tenantId,
            twilioNumber: number.phoneNumber,
            twilioNumberSid: number.sid,
            useMainNumber: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        logger.info(`Assigned Twilio number ${number.phoneNumber} to recruiter ${recruiterId}`);

        return {
          success: true,
          twilioNumber: number.phoneNumber,
          twilioNumberSid: number.sid,
        };
      } else {
        // Use main number (fallback)
        const recruiterNumberRef = db.doc(`tenants/${tenantId}/recruiterNumbers/${recruiterId}`);
        await recruiterNumberRef.set(
          {
            recruiterId,
            tenantId,
            useMainNumber: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return {
          success: true,
          useMainNumber: true,
        };
      }
    } catch (error: any) {
      logger.error('Error assigning recruiter number:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', `Failed to assign number: ${error.message}`);
    }
  }
);

/**
 * Release a recruiter's Twilio number
 */
export const releaseRecruiterNumber = onCall(
  {
    secrets: [twilioAccountSid, twilioAuthToken],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const { tenantId, recruiterId } = request.data as {
      tenantId: string;
      recruiterId: string;
    };

    if (!tenantId || !recruiterId) {
      throw new HttpsError('invalid-argument', 'tenantId and recruiterId are required');
    }

    // Check permissions
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    const userData = userDoc.data();
    
    // Check tenant-specific security level first, then fallback to root
    const tenantSecurityLevel = userData?.tenantIds?.[tenantId]?.securityLevel;
    const rootSecurityLevel = userData?.securityLevel;
    const securityLevelStr = tenantSecurityLevel || rootSecurityLevel || '0';
    const securityLevel = typeof securityLevelStr === 'string' ? parseInt(securityLevelStr) : securityLevelStr;

    if (!securityLevel || securityLevel < 5) {
      throw new HttpsError('permission-denied', 'Only admins can release numbers');
    }

    try {
      const recruiterNumberRef = db.doc(`tenants/${tenantId}/recruiterNumbers/${recruiterId}`);
      const recruiterNumberDoc = await recruiterNumberRef.get();

      if (!recruiterNumberDoc.exists) {
        throw new HttpsError('not-found', 'No number assigned to this recruiter');
      }

      const data = recruiterNumberDoc.data();

      // Remove webhook from Twilio number (optional - can leave it)
      if (data?.twilioNumberSid) {
        try {
          const client = getTwilioClient();
          await client.incomingPhoneNumbers(data.twilioNumberSid).update({
            smsUrl: null,
            smsMethod: null,
          });
        } catch (twilioError) {
          logger.warn(`Failed to remove webhook from number ${data.twilioNumberSid}:`, twilioError);
          // Continue with deletion even if webhook removal fails
        }
      }

      // Delete the assignment
      await recruiterNumberRef.delete();

      logger.info(`Released Twilio number from recruiter ${recruiterId}`);

      return { success: true };
    } catch (error: any) {
      logger.error('Error releasing recruiter number:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', `Failed to release number: ${error.message}`);
    }
  }
);

/**
 * Get all recruiter number assignments for a tenant
 */
export const getRecruiterNumbers = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { tenantId } = request.data as { tenantId: string };

  if (!tenantId) {
    throw new HttpsError('invalid-argument', 'tenantId is required');
  }

  // Check permissions
  const userDoc = await db.doc(`users/${request.auth.uid}`).get();
  const userData = userDoc.data();
  
  // Check tenant-specific security level first, then fallback to root
  const tenantSecurityLevel = userData?.tenantIds?.[tenantId]?.securityLevel;
  const rootSecurityLevel = userData?.securityLevel;
  const securityLevelStr = tenantSecurityLevel || rootSecurityLevel || '0';
  const securityLevel = typeof securityLevelStr === 'string' ? parseInt(securityLevelStr) : securityLevelStr;

  if (!securityLevel || securityLevel < 5) {
    throw new HttpsError('permission-denied', 'Only admins can view recruiter numbers');
  }

  try {
    const snapshot = await db.collection(`tenants/${tenantId}/recruiterNumbers`).get();

    const assignments: Array<RecruiterNumber & { recruiterName?: string }> = [];

    for (const doc of snapshot.docs) {
      const data = doc.data() as RecruiterNumber;
      
      // Fetch recruiter name
      const recruiterDoc = await db.doc(`users/${data.recruiterId}`).get();
      const recruiterData = recruiterDoc.data();
      const recruiterName = recruiterData
        ? `${recruiterData.firstName || ''} ${recruiterData.lastName || ''}`.trim() || recruiterData.email
        : 'Unknown';

      assignments.push({
        ...data,
        recruiterName,
      });
    }

    return {
      success: true,
      assignments,
    };
  } catch (error: any) {
    logger.error('Error fetching recruiter numbers:', error);
    throw new HttpsError('internal', `Failed to fetch assignments: ${error.message}`);
  }
});

