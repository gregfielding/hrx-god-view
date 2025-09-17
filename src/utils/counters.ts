import { doc, getDoc, setDoc, updateDoc, deleteDoc, increment } from 'firebase/firestore';
import { db } from '../firebase';
import { Counter } from '../types/NewDataModel';

/**
 * Counter system for auto-incrementing IDs
 * Follows the pattern: tenants/{tenantId}/counters/{counterId}
 */

/**
 * Get the next value for a counter
 * @param tenantId - The tenant ID
 * @param counterId - The counter identifier (e.g., 'jobOrderNumber', 'applicationNumber')
 * @param prefix - Optional prefix for the generated ID
 * @param suffix - Optional suffix for the generated ID
 * @param padding - Optional padding for the number (e.g., 4 for '0001')
 * @returns Promise with the next counter value and formatted ID
 */
export const getNextCounterValue = async (
  tenantId: string,
  counterId: string,
  prefix: string = '',
  suffix: string = '',
  padding: number = 0
): Promise<{ value: number; formattedId: string }> => {
  try {
    const counterRef = doc(db, 'tenants', tenantId, 'counters', counterId);
    
    // Use a transaction-like approach with retry logic
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        const counterDoc = await getDoc(counterRef);
        
        if (counterDoc.exists()) {
          // Counter exists, increment it
          const currentData = counterDoc.data() as Counter;
          const nextValue = currentData.next;
          
          // Update the counter atomically
          await updateDoc(counterRef, {
            next: increment(1),
            lastUsed: Date.now(),
            updatedAt: Date.now(),
            updatedBy: 'system'
          });
          
          const formattedId = formatCounterId(nextValue, prefix, suffix, padding);
          
          return {
            value: nextValue,
            formattedId
          };
        } else {
          // Counter doesn't exist, create it with value 1
          const newCounter: Counter = {
            id: counterId,
            tenantId,
            counterId,
            next: 2, // Start at 2 since we're returning 1
            prefix,
            suffix,
            padding,
            description: `Auto-incrementing counter for ${counterId}`,
            lastUsed: Date.now(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            createdBy: 'system',
            updatedBy: 'system'
          };
          
          await setDoc(counterRef, newCounter);
          
          const formattedId = formatCounterId(1, prefix, suffix, padding);
          
          return {
            value: 1,
            formattedId
          };
        }
      } catch (error) {
        attempts++;
        if (attempts >= maxAttempts) {
          throw error;
        }
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 100 * attempts));
      }
    }
    
    throw new Error(`Failed to get counter value after ${maxAttempts} attempts`);
  } catch (error) {
    console.error(`Error getting counter value for ${counterId}:`, error);
    throw error;
  }
};

/**
 * Format a counter value into a string ID
 * @param value - The numeric value
 * @param prefix - Optional prefix
 * @param suffix - Optional suffix
 * @param padding - Optional padding (e.g., 4 for '0001')
 * @returns Formatted ID string
 */
export const formatCounterId = (
  value: number,
  prefix: string = '',
  suffix: string = '',
  padding: number = 0
): string => {
  let formattedValue = value.toString();
  
  if (padding > 0) {
    formattedValue = formattedValue.padStart(padding, '0');
  }
  
  return `${prefix}${formattedValue}${suffix}`;
};

/**
 * Get current counter value without incrementing
 * @param tenantId - The tenant ID
 * @param counterId - The counter identifier
 * @returns Promise with current counter value
 */
export const getCurrentCounterValue = async (
  tenantId: string,
  counterId: string
): Promise<number> => {
  try {
    const counterRef = doc(db, 'tenants', tenantId, 'counters', counterId);
    const counterDoc = await getDoc(counterRef);
    
    if (counterDoc.exists()) {
      const data = counterDoc.data() as Counter;
      return data.next - 1; // Current value is next - 1
    }
    
    return 0; // Counter doesn't exist yet
  } catch (error) {
    console.error(`Error getting current counter value for ${counterId}:`, error);
    throw error;
  }
};

