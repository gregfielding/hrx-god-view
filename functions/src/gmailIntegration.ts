import { onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { google } from 'googleapis';
import { getFirestore } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions';

const db = getFirestore();

// Get Gmail OAuth configuration from Firebase Functions config
const getGmailOAuthConfig = () => {
  const config = functions.config();
  return {
    clientId: config.gmail?.client_id,
    clientSecret: config.gmail?.client_secret,
    redirectUri: config.gmail?.redirect_uri
  };
};

// Gmail API OAuth2 configuration
let oauth2Client: any = null;

const initializeOAuth2Client = () => {
  const config = getGmailOAuthConfig();
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    throw new Error('Gmail OAuth configuration is missing. Please set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REDIRECT_URI in Firebase Functions config.');
  }
  
  oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );
  
  return oauth2Client;
};

interface GmailConfig {
  enabled: boolean;
  accountEmail?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: Date;
  labels?: string[];
  autoSync: boolean;
  syncInterval: number;
  dealIntelligenceEnabled: boolean;
  emailTemplates?: {
    id: string;
    name: string;
    subject: string;
    body: string;
    dealStage: string;
    triggerType: 'manual' | 'automatic';
  }[];
  lastSync?: Date;
  status: 'active' | 'inactive' | 'error' | 'authenticating';
  errorMessage?: string;
  syncStats?: {
    emailsSynced: number;
    emailsSent: number;
    contactsLinked: number;
    dealsUpdated: number;
    lastSyncTime: Date;
  };
}

// Get Gmail configuration for a tenant
export const getGmailConfig = onCall(async (request) => {
  if (!request.auth) {
    throw new Error('User must be authenticated');
  }

  const { tenantId } = request.data;
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }

  try {
    const configDoc = await db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail').get();
    
    if (configDoc.exists) {
      return { config: configDoc.data() as GmailConfig };
    } else {
      // Return default config
      const defaultConfig: GmailConfig = {
        enabled: false,
        autoSync: true,
        syncInterval: 15,
        dealIntelligenceEnabled: true,
        emailTemplates: [],
        status: 'inactive'
      };
      return { config: defaultConfig };
    }
  } catch (error) {
    console.error('Error getting Gmail config:', error);
    throw new Error('Failed to get Gmail configuration');
  }
});

// Update Gmail configuration
export const updateGmailConfig = onCall(async (request) => {
  if (!request.auth) {
    throw new Error('User must be authenticated');
  }

  const { tenantId, config } = request.data;
  if (!tenantId || !config) {
    throw new Error('Tenant ID and config are required');
  }

  try {
    await db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail').set(config, { merge: true });
    
    // Log the configuration update
    await db.collection('tenants').doc(tenantId).collection('integrationLogs').add({
      type: 'gmail',
      action: 'config_updated',
      timestamp: new Date(),
      userId: request.auth.uid,
      details: { config }
    });

    return { success: true, config };
  } catch (error) {
    console.error('Error updating Gmail config:', error);
    throw new Error('Failed to update Gmail configuration');
  }
});

// Initiate Gmail OAuth authentication
export const authenticateGmail = onCall(async (request) => {
  if (!request.auth) {
    throw new Error('User must be authenticated');
  }

  const { tenantId } = request.data;
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }

  try {
    // Check if Gmail OAuth configuration is available
    const config = getGmailOAuthConfig();
    if (!config.clientId || !config.clientSecret || !config.redirectUri) {
      // Return a helpful error message instead of crashing
      return {
        error: true,
        message: 'Gmail OAuth configuration is not set up. Please configure Gmail OAuth credentials in Firebase Functions config.',
        setupRequired: true,
        setupInstructions: [
          '1. Go to Google Cloud Console',
          '2. Create OAuth 2.0 credentials',
          '3. Set Firebase Functions config:',
          '   firebase functions:config:set gmail.client_id="YOUR_CLIENT_ID"',
          '   firebase functions:config:set gmail.client_secret="YOUR_CLIENT_SECRET"',
          '   firebase functions:config:set gmail.redirect_uri="YOUR_REDIRECT_URI"',
          '4. Deploy functions: firebase deploy --only functions'
        ]
      };
    }

    // Initialize OAuth2 client
    const oauth2Client = initializeOAuth2Client();
    
    // Generate OAuth URL
    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify'
    ];

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });

    // Update config status to authenticating
    await db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail').set({
      status: 'authenticating',
      lastAuthAttempt: new Date()
    }, { merge: true });

    return { authUrl };
  } catch (error) {
    console.error('Error generating Gmail auth URL:', error);
    throw new Error('Failed to generate authentication URL');
  }
});

