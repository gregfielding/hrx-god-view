import { 
  collection, 
  doc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  query, 
  where, 
  orderBy, 
  limit,
  Timestamp,
  writeBatch
} from 'firebase/firestore';

import { db } from '../firebase';

export interface EmailLog {
  id?: string;
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  timestamp: Date;
  bodySnippet: string;
  bodyHtml?: string;
  direction: 'inbound' | 'outbound';
  contactId?: string;
  companyId?: string;
  dealId?: string;
  userId: string;
  isDraft?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: {
    headers: Array<{
      name: string;
      value: string;
    }>;
    body?: {
      data?: string;
    };
    parts?: Array<{
      mimeType: string;
      body: {
        data?: string;
      };
    }>;
  };
  internalDate: string;
}

export class EmailService {
  private static readonly EMAIL_LOGS_COLLECTION = 'email_logs';

  /**
   * Load emails for a specific deal
   */
  static async loadEmailsForDeal(tenantId: string, dealId: string): Promise<EmailLog[]> {
    try {
      const emailsRef = collection(db, 'tenants', tenantId, this.EMAIL_LOGS_COLLECTION);
      const q = query(
        emailsRef,
        where('dealId', '==', dealId),
        orderBy('timestamp', 'desc')
      );
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate() || new Date(),
        createdAt: doc.data().createdAt?.toDate() || new Date(),
        updatedAt: doc.data().updatedAt?.toDate() || new Date()
      })) as EmailLog[];
    } catch (error) {
      console.error('Error loading emails for deal:', error);
      throw error;
    }
  }

  /**
   * Load emails for a specific contact
   */
  static async loadEmailsForContact(tenantId: string, contactId: string): Promise<EmailLog[]> {
    try {
      const emailsRef = collection(db, 'tenants', tenantId, this.EMAIL_LOGS_COLLECTION);
      const q = query(
        emailsRef,
        where('contactId', '==', contactId),
        orderBy('timestamp', 'desc')
      );
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate() || new Date(),
        createdAt: doc.data().createdAt?.toDate() || new Date(),
        updatedAt: doc.data().updatedAt?.toDate() || new Date()
      })) as EmailLog[];
    } catch (error) {
      console.error('Error loading emails for contact:', error);
      throw error;
    }
  }

  /**
   * Save email log to Firestore
   */
  static async saveEmailLog(tenantId: string, emailLog: Omit<EmailLog, 'id'>): Promise<string> {
    try {
      const emailsRef = collection(db, 'tenants', tenantId, this.EMAIL_LOGS_COLLECTION);
      const docRef = await addDoc(emailsRef, {
        ...emailLog,
        timestamp: Timestamp.fromDate(emailLog.timestamp),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });
      
      return docRef.id;
    } catch (error) {
      console.error('Error saving email log:', error);
      throw error;
    }
  }

  /**
   * Save multiple email logs in a batch
   */
  static async saveEmailLogsBatch(tenantId: string, emailLogs: Omit<EmailLog, 'id'>[]): Promise<void> {
    try {
      const batch = writeBatch(db);
      const emailsRef = collection(db, 'tenants', tenantId, this.EMAIL_LOGS_COLLECTION);
      
      emailLogs.forEach(emailLog => {
        const docRef = doc(emailsRef);
        batch.set(docRef, {
          ...emailLog,
          timestamp: Timestamp.fromDate(emailLog.timestamp),
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });
      });
      
      await batch.commit();
    } catch (error) {
      console.error('Error saving email logs batch:', error);
      throw error;
    }
  }

  /**
   * Update an existing email log
   */
  static async updateEmailLog(tenantId: string, emailId: string, updates: Partial<EmailLog>): Promise<void> {
    try {
      const emailRef = doc(db, 'tenants', tenantId, this.EMAIL_LOGS_COLLECTION, emailId);
      await updateDoc(emailRef, {
        ...updates,
        updatedAt: Timestamp.now()
      });
    } catch (error) {
      console.error('Error updating email log:', error);
      throw error;
    }
  }

  /**
   * Check if email already exists in database
   */
  static async emailExists(tenantId: string, messageId: string): Promise<boolean> {
    try {
      const emailsRef = collection(db, 'tenants', tenantId, this.EMAIL_LOGS_COLLECTION);
      const q = query(emailsRef, where('messageId', '==', messageId));
      const snapshot = await getDocs(q);
      return !snapshot.empty;
    } catch (error) {
      console.error('Error checking if email exists:', error);
      return false;
    }
  }

  /**
   * Find contacts by email addresses
   */
  static async findContactsByEmails(tenantId: string, emails: string[]): Promise<Map<string, any>> {
    try {
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      const contactMap = new Map<string, any>();
      
      // Query contacts by email addresses
      for (const email of emails) {
        const q = query(contactsRef, where('email', '==', email));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          const contact = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
          contactMap.set(email, contact);
        }
      }
      
      return contactMap;
    } catch (error) {
      console.error('Error finding contacts by emails:', error);
      return new Map();
    }
  }

  /**
   * Find the most relevant deal for a contact
   */
  static async findRelevantDeal(tenantId: string, contactId: string): Promise<string | null> {
    try {
      const dealsRef = collection(db, 'tenants', tenantId, 'crm_deals');
      const q = query(
        dealsRef,
        where('associations.contacts', 'array-contains', contactId),
        orderBy('updatedAt', 'desc'),
        limit(1)
      );
      
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        return snapshot.docs[0].id;
      }
      
      return null;
    } catch (error) {
      console.error('Error finding relevant deal:', error);
      return null;
    }
  }

  /**
   * Parse Gmail message and extract relevant data
   */
  static parseGmailMessage(message: GmailMessage, userId: string): Partial<EmailLog> {
    const headers = message.payload.headers;
    const getHeader = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
    
    const from = getHeader('from');
    const to = getHeader('to').split(',').map(email => email.trim());
    const cc = getHeader('cc').split(',').filter(email => email.trim()).map(email => email.trim());
    const bcc = getHeader('bcc').split(',').filter(email => email.trim()).map(email => email.trim());
    const subject = getHeader('subject');
    
    // Extract email body
    let bodySnippet = message.snippet;
    let bodyHtml = '';
    
    if (message.payload.body?.data) {
      bodySnippet = atob(message.payload.body.data);
    } else if (message.payload.parts) {
      for (const part of message.payload.parts) {
        if (part.mimeType === 'text/html' && part.body.data) {
          bodyHtml = atob(part.body.data);
        } else if (part.mimeType === 'text/plain' && part.body.data) {
          bodySnippet = atob(part.body.data);
        }
      }
    }
    
    // Determine direction based on user's email
    const userEmail = ''; // TODO: Get from user profile
    const direction: 'inbound' | 'outbound' = from.includes(userEmail) ? 'outbound' : 'inbound';
    
    return {
      messageId: message.id,
      threadId: message.threadId,
      subject,
      from,
      to,
      cc,
      bcc,
      timestamp: new Date(parseInt(message.internalDate)),
      bodySnippet: bodySnippet.substring(0, 250),
      bodyHtml,
      direction,
      userId,
      isDraft: message.labelIds.includes('DRAFT')
    };
  }

  /**
   * Sync emails from Gmail API
   */
  static async syncEmailsFromGmail(tenantId: string, userId: string): Promise<number> {
    try {
      // TODO: Implement Gmail API integration
      // This would involve:
      // 1. Getting Gmail API access token for the user
      // 2. Fetching recent messages from Gmail API
      // 3. Parsing messages and finding associations
      // 4. Saving to Firestore
      
      console.log('Gmail sync not yet implemented');
      return 0;
    } catch (error) {
      console.error('Error syncing emails from Gmail:', error);
      throw error;
    }
  }
}

export default EmailService;
