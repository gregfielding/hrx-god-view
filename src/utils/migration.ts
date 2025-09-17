import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  writeBatch,
  query,
  where,
  orderBy,
  limit
} from 'firebase/firestore';
import { db } from '../firebase';
import { 
  Account, 
  Contact, 
  Location, 
  JobOrder, 
  Candidate, 
  Application, 
  Assignment, 
  Task,
  BaseEntity
} from '../types/NewDataModel';

/**
 * Migration utilities for moving from legacy collections to new data model
 * Following the principle: Only two top-level collections (tenants, users)
 */

export interface MigrationOptions {
  tenantId: string;
  batchSize?: number;
  dryRun?: boolean;
  preserveLegacy?: boolean;
}

export interface MigrationResult {
  success: boolean;
  processed: number;
  errors: string[];
  warnings: string[];
}

export class DataMigration {
  private tenantId: string;
  private batchSize: number;
  private dryRun: boolean;
  private preserveLegacy: boolean;

  constructor(options: MigrationOptions) {
    this.tenantId = options.tenantId;
    this.batchSize = options.batchSize || 100;
    this.dryRun = options.dryRun || false;
    this.preserveLegacy = options.preserveLegacy || true;
  }

  /**
   * Migrate CRM companies to accounts
   */
  async migrateCompaniesToAccounts(): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: true,
      processed: 0,
      errors: [],
      warnings: []
    };

    try {
      console.log(`Starting migration of companies to accounts for tenant ${this.tenantId}`);
      
      // Get all CRM companies
      const companiesRef = collection(db, 'tenants', this.tenantId, 'crm_companies');
      const companiesSnapshot = await getDocs(companiesRef);
      
      if (companiesSnapshot.empty) {
        console.log('No companies found to migrate');
        return result;
      }

      const companies = companiesSnapshot.docs;
      console.log(`Found ${companies.length} companies to migrate`);

      // Process in batches
      for (let i = 0; i < companies.length; i += this.batchSize) {
        const batch = writeBatch(db);
        const batchCompanies = companies.slice(i, i + this.batchSize);
        
        for (const companyDoc of batchCompanies) {
          try {
            const companyData = companyDoc.data();
            
            // Transform to new Account structure
            const accountData: Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> = {
              tenantId: this.tenantId,
              name: companyData.name || companyData.companyName || 'Unknown Company',
              companyName: companyData.companyName || companyData.name || 'Unknown Company',
              status: companyData.status || 'lead',
              industry: companyData.industry || '',
              tier: companyData.tier || 'C',
              tags: companyData.tags || [],
              address: companyData.address || '',
              city: companyData.city || '',
              state: companyData.state || '',
              zipcode: companyData.zipcode || '',
              country: companyData.country || '',
              phone: companyData.phone || '',
              website: companyData.website || '',
              linkedInUrl: companyData.linkedInUrl,
              latitude: companyData.latitude,
              longitude: companyData.longitude,
              notes: companyData.notes || '',
              source: companyData.source || '',
              externalId: companyData.externalId,
              salesOwnerId: companyData.salesOwnerId,
              salesOwnerName: companyData.salesOwnerName,
              salesOwnerRef: companyData.salesOwnerRef,
              freshsalesId: companyData.freshsalesId,
              companyStructure: companyData.companyStructure,
              dealIntelligence: companyData.dealIntelligence,
              associationCounts: companyData.associationCounts
            };

            if (!this.dryRun) {
              // Create new account document
              const accountRef = doc(db, 'tenants', this.tenantId, 'accounts', companyDoc.id);
              batch.set(accountRef, {
                ...accountData,
                createdAt: companyData.createdAt || Date.now(),
                updatedAt: companyData.updatedAt || Date.now(),
                createdBy: companyData.createdBy || 'migration',
                updatedBy: 'migration'
              });
            }

            result.processed++;
            console.log(`Migrated company: ${companyData.name || companyData.companyName}`);
            
          } catch (error) {
            const errorMsg = `Error migrating company ${companyDoc.id}: ${error}`;
            console.error(errorMsg);
            result.errors.push(errorMsg);
          }
        }

        if (!this.dryRun) {
          await batch.commit();
        }
        
        console.log(`Processed batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(companies.length / this.batchSize)}`);
      }

      console.log(`Migration completed. Processed: ${result.processed}, Errors: ${result.errors.length}`);
      
    } catch (error) {
      const errorMsg = `Migration failed: ${error}`;
      console.error(errorMsg);
      result.success = false;
      result.errors.push(errorMsg);
    }

    return result;
  }

  /**
   * Migrate CRM contacts to new contacts structure
   */
  async migrateContactsToNewStructure(): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: true,
      processed: 0,
      errors: [],
      warnings: []
    };

    try {
      console.log(`Starting migration of contacts for tenant ${this.tenantId}`);
      
      // Get all CRM contacts
      const contactsRef = collection(db, 'tenants', this.tenantId, 'crm_contacts');
      const contactsSnapshot = await getDocs(contactsRef);
      
      if (contactsSnapshot.empty) {
        console.log('No contacts found to migrate');
        return result;
      }

      const contacts = contactsSnapshot.docs;
      console.log(`Found ${contacts.length} contacts to migrate`);

      // Process in batches
      for (let i = 0; i < contacts.length; i += this.batchSize) {
        const batch = writeBatch(db);
        const batchContacts = contacts.slice(i, i + this.batchSize);
        
        for (const contactDoc of batchContacts) {
          try {
            const contactData = contactDoc.data();
            
            // Transform to new Contact structure
            const newContactData: Omit<Contact, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> = {
              tenantId: this.tenantId,
              fullName: contactData.fullName || `${contactData.firstName || ''} ${contactData.lastName || ''}`.trim(),
              firstName: contactData.firstName || '',
              lastName: contactData.lastName || '',
              email: contactData.email || '',
              phone: contactData.phone || '',
              title: contactData.title || '',
              accountId: contactData.companyId || contactData.accountId || '',
              role: contactData.role || 'other',
              status: contactData.status || 'active',
              locationId: contactData.locationId,
              tags: contactData.tags || [],
              notes: contactData.notes || '',
              salesOwnerId: contactData.salesOwnerId,
              salesOwnerName: contactData.salesOwnerName,
              salesOwnerRef: contactData.salesOwnerRef,
              freshsalesId: contactData.freshsalesId,
              contactProfile: contactData.contactProfile,
              associationCounts: contactData.associationCounts
            };

            if (!this.dryRun) {
              // Create new contact document under the account
              if (newContactData.accountId) {
                const contactRef = doc(db, 'tenants', this.tenantId, 'accounts', newContactData.accountId, 'contacts', contactDoc.id);
                batch.set(contactRef, {
                  ...newContactData,
                  createdAt: contactData.createdAt || Date.now(),
                  updatedAt: contactData.updatedAt || Date.now(),
                  createdBy: contactData.createdBy || 'migration',
                  updatedBy: 'migration'
                });
              } else {
                result.warnings.push(`Contact ${contactDoc.id} has no accountId, skipping`);
              }
            }

            result.processed++;
            console.log(`Migrated contact: ${newContactData.fullName}`);
            
          } catch (error) {
            const errorMsg = `Error migrating contact ${contactDoc.id}: ${error}`;
            console.error(errorMsg);
            result.errors.push(errorMsg);
          }
        }

        if (!this.dryRun) {
          await batch.commit();
        }
        
        console.log(`Processed batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(contacts.length / this.batchSize)}`);
      }

      console.log(`Migration completed. Processed: ${result.processed}, Errors: ${result.errors.length}`);
      
    } catch (error) {
      const errorMsg = `Migration failed: ${error}`;
      console.error(errorMsg);
      result.success = false;
      result.errors.push(errorMsg);
    }

    return result;
  }

  /**
   * Migrate job orders to new structure
   */
  async migrateJobOrdersToNewStructure(): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: true,
      processed: 0,
      errors: [],
      warnings: []
    };

    try {
      console.log(`Starting migration of job orders for tenant ${this.tenantId}`);
      
      // Get all recruiter job orders
      const jobOrdersRef = collection(db, 'tenants', this.tenantId, 'recruiter_jobOrders');
      const jobOrdersSnapshot = await getDocs(jobOrdersRef);
      
      if (jobOrdersSnapshot.empty) {
        console.log('No job orders found to migrate');
        return result;
      }

      const jobOrders = jobOrdersSnapshot.docs;
      console.log(`Found ${jobOrders.length} job orders to migrate`);

      // Process in batches
      for (let i = 0; i < jobOrders.length; i += this.batchSize) {
        const batch = writeBatch(db);
        const batchJobOrders = jobOrders.slice(i, i + this.batchSize);
        
        for (const jobOrderDoc of batchJobOrders) {
          try {
            const jobOrderData = jobOrderDoc.data();
            
            // Transform to new JobOrder structure
            const newJobOrderData: Omit<JobOrder, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> = {
              tenantId: this.tenantId,
              name: jobOrderData.title || 'Untitled Job Order',
              title: jobOrderData.title || 'Untitled Job Order',
              accountId: jobOrderData.crmCompanyId || jobOrderData.accountId || '',
              locationId: jobOrderData.worksiteId || jobOrderData.locationId,
              roleCategory: jobOrderData.roleCategory,
              openings: jobOrderData.openings || 1,
              remainingOpenings: jobOrderData.remainingOpenings || jobOrderData.openings || 1,
              startDate: jobOrderData.startDate || new Date().toISOString(),
              endDate: jobOrderData.endDate,
              targetFillDate: jobOrderData.targetFillDate,
              shifts: jobOrderData.shifts || [],
              payRate: jobOrderData.payRate || 0,
              billRate: jobOrderData.billRate,
              markup: jobOrderData.markup,
              otRules: jobOrderData.otRules || { multiplier: 1.5, threshold: 40 },
              backgroundCheck: jobOrderData.backgroundCheck || { required: false },
              drugTest: jobOrderData.drugTest || { required: false },
              language: jobOrderData.language || [],
              minExperience: jobOrderData.minExperience,
              certifications: jobOrderData.certifications || [],
              dressCode: jobOrderData.dressCode,
              priority: jobOrderData.priority || 'medium',
              urgencyScore: jobOrderData.urgencyScore || 50,
              recruiterOwnerId: jobOrderData.recruiterOwnerId || '',
              teamIds: jobOrderData.teamIds || [],
              autoPostToJobsBoard: jobOrderData.autoPostToJobsBoard || false,
              submittalLimit: jobOrderData.submittalLimit || 5,
              internalOnly: jobOrderData.internalOnly || false,
              allowOverfill: jobOrderData.allowOverfill || false,
              status: jobOrderData.status || 'draft',
              notes: jobOrderData.notes,
              tags: jobOrderData.tags,
              metrics: jobOrderData.metrics || {
                submittals: 0,
                interviews: 0,
                offers: 0,
                placements: 0,
                jobAgingDays: 0
              },
              crmCompanyId: jobOrderData.crmCompanyId,
              crmDealId: jobOrderData.crmDealId,
              worksiteId: jobOrderData.worksiteId
            };

            if (!this.dryRun) {
              // Create new job order document
              const jobOrderRef = doc(db, 'tenants', this.tenantId, 'jobOrders', jobOrderDoc.id);
              batch.set(jobOrderRef, {
                ...newJobOrderData,
                createdAt: jobOrderData.createdAt || Date.now(),
                updatedAt: jobOrderData.updatedAt || Date.now(),
                createdBy: jobOrderData.createdBy || 'migration',
                updatedBy: 'migration'
              });
            }

            result.processed++;
            console.log(`Migrated job order: ${newJobOrderData.title}`);
            
          } catch (error) {
            const errorMsg = `Error migrating job order ${jobOrderDoc.id}: ${error}`;
            console.error(errorMsg);
            result.errors.push(errorMsg);
          }
        }

        if (!this.dryRun) {
          await batch.commit();
        }
        
        console.log(`Processed batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(jobOrders.length / this.batchSize)}`);
      }

      console.log(`Migration completed. Processed: ${result.processed}, Errors: ${result.errors.length}`);
      
    } catch (error) {
      const errorMsg = `Migration failed: ${error}`;
      console.error(errorMsg);
      result.success = false;
      result.errors.push(errorMsg);
    }

    return result;
  }

  /**
   * Run full migration
   */
  async runFullMigration(): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: true,
      processed: 0,
      errors: [],
      warnings: []
    };

    try {
      console.log(`Starting full migration for tenant ${this.tenantId}`);
      
      // Step 1: Migrate companies to accounts
      console.log('Step 1: Migrating companies to accounts...');
      const companiesResult = await this.migrateCompaniesToAccounts();
      result.processed += companiesResult.processed;
      result.errors.push(...companiesResult.errors);
      result.warnings.push(...companiesResult.warnings);
      
      if (!companiesResult.success) {
        result.success = false;
        return result;
      }

      // Step 2: Migrate contacts
      console.log('Step 2: Migrating contacts...');
      const contactsResult = await this.migrateContactsToNewStructure();
      result.processed += contactsResult.processed;
      result.errors.push(...contactsResult.errors);
      result.warnings.push(...contactsResult.warnings);
      
      if (!contactsResult.success) {
        result.success = false;
        return result;
      }

      // Step 3: Migrate job orders
      console.log('Step 3: Migrating job orders...');
      const jobOrdersResult = await this.migrateJobOrdersToNewStructure();
      result.processed += jobOrdersResult.processed;
      result.errors.push(...jobOrdersResult.errors);
      result.warnings.push(...jobOrdersResult.warnings);
      
      if (!jobOrdersResult.success) {
        result.success = false;
        return result;
      }

      console.log(`Full migration completed. Total processed: ${result.processed}, Errors: ${result.errors.length}, Warnings: ${result.warnings.length}`);
      
    } catch (error) {
      const errorMsg = `Full migration failed: ${error}`;
      console.error(errorMsg);
      result.success = false;
      result.errors.push(errorMsg);
    }

    return result;
  }

  /**
   * Verify migration integrity
   */
  async verifyMigration(): Promise<{
    companies: { legacy: number; new: number };
    contacts: { legacy: number; new: number };
    jobOrders: { legacy: number; new: number };
  }> {
    const result = {
      companies: { legacy: 0, new: 0 },
      contacts: { legacy: 0, new: 0 },
      jobOrders: { legacy: 0, new: 0 }
    };

    try {
      // Count legacy companies
      const legacyCompaniesRef = collection(db, 'tenants', this.tenantId, 'crm_companies');
      const legacyCompaniesSnapshot = await getDocs(legacyCompaniesRef);
      result.companies.legacy = legacyCompaniesSnapshot.size;

      // Count new accounts
      const newAccountsRef = collection(db, 'tenants', this.tenantId, 'accounts');
      const newAccountsSnapshot = await getDocs(newAccountsRef);
      result.companies.new = newAccountsSnapshot.size;

      // Count legacy contacts
      const legacyContactsRef = collection(db, 'tenants', this.tenantId, 'crm_contacts');
      const legacyContactsSnapshot = await getDocs(legacyContactsRef);
      result.contacts.legacy = legacyContactsSnapshot.size;

      // Count new contacts (sum across all accounts)
      const accountsSnapshot = await getDocs(newAccountsRef);
      let newContactsCount = 0;
      for (const accountDoc of accountsSnapshot.docs) {
        const contactsRef = collection(db, 'tenants', this.tenantId, 'accounts', accountDoc.id, 'contacts');
        const contactsSnapshot = await getDocs(contactsRef);
        newContactsCount += contactsSnapshot.size;
      }
      result.contacts.new = newContactsCount;

      // Count legacy job orders
      const legacyJobOrdersRef = collection(db, 'tenants', this.tenantId, 'recruiter_jobOrders');
      const legacyJobOrdersSnapshot = await getDocs(legacyJobOrdersRef);
      result.jobOrders.legacy = legacyJobOrdersSnapshot.size;

      // Count new job orders
      const newJobOrdersRef = collection(db, 'tenants', this.tenantId, 'jobOrders');
      const newJobOrdersSnapshot = await getDocs(newJobOrdersRef);
      result.jobOrders.new = newJobOrdersSnapshot.size;

    } catch (error) {
      console.error('Error verifying migration:', error);
    }

    return result;
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Run migration for a tenant
 */
export const runMigration = async (options: MigrationOptions): Promise<MigrationResult> => {
  const migration = new DataMigration(options);
  return await migration.runFullMigration();
};

/**
 * Verify migration for a tenant
 */
export const verifyMigration = async (tenantId: string) => {
  const migration = new DataMigration({ tenantId });
  return await migration.verifyMigration();
};

/**
 * Run dry run migration
 */
export const runDryRunMigration = async (tenantId: string): Promise<MigrationResult> => {
  const migration = new DataMigration({ 
    tenantId, 
    dryRun: true 
  });
  return await migration.runFullMigration();
};
