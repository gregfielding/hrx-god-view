import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getApps, getApp } from 'firebase-admin/app';

// Initialize Firebase Admin
const app = getApps().length ? getApp() : getApps()[0];
const db = getFirestore(app);

interface CompanyData {
  id: string;
  name?: string;
  companyName?: string;
  status?: string;
  industry?: string;
  tier?: string;
  tags?: string[];
  accountOwner?: string;
  source?: string;
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  country?: string;
  phone?: string;
  website?: string;
  linkedInUrl?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
  salesOwnerId?: string;
  salesOwnerName?: string;
  salesOwnerRef?: string;
  freshsalesId?: string;
  externalId?: string;
  logo?: string;
  companyStructure?: any;
  dealIntelligence?: any;
  createdAt?: any;
  updatedAt?: any;
  [key: string]: any; // For any additional fields
}

interface DuplicateGroup {
  companies: CompanyData[];
  keepCompany: CompanyData;
  deleteCompanies: CompanyData[];
}

// Function to calculate completeness score for a company
function calculateCompletenessScore(company: CompanyData): number {
  let score = 0;
  let totalFields = 0;

  // Define important fields that contribute to completeness
  const importantFields = [
    'name', 'companyName', 'status', 'industry', 'tier', 'tags', 
    'accountOwner', 'source', 'address', 'city', 'state', 'zipcode', 
    'country', 'phone', 'website', 'linkedInUrl', 'latitude', 'longitude', 
    'notes', 'salesOwnerId', 'salesOwnerName', 'salesOwnerRef', 
    'freshsalesId', 'externalId', 'logo', 'companyStructure', 'dealIntelligence'
  ];

  importantFields.forEach(field => {
    totalFields++;
    const value = company[field];
    
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value)) {
        if (value.length > 0) score++;
      } else if (typeof value === 'object') {
        if (Object.keys(value).length > 0) score++;
      } else {
        score++;
      }
    }
  });

  return totalFields > 0 ? score / totalFields : 0;
}

// Function to normalize company name for comparison
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

// Function to find duplicate companies
function findDuplicateGroups(companies: CompanyData[]): DuplicateGroup[] {
  const nameGroups = new Map<string, CompanyData[]>();
  
  // Group companies by normalized name
  companies.forEach(company => {
    const name = company.name || company.companyName || '';
    if (name) {
      const normalizedName = normalizeCompanyName(name);
      if (!nameGroups.has(normalizedName)) {
        nameGroups.set(normalizedName, []);
      }
      nameGroups.get(normalizedName)!.push(company);
    }
  });

  // Find groups with duplicates (more than 1 company)
  const duplicateGroups: DuplicateGroup[] = [];
  
  nameGroups.forEach((groupCompanies, normalizedName) => {
    if (groupCompanies.length > 1) {
      // Calculate completeness scores
      const scoredCompanies = groupCompanies.map(company => ({
        ...company,
        completenessScore: calculateCompletenessScore(company)
      }));

      // Sort by completeness score (highest first), then by creation date (oldest first)
      scoredCompanies.sort((a, b) => {
        if (Math.abs(a.completenessScore - b.completenessScore) > 0.01) {
          return b.completenessScore - a.completenessScore;
        }
        
        // If completeness is similar, prefer the oldest one
        const aCreated = a.createdAt?.toDate?.() || new Date(0);
        const bCreated = b.createdAt?.toDate?.() || new Date(0);
        return aCreated.getTime() - bCreated.getTime();
      });

      const keepCompany = scoredCompanies[0];
      const deleteCompanies = scoredCompanies.slice(1);

      duplicateGroups.push({
        companies: groupCompanies,
        keepCompany,
        deleteCompanies
      });
    }
  });

  return duplicateGroups;
}

export const removeDuplicateCompanies = onCall({
  cors: true,
  maxInstances: 1
}, async (request) => {
  try {
    const { tenantId, dryRun = true } = request.data;

    if (!tenantId) {
      throw new Error('tenantId is required');
    }

    console.log(`Starting duplicate company removal for tenant: ${tenantId}, dryRun: ${dryRun}`);

    // Get all companies for the tenant
    const companiesRef = db.collection('tenants').doc(tenantId).collection('crm_companies');
    const companiesSnapshot = await companiesRef.get();

    if (companiesSnapshot.empty) {
      return {
        success: true,
        message: 'No companies found for this tenant',
        summary: {
          totalCompanies: 0,
          duplicateGroups: 0,
          companiesToDelete: 0,
          companiesToKeep: 0
        }
      };
    }

    const companies: CompanyData[] = companiesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    console.log(`Found ${companies.length} total companies`);

    // Find duplicate groups
    const duplicateGroups = findDuplicateGroups(companies);
    
    console.log(`Found ${duplicateGroups.length} duplicate groups`);

    // Prepare summary
    const summary = {
      totalCompanies: companies.length,
      duplicateGroups: duplicateGroups.length,
      companiesToDelete: duplicateGroups.reduce((sum, group) => sum + group.deleteCompanies.length, 0),
      companiesToKeep: companies.length - duplicateGroups.reduce((sum, group) => sum + group.deleteCompanies.length, 0),
      groups: duplicateGroups.map(group => ({
        companyName: group.keepCompany.name || group.keepCompany.companyName,
        keepCompanyId: group.keepCompany.id,
        keepCompanyScore: calculateCompletenessScore(group.keepCompany),
        deleteCompanyIds: group.deleteCompanies.map(c => c.id),
        deleteCompanyScores: group.deleteCompanies.map(c => calculateCompletenessScore(c))
      }))
    };

    // If dry run, return the analysis without making changes
    if (dryRun) {
      return {
        success: true,
        message: 'Dry run completed - no changes made',
        summary,
        dryRun: true
      };
    }

    // Perform the actual deletion
    const batch = db.batch();
    let deletedCount = 0;

    for (const group of duplicateGroups) {
      for (const companyToDelete of group.deleteCompanies) {
        const companyRef = companiesRef.doc(companyToDelete.id);
        batch.delete(companyRef);
        deletedCount++;
      }
    }

    // Commit the batch
    await batch.commit();

    console.log(`Successfully deleted ${deletedCount} duplicate companies`);

    return {
      success: true,
      message: `Successfully removed ${deletedCount} duplicate companies`,
      summary: {
        ...summary,
        companiesDeleted: deletedCount
      },
      dryRun: false
    };

  } catch (error) {
    console.error('Error removing duplicate companies:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      dryRun: request.data?.dryRun || true
    };
  }
}); 