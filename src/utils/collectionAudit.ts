import { 
  collection, 
  getDocs, 
  doc, 
  getDoc,
  query,
  limit
} from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Collection Audit Utility for Phase 1 Groundwork
 * Audits existing collections under tenants/{tenantId} to identify duplicates and cleanup needs
 */

export interface CollectionInfo {
  name: string;
  path: string;
  documentCount: number;
  sampleDocuments: any[];
  hasTenantId: boolean;
  hasRequiredFields: boolean;
  issues: string[];
}

export interface AuditResult {
  tenantId: string;
  collections: CollectionInfo[];
  duplicates: string[];
  missingTenantIds: string[];
  recommendations: string[];
  summary: {
    totalCollections: number;
    totalDocuments: number;
    duplicateCollections: number;
    collectionsWithIssues: number;
  };
}

export class CollectionAuditor {
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  /**
   * Run full audit of tenant collections
   */
  async runAudit(): Promise<AuditResult> {
    console.log(`Starting collection audit for tenant: ${this.tenantId}`);
    
    const result: AuditResult = {
      tenantId: this.tenantId,
      collections: [],
      duplicates: [],
      missingTenantIds: [],
      recommendations: [],
      summary: {
        totalCollections: 0,
        totalDocuments: 0,
        duplicateCollections: 0,
        collectionsWithIssues: 0
      }
    };

    try {
      // Get tenant document to verify it exists
      const tenantRef = doc(db, 'tenants', this.tenantId);
      const tenantDoc = await getDoc(tenantRef);
      
      if (!tenantDoc.exists()) {
        throw new Error(`Tenant ${this.tenantId} does not exist`);
      }

      // Get all subcollections under the tenant
      const tenantCollections = await this.getTenantSubcollections();
      
      // Audit each collection
      for (const collectionName of tenantCollections) {
        const collectionInfo = await this.auditCollection(collectionName);
        result.collections.push(collectionInfo);
        
        if (collectionInfo.issues.length > 0) {
          result.summary.collectionsWithIssues++;
        }
        
        result.summary.totalDocuments += collectionInfo.documentCount;
      }

      result.summary.totalCollections = result.collections.length;
      
      // Identify duplicates
      result.duplicates = this.identifyDuplicates(result.collections);
      result.summary.duplicateCollections = result.duplicates.length;
      
      // Identify missing tenantIds
      result.missingTenantIds = this.identifyMissingTenantIds(result.collections);
      
      // Generate recommendations
      result.recommendations = this.generateRecommendations(result);
      
      console.log(`Audit completed. Found ${result.summary.totalCollections} collections with ${result.summary.totalDocuments} documents`);
      
    } catch (error) {
      console.error('Audit failed:', error);
      result.recommendations.push(`Audit failed: ${error}`);
    }

    return result;
  }

  /**
   * Get list of subcollections under tenant
   */
  private async getTenantSubcollections(): Promise<string[]> {
    // Note: Firestore doesn't have a direct way to list subcollections
    // We'll need to check for known collection names
    const knownCollections = [
      'crm_companies',
      'crm_contacts', 
      'crm_deals',
      'crm_locations',
      'recruiter_jobOrders',
      'recruiter_candidates',
      'recruiter_applications',
      'recruiter_assignments',
      'recruiter_jobsBoardPosts',
      'jobOrders', // Legacy top-level
      'jobBoardPosts',
      'applications',
      'userGroups',
      'users',
      'tasks',
      'settings',
      'aiSettings',
      'branding',
      'integrations',
      'aiTraining',
      'modules',
      'counters'
    ];

    const existingCollections: string[] = [];
    
    for (const collectionName of knownCollections) {
      try {
        const collectionRef = collection(db, 'tenants', this.tenantId, collectionName);
        const snapshot = await getDocs(query(collectionRef, limit(1)));
        
        // If we can query it, it exists
        existingCollections.push(collectionName);
      } catch (error) {
        // Collection doesn't exist or we don't have access
        console.log(`Collection ${collectionName} not found or not accessible`);
      }
    }

    return existingCollections;
  }

  /**
   * Audit a specific collection
   */
  private async auditCollection(collectionName: string): Promise<CollectionInfo> {
    const collectionInfo: CollectionInfo = {
      name: collectionName,
      path: `tenants/${this.tenantId}/${collectionName}`,
      documentCount: 0,
      sampleDocuments: [],
      hasTenantId: false,
      hasRequiredFields: false,
      issues: []
    };

    try {
      const collectionRef = collection(db, 'tenants', this.tenantId, collectionName);
      const snapshot = await getDocs(query(collectionRef, limit(10))); // Get sample for analysis
      
      collectionInfo.documentCount = snapshot.size;
      
      if (snapshot.empty) {
        collectionInfo.issues.push('Collection is empty');
        return collectionInfo;
      }

      // Analyze sample documents
      let tenantIdCount = 0;
      let hasRequiredFieldsCount = 0;
      
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        collectionInfo.sampleDocuments.push({
          id: doc.id,
          ...data
        });

        // Check for tenantId
        if (data.tenantId === this.tenantId) {
          tenantIdCount++;
        }

        // Check for required fields based on collection type
        const hasRequired = this.checkRequiredFields(collectionName, data);
        if (hasRequired) {
          hasRequiredFieldsCount++;
        }
      });

      // Calculate percentages
      collectionInfo.hasTenantId = tenantIdCount === snapshot.size;
      collectionInfo.hasRequiredFields = hasRequiredFieldsCount === snapshot.size;

      // Identify issues
      if (!collectionInfo.hasTenantId) {
        collectionInfo.issues.push(`Missing tenantId in ${snapshot.size - tenantIdCount}/${snapshot.size} documents`);
      }

      if (!collectionInfo.hasRequiredFields) {
        collectionInfo.issues.push(`Missing required fields in ${snapshot.size - hasRequiredFieldsCount}/${snapshot.size} documents`);
      }