/**
 * Initialize a counter with a specific value
 * @param tenantId - The tenant ID
 * @param counterId - The counter identifier
 * @param initialValue - Initial value (defaults to 0)
 * @param prefix - Optional prefix
 * @param suffix - Optional suffix
 * @param padding - Optional padding
 * @returns Promise that resolves when counter is initialized
 */
export const initializeCounter = async (
  tenantId: string,
  counterId: string,
  initialValue: number = 0,
  prefix: string = '',
  suffix: string = '',
  padding: number = 0
): Promise<void> => {
  try {
    const counterRef = doc(db, 'tenants', tenantId, 'counters', counterId);
    const counterDoc = await getDoc(counterRef);
    
    if (counterDoc.exists()) {
      console.log(`Counter ${counterId} already exists`);
      return;
    }
    
    const newCounter: Counter = {
      id: counterId,
      tenantId,
      counterId,
      next: initialValue + 1, // Next value is initial + 1
      prefix,
      suffix,
      padding,
      description: `Auto-incrementing counter for ${counterId}`,
      lastUsed: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: 'system',
      updatedBy: 'system'
    };
    
    await setDoc(counterRef, newCounter);
    console.log(`Counter ${counterId} initialized with value ${initialValue}`);
  } catch (error) {
    console.error(`Error initializing counter ${counterId}:`, error);
    throw error;
  }
};

/**
 * Reset a counter to a specific value
 * @param tenantId - The tenant ID
 * @param counterId - The counter identifier
 * @param newValue - New value to set
 * @returns Promise that resolves when counter is reset
 */
export const resetCounter = async (
  tenantId: string,
  counterId: string,
  newValue: number
): Promise<void> => {
  try {
    const counterRef = doc(db, 'tenants', tenantId, 'counters', counterId);
    
    await updateDoc(counterRef, {
      next: newValue + 1, // Next value is new + 1
      lastUsed: Date.now(),
      updatedAt: Date.now(),
      updatedBy: 'system'
    });
    
    console.log(`Counter ${counterId} reset to value ${newValue}`);
  } catch (error) {
    console.error(`Error resetting counter ${counterId}:`, error);
    throw error;
  }
};

/**
 * Get all counters for a tenant
 * @param tenantId - The tenant ID
 * @returns Promise with array of counters
 */
export const getAllCounters = async (tenantId: string): Promise<Counter[]> => {
  try {
    const countersRef = doc(db, 'tenants', tenantId, 'counters');
    const countersDoc = await getDoc(countersRef);
    
    if (countersDoc.exists()) {
      const data = countersDoc.data();
      return Object.values(data) as Counter[];
    }
    
    return [];
  } catch (error) {
    console.error('Error getting all counters:', error);
    throw error;
  }
};

/**
 * Delete a counter
 * @param tenantId - The tenant ID
 * @param counterId - The counter identifier
 * @returns Promise that resolves when counter is deleted
 */
export const deleteCounter = async (
  tenantId: string,
  counterId: string
): Promise<void> => {
  try {
    const counterRef = doc(db, 'tenants', tenantId, 'counters', counterId);
    await deleteDoc(counterRef);
    
    console.log(`Counter ${counterId} deleted`);
  } catch (error) {
    console.error(`Error deleting counter ${counterId}:`, error);
    throw error;
  }
};

// ============================================================================
// PREDEFINED COUNTER TYPES
// ============================================================================

/**
 * Common counter configurations
 */
