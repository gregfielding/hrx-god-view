/**
 * React hook for sending worker messages via Twilio
 * Provides utilities for common messaging scenarios
 */

import { useState } from 'react';
import { sendWorkerMessage } from '../utils/phoneVerificationTwilio';

export interface WorkerMessage {
  messageId: string;
  status: string;
}

export interface UseWorkerMessagingReturn {
  sendMessage: (
    to: string,
    message?: string,
    template?: 'shift_reminder' | 'onboarding' | 'status_update' | 'custom'
  ) => Promise<WorkerMessage>;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * Hook for sending worker messages
 * @returns Object with sendMessage function and loading/error states
 */
export function useWorkerMessaging(): UseWorkerMessagingReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = async (
    to: string,
    message?: string,
    template?: 'shift_reminder' | 'onboarding' | 'status_update' | 'custom'
  ): Promise<WorkerMessage> => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await sendWorkerMessage(to, message, template);
      setIsLoading(false);
      return result;
    } catch (err: any) {
      setIsLoading(false);
      const errorMessage = err.message || 'Failed to send message';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };

  const clearError = () => {
    setError(null);
  };

  return {
    sendMessage,
    isLoading,
    error,
    clearError,
  };
}

/**
 * Message templates for common worker communications
 */
export const messageTemplates = {
  shift_reminder: {
    name: 'Shift Reminder',
    template: 'shift_reminder' as const,
    defaultMessage: 'Hi! This is a reminder about your upcoming shift. Please confirm your availability.',
  },
  onboarding: {
    name: 'Onboarding Welcome',
    template: 'onboarding' as const,
    defaultMessage: 'Welcome to the team! Please check your email for onboarding details and next steps.',
  },
  status_update: {
    name: 'Application Status',
    template: 'status_update' as const,
    defaultMessage: 'Your application status has been updated. Please check your account for details.',
  },
  custom: {
    name: 'Custom Message',
    template: 'custom' as const,
    defaultMessage: 'You have a new message from HRX. Please check your account for details.',
  },
} as const;

/**
 * Utility function to format phone number for messaging
 * @param phone - Phone number in various formats
 * @returns E.164 formatted phone number
 */
export function formatPhoneForMessaging(phone: string): string {
  // Remove all non-digit characters except +
  const cleaned = phone.replace(/[^\d+]/g, '');
  
  // If it doesn't start with +, assume it's a US number and add +1
  if (!cleaned.startsWith('+')) {
    // Remove any leading 1
    const digits = cleaned.startsWith('1') ? cleaned.substring(1) : cleaned;
    
    // Ensure it's 10 digits
    if (digits.length === 10) {
      return `+1${digits}`;
    }
  }
  
  return cleaned;
}

/**
 * Utility function to validate if a phone number can receive SMS
 * @param phone - Phone number to validate
 * @returns true if phone number appears to be SMS capable
 */
export function isSmsCapable(phone: string): boolean {
  // Basic validation - in a real app, you might want to use Twilio's Lookup API
  const e164Regex = /^\+[1-9]\d{7,14}$/;
  return e164Regex.test(phone);
}
