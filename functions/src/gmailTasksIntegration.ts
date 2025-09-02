import { onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { google } from 'googleapis';
import { logAIAction } from './utils/aiLogging';

const db = getFirestore();

// Google OAuth configuration using Firebase Functions v2 params
const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
const redirectUri = defineString('GOOGLE_REDIRECT_URI');

// Gmail OAuth configuration
const getGmailOAuthConfig = () => {
  return {
    clientId: clientId.value(),
    clientSecret: clientSecret.value(),
    redirectUri: redirectUri.value()
  };
};

let oauth2Client: any = null;

const initializeOAuth2Client = () => {
  const config = getGmailOAuthConfig();
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    throw new Error('Gmail OAuth configuration is missing');
  }
  
  oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );
  
  return oauth2Client;
};

// Email analysis for task creation
interface EmailAnalysis {
  requiresFollowUp: boolean;
  followUpType: 'email' | 'phone_call' | 'meeting' | 'research';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  urgency: number; // 0-100
  suggestedFollowUpDate: string;
  contactId?: string;
  dealId?: string;
  companyId?: string;
  keyTopics: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  actionRequired: boolean;
}

// Analyze email content for task creation
const analyzeEmailForTask = async (emailData: any, tenantId: string): Promise<EmailAnalysis> => {
  const analysis: EmailAnalysis = {
    requiresFollowUp: false,
    followUpType: 'email',
    priority: 'medium',
    urgency: 50,
    suggestedFollowUpDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Default: 24 hours
    keyTopics: [],
    sentiment: 'neutral',
    actionRequired: false
  };

  const content = emailData.snippet || '';
  const subject = emailData.subject || '';
  const from = emailData.from || '';

  // Basic keyword analysis for follow-up detection
  const followUpKeywords = [
    'interested', 'proposal', 'quote', 'meeting', 'call', 'discuss',
    'opportunity', 'project', 'contract', 'partnership', 'collaboration',
    'demo', 'presentation', 'pricing', 'timeline', 'deadline'
  ];

  const urgentKeywords = [
    'urgent', 'asap', 'deadline', 'timeline', 'immediate', 'critical',
    'important', 'priority', 'expedite', 'rush'
  ];

  const positiveKeywords = [
    'interested', 'excited', 'great', 'excellent', 'perfect', 'love',
    'amazing', 'fantastic', 'wonderful', 'outstanding'
  ];

  const negativeKeywords = [
    'not interested', 'decline', 'reject', 'unfortunately', 'sorry',
    'cannot', 'unable', 'problem', 'issue', 'concern'
  ];

  // Analyze content for follow-up requirements
  const hasFollowUpKeywords = followUpKeywords.some(keyword => 
    content.toLowerCase().includes(keyword) || subject.toLowerCase().includes(keyword)
  );

  const hasUrgentKeywords = urgentKeywords.some(keyword => 
    content.toLowerCase().includes(keyword) || subject.toLowerCase().includes(keyword)
  );

  const hasPositiveSentiment = positiveKeywords.some(keyword => 
    content.toLowerCase().includes(keyword)
  );

  const hasNegativeSentiment = negativeKeywords.some(keyword => 
    content.toLowerCase().includes(keyword)
  );

  // Determine follow-up type
  if (content.toLowerCase().includes('meeting') || subject.toLowerCase().includes('meeting')) {
    analysis.followUpType = 'meeting';
  } else if (content.toLowerCase().includes('call') || subject.toLowerCase().includes('call')) {
    analysis.followUpType = 'phone_call';
  } else if (content.toLowerCase().includes('research') || content.toLowerCase().includes('information')) {
    analysis.followUpType = 'research';
  }

  // Set priority based on urgency keywords
  if (hasUrgentKeywords) {
    analysis.priority = 'urgent';
    analysis.urgency = 90;
    analysis.suggestedFollowUpDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours
  } else if (hasFollowUpKeywords) {
    analysis.priority = 'high';
    analysis.urgency = 75;
    analysis.suggestedFollowUpDate = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(); // 4 hours
  }

  // Set sentiment
  if (hasPositiveSentiment && !hasNegativeSentiment) {
    analysis.sentiment = 'positive';
  } else if (hasNegativeSentiment) {
    analysis.sentiment = 'negative';
  }

  // Determine if follow-up is required
  analysis.requiresFollowUp = hasFollowUpKeywords || hasUrgentKeywords;
  analysis.actionRequired = analysis.requiresFollowUp;

  // Extract key topics
  const topics = [...followUpKeywords, ...urgentKeywords].filter(keyword => 
    content.toLowerCase().includes(keyword) || subject.toLowerCase().includes(keyword)
  );
  analysis.keyTopics = topics;

  // Try to find associated contact
  try {
    const contactsSnapshot = await db.collection('tenants').doc(tenantId).collection('contacts')
      .where('email', '==', from)
      .limit(1)
      .get();

    if (!contactsSnapshot.empty) {
      const contact = contactsSnapshot.docs[0];
      analysis.contactId = contact.id;
      
      // Try to find associated deal
      const dealsSnapshot = await db.collection('tenants').doc(tenantId).collection('deals')
        .where('contactId', '==', contact.id)
        .limit(1)
        .get();

      if (!dealsSnapshot.empty) {
        analysis.dealId = dealsSnapshot.docs[0].id;
      }
    }
  } catch (error) {
    console.error('Error finding associated contact:', error);
  }

  return analysis;
};

