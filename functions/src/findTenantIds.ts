import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getApps, getApp } from 'firebase-admin/app';

// Initialize Firebase Admin
const app = getApps().length ? getApp() : getApps()[0];
const db = getFirestore(app);

interface TenantInfo {
  id: string;
  name: string;
  type: string;
  createdAt: any;
  companyCount: number;
  duplicateGroups: number;
  duplicateCompanies: number;
}

interface DuplicateAnalysis {
  tenantId: string;
  tenantName: string;
  totalCompanies: number;
  duplicateGroups: number;
  companiesToDelete: number;
  companiesToKeep: number;
  groups: Array<{
    companyName: string;
    keepCompanyId: string;
    deleteCompanyIds: string[];
  }>;
}

export const findTenantIds = onCall({
  cors: true,
  maxInstances: 1
}, async (request) => {
  try {
    console.log('Starting tenant ID discovery...');

    // Get all tenants
    const tenantsSnapshot = await db.collection('tenants').get();

    if (tenantsSnapshot.empty) {
      return {
        success: true,
        message: 'No tenants found in the system',
        tenants: [],
        duplicateAnalysis: []
      };
    }

    const tenants: TenantInfo[] = [];
    const duplicateAnalysis: DuplicateAnalysis[] = [];

    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenantId = tenantDoc.id;
      const tenantData = tenantDoc.data();
      
      try {
        // Check if tenant has crm_companies subcollection
        const companiesSnapshot = await db.collection(`tenants/${tenantId}/crm_companies`).get();
        
        const tenantInfo: TenantInfo = {
          id: tenantId,
          name: tenantData.name || 'Unnamed Tenant',
          type: tenantData.type || 'Unknown',
          createdAt: tenantData.createdAt,
          companyCount: companiesSnapshot.size,
          duplicateGroups: 0,
          duplicateCompanies: 0
        };

        tenants.push(tenantInfo);

        if (companiesSnapshot.size > 0) {
          // Analyze for duplicates
          const companies = companiesSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));

          // Group by normalized company name
          const nameGroups = new Map<string, any[]>();
          companies.forEach(company => {
            const name = (company as any).name || (company as any).companyName || '';
            if (name) {
              const normalizedName = name.toLowerCase()
                .replace(/[^\w\s]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
              
              if (!nameGroups.has(normalizedName)) {
                nameGroups.set(normalizedName, []);
              }
              nameGroups.get(normalizedName)!.push(company);
            }
          });

          // Find groups with duplicates
          const duplicateGroups = Array.from(nameGroups.entries())
            .filter(([name, group]) => group.length > 1)
            .map(([name, group]) => ({ name, companies: group }));

          tenantInfo.duplicateGroups = duplicateGroups.length;
          tenantInfo.duplicateCompanies = duplicateGroups.reduce((sum, group) => sum + group.companies.length - 1, 0);

          if (duplicateGroups.length > 0) {
            // Calculate completeness scores and determine which to keep
            const analysis: DuplicateAnalysis = {
              tenantId,
              tenantName: tenantInfo.name,
              totalCompanies: companies.length,
              duplicateGroups: duplicateGroups.length,
              companiesToDelete: 0,
              companiesToKeep: companies.length,
              groups: []
            };

            duplicateGroups.forEach(group => {
              // Calculate completeness scores
              const scoredCompanies = group.companies.map(company => {
                let score = 0;
                let totalFields = 0;
                
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

                return {
                  ...company,
                  completenessScore: totalFields > 0 ? score / totalFields : 0
                };
              });

              // Sort by completeness score (highest first), then by creation date (oldest first)
              scoredCompanies.sort((a, b) => {
                if (Math.abs(a.completenessScore - b.completenessScore) > 0.01) {
                  return b.completenessScore - a.completenessScore;
                }
                
                const aCreated = a.createdAt?.toDate?.() || new Date(0);
                const bCreated = b.createdAt?.toDate?.() || new Date(0);
                return aCreated.getTime() - bCreated.getTime();
              });

              const keepCompany = scoredCompanies[0];
              const deleteCompanies = scoredCompanies.slice(1);

              analysis.groups.push({
                companyName: group.name,
                keepCompanyId: keepCompany.id,
                deleteCompanyIds: deleteCompanies.map(c => c.id)
              });

              analysis.companiesToDelete += deleteCompanies.length;
              analysis.companiesToKeep = analysis.totalCompanies - analysis.companiesToDelete;
            });

            duplicateAnalysis.push(analysis);
          }
        }
      } catch (error) {
        console.error(`Error analyzing tenant ${tenantId}:`, error);
        tenants.push({
          id: tenantId,
          name: tenantData.name || 'Unnamed Tenant',
          type: tenantData.type || 'Unknown',
          createdAt: tenantData.createdAt,
          companyCount: 0,
          duplicateGroups: 0,
          duplicateCompanies: 0
        });
      }
    }

    return {
      success: true,
      message: `Found ${tenants.length} tenants`,
      tenants,
      duplicateAnalysis
    };

  } catch (error) {
    console.error('Error finding tenant IDs:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}); 