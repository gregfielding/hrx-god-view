/**
 * Consent Logging Utility
 * 
 * Logs SMS consent events to Firestore for compliance.
 * Implements: HRX SMS Consent & Compliance Spec - Section 5
 */

import { doc, setDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

export interface ConsentLogData {
  uid: string;
  phone: string;
  smsOptIn: boolean;
  source: 'signup_form' | 'profile_update' | 'admin' | 'apply_landing';
  termsVersion: string;
  ip?: string;
  userAgent?: string;
}

export interface STOPEventData {
  type: 'STOP' | 'HELP';
  timestamp: any; // serverTimestamp()
  source: 'sms';
  twilioSid?: string;
}

/**
 * Log SMS consent to userConsents collection
 */
export async function logSMSConsent(data: ConsentLogData): Promise<void> {
  try {
    const consentRef = doc(db, 'userConsents', data.uid);
    
    await setDoc(consentRef, {
      uid: data.uid,
      phone: data.phone,
      smsOptIn: data.smsOptIn,
      source: data.source,
      timestamp: serverTimestamp(),
      termsVersion: data.termsVersion,
      ip: data.ip || null,
      userAgent: data.userAgent || null,
    }, { merge: true });
    
    console.log(`[Consent] Logged SMS consent for user ${data.uid}: ${data.smsOptIn}`);
  } catch (error: any) {
    console.error('[Consent] Error logging SMS consent:', error);
    // Don't throw - consent logging failure shouldn't block signup
  }
}

/**
 * Log STOP/HELP event to userConsents/{uid}/events subcollection
 */
export async function logSTOPEvent(uid: string, eventData: STOPEventData): Promise<void> {
  try {
    const eventsRef = collection(db, 'userConsents', uid, 'events');
    
    await addDoc(eventsRef, {
      type: eventData.type,
      timestamp: eventData.timestamp,
      source: eventData.source,
      twilioSid: eventData.twilioSid || null,
    });
    
    console.log(`[Consent] Logged ${eventData.type} event for user ${uid}`);
  } catch (error: any) {
    console.error('[Consent] Error logging STOP event:', error);
    throw error; // Re-throw for STOP events as they're critical
  }
}

/**
 * Get client IP address (best effort)
 * Note: In production, this should be done server-side for accuracy
 */
export function getClientIP(): string | undefined {
  // This is a placeholder - real IP should come from server
  // For now, we'll try to get it from headers if available
  if (typeof window === 'undefined') return undefined;
  
  // In a real implementation, you'd make an API call to get the IP
  // For now, return undefined and let the backend handle it
  return undefined;
}

/**
 * Get user agent string
 */
export function getUserAgent(): string | undefined {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return undefined;
  }
  return navigator.userAgent;
}