// Create task from email analysis
const createTaskFromEmail = async (emailData: any, analysis: EmailAnalysis, tenantId: string, userId: string) => {
  const taskData = {
    title: `Follow up: ${emailData.subject || 'Email follow-up'}`,
    description: `Follow-up required for email from ${emailData.from}. ${analysis.keyTopics.length > 0 ? `Topics: ${analysis.keyTopics.join(', ')}` : ''}`,
    type: analysis.followUpType,
    priority: analysis.priority,
    status: 'upcoming' as const,
    scheduledDate: analysis.suggestedFollowUpDate,
    assignedTo: userId,
    createdBy: userId,
    associations: {
      contacts: analysis.contactId ? [analysis.contactId] : [],
      deals: analysis.dealId ? [analysis.dealId] : [],
      companies: analysis.companyId ? [analysis.companyId] : []
    },
    aiGenerated: true,
    aiSuggested: true,
    aiReason: `Email analysis detected ${analysis.followUpType} follow-up required`,
    aiConfidence: analysis.urgency,
    communicationDetails: {
      method: analysis.followUpType,
      recipient: emailData.from,
      subject: `Re: ${emailData.subject || 'Follow-up'}`,
      draftContent: `Hi ${emailData.from.split('@')[0]},\n\nThank you for your email. ${analysis.sentiment === 'positive' ? 'I appreciate your interest.' : 'I understand your concerns.'}\n\nI'd like to follow up on this. When would be a good time to discuss this further?\n\nBest regards`
    },
    tenantId,
    tags: ['email-follow-up', 'auto-generated'],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  // Create task using existing task engine
  const createTaskFn = require('./taskEngine').createTask;
  return await createTaskFn({ data: taskData });
};

// Sync Gmail emails and create tasks
export const syncGmailAndCreateTasks = onCall({
  maxInstances: 3,
  timeoutSeconds: 300
}, async (request) => {
  if (!request.auth) {
    throw new Error('User must be authenticated');
  }

  const { tenantId, userId } = request.data;
  if (!tenantId || !userId) {
    throw new Error('Tenant ID and User ID are required');
  }

  try {
    // Get Gmail config
    const configDoc = await db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail').get();
    if (!configDoc.exists) {
      throw new Error('Gmail integration not configured');
    }

    const config = configDoc.data() as any;
    if (!config || !config.enabled || !config.accessToken) {
      throw new Error('Gmail integration not enabled or not authenticated');
    }

    // Initialize OAuth2 client
    const oauth2Client = initializeOAuth2Client();
    oauth2Client.setCredentials({
      access_token: config.accessToken,
      refresh_token: config.refreshToken
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get recent emails (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const query = `after:${Math.floor(oneDayAgo.getTime() / 1000)}`;

    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 50,
      q: query
    });

    const messages = response.data.messages || [];
    let tasksCreated = 0;
    let emailsAnalyzed = 0;

    // Process each email
    for (const message of messages) {
      try {
        const email = await gmail.users.messages.get({
          userId: 'me',
          id: message.id || ''
        });

        // Extract email data
        const emailData = {
          id: message.id,
          subject: email.data.payload?.headers?.find((h: any) => h.name === 'Subject')?.value || '',
          from: email.data.payload?.headers?.find((h: any) => h.name === 'From')?.value || '',
          to: email.data.payload?.headers?.find((h: any) => h.name === 'To')?.value || '',
          snippet: email.data.snippet || '',
          internalDate: email.data.internalDate
        };

        // Analyze email for task creation
        const analysis = await analyzeEmailForTask(emailData, tenantId);
        emailsAnalyzed++;

        // Create task if follow-up is required
        if (analysis.requiresFollowUp) {
          await createTaskFromEmail(emailData, analysis, tenantId, userId);
          tasksCreated++;
        }

        // Log AI action
        await logAIAction({
          eventType: 'email.analyzed',
          targetType: 'email',
          targetId: message.id || '',
          reason: 'Email analysis for task creation',
          contextType: 'email_content',
          aiTags: ['email_analysis', 'task_creation'],
          urgencyScore: analysis.urgency,
          inputPrompt: `Analyze email: ${emailData.subject}`,
          composedPrompt: `Analyze email content for follow-up requirements`,
          aiResponse: JSON.stringify(analysis),
          success: true,
          tenantId,
          userId: request.auth.uid,
          associations: {
            contacts: analysis.contactId ? [analysis.contactId] : [],
            deals: analysis.dealId ? [analysis.dealId] : []
          }
        });

      } catch (error) {
        console.error(`Error processing email ${message.id}:`, error);
      }
    }

    return {
      success: true,
      emailsAnalyzed,
      tasksCreated,
      message: `Analyzed ${emailsAnalyzed} emails, created ${tasksCreated} tasks`
    };

  } catch (error) {
    console.error('Error syncing Gmail and creating tasks:', error);
    throw new Error('Failed to sync Gmail and create tasks');
  }
});

// Sync Gmail calendar events as tasks
export const syncGmailCalendarAsTasks = onCall({
  cors: true
}, async (request) => {
  if (!request.auth) {
    throw new Error('User must be authenticated');
  }

  const { tenantId, userId } = request.data;
  if (!tenantId || !userId) {
    throw new Error('Tenant ID and User ID are required');
  }

  try {
    // Get Gmail config
    const configDoc = await db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail').get();
    if (!configDoc.exists) {
      throw new Error('Gmail integration not configured');
    }

    const config = configDoc.data() as any;
    if (!config || !config.enabled || !config.accessToken) {
      throw new Error('Gmail integration not enabled or not authenticated');
    }

    // Initialize OAuth2 client
    const oauth2Client = initializeOAuth2Client();
    oauth2Client.setCredentials({
      access_token: config.accessToken,
      refresh_token: config.refreshToken
    });

    // Get calendar events (next 7 days)
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const now = new Date();
    const oneWeekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: oneWeekLater.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });

    const events = response.data.items || [];
    let tasksCreated = 0;

    // Process each calendar event
    for (const event of events) {
      try {
        // Skip if already processed
        const existingTask = await db.collection('tenants').doc(tenantId).collection('tasks')
          .where('associations.calendarEventId', '==', event.id)
          .limit(1)
          .get();

        if (!existingTask.empty) {
          continue;
        }

        const startDate = event.start?.dateTime || event.start?.date;
        if (!startDate) continue;

        // Create task from calendar event
        const taskData = {
          title: event.summary || 'Calendar Event',
          description: event.description || `Meeting scheduled for ${startDate}`,
          type: 'scheduled_meeting_virtual' as const,
          priority: 'medium' as const,
          status: 'upcoming' as const,
          scheduledDate: startDate,
          assignedTo: userId,
          createdBy: userId,
          associations: {
            calendarEventId: event.id,
            contacts: event.attendees?.map((a: any) => a.email) || []
          },
          aiGenerated: true,
          aiSuggested: true,
          aiReason: 'Calendar event sync',
          aiConfidence: 80,
          locationDetails: {
            isVirtual: event.hangoutLink ? true : false,
            meetingUrl: event.hangoutLink || undefined,
            address: event.location || undefined
          },
          tenantId,
          tags: ['calendar-sync', 'auto-generated'],
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Create task using existing task engine
        const createTaskFn = require('./taskEngine').createTask;
        await createTaskFn({ data: taskData });
        tasksCreated++;

      } catch (error) {
        console.error(`Error processing calendar event ${event.id}:`, error);
      }
    }

    return {
      success: true,
      eventsProcessed: events.length,
      tasksCreated,
      message: `Processed ${events.length} calendar events, created ${tasksCreated} tasks`
    };

  } catch (error) {
    console.error('Error syncing Gmail calendar as tasks:', error);
    throw new Error('Failed to sync Gmail calendar as tasks');
  }
});

// Auto-send email tasks via Gmail
export const sendEmailTaskViaGmail = onCall(async (request) => {
  if (!request.auth) {
    throw new Error('User must be authenticated');
  }

  const { taskId, tenantId } = request.data;
  if (!taskId || !tenantId) {
    throw new Error('Task ID and Tenant ID are required');
  }

  try {
    // Get task data
    const taskDoc = await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).get();
    if (!taskDoc.exists) {
      throw new Error('Task not found');
    }

    const task = taskDoc.data() as any;
    if (!task || task.type !== 'email') {
      throw new Error('Task is not an email task');
    }

    // Get Gmail config
    const configDoc = await db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail').get();
    if (!configDoc.exists) {
      throw new Error('Gmail integration not configured');
    }

    const config = configDoc.data() as any;
    if (!config || !config.enabled || !config.accessToken) {
      throw new Error('Gmail integration not enabled or not authenticated');
    }

    // Initialize OAuth2 client
    const oauth2Client = initializeOAuth2Client();
    oauth2Client.setCredentials({
      access_token: config.accessToken,
      refresh_token: config.refreshToken
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Prepare email content
    const to = task.communicationDetails?.recipient || '';
    const subject = task.communicationDetails?.subject || task.title;
    const body = task.communicationDetails?.draftContent || task.description;

    if (!to) {
      throw new Error('No recipient specified for email task');
    }

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

    // Update task status
    await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).update({
      status: 'completed',
      completedAt: new Date(),
      actionResult: `Email sent successfully. Message ID: ${response.data.id}`
    });

    // Log AI action
    await logAIAction({
      eventType: 'task.email_sent',
      targetType: 'task',
      targetId: taskId,
      reason: 'Email task sent via Gmail',
      contextType: 'email_send',
      aiTags: ['email_send', 'task_completion'],
      urgencyScore: 70,
      inputPrompt: `Send email: ${subject}`,
      composedPrompt: `Send email task via Gmail API`,
      aiResponse: `Email sent successfully to ${to}`,
      success: true,
      tenantId,
      userId: request.auth.uid,
      associations: task.associations
    });

    return {
      success: true,
      messageId: response.data.id,
      message: 'Email sent successfully'
    };

  } catch (error) {
    console.error('Error sending email task via Gmail:', error);
    throw new Error('Failed to send email task via Gmail');
  }
}); 