import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Gets the next available job order ID for a specific tenant
 * @param tenantId - The tenant ID to get the next job order ID for
 * @returns Promise<number> - The next job order ID (starts at 1000 if no existing orders)
 */
export const getNextJobOrderId = async (tenantId: string): Promise<number> => {
  if (!tenantId) {
    console.warn('⚠️ No tenantId provided to getNextJobOrderId');
    return 1000;
  }

  try {
    console.log('🔍 Getting next job order ID for tenant:', tenantId);
    
    const q = query(
      collection(db, 'jobOrders'),
      where('tenantId', '==', tenantId),
      orderBy('jobOrderId', 'desc'),
      limit(1),
    );
    
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
      const lastId = snapshot.docs[0].data().jobOrderId;
      const nextId = lastId + 1;
      console.log('✅ Found last job order ID:', lastId, 'Next will be:', nextId);
      return nextId;
    }
    
    console.log('✅ No existing job orders found, starting with 1000');
    return 1000;
  } catch (error) {
    console.error('❌ Error in getNextJobOrderId:', error);
    // If there's an error (like missing index), fall back to 1000
    console.warn('⚠️ Falling back to job order ID 1000 due to error');
    return 1000;
  }
};

/**
 * Validates if a job order ID is valid
 * @param jobOrderId - The job order ID to validate
 * @returns boolean - True if valid, false otherwise
 */
export const isValidJobOrderId = (jobOrderId: number): boolean => {
  return typeof jobOrderId === 'number' && jobOrderId >= 1000 && Number.isInteger(jobOrderId);
};

/**
 * Formats a job order ID for display
 * @param jobOrderId - The job order ID to format
 * @returns string - Formatted job order ID (e.g., "Job Order 1001")
 */
export const formatJobOrderId = (jobOrderId: number): string => {
  if (!isValidJobOrderId(jobOrderId)) {
    return 'Invalid Job Order ID';
  }
  return `Job Order ${jobOrderId}`;
}; 