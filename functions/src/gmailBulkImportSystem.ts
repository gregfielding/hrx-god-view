import { onCall } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFirestore } from 'firebase-admin/firestore';
import { google } from 'googleapis';
import * as admin from 'firebase-admin';
import { defineString } from 'firebase-functions/params';

const db = getFirestore();

const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
const redirectUri = defineString('GOOGLE_REDIRECT_URI');

const oauth2Client = new google.auth.OAuth2(
  clientId.value(),
  clientSecret.value(),
  redirectUri.value()
);

/**
 * Initiates a bulk Gmail import for all users in a tenant
 * This function creates background tasks to process users in batches
 */
export const initiateBulkGmailImport = onCall({
  cors: true,
  maxInstances: 1,
  region: 'us-central1',
  timeoutSeconds: 300
}, async (request) => {
  try {
    const { tenantId, daysBack = 90 } = request.data;
    
    if (!tenantId) {
      throw new Error('Missing required field: tenantId');
    }
    
    console.log(`🚀 Initiating bulk Gmail import for tenant ${tenantId}, last ${daysBack} days`);
    
    // Get all users in this tenant with Gmail connected
    const usersSnapshot = await db.collection('users')
      .where('gmailConnected', '==', true)
      .get();
    
    if (usersSnapshot.empty) {
      return {
        success: true,
        message: 'No users with Gmail connected found in this tenant',
        totalUsers: 0,
        tasksCreated: 0,
        headers: {
          'Access-Control-Allow-Origin': 'https://hrxone.com',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      };
    }
    
    const users = usersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as any));
    
    // Filter users that belong to this tenant
    const tenantUsers = users.filter((user: any) => {
      const userTenantId = user.tenantId || user.defaultTenantId;
      return userTenantId === tenantId;
    });
    
    console.log(`👥 Found ${tenantUsers.length} users with Gmail connected in tenant ${tenantId}`);
    
    // Create a job record to track progress
    const jobId = `bulk_import_${tenantId}_${Date.now()}`;
    const jobRef = db.collection('gmail_import_jobs').doc(jobId);
    
    await jobRef.set({
      tenantId,
      daysBack,
      totalUsers: tenantUsers.length,
      processedUsers: 0,
      totalEmails: 0,
      processedEmails: 0,
      duplicatesSkipped: 0,
      status: 'initializing',
      createdAt: new Date(),
      updatedAt: new Date(),
      userResults: []
    });
    
    // Create background tasks for each user (process 2 users at a time)
    const batchSize = 2;
    const tasks = [];
    
    for (let i = 0; i < tenantUsers.length; i += batchSize) {
      const userBatch = tenantUsers.slice(i, i + batchSize);
      
      for (const user of userBatch) {
        const task = {
          name: `process-user-${user.id}`,
          data: {
            jobId,
            tenantId,
            userId: user.id,
            userEmail: (user as any).email,
            daysBack
          }
        };
        tasks.push(task);
      }
    }
    
    console.log(`📋 Created ${tasks.length} background tasks for ${tenantUsers.length} users`);
    
    // Update job status
    await jobRef.update({
      status: 'processing',
      totalTasks: tasks.length,
      updatedAt: new Date()
    });
    
    return {
      success: true,
      message: `Bulk import initiated for ${tenantUsers.length} users`,
      jobId,
      totalUsers: tenantUsers.length,
      tasksCreated: tasks.length,
      headers: {
        'Access-Control-Allow-Origin': 'https://hrxone.com',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    };
    
  } catch (error) {
    console.error('❌ Error initiating bulk Gmail import:', error);
    return {
      success: false,
      message: `Failed to initiate bulk import: ${error instanceof Error ? error.message : 'Unknown error'}`,
      headers: {
        'Access-Control-Allow-Origin': 'https://hrxone.com',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    };
  }
});

/**
 * Background task to process a single user's emails
 */
export const processUserEmails = onTaskDispatched({
  retryConfig: {
    maxAttempts: 3,
    maxBackoffSeconds: 60
  },
  rateLimits: {
    maxConcurrentDispatches: 5
  }
}, async (request) => {
  const { jobId, tenantId, userId, userEmail, daysBack } = request.data;
  
  console.log(`📧 Processing emails for user ${userId} (${userEmail})`);
  
  try {
    // Get user's Gmail tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }
    
    const userData = userDoc.data();
    if (!userData?.gmailTokens?.access_token) {
      throw new Error('Gmail not connected for this user');
    }
    
    // Set up Gmail API
    oauth2Client.setCredentials(userData.gmailTokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // Test token validity
    try {
      const testResponse = await gmail.users.getProfile({ userId: 'me' });
      console.log(`✅ Gmail API access confirmed for ${testResponse.data.emailAddress}`);
    } catch (tokenError) {
      console.error(`❌ Gmail token validation failed for user ${userId}:`, tokenError);
      throw new Error('Gmail access has expired for this user');
    }
    
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    
    console.log(`📅 Importing emails from ${startDate.toISOString()} to ${endDate.toISOString()} for user ${userId}`);
    
    // Get all contacts for this tenant
    const contactsSnapshot = await db.collection('tenants').doc(tenantId).collection('crm_contacts').get();
    const contacts = contactsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
    
    let processedCount = 0;
    let activityLogsCreated = 0;
    let duplicatesSkipped = 0;
    let pageToken: string | undefined;
    
    // Process emails in batches (Gmail API pagination)
    do {
      const query = `in:sent after:${Math.floor(startDate.getTime() / 1000)} before:${Math.floor(endDate.getTime() / 1000)}`;
      
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100,
        pageToken
      });
      
      const messages = response.data.messages || [];
      console.log(`📨 Processing batch of ${messages.length} emails for user ${userId}`);
      
      // Process each email in this batch
      for (const message of messages) {
        try {
          // Check for existing email log
          const existingEmailLog = await db.collection('tenants').doc(tenantId)
            .collection('email_logs')
            .where('gmailMessageId', '==', message.id)
            .limit(1)
            .get();
          
          if (!existingEmailLog.empty) {
            console.log(`⏭️ Skipping duplicate email ${message.id}`);
            duplicatesSkipped++;
            continue;
          }
          
          // Get full message details
          const messageDetails = await gmail.users.messages.get({
            userId: 'me',
            id: message.id!
          });
          
          const emailData = messageDetails.data;
          const headers = emailData.payload?.headers || [];
          
          // Extract email details
          const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
          const to = headers.find(h => h.name === 'To')?.value || '';
          const from = headers.find(h => h.name === 'From')?.value || '';
          const date = headers.find(h => h.name === 'Date')?.value || '';
          
          // Extract email addresses from To field
          const emailAddresses = extractEmailAddresses(to);
          
          if (emailAddresses.length === 0) {
            console.log(`⚠️ No email addresses found in To field for message ${message.id}`);
            continue;
          }
          
          // Find matching contacts
          const matchingContacts = contacts.filter(contact => 
            emailAddresses.some(email => 
              contact.email?.toLowerCase() === email.toLowerCase()
            )
          );
          
          if (matchingContacts.length === 0) {
            console.log(`⚠️ No matching contacts found for email addresses: ${emailAddresses.join(', ')}`);
            continue;
          }
          
          // Create email log
          const emailLogData = {
            gmailMessageId: message.id,
            subject,
            to,
            from,
            date: new Date(date),
            processedAt: new Date(),
            userId,
            userEmail: userData.email,
            matchingContacts: matchingContacts.map(c => c.id),
            emailAddresses
          };
          
          await db.collection('tenants').doc(tenantId)
            .collection('email_logs')
            .add(emailLogData);
          
          // Create activity logs for each matching contact
          for (const contact of matchingContacts) {
            const activityLogData = {
              type: 'email',
              description: `Email sent: ${subject}`,
              timestamp: new Date(date),
              userId,
              userEmail: userData.email,
              contactId: contact.id,
              contactName: contact.fullName || contact.name,
              metadata: {
                gmailMessageId: message.id,
                subject,
                to,
                from
              }
            };
            
            await db.collection('tenants').doc(tenantId)
              .collection('activity_logs')
              .add(activityLogData);
            
            // Get all associated entities for comprehensive "filter up" functionality
            const associatedEntities = {
              companies: new Set<string>(),
              locations: new Set<string>(),
              deals: new Set<string>()
            };

            // Collect company associations
            if (contact.companyId) {
              associatedEntities.companies.add(contact.companyId);
            }
            if (contact.associations?.companies) {
              contact.associations.companies.forEach((company: any) => {
                const companyId = typeof company === 'string' ? company : company?.id;
                if (companyId) associatedEntities.companies.add(companyId);
              });
            }

            // Collect location associations
            if (contact.locationId) {
              associatedEntities.locations.add(contact.locationId);
            }
            if (contact.associations?.locations) {
              contact.associations.locations.forEach((location: any) => {
                const locationId = typeof location === 'string' ? location : location?.id;
                if (locationId) associatedEntities.locations.add(locationId);
              });
            }

            // Collect deal associations
            if (contact.associations?.deals) {
              contact.associations.deals.forEach((deal: any) => {
                const dealId = typeof deal === 'string' ? deal : deal?.id;
                if (dealId) associatedEntities.deals.add(dealId);
              });
            }

            // Update active salespeople for contact
            try {
              const contactDoc = await db.collection('tenants').doc(tenantId)
                .collection('crm_contacts')
                .doc(contact.id)
                .get();
              
              if (contactDoc.exists) {
                const contactData = contactDoc.data();
                const currentActiveSalespeople = contactData?.activeSalespeople || {};
                
                const updatedActiveSalespeople = {
                  ...currentActiveSalespeople,
                  [userId]: {
                    id: userId,
                    displayName: userData?.displayName || userData?.firstName || userData?.email || 'Unknown',
                    email: userData?.email || '',
                    lastActiveAt: new Date(date).getTime(),
                    _processedBy: 'gmail_bulk_import',
                    _processedAt: admin.firestore.FieldValue.serverTimestamp()
                  }
                };
                
                await db.collection('tenants').doc(tenantId)
                  .collection('crm_contacts')
                  .doc(contact.id)
                  .set({
                    activeSalespeople: updatedActiveSalespeople,
                    activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
                  }, { merge: true });
                
                console.log(`✅ Updated active salespeople for contact ${contact.id} to include user ${userId}`);
              }
            } catch (salespersonError) {
              console.warn(`Failed to update active salespeople for contact ${contact.id}:`, salespersonError);
            }

            // Update active salespeople for associated companies
            for (const companyId of associatedEntities.companies) {
              try {
                const companyDoc = await db.collection('tenants').doc(tenantId)
                  .collection('crm_companies')
                  .doc(companyId)
                  .get();
                
                if (companyDoc.exists) {
                  const companyData = companyDoc.data();
                  const currentActiveSalespeople = companyData?.activeSalespeople || {};
                  
                  const updatedActiveSalespeople = {
                    ...currentActiveSalespeople,
                    [userId]: {
                      id: userId,
                      displayName: userData?.displayName || userData?.firstName || userData?.email || 'Unknown',
                      email: userData?.email || '',
                      lastActiveAt: new Date(date).getTime(),
                      _processedBy: 'gmail_bulk_import',
                      _processedAt: admin.firestore.FieldValue.serverTimestamp()
                    }
                  };
                  
                  await db.collection('tenants').doc(tenantId)
                    .collection('crm_companies')
                    .doc(companyId)
                    .set({
                      activeSalespeople: updatedActiveSalespeople,
                      activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                  
                  console.log(`✅ Updated active salespeople for company ${companyId} to include user ${userId}`);
                }
              } catch (companyError) {
                console.warn(`Failed to update active salespeople for company ${companyId}:`, companyError);
              }
            }

            // Update active salespeople for associated locations
            for (const locationId of associatedEntities.locations) {
              try {
                const locationDoc = await db.collection('tenants').doc(tenantId)
                  .collection('crm_companies')
                  .doc(contact.companyId || '')
                  .collection('locations')
                  .doc(locationId)
                  .get();
                
                if (locationDoc.exists) {
                  const locationData = locationDoc.data();
                  const currentActiveSalespeople = locationData?.activeSalespeople || {};
                  
                  const updatedActiveSalespeople = {
                    ...currentActiveSalespeople,
                    [userId]: {
                      id: userId,
                      displayName: userData?.displayName || userData?.firstName || userData?.email || 'Unknown',
                      email: userData?.email || '',
                      lastActiveAt: new Date(date).getTime(),
                      _processedBy: 'gmail_bulk_import',
                      _processedAt: admin.firestore.FieldValue.serverTimestamp()
                    }
                  };
                  
                  await db.collection('tenants').doc(tenantId)
                    .collection('crm_companies')
                    .doc(contact.companyId || '')
                    .collection('locations')
                    .doc(locationId)
                    .set({
                      activeSalespeople: updatedActiveSalespeople,
                      activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                  
                  console.log(`✅ Updated active salespeople for location ${locationId} to include user ${userId}`);
                }
              } catch (locationError) {
                console.warn(`Failed to update active salespeople for location ${locationId}:`, locationError);
              }
            }

            // Update active salespeople for associated deals
            for (const dealId of associatedEntities.deals) {
              try {
                const dealDoc = await db.collection('tenants').doc(tenantId)
                  .collection('crm_deals')
                  .doc(dealId)
                  .get();
                
                if (dealDoc.exists) {
                  const dealData = dealDoc.data();
                  const currentActiveSalespeople = dealData?.activeSalespeople || {};
                  
                  const updatedActiveSalespeople = {
                    ...currentActiveSalespeople,
                    [userId]: {
                      id: userId,
                      displayName: userData?.displayName || userData?.firstName || userData?.email || 'Unknown',
                      email: userData?.email || '',
                      lastActiveAt: new Date(date).getTime(),
                      _processedBy: 'gmail_bulk_import',
                      _processedAt: admin.firestore.FieldValue.serverTimestamp()
                    }
                  };
                  
                  await db.collection('tenants').doc(tenantId)
                    .collection('crm_deals')
                    .doc(dealId)
                    .set({
                      activeSalespeople: updatedActiveSalespeople,
                      activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                  
                  console.log(`✅ Updated active salespeople for deal ${dealId} to include user ${userId}`);
                }
              } catch (dealError) {
                console.warn(`Failed to update active salespeople for deal ${dealId}:`, dealError);
              }
            }

            // Create email logs for all associated entities to enable "filter up" functionality
            const emailLogBase = {
              gmailMessageId: message.id,
              subject,
              to,
              from,
              date: new Date(date),
              processedAt: new Date(),
              userId,
              userEmail: userData.email,
              matchingContacts: [contact.id],
              emailAddresses: [contact.email]
            };

            // Create email log for contact (primary)
            const contactEmailLog = {
              ...emailLogBase,
              contactId: contact.id,
              companyId: contact.companyId
            };
            await db.collection('tenants').doc(tenantId)
              .collection('email_logs')
              .add(contactEmailLog);

            // Create email logs for associated companies
            for (const companyId of associatedEntities.companies) {
              const companyEmailLog = {
                ...emailLogBase,
                contactId: contact.id,
                companyId
              };
              await db.collection('tenants').doc(tenantId)
                .collection('email_logs')
                .add(companyEmailLog);
            }

            // Create email logs for associated locations
            for (const locationId of associatedEntities.locations) {
              const locationEmailLog = {
                ...emailLogBase,
                contactId: contact.id,
                companyId: contact.companyId,
                locationId
              };
              await db.collection('tenants').doc(tenantId)
                .collection('email_logs')
                .add(locationEmailLog);
            }

            // Create email logs for associated deals
            for (const dealId of associatedEntities.deals) {
              const dealEmailLog = {
                ...emailLogBase,
                contactId: contact.id,
                companyId: contact.companyId,
                dealId
              };
              await db.collection('tenants').doc(tenantId)
                .collection('email_logs')
                .add(dealEmailLog);
            }

            console.log(`✅ Created email logs for contact ${contact.id} and ${associatedEntities.companies.size} companies, ${associatedEntities.locations.size} locations, ${associatedEntities.deals.size} deals`);
            
            activityLogsCreated++;
          }
          
          processedCount++;
          
        } catch (emailError) {
          console.error(`❌ Error processing email ${message.id}:`, emailError);
          continue;
        }
      }
      
      pageToken = response.data.nextPageToken;
      
    } while (pageToken);
    
    // Update job progress
    const jobRef = db.collection('gmail_import_jobs').doc(jobId);
    await jobRef.update({
      processedUsers: admin.firestore.FieldValue.increment(1),
      processedEmails: admin.firestore.FieldValue.increment(processedCount),
      duplicatesSkipped: admin.firestore.FieldValue.increment(duplicatesSkipped),
      userResults: admin.firestore.FieldValue.arrayUnion({
        userId,
        userEmail,
        processedCount,
        activityLogsCreated,
        duplicatesSkipped,
        completedAt: new Date()
      }),
      updatedAt: new Date()
    });
    
    console.log(`✅ Completed processing for user ${userId}: ${processedCount} emails, ${activityLogsCreated} activities, ${duplicatesSkipped} duplicates`);
    
  } catch (error) {
    console.error(`❌ Error processing user ${userId}:`, error);
    
    // Update job with error
    const jobRef = db.collection('gmail_import_jobs').doc(jobId);
    await jobRef.update({
      userResults: admin.firestore.FieldValue.arrayUnion({
        userId,
        userEmail,
        error: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date()
      }),
      updatedAt: new Date()
    });
    
    throw error; // Retry the task
  }
});

/**
 * Get the status of a bulk import job
 */
export const getBulkImportStatus = onCall({
  cors: true,
  maxInstances: 10,
  region: 'us-central1'
}, async (request) => {
  try {
    const { jobId } = request.data;
    
    if (!jobId) {
      throw new Error('Missing required field: jobId');
    }
    
    const jobDoc = await db.collection('gmail_import_jobs').doc(jobId).get();
    
    if (!jobDoc.exists) {
      return {
        success: false,
        message: 'Job not found',
        headers: {
          'Access-Control-Allow-Origin': 'https://hrxone.com',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      };
    }
    
    const jobData = jobDoc.data();
    
    return {
      success: true,
      job: jobData,
      headers: {
        'Access-Control-Allow-Origin': 'https://hrxone.com',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    };
    
  } catch (error) {
    console.error('❌ Error getting bulk import status:', error);
    return {
      success: false,
      message: `Failed to get status: ${error instanceof Error ? error.message : 'Unknown error'}`,
      headers: {
        'Access-Control-Allow-Origin': 'https://hrxone.com',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    };
  }
});

/**
 * Helper function to extract email addresses from a string
 */
function extractEmailAddresses(text: string): string[] {
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const matches = text.match(emailRegex) || [];
  return matches.map(email => email.toLowerCase());
}
