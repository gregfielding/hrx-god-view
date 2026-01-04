/**
 * Contact Linking Service
 * 
 * Resolves email addresses to CRM contacts and system users
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

const db = admin.firestore();

export interface ParticipantContact {
  email: string;
  contactId?: string;
  contactName?: string;
  companyId?: string;
  companyName?: string;
  userId?: string;
  userName?: string;
  dealIds?: string[];
}

/**
 * Lookup contacts by email addresses
 * Returns a map of email -> ParticipantContact
 */
export async function lookupContactsByEmails(
  tenantId: string,
  emails: string[]
): Promise<Map<string, ParticipantContact>> {
  const contactMap = new Map<string, ParticipantContact>();
  
  if (!emails || emails.length === 0) {
    return contactMap;
  }

  // Normalize emails (lowercase, trim)
  const normalizedEmails = emails
    .map(e => e.toLowerCase().trim())
    .filter(Boolean);

  if (normalizedEmails.length === 0) {
    return contactMap;
  }

  try {
    // Query CRM contacts - Firestore 'in' operator supports up to 10 items
    // So we need to chunk the emails
    const contactsRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('crm_contacts');

    const contactDocs: admin.firestore.DocumentSnapshot[] = [];
    
    // Process in chunks of 10
    for (let i = 0; i < normalizedEmails.length; i += 10) {
      const chunk = normalizedEmails.slice(i, i + 10);
      if (chunk.length === 0) continue;
      
      try {
        const snapshot = await contactsRef
          .where('email', 'in', chunk)
          .get();
        
        contactDocs.push(...snapshot.docs);
      } catch (error: any) {
        logger.warn(`Failed to query contacts for chunk: ${error.message}`);
      }
    }

    // Process contact results
    for (const doc of contactDocs) {
      const contactData = doc.data();
      const email = (contactData.email || '').toLowerCase().trim();
      
      if (!email || !normalizedEmails.includes(email)) continue;

      const contactName = contactData.fullName || 
        `${contactData.firstName || ''} ${contactData.lastName || ''}`.trim() ||
        contactData.name ||
        email.split('@')[0];

      const participantContact: ParticipantContact = {
        email: contactData.email || email, // Use original email case
        contactId: doc.id,
        contactName: contactName || undefined,
        companyId: contactData.companyId || undefined,
        companyName: contactData.companyName || undefined,
      };

      contactMap.set(email, participantContact);
    }

    // Query system users by email
    // Note: Users collection might not have email indexed, so we'll query all users
    // and filter in memory (or use a more efficient approach if available)
    try {
      const usersSnapshot = await db
        .collection('users')
        .where('email', 'in', normalizedEmails.slice(0, 10)) // Firestore limit
        .get();

      for (const doc of usersSnapshot.docs) {
        const userData = doc.data();
        const email = (userData.email || '').toLowerCase().trim();
        
        if (!email || !normalizedEmails.includes(email)) continue;

        const existing = contactMap.get(email);
        if (existing) {
          // Add user info to existing contact
          existing.userId = doc.id;
          existing.userName = userData.firstName && userData.lastName
            ? `${userData.firstName} ${userData.lastName}`
            : userData.displayName || userData.name || email.split('@')[0];
        } else {
          // Create new entry for user
          contactMap.set(email, {
            email: userData.email || email,
            userId: doc.id,
            userName: userData.firstName && userData.lastName
              ? `${userData.firstName} ${userData.lastName}`
              : userData.displayName || userData.name || email.split('@')[0],
          });
        }
      }
    } catch (error: any) {
      logger.warn(`Failed to query users: ${error.message}`);
    }

    // For contacts with companyId, fetch company name if not already set
    const companyIds = Array.from(contactMap.values())
      .map(c => c.companyId)
      .filter((id): id is string => !!id);

    if (companyIds.length > 0) {
      const uniqueCompanyIds = Array.from(new Set(companyIds));
      
      for (let i = 0; i < uniqueCompanyIds.length; i += 10) {
        const chunk = uniqueCompanyIds.slice(i, i + 10);
        try {
          // Use document references to fetch companies
          const companyPromises = chunk.map(companyId => 
            db.collection('tenants').doc(tenantId).collection('crm_companies').doc(companyId).get()
          );
          const companyDocs = await Promise.all(companyPromises);

          const companyMap = new Map<string, string>();
          companyDocs.forEach(doc => {
            if (doc.exists) {
              const companyData = doc.data();
              companyMap.set(doc.id, companyData?.companyName || companyData?.name || '');
            }
          });

          // Update contact map with company names
          contactMap.forEach((contact) => {
            if (contact.companyId && companyMap.has(contact.companyId) && !contact.companyName) {
              contact.companyName = companyMap.get(contact.companyId);
            }
          });
        } catch (error: any) {
          logger.warn(`Failed to query companies: ${error.message}`);
        }
      }
    }

    logger.info(`Contact lookup completed: ${contactMap.size} contacts found for ${normalizedEmails.length} emails`);
    
  } catch (error: any) {
    logger.error(`Error in lookupContactsByEmails: ${error.message}`, { error });
  }

  return contactMap;
}

/**
 * Enrich email thread with contact information
 */
export async function enrichThreadWithContacts(
  threadId: string,
  tenantId: string,
  participants: string[]
): Promise<ParticipantContact[]> {
  try {
    const contactMap = await lookupContactsByEmails(tenantId, participants);
    
    // Convert map to array, preserving participant order
    const participantContacts: ParticipantContact[] = participants.map(email => {
      const normalizedEmail = email.toLowerCase().trim();
      return contactMap.get(normalizedEmail) || { email };
    });

    return participantContacts;
  } catch (error: any) {
    logger.error(`Error enriching thread with contacts: ${error.message}`, { error });
    // Return basic participant info on error
    return participants.map(email => ({ email }));
  }
}