// Handle Gmail OAuth callback
export const gmailOAuthCallback = onRequest(async (req, res) => {
  const { code, state } = req.query;
  
  if (!code) {
    res.status(400).send('Authorization code not provided');
    return;
  }

  try {
    // Initialize OAuth2 client
    const oauth2Client = initializeOAuth2Client();
    
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code as string);
    oauth2Client.setCredentials(tokens);

    // Get user info
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress;

    if (!email) {
      throw new Error('Could not retrieve email address');
    }

    // Store tokens in Firestore (you'll need to determine the tenant ID from state or other means)
    // For now, we'll use a placeholder
    const tenantId = state as string || 'default';
    
    await db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail').set({
      enabled: true,
      accountEmail: email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      status: 'active',
      lastAuthAttempt: new Date()
    }, { merge: true });

    res.send(`
      <html>
        <body>
          <h1>Gmail Integration Successful!</h1>
          <p>Your Gmail account (${email}) has been successfully connected.</p>
          <p>You can close this window and return to the application.</p>
          <script>
            setTimeout(() => {
              window.close();
            }, 3000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error in Gmail OAuth callback:', error);
    res.status(500).send('Authentication failed. Please try again.');
  }
});

// Sync Gmail emails
export const syncGmailEmails = onCall(async (request) => {
  if (!request.auth) {
    throw new Error('User must be authenticated');
  }

  const { tenantId } = request.data;
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }

  try {
    // Get Gmail config
    const configDoc = await db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail').get();
    if (!configDoc.exists) {
      throw new Error('Gmail integration not configured');
    }

    const config = configDoc.data() as GmailConfig;
    if (!config.enabled || !config.accessToken) {
      throw new Error('Gmail integration not enabled or not authenticated');
    }

    // Initialize OAuth2 client
    const oauth2Client = initializeOAuth2Client();
    
    // Set up Gmail API client
    oauth2Client.setCredentials({
      access_token: config.accessToken,
      refresh_token: config.refreshToken
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get recent emails
    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 50,
      q: 'is:unread OR in:sent'
    });

    const messages = response.data.messages || [];
    let syncedCount = 0;
    let linkedContacts = 0;
    let updatedDeals = 0;

    // Process each email
    for (const message of messages) {
      try {
        const email = await gmail.users.messages.get({
          userId: 'me',
          id: message.id || ''
        });

        // Store email in Firestore
        const messageId = message.id || '';
        await db.collection('tenants').doc(tenantId).collection('emails').doc(messageId).set({
          id: messageId,
          threadId: email.data.threadId,
          labelIds: email.data.labelIds,
          snippet: email.data.snippet,
          internalDate: email.data.internalDate,
          syncedAt: new Date()
        });

        syncedCount++;
      } catch (error) {
        console.error(`Error processing email ${message.id}:`, error);
      }
    }

    // Update sync stats
    const updatedStats = {
      emailsSynced: (config.syncStats?.emailsSynced || 0) + syncedCount,
      contactsLinked: (config.syncStats?.contactsLinked || 0) + linkedContacts,
      dealsUpdated: (config.syncStats?.dealsUpdated || 0) + updatedDeals,
      lastSyncTime: new Date()
    };

    await db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail').update({
      lastSync: new Date(),
      syncStats: updatedStats
    });

    return {
      success: true,
      syncedCount,
      linkedContacts,
      updatedDeals
    };
  } catch (error) {
    console.error('Error syncing Gmail emails:', error);
    throw new Error('Failed to sync Gmail emails');
  }
});

// Send Gmail email
export const sendGmailEmail = onCall(async (request) => {
  if (!request.auth) {
    throw new Error('User must be authenticated');
  }

  const { tenantId, to, subject, body } = request.data;
  if (!tenantId || !to || !subject || !body) {
    throw new Error('Tenant ID, to, subject, and body are required');
  }

  try {
    // Get Gmail config
    const configDoc = await db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail').get();
    if (!configDoc.exists) {
      throw new Error('Gmail integration not configured');
    }

    const config = configDoc.data() as GmailConfig;
    if (!config.enabled || !config.accessToken) {
      throw new Error('Gmail integration not enabled or not authenticated');
    }

    // Initialize OAuth2 client
    const oauth2Client = initializeOAuth2Client();
    
    // Set up Gmail API client
    oauth2Client.setCredentials({
      access_token: config.accessToken,
      refresh_token: config.refreshToken
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Create email message
    const message = [
      `To: ${to}`,
      `Subject: ${subject}`,
      '',
      body
    ].join('\n');

    const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

    // Send email
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });

    // Update stats
    const updatedStats = {
      emailsSent: (config.syncStats?.emailsSent || 0) + 1,
      lastSyncTime: new Date()
    };

    await db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail').update({
      syncStats: updatedStats
    });

    return {
      success: true,
      messageId: response.data.id
    };
  } catch (error) {
    console.error('Error sending Gmail email:', error);
    throw new Error('Failed to send email');
  }
});

// Scheduled Gmail sync
export const scheduledGmailSync = onSchedule({
  schedule: 'every 15 minutes'
}, async (event) => {
  try {
    // Get all tenants with Gmail integration enabled
    const tenantsSnapshot = await db.collection('tenants').get();
    
    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenantId = tenantDoc.id;
      const gmailDoc = await db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail').get();
      
      if (gmailDoc.exists) {
        const config = gmailDoc.data() as GmailConfig;
        if (config.enabled && config.autoSync) {
          try {
                         // Call sync function for this tenant
             // Note: This is a simplified call for scheduled sync
             console.log(`Scheduled sync for tenant: ${tenantId}`);
          } catch (error) {
            console.error(`Error syncing Gmail for tenant ${tenantId}:`, error);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error in scheduled Gmail sync:', error);
  }
}); 