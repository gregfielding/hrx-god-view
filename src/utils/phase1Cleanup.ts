import { 
  collection, 
  getDocs, 
  doc, 
  getDoc,
  deleteDoc,
  writeBatch,
  query,
  limit
} from 'firebase/firestore';
import { db } from '../firebase';
import { PHASE1_COLLECTION_PATHS } from '../types/Phase1Types';

/**
 * Phase 1 Cleanup Utility
 * Handles deletion and merging of legacy collections as specified in phase1-groundwork.md
 */

export interface CleanupOptions {
  tenantId: string;
  batchSize?: number;
  dryRun?: boolean;
  preserveLegacy?: boolean;
}

export interface CleanupResult {
  success: boolean;
  processed: number;
  deleted: number;
  errors: string[];
  warnings: string[];
  summary: {
    collectionsRemoved: number;
    documentsDeleted: number;
    collectionsMerged: number;
    documentsMoved: number;
  };
}

export class Phase1Cleanup {
  private tenantId: string;
  private batchSize: number;
  private dryRun: boolean;
  private preserveLegacy: boolean;

  constructor(options: CleanupOptions) {
    this.tenantId = options.tenantId;
    this.batchSize = options.batchSize || 100;
    this.dryRun = options.dryRun || false;
    this.preserveLegacy = options.preserveLegacy || true;
  }

  /**
   * Run full cleanup process
   */
  async runCleanup(): Promise<CleanupResult> {
    const result: CleanupResult = {
      success: true,
      processed: 0,
      deleted: 0,
      errors: [],
      warnings: [],
      summary: {
        collectionsRemoved: 0,
        documentsDeleted: 0,
        collectionsMerged: 0,
        documentsMoved: 0
      }
    };

    try {
      console.log(`Starting Phase 1 cleanup for tenant: ${this.tenantId}`);
      
      // Step 1: Remove duplicate collections
      console.log('Step 1: Removing duplicate collections...');
      const duplicateResult = await this.removeDuplicateCollections();
      result.summary.collectionsRemoved += duplicateResult.collectionsRemoved;
      result.summary.documentsDeleted += duplicateResult.documentsDeleted;
      result.errors.push(...duplicateResult.errors);
      result.warnings.push(...duplicateResult.warnings);
      
      // Step 2: Remove stray locations
      console.log('Step 2: Removing stray locations...');
      const locationsResult = await this.removeStrayLocations();
      result.summary.collectionsRemoved += locationsResult.collectionsRemoved;
      result.summary.documentsDeleted += locationsResult.documentsDeleted;
      result.errors.push(...locationsResult.errors);
      result.warnings.push(...locationsResult.warnings);
      
      // Step 3: Remove legacy top-level jobOrders
      console.log('Step 3: Removing legacy top-level jobOrders...');
      const jobOrdersResult = await this.removeLegacyJobOrders();
      result.summary.collectionsRemoved += jobOrdersResult.collectionsRemoved;
      result.summary.documentsDeleted += jobOrdersResult.documentsDeleted;
      result.errors.push(...jobOrdersResult.errors);
      result.warnings.push(...jobOrdersResult.warnings);
      
      result.processed = result.summary.documentsDeleted;
      result.deleted = result.summary.documentsDeleted;
      
      console.log(`Cleanup completed. Removed ${result.summary.collectionsRemoved} collections, deleted ${result.summary.documentsDeleted} documents`);
      
    } catch (error) {
      const errorMsg = `Cleanup failed: ${error}`;
      console.error(errorMsg);
      result.success = false;
      result.errors.push(errorMsg);
    }

    return result;
  }

  /**
   * Remove duplicate collections
   */
  private async removeDuplicateCollections(): Promise<{
    collectionsRemoved: number;
    documentsDeleted: number;
    errors: string[];
    warnings: string[];
  }> {
    const result = {
      collectionsRemoved: 0,
      documentsDeleted: 0,
      errors: [] as string[],
      warnings: [] as string[]
    };

    try {
      // Define duplicate patterns to remove
      const duplicatesToRemove = [
        'recruiter_jobOrders', // Keep jobOrders (new structure)
        'recruiter_applications', // Keep applications (new structure)
        'recruiter_candidates', // Keep candidates (new structure)
        'recruiter_assignments', // Keep assignments (new structure)
        'recruiter_jobsBoardPosts', // Keep jobBoardPosts (new structure)
        'crm_locations' // Keep locations under crm_companies
      ];

      for (const collectionName of duplicatesToRemove) {
        try {
          const collectionRef = collection(db, 'tenants', this.tenantId, collectionName);
          const snapshot = await getDocs(query(collectionRef, limit(1)));
          
          if (!snapshot.empty) {
            console.log(`Found duplicate collection: ${collectionName} with ${snapshot.size} documents`);
            
            if (!this.dryRun) {
              const deleteResult = await this.deleteCollection(collectionName);
              result.documentsDeleted += deleteResult.documentsDeleted;
              result.collectionsRemoved += 1;
            } else {
              result.warnings.push(`Would delete duplicate collection: ${collectionName}`);
            }
          }
        } catch (error) {
          const errorMsg = `Error processing duplicate collection ${collectionName}: ${error}`;
          console.error(errorMsg);
          result.errors.push(errorMsg);
        }
      }
      
    } catch (error) {
      const errorMsg = `Error removing duplicate collections: ${error}`;
      console.error(errorMsg);
      result.errors.push(errorMsg);
    }

    return result;
  }

  /**
   * Remove stray locations collections
   */
  private async removeStrayLocations(): Promise<{
    collectionsRemoved: number;
    documentsDeleted: number;
    errors: string[];
    warnings: string[];
  }> {
    const result = {
      collectionsRemoved: 0,
      documentsDeleted: 0,
      errors: [] as string[],
      warnings: [] as string[]
    };

    try {
      // Check for stray locations collection at tenant level
      const locationsRef = collection(db, 'tenants', this.tenantId, 'locations');
      const snapshot = await getDocs(query(locationsRef, limit(1)));
      
      if (!snapshot.empty) {
        console.log(`Found stray locations collection with ${snapshot.size} documents`);
        
        if (!this.dryRun) {
          const deleteResult = await this.deleteCollection('locations');
          result.documentsDeleted += deleteResult.documentsDeleted;
          result.collectionsRemoved += 1;
        } else {
          result.warnings.push('Would delete stray locations collection');
        }
      }
      
    } catch (error) {
      const errorMsg = `Error removing stray locations: ${error}`;
      console.error(errorMsg);
      result.errors.push(errorMsg);
    }

    return result;
  }

  /**
   * Remove legacy top-level jobOrders
   */
  private async removeLegacyJobOrders(): Promise<{
    collectionsRemoved: number;
    documentsDeleted: number;
    errors: string[];
    warnings: string[];
  }> {
    const result = {
      collectionsRemoved: 0,
      documentsDeleted: 0,
      errors: [] as string[],
      warnings: [] as string[]
    };

    try {
      // Check for legacy top-level jobOrders collection
      const jobOrdersRef = collection(db, 'tenants', this.tenantId, 'jobOrders');
      const snapshot = await getDocs(query(jobOrdersRef, limit(1)));
      
      if (!snapshot.empty) {
        console.log(`Found legacy top-level jobOrders collection with ${snapshot.size} documents`);
        
        if (!this.dryRun) {
          const deleteResult = await this.deleteCollection('jobOrders');
          result.documentsDeleted += deleteResult.documentsDeleted;
          result.collectionsRemoved += 1;
        } else {
          result.warnings.push('Would delete legacy top-level jobOrders collection');
        }
      }
      
    } catch (error) {
      const errorMsg = `Error removing legacy jobOrders: ${error}`;
      console.error(errorMsg);
      result.errors.push(errorMsg);
    }

    return result;
  }

  /**
   * Delete an entire collection
   */
  private async deleteCollection(collectionName: string): Promise<{
    documentsDeleted: number;
  }> {
    let documentsDeleted = 0;
    
    try {
      const collectionRef = collection(db, 'tenants', this.tenantId, collectionName);
      
      // Delete in batches
      let hasMore = true;
      while (hasMore) {
        const snapshot = await getDocs(query(collectionRef, limit(this.batchSize)));
        
        if (snapshot.empty) {
          hasMore = false;
          break;
        }
        
        const batch = writeBatch(db);
        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
          documentsDeleted++;
        });
        
        await batch.commit();
        console.log(`Deleted batch of ${snapshot.docs.length} documents from ${collectionName}`);
      }
      
    } catch (error) {
      console.error(`Error deleting collection ${collectionName}:`, error);
      throw error;
    }
    
    return { documentsDeleted };
  }

  /**
   * Verify cleanup results
   */
  async verifyCleanup(): Promise<{
    remainingCollections: string[];
    issues: string[];
  }> {
    const result = {
      remainingCollections: [] as string[],
      issues: [] as string[]
    };

    try {
      // Check for collections that should have been removed
      const collectionsToCheck = [
        'recruiter_jobOrders',
        'recruiter_applications', 
        'recruiter_candidates',
        'recruiter_assignments',
        'recruiter_jobsBoardPosts',
        'crm_locations',
        'locations',
        'jobOrders' // Legacy top-level
      ];

      for (const collectionName of collectionsToCheck) {
        try {
          const collectionRef = collection(db, 'tenants', this.tenantId, collectionName);
          const snapshot = await getDocs(query(collectionRef, limit(1)));
          
          if (!snapshot.empty) {
            result.remainingCollections.push(collectionName);
            result.issues.push(`Collection ${collectionName} still exists with ${snapshot.size} documents`);
          }
        } catch (error) {
          // Collection doesn't exist or we don't have access - this is good
          console.log(`Collection ${collectionName} successfully removed or doesn't exist`);
        }
      }
      
    } catch (error) {
      result.issues.push(`Error verifying cleanup: ${error}`);
    }

    return result;
  }

  /**
   * Generate cleanup report
   */
  generateReport(cleanupResult: CleanupResult): string {
    let report = `# Phase 1 Cleanup Report for Tenant: ${this.tenantId}\n\n`;
    
    report += `## Summary\n`;
    report += `- Success: ${cleanupResult.success ? 'Yes' : 'No'}\n`;
    report += `- Collections Removed: ${cleanupResult.summary.collectionsRemoved}\n`;
    report += `- Documents Deleted: ${cleanupResult.summary.documentsDeleted}\n`;
    report += `- Collections Merged: ${cleanupResult.summary.collectionsMerged}\n`;
    report += `- Documents Moved: ${cleanupResult.summary.documentsMoved}\n\n`;

    if (cleanupResult.errors.length > 0) {
      report += `## Errors\n`;
      cleanupResult.errors.forEach(error => {
        report += `- ${error}\n`;
      });
      report += `\n`;
    }

    if (cleanupResult.warnings.length > 0) {
      report += `## Warnings\n`;
      cleanupResult.warnings.forEach(warning => {
        report += `- ${warning}\n`;
      });
      report += `\n`;
    }

    report += `## Cleanup Actions\n`;
    report += `- Removed duplicate collections (recruiter_*)\n`;
    report += `- Removed stray locations collection\n`;
    report += `- Removed legacy top-level jobOrders collection\n`;
    report += `- Preserved legacy data: ${this.preserveLegacy ? 'Yes' : 'No'}\n`;
    report += `- Dry run: ${this.dryRun ? 'Yes' : 'No'}\n`;

    return report;
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Run cleanup for a tenant
 */
export const runPhase1Cleanup = async (options: CleanupOptions): Promise<CleanupResult> => {
  const cleanup = new Phase1Cleanup(options);
  return await cleanup.runCleanup();
};

/**
 * Run dry run cleanup
 */
export const runDryRunCleanup = async (tenantId: string): Promise<CleanupResult> => {
  const cleanup = new Phase1Cleanup({ 
    tenantId, 
    dryRun: true 
  });
  return await cleanup.runCleanup();
};

/**
 * Verify cleanup results
 */
export const verifyPhase1Cleanup = async (tenantId: string) => {
  const cleanup = new Phase1Cleanup({ tenantId });
  return await cleanup.verifyCleanup();
};
