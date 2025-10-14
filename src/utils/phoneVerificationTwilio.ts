/**
 * Twilio phone verification client utilities
 * Wraps Firebase callable functions for phone verification
 */

import { httpsCallable } from 'firebase/functions';
import { functions as firebaseFunctions } from '../firebase';

// Use the app/region-configured Functions instance

/**
 * Send SMS verification code to phone number via Twilio
 * @param e164 - Phone number in E.164 format (e.g., +17025550147)
 * @returns Promise resolving when SMS is sent
 */
export async function startPhoneVerification(e164: string): Promise<void> {
  // Validate E.164 format
  if (!isValidE164(e164)) {
    throw new Error('Invalid phone number format. Use E.164 format (e.g., +17025550147)');
  }

  try {
    // Primary path: callable function
    const sendOtp = httpsCallable(firebaseFunctions, 'sendOtp');
    const result = await sendOtp({ phoneE164: e164 });
    if (result.data && (result.data as any).success) {
      console.log('SMS verification sent to:', e164);
      return;
    }
    throw new Error('Failed to send verification code');
  } catch (error: any) {
    console.error('Phone verification error:', error);
    // Fallback: HTTP endpoint (invoker public + CORS enabled)
    try {
      const response = await fetch('https://us-central1-hrx1-d3beb.cloudfunctions.net/sendOtpHttp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneE164: e164 }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }
      const data = await response.json();
      if (data?.success) {
        console.log('SMS verification sent (HTTP fallback):', e164);
        return;
      }
      throw new Error('HTTP fallback failed');
    } catch (fallbackErr: any) {
      // Map common cases for the UI
      if (error?.code === 'functions/invalid-argument') {
        throw new Error(error.message || 'Invalid phone number format');
      }
      throw new Error('Service temporarily unavailable. Please try again.');
    }
  }
}

/**
 * Verify the SMS code and complete phone verification
 * @param code - 6-digit verification code
 * @param e164 - Phone number in E.164 format
 * @returns Promise resolving when phone is verified
 */
export async function confirmPhoneCode(code: string, e164: string): Promise<void> {
  // Validate inputs
  if (!code || !/^\d{6}$/.test(code)) {
    throw new Error('Invalid code format. Please enter a 6-digit code.');
  }

  if (!isValidE164(e164)) {
    throw new Error('Invalid phone number format');
  }

  try {
    const checkOtp = httpsCallable(firebaseFunctions, 'checkOtp');
    const result = await checkOtp({ 
      phoneE164: e164, 
      code: code 
    });
    
    if (result.data && (result.data as any).success) {
      console.log('Phone verified successfully:', e164);
    } else {
      throw new Error('Failed to verify phone number');
    }
  } catch (error: any) {
    console.error('Code verification error:', error);
    
    // Handle specific Firebase Functions errors
    if (error.code === 'functions/unauthenticated') {
      throw new Error('Must be signed in to verify phone');
    } else if (error.code === 'functions/invalid-argument') {
      throw new Error(error.message || 'Invalid code format');
    } else if (error.code === 'functions/permission-denied') {
      throw new Error('Incorrect code. Please try again.');
    } else if (error.code === 'functions/deadline-exceeded') {
      throw new Error('Code expired. Please request a new one.');
    } else if (error.code === 'functions/resource-exhausted') {
      throw new Error('Too many attempts. Please try again later.');
    } else if (error.code === 'functions/internal') {
      throw new Error('Service temporarily unavailable. Please try again.');
    }
    
    throw error;
  }
}

/**
 * Send worker message via Twilio (for future use)
 * @param to - Recipient phone number in E.164 format
 * @param message - Message content
 * @param template - Optional message template
 * @returns Promise resolving when message is sent
 */
export async function sendWorkerMessage(
  to: string, 
  message?: string, 
  template?: 'shift_reminder' | 'onboarding' | 'status_update' | 'custom'
): Promise<{ messageId: string; status: string }> {
  if (!message && !template) {
    throw new Error('Message content or template is required');
  }

  if (!isValidE164(to)) {
    throw new Error('Invalid recipient phone number format');
  }

  try {
    const sendWorkerMessageFn = httpsCallable(firebaseFunctions, 'sendWorkerMessage');
    const result = await sendWorkerMessageFn({ 
      to, 
      message, 
      template 
    });
    
    const data = result.data as any;
    if (data && data.success) {
      console.log('Worker message sent:', data.messageId);
      return {
        messageId: data.messageId,
        status: data.status
      };
    } else {
      throw new Error('Failed to send message');
    }
  } catch (error: any) {
    console.error('Worker message error:', error);
    
    // Handle specific Firebase Functions errors
    if (error.code === 'functions/unauthenticated') {
      throw new Error('Must be signed in to send messages');
    } else if (error.code === 'functions/permission-denied') {
      throw new Error(error.message || 'Insufficient permissions to send messages');
    } else if (error.code === 'functions/invalid-argument') {
      throw new Error(error.message || 'Invalid message parameters');
    } else if (error.code === 'functions/not-found') {
      throw new Error('Recipient not found in system');
    } else if (error.code === 'functions/internal') {
      throw new Error('Service temporarily unavailable. Please try again.');
    }
    
    throw error;
  }
}

/**
 * Validate E.164 phone number format
 * @param phone - Phone number string
 * @returns true if valid E.164 format
 */
export function isValidE164(phone: string): boolean {
  // E.164 format: + followed by 1-15 digits
  const e164Regex = /^\+[1-9]\d{7,14}$/;
  return e164Regex.test(phone);
}

/**
 * Format phone number for display
 * @param e164 - Phone number in E.164 format
 * @returns Formatted phone number (e.g., (702) 555-0147)
 */
export function formatPhoneForDisplay(e164: string): string {
  if (!e164) return '';
  
  // Remove + and extract country code and number
  const cleaned = e164.replace('+', '');
  
  // For US numbers (+1XXXXXXXXXX)
  if (cleaned.startsWith('1') && cleaned.length === 11) {
    const areaCode = cleaned.substring(1, 4);
    const firstPart = cleaned.substring(4, 7);
    const secondPart = cleaned.substring(7, 11);
    return `(${areaCode}) ${firstPart}-${secondPart}`;
  }
  
  // For other numbers, just return with +
  return e164;
}

/**
 * Clean up any stored verification data (no-op for Twilio)
 * This function exists for compatibility with the mock system
 */
export function cleanupPhoneVerification(): void {
  // No cleanup needed for Twilio - verification state is managed server-side
  console.log('Phone verification cleanup (Twilio mode)');
}