      // Collection-specific checks
      this.checkCollectionSpecificIssues(collectionName, collectionInfo);

    } catch (error) {
      collectionInfo.issues.push(`Error accessing collection: ${error}`);
    }

    return collectionInfo;
  }

  /**
   * Check required fields for different collection types
   */
  private checkRequiredFields(collectionName: string, data: any): boolean {
    switch (collectionName) {
      case 'crm_companies':
        return !!(data.name || data.companyName);
      
      case 'crm_contacts':
        return !!(data.fullName || (data.firstName && data.lastName));
      
      case 'recruiter_jobOrders':
        return !!(data.title && data.status);
      
      case 'applications':
        return !!(data.candidateId && data.status);
      
      case 'userGroups':
        return !!(data.groupName && data.members);
      
      case 'users':
        return !!(data.email && data.role);
      
      default:
        return true; // Don't enforce requirements for unknown collections
    }
  }

  /**
   * Check collection-specific issues
   */
  private checkCollectionSpecificIssues(collectionName: string, collectionInfo: CollectionInfo): void {
    switch (collectionName) {
      case 'jobOrders':
        collectionInfo.issues.push('Legacy top-level jobOrders collection - should be moved to tenant level');
        break;
      
      case 'locations':
        collectionInfo.issues.push('Stray locations collection - should be under crm_companies/{companyId}/locations');
        break;
      
      case 'recruiter_jobOrders':
        if (collectionInfo.sampleDocuments.some(doc => !doc.crmCompanyId)) {
          collectionInfo.issues.push('Some job orders missing crmCompanyId reference');
        }
        break;
      
      case 'crm_contacts':
        if (collectionInfo.sampleDocuments.some(doc => !doc.companyId)) {
          collectionInfo.issues.push('Some contacts missing companyId reference');
        }
        break;
    }
  }

  /**
   * Identify duplicate collections
   */
  private identifyDuplicates(collections: CollectionInfo[]): string[] {
    const duplicates: string[] = [];
    const collectionNames = collections.map(c => c.name);
    
    // Check for known duplicates
    const duplicatePatterns = [
      ['jobOrders', 'recruiter_jobOrders'],
      ['locations', 'crm_locations'],
      ['applications', 'recruiter_applications'],
      ['candidates', 'recruiter_candidates'],
      ['assignments', 'recruiter_assignments']
    ];

    duplicatePatterns.forEach(pattern => {
      const found = pattern.filter(name => collectionNames.includes(name));
      if (found.length > 1) {
        duplicates.push(...found);
      }
    });

    return [...new Set(duplicates)]; // Remove duplicates
  }

  /**
   * Identify collections missing tenantId
   */
  private identifyMissingTenantIds(collections: CollectionInfo[]): string[] {
    return collections
      .filter(c => !c.hasTenantId)
      .map(c => c.name);
  }

  /**
   * Generate recommendations based on audit results
   */
  private generateRecommendations(result: AuditResult): string[] {
    const recommendations: string[] = [];

    // Duplicate collections
    if (result.duplicates.length > 0) {
      recommendations.push(`Remove duplicate collections: ${result.duplicates.join(', ')}`);
    }

    // Missing tenantIds
    if (result.missingTenantIds.length > 0) {
      recommendations.push(`Add tenantId to collections: ${result.missingTenantIds.join(', ')}`);
    }

    // Collections with issues
    const collectionsWithIssues = result.collections.filter(c => c.issues.length > 0);
    if (collectionsWithIssues.length > 0) {
      recommendations.push(`Fix issues in collections: ${collectionsWithIssues.map(c => c.name).join(', ')}`);
    }

    // Phase 1 specific recommendations
    if (result.collections.some(c => c.name === 'jobOrders')) {
      recommendations.push('Move legacy jobOrders collection to tenant level');
    }

    if (result.collections.some(c => c.name === 'locations')) {
      recommendations.push('Move stray locations collection under crm_companies');
    }

    if (!result.collections.some(c => c.name === 'jobOrders')) {
      recommendations.push('Create new jobOrders subcollection at tenant level');
    }

    if (!result.collections.some(c => c.name === 'applications')) {
      recommendations.push('Create applications subcollection at tenant level');
    }

    if (!result.collections.some(c => c.name === 'userGroups')) {
      recommendations.push('Create userGroups subcollection at tenant level');
    }

    return recommendations;
  }

  /**
   * Generate detailed report
   */
  generateReport(result: AuditResult): string {
    let report = `# Collection Audit Report for Tenant: ${result.tenantId}\n\n`;
    
    report += `## Summary\n`;
    report += `- Total Collections: ${result.summary.totalCollections}\n`;
    report += `- Total Documents: ${result.summary.totalDocuments}\n`;
    report += `- Duplicate Collections: ${result.summary.duplicateCollections}\n`;
    report += `- Collections with Issues: ${result.summary.collectionsWithIssues}\n\n`;

    if (result.duplicates.length > 0) {
      report += `## Duplicate Collections\n`;
      result.duplicates.forEach(dup => {
        report += `- ${dup}\n`;
      });
      report += `\n`;
    }

    if (result.missingTenantIds.length > 0) {
      report += `## Collections Missing tenantId\n`;
      result.missingTenantIds.forEach(name => {
        report += `- ${name}\n`;
      });
      report += `\n`;
    }

    report += `## Collection Details\n`;
    result.collections.forEach(collection => {
      report += `### ${collection.name}\n`;
      report += `- Path: ${collection.path}\n`;
      report += `- Documents: ${collection.documentCount}\n`;
      report += `- Has tenantId: ${collection.hasTenantId ? 'Yes' : 'No'}\n`;
      report += `- Has required fields: ${collection.hasRequiredFields ? 'Yes' : 'No'}\n`;
      
      if (collection.issues.length > 0) {
        report += `- Issues:\n`;
        collection.issues.forEach(issue => {
          report += `  - ${issue}\n`;
        });
      }
      report += `\n`;
    });

    report += `## Recommendations\n`;
    result.recommendations.forEach(rec => {
      report += `- ${rec}\n`;
    });

    return report;
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Run audit for a tenant
 */
export const runCollectionAudit = async (tenantId: string): Promise<AuditResult> => {
  const auditor = new CollectionAuditor(tenantId);
  return await auditor.runAudit();
};

/**
 * Generate audit report
 */
export const generateAuditReport = async (tenantId: string): Promise<string> => {
  const auditor = new CollectionAuditor(tenantId);
  const result = await auditor.runAudit();
  return auditor.generateReport(result);
};
