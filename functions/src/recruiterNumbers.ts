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
    const securityLevel = parseInt(userData?.securityLevel || '0');

    if (securityLevel < 5) {
      throw new HttpsError('permission-denied', 'Only admins can view available numbers');
    }

    try {
      const client = getTwilioClient();

      // Get all phone numbers from Twilio account
      const numbers = await client.incomingPhoneNumbers.list({ limit: 100 });

      // Get all assigned numbers from Firestore
      const assignedNumbersSnapshot = await db
        .collectionGroup('recruiterNumbers')
        .where('twilioNumber', '!=', null)
        .get();

      const assignedNumbers = new Set<string>();
      assignedNumbersSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.twilioNumber) {
          assignedNumbers.add(data.twilioNumber);
        }
      });

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
    const securityLevel = parseInt(userData?.securityLevel || '0');

    if (securityLevel < 5) {
      throw new HttpsError('permission-denied', 'Only admins can assign numbers');
    }

    try {
      // Verify recruiter exists and has appropriate role
      const recruiterDoc = await db.doc(`users/${recruiterId}`).get();
      const recruiterData = recruiterDoc.data();

      if (!recruiterData) {
        throw new HttpsError('not-found', 'Recruiter not found');
      }

      const recruiterSecurityLevel = parseInt(recruiterData.securityLevel || '0');
      const isRecruiter = recruiterSecurityLevel >= 5 || recruiterData.recruiter === true;

      if (!isRecruiter) {
        throw new HttpsError('invalid-argument', 'User is not a recruiter');
      }

      // Check if number is already assigned
      if (twilioNumberSid) {
        const existingAssignment = await db
          .collectionGroup('recruiterNumbers')
          .where('twilioNumberSid', '==', twilioNumberSid)
          .get();

        if (!existingAssignment.empty) {
          throw new HttpsError('already-exists', 'This number is already assigned to another recruiter');
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
    const securityLevel = parseInt(userData?.securityLevel || '0');

    if (securityLevel < 5) {
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
  const securityLevel = parseInt(userData?.securityLevel || '0');

  if (securityLevel < 5) {
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

