import {
  getAuth,
  PhoneAuthProvider,
  linkWithCredential,
  RecaptchaVerifier,
  ApplicationVerifier
} from 'firebase/auth';
import { doc, updateDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

let verificationId: string | null = null;
let recaptchaVerifier: RecaptchaVerifier | null = null;

/**
 * Initialize reCAPTCHA verifier for phone authentication
 * @param containerId - ID of the DOM element to render reCAPTCHA
 * @param invisible - Whether to use invisible reCAPTCHA (default: true)
 * @returns RecaptchaVerifier instance
 */
export function initRecaptcha(
  containerId = 'recaptcha-container',
  invisible = true
): ApplicationVerifier {
  const auth = getAuth();
  
  // Clean up existing verifier if any
  if (recaptchaVerifier) {
    recaptchaVerifier.clear();
  }

  recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
    size: invisible ? 'invisible' : 'normal',
    callback: () => {
      // reCAPTCHA solved, allow phoneNumber verification.
      console.log('reCAPTCHA solved');
    },
    'expired-callback': () => {
      // Response expired. Ask user to solve reCAPTCHA again.
      console.warn('reCAPTCHA expired');
    }
  });

  return recaptchaVerifier;
}

/**
 * Send SMS verification code to phone number
 * @param e164 - Phone number in E.164 format (e.g., +17025550147)
 * @returns Promise resolving to verification ID
 */
export async function startPhoneVerification(e164: string): Promise<string> {
  const auth = getAuth();
  
  if (!auth.currentUser) {
    throw new Error('Must be signed in to verify phone');
  }

  // Validate E.164 format
  if (!isValidE164(e164)) {
    throw new Error('Invalid phone number format. Use E.164 format (e.g., +17025550147)');
  }

  try {
    // Initialize reCAPTCHA if not already done
    if (!recaptchaVerifier) {
      initRecaptcha();
    }

    // Send SMS verification code
    const provider = new PhoneAuthProvider(auth);
    verificationId = await provider.verifyPhoneNumber(e164, recaptchaVerifier);

    console.log('SMS sent to:', e164);
    return verificationId;
  } catch (error: any) {
    console.error('Phone verification error:', error);
    
    // Handle specific errors
    if (error.code === 'auth/invalid-phone-number') {
      throw new Error('Invalid phone number. Please check and try again.');
    } else if (error.code === 'auth/too-many-requests') {
      throw new Error('Too many attempts. Please try again later.');
    } else if (error.code === 'auth/quota-exceeded') {
      throw new Error('SMS quota exceeded. Please contact support.');
    }
    
    throw error;
  }
}

/**
 * Verify the SMS code and link phone to user account
 * @param code - 6-digit verification code
 * @param e164 - Phone number in E.164 format
 * @returns Promise resolving when phone is verified and linked
 */
export async function confirmPhoneCode(code: string, e164: string): Promise<void> {
  const auth = getAuth();
  
  if (!auth.currentUser) {
    throw new Error('Must be signed in to confirm phone');
  }

  if (!verificationId) {
    throw new Error('No verification in progress. Please request a new code.');
  }

  // Validate code format (6 digits)
  if (!isValidOTPCode(code)) {
    throw new Error('Invalid code format. Please enter a 6-digit code.');
  }

  try {
    // Create phone credential
    const credential = PhoneAuthProvider.credential(verificationId, code);

    // Link credential to current user
    await linkWithCredential(auth.currentUser, credential);

    // Update user profile in Firestore
    await updateDoc(doc(db, 'users', auth.currentUser.uid), {
      phoneE164: e164,
      phoneVerified: true,
      updatedAt: serverTimestamp()
    });

    // Recompute work eligibility
    await recomputeEligibility(auth.currentUser.uid);

    console.log('Phone verified and linked successfully');
  } catch (error: any) {
    console.error('Code verification error:', error);
    
    // Handle specific errors
    if (error.code === 'auth/invalid-verification-code') {
      throw new Error('Incorrect code. Please try again.');
    } else if (error.code === 'auth/code-expired') {
      throw new Error('Code expired. Please request a new one.');
    } else if (error.code === 'auth/credential-already-in-use') {
      throw new Error('This phone number is already linked to another account.');
    }
    
    throw error;
  }
}

/**
 * Recompute work eligibility based on DOB and phone verification
 * @param uid - User ID
 */
async function recomputeEligibility(uid: string): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  
  if (!userSnap.exists()) {
    throw new Error('User not found');
  }

  const userData = userSnap.data();
  
  // Check if both DOB and phone are verified
  const hasDOB = !!userData.dob;
  const hasPhoneVerified = !!userData.phoneVerified;
  
  if (hasDOB && hasPhoneVerified) {
    // Both requirements met, set workEligibility to true
    await updateDoc(userRef, {
      workEligibility: true,
      updatedAt: serverTimestamp()
    });
    console.log('Work eligibility updated to true');
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
 * Validate OTP code format
 * @param code - OTP code string
 * @returns true if valid 6-digit code
 */
export function isValidOTPCode(code: string): boolean {
  // 6 digits
  const otpRegex = /^\d{6}$/;
  return otpRegex.test(code);
}

/**
 * Clean up reCAPTCHA verifier
 */
export function cleanupRecaptcha(): void {
  if (recaptchaVerifier) {
    recaptchaVerifier.clear();
    recaptchaVerifier = null;
  }
  verificationId = null;
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