export const COUNTER_CONFIGS = {
  JOB_ORDER_NUMBER: {
    counterId: 'jobOrderNumber',
    prefix: 'JO-',
    padding: 4,
    description: 'Job Order Number'
  },
  APPLICATION_NUMBER: {
    counterId: 'applicationNumber',
    prefix: 'APP-',
    padding: 4,
    description: 'Application Number'
  },
  ASSIGNMENT_NUMBER: {
    counterId: 'assignmentNumber',
    prefix: 'ASG-',
    padding: 4,
    description: 'Assignment Number'
  },
  CANDIDATE_NUMBER: {
    counterId: 'candidateNumber',
    prefix: 'CAN-',
    padding: 4,
    description: 'Candidate Number'
  },
  TASK_NUMBER: {
    counterId: 'taskNumber',
    prefix: 'TASK-',
    padding: 4,
    description: 'Task Number'
  },
  POST_NUMBER: {
    counterId: 'postNumber',
    prefix: 'POST-',
    padding: 4,
    description: 'Job Board Post Number'
  }
} as const;

/**
 * Initialize all common counters for a tenant
 * @param tenantId - The tenant ID
 * @returns Promise that resolves when all counters are initialized
 */
export const initializeCommonCounters = async (tenantId: string): Promise<void> => {
  try {
    const promises = Object.values(COUNTER_CONFIGS).map(config =>
      initializeCounter(
        tenantId,
        config.counterId,
        0,
        config.prefix,
        '',
        config.padding
      )
    );
    
    await Promise.all(promises);
    console.log('All common counters initialized for tenant:', tenantId);
  } catch (error) {
    console.error('Error initializing common counters:', error);
    throw error;
  }
};

/**
 * Get next job order number
 * @param tenantId - The tenant ID
 * @returns Promise with formatted job order number
 */
export const getNextJobOrderNumber = async (tenantId: string): Promise<string> => {
  const config = COUNTER_CONFIGS.JOB_ORDER_NUMBER;
  const result = await getNextCounterValue(
    tenantId,
    config.counterId,
    config.prefix,
    '',
    config.padding
  );
  return result.formattedId;
};

/**
 * Get next application number
 * @param tenantId - The tenant ID
 * @returns Promise with formatted application number
 */
export const getNextApplicationNumber = async (tenantId: string): Promise<string> => {
  const config = COUNTER_CONFIGS.APPLICATION_NUMBER;
  const result = await getNextCounterValue(
    tenantId,
    config.counterId,
    config.prefix,
    '',
    config.padding
  );
  return result.formattedId;
};

/**
 * Get next assignment number
 * @param tenantId - The tenant ID
 * @returns Promise with formatted assignment number
 */
export const getNextAssignmentNumber = async (tenantId: string): Promise<string> => {
  const config = COUNTER_CONFIGS.ASSIGNMENT_NUMBER;
  const result = await getNextCounterValue(
    tenantId,
    config.counterId,
    config.prefix,
    '',
    config.padding
  );
  return result.formattedId;
};

/**
 * Get next candidate number
 * @param tenantId - The tenant ID
 * @returns Promise with formatted candidate number
 */
export const getNextCandidateNumber = async (tenantId: string): Promise<string> => {
  const config = COUNTER_CONFIGS.CANDIDATE_NUMBER;
  const result = await getNextCounterValue(
    tenantId,
    config.counterId,
    config.prefix,
    '',
    config.padding
  );
  return result.formattedId;
};

/**
 * Get next task number
 * @param tenantId - The tenant ID
 * @returns Promise with formatted task number
 */
export const getNextTaskNumber = async (tenantId: string): Promise<string> => {
  const config = COUNTER_CONFIGS.TASK_NUMBER;
  const result = await getNextCounterValue(
    tenantId,
    config.counterId,
    config.prefix,
    '',
    config.padding
  );
  return result.formattedId;
};

/**
 * Get next post number
 * @param tenantId - The tenant ID
 * @returns Promise with formatted post number
 */
export const getNextPostNumber = async (tenantId: string): Promise<string> => {
  const config = COUNTER_CONFIGS.POST_NUMBER;
  const result = await getNextCounterValue(
    tenantId,
    config.counterId,
    config.prefix,
    '',
    config.padding
  );
  return result.formattedId;
};
