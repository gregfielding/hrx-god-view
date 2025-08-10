import { collection, query, where, getDocs, updateDoc } from 'firebase/firestore';

import { db } from '../firebase';

/**
 * Links an actual salesperson user account to their placeholder record
 * This should be called when a salesperson is added to the system
 */
export const linkSalespersonToPlaceholder = async (
  tenantId: string,
  salespersonEmail: string,
  salespersonName: string
) => {
  try {
    // Find the placeholder record by name
    const salespeopleRef = collection(db, 'tenants', tenantId, 'crm_salespeople');
    const q = query(salespeopleRef, where('name', '==', salespersonName));
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
      const placeholderDoc = snapshot.docs[0];
      
      // Update the placeholder with the actual user info
      await updateDoc(placeholderDoc.ref, {
        email: salespersonEmail,
        status: 'active',
        linkedUserId: placeholderDoc.id, // For now, using the placeholder ID as reference
        updatedAt: new Date(),
      });
      
      console.log(`Linked salesperson ${salespersonName} to placeholder record`);
      return placeholderDoc.id;
    } else {
      console.log(`No placeholder found for salesperson: ${salespersonName}`);
      return null;
    }
  } catch (error) {
    console.error('Error linking salesperson to placeholder:', error);
    throw error;
  }
};

/**
 * Gets all placeholder salespeople that need to be linked
 */
export const getPlaceholderSalespeople = async (tenantId: string) => {
  try {
    const salespeopleRef = collection(db, 'tenants', tenantId, 'crm_salespeople');
    const q = query(salespeopleRef, where('status', '==', 'placeholder'));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error('Error getting placeholder salespeople:', error);
    throw error;
  }
};

/**
 * Updates company and contact records to use the linked salesperson
 */
export const updateCompanySalespersonReferences = async (
  tenantId: string,
  salespersonName: string,
  linkedUserId: string
) => {
  try {
    // Update companies
    const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
    const companiesQuery = query(companiesRef, where('salesOwnerName', '==', salespersonName));
    const companiesSnapshot = await getDocs(companiesQuery);
    
    companiesSnapshot.docs.forEach(async (companyDoc) => {
      await updateDoc(companyDoc.ref, {
        salesOwnerRef: linkedUserId,
        updatedAt: new Date(),
      });
    });
    
    // Update contacts
    const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
    const contactsQuery = query(contactsRef, where('salesOwnerName', '==', salespersonName));
    const contactsSnapshot = await getDocs(contactsQuery);
    
    contactsSnapshot.docs.forEach(async (contactDoc) => {
      await updateDoc(contactDoc.ref, {
        salesOwnerRef: linkedUserId,
        updatedAt: new Date(),
      });
    });
    
    console.log(`Updated ${companiesSnapshot.docs.length} companies and ${contactsSnapshot.docs.length} contacts for salesperson ${salespersonName}`);
  } catch (error) {
    console.error('Error updating salesperson references:', error);
    throw error;
  }
};

/**
 * Complete workflow to link a salesperson
 */
export const linkSalespersonWorkflow = async (
  tenantId: string,
  salespersonEmail: string,
  salespersonName: string
) => {
  try {
    // Step 1: Link to placeholder
    const placeholderId = await linkSalespersonToPlaceholder(tenantId, salespersonEmail, salespersonName);
    
    if (placeholderId) {
      // Step 2: Update all references
      await updateCompanySalespersonReferences(tenantId, salespersonName, placeholderId);
      
      console.log(`Successfully linked salesperson ${salespersonName} to all related records`);
      return placeholderId;
    }
    
    return null;
  } catch (error) {
    console.error('Error in salesperson linking workflow:', error);
    throw error;
  }
}; 