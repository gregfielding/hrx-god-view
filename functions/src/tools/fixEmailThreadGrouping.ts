/**
 * Fix Email Thread Grouping
 * 
 * Migration script to fix incorrectly grouped email threads.
 * Splits threads that contain messages with different Gmail threadIds.
 */

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const DEFAULT_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD'; // C1 Staffing tenant ID

interface EmailMessage {
  id: string;
  gmailMessageId?: string;
  threadId: string;
  [key: string]: any;
}

interface EmailThread {
  id: string;
  gmailThreadId?: string;
  subject: string;
  participants: string[];
  [key: string]: any;
}

/**
 * Fix email thread grouping for a specific tenant
 */
export async function fixEmailThreadGroupingForTenant(tenantId: string): Promise<void> {
  console.log(`Starting email thread grouping fix for tenant ${tenantId}...`);

  // Get all email threads
  const threadsSnapshot = await db
    .collection('tenants')
    .doc(tenantId)
    .collection('emailThreads')
    .where('status', '==', 'active')
    .get();

  console.log(`Found ${threadsSnapshot.size} active email threads to check`);

  let threadsFixed = 0;
  let threadsSkipped = 0;
  let messagesMoved = 0;

  for (const threadDoc of threadsSnapshot.docs) {
    const thread = { id: threadDoc.id, ...threadDoc.data() } as EmailThread;

    // For threads with Gmail threadId, verify all messages belong to that thread
    // For threads without Gmail threadId, group messages by their Gmail threadIds

    // Get all messages in this thread
    const messagesSnapshot = await threadDoc.ref
      .collection('messages')
      .get();

    if (messagesSnapshot.empty || messagesSnapshot.size <= 1) {
      threadsSkipped++;
      continue;
    }

    // Group messages by their Gmail messageId's threadId
    // We need to fetch the Gmail threadId for each message
    const messageGroups = new Map<string, EmailMessage[]>();
    const messagesWithoutGmailId: EmailMessage[] = [];

    for (const msgDoc of messagesSnapshot.docs) {
      const message = { id: msgDoc.id, ...msgDoc.data() } as EmailMessage;

      // If message has gmailMessageId, we need to get its threadId from email_logs
      if (message.gmailMessageId) {
        try {
          // Look up the Gmail threadId from email_logs
          const emailLogQuery = await db
            .collection('tenants')
            .doc(tenantId)
            .collection('email_logs')
            .where('messageId', '==', message.gmailMessageId)
            .limit(1)
            .get();

          if (!emailLogQuery.empty) {
            const emailLog = emailLogQuery.docs[0].data();
            const gmailThreadId = emailLog.threadId as string;

            if (gmailThreadId) {
              // If thread has a Gmail threadId, check if this message belongs to it
              if (thread.gmailThreadId && gmailThreadId !== thread.gmailThreadId) {
                // Message doesn't belong to this thread - add to wrong group
                if (!messageGroups.has('_wrong_thread')) {
                  messageGroups.set('_wrong_thread', []);
                }
                messageGroups.get('_wrong_thread')!.push(message);
              } else {
                // Group by Gmail threadId
                if (!messageGroups.has(gmailThreadId)) {
                  messageGroups.set(gmailThreadId, []);
                }
                messageGroups.get(gmailThreadId)!.push(message);
              }
            } else {
              // No threadId in email_logs - keep in original thread
              messagesWithoutGmailId.push(message);
            }
          } else {
            // No email_log entry - keep in original thread
            messagesWithoutGmailId.push(message);
          }
        } catch (error) {
          console.error(`Error looking up Gmail threadId for message ${message.id}:`, error);
          messagesWithoutGmailId.push(message);
        }
      } else {
        // No gmailMessageId - keep in original thread
        messagesWithoutGmailId.push(message);
      }
    }

    // If we have multiple groups (different Gmail threadIds), or wrong messages in a thread with Gmail threadId, we need to split
    const hasWrongMessages = messageGroups.has('_wrong_thread');
    const validGroups = Array.from(messageGroups.entries()).filter(([key]) => key !== '_wrong_thread');
    
    if (messageGroups.size > 1 || (thread.gmailThreadId && hasWrongMessages)) {
      if (thread.gmailThreadId && hasWrongMessages) {
        console.log(`\nThread ${thread.id} has messages that don't belong to its Gmail threadId (${thread.gmailThreadId}) - fixing...`);
      } else {
        console.log(`\nThread ${thread.id} has ${messageGroups.size} different Gmail threadIds - splitting...`);
      }
      console.log(`  Subject: ${thread.subject}`);
      console.log(`  Total messages: ${messagesSnapshot.size}`);

      // Determine which group stays in the original thread
      let groupsArray: Array<[string, EmailMessage[]]>;
      let firstThreadId: string;
      let firstGroup: EmailMessage[];

      if (thread.gmailThreadId) {
        // Thread has Gmail threadId - keep messages that match it
        const correctGroup = messageGroups.get(thread.gmailThreadId);
        if (correctGroup) {
          firstThreadId = thread.gmailThreadId;
          firstGroup = correctGroup;
          groupsArray = validGroups.filter(([id]) => id !== thread.gmailThreadId);
          if (hasWrongMessages) {
            groupsArray.push(['_wrong_thread', messageGroups.get('_wrong_thread')!]);
          }
        } else {
          // No messages match the thread's Gmail threadId - use first valid group
          groupsArray = validGroups.length > 0 ? validGroups : Array.from(messageGroups.entries());
          [firstThreadId, firstGroup] = groupsArray[0];
          groupsArray = groupsArray.slice(1);
        }
      } else {
        // No Gmail threadId - keep the first group
        groupsArray = validGroups.length > 0 ? validGroups : Array.from(messageGroups.entries());
        [firstThreadId, firstGroup] = groupsArray[0];
        groupsArray = groupsArray.slice(1);
      }

      // Update original thread with first group's Gmail threadId (if it didn't have one)
      if (!thread.gmailThreadId) {
        await threadDoc.ref.update({
          gmailThreadId: firstThreadId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      console.log(`  Keeping ${firstGroup.length} messages in original thread ${thread.id} (Gmail threadId: ${firstThreadId})`);

      // Create new threads for other groups
      for (const [gmailThreadId, messages] of groupsArray) {
        // Skip the wrong_thread marker - we'll handle those separately
        if (gmailThreadId === '_wrong_thread') {
          // These messages need to be moved to their correct threads
          for (const message of messages) {
            // Look up the correct threadId for this message
            try {
              const emailLogQuery = await db
                .collection('tenants')
                .doc(tenantId)
                .collection('email_logs')
                .where('messageId', '==', message.gmailMessageId)
                .limit(1)
                .get();

              if (!emailLogQuery.empty) {
                const emailLog = emailLogQuery.docs[0].data();
                const correctGmailThreadId = emailLog.threadId as string;

                if (correctGmailThreadId) {
                  // Find or create thread with this Gmail threadId
                  const correctThreadQuery = await db
                    .collection('tenants')
                    .doc(tenantId)
                    .collection('emailThreads')
                    .where('gmailThreadId', '==', correctGmailThreadId)
                    .limit(1)
                    .get();

                  if (!correctThreadQuery.empty) {
                    const correctThread = correctThreadQuery.docs[0];
                    const messageRef = threadDoc.ref.collection('messages').doc(message.id);
                    const messageData = await messageRef.get();
                    if (messageData.exists) {
                      await correctThread.ref.collection('messages').add(messageData.data()!);
                      await messageRef.delete();
                      messagesMoved++;
                      
                      // Update correct thread's message count
                      const correctThreadData = correctThread.data() as EmailThread;
                      await correctThread.ref.update({
                        messageCount: (correctThreadData.messageCount || 0) + 1,
                        lastMessageAt: message.createdAt || admin.firestore.FieldValue.serverTimestamp(),
                        lastMessageSnippet: message.bodySnippet || message.bodyPlain?.substring(0, 100) || '',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                      });
                    }
                  } else {
                    // Correct thread doesn't exist - create it
                    const messageRef = threadDoc.ref.collection('messages').doc(message.id);
                    const messageData = await messageRef.get();
                    if (messageData.exists) {
                      const msgData = messageData.data()!;
                      const newThreadRef = await db
                        .collection('tenants')
                        .doc(tenantId)
                        .collection('emailThreads')
                        .add({
                          tenantId,
                          gmailThreadId: correctGmailThreadId,
                          subject: thread.subject,
                          participants: thread.participants,
                          participantUserIds: thread.participantUserIds || [],
                          lastMessageAt: msgData.createdAt || admin.firestore.FieldValue.serverTimestamp(),
                          unreadCount: 0,
                          messageCount: 1,
                          status: 'active',
                          starred: false,
                          labels: thread.labels || [],
                          createdAt: admin.firestore.FieldValue.serverTimestamp(),
                          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        });

                      await newThreadRef.collection('messages').add(msgData);
                      await messageRef.delete();
                      messagesMoved++;
                      console.log(`    Created new thread ${newThreadRef.id} for message ${message.id}`);
                    }
                  }
                }
              }
            } catch (error) {
              console.error(`Error moving wrong message ${message.id}:`, error);
            }
          }
          continue;
        }

        // Check if a thread with this Gmail threadId already exists
        const existingThreadQuery = await db
          .collection('tenants')
          .doc(tenantId)
          .collection('emailThreads')
          .where('gmailThreadId', '==', gmailThreadId)
          .limit(1)
          .get();

        if (!existingThreadQuery.empty) {
          // Thread already exists - move messages there
          const existingThread = existingThreadQuery.docs[0];
          console.log(`  Moving ${messages.length} messages to existing thread ${existingThread.id} (Gmail threadId: ${gmailThreadId})`);

          for (const message of messages) {
            const messageRef = threadDoc.ref.collection('messages').doc(message.id);
            const messageData = await messageRef.get();
            if (messageData.exists) {
              // Copy message to new thread
              await existingThread.ref
                .collection('messages')
                .add(messageData.data()!);

              // Delete from old thread
              await messageRef.delete();
              messagesMoved++;
            }
          }

          // Update existing thread's message count and lastMessageAt
          const existingThreadData = existingThread.data() as EmailThread;
          const updatedMessageCount = (existingThreadData.messageCount || 0) + messages.length;
          const lastMessage = messages.sort((a, b) => {
            const aTime = a.createdAt?.toMillis() || 0;
            const bTime = b.createdAt?.toMillis() || 0;
            return bTime - aTime;
          })[0];

          await existingThread.ref.update({
            messageCount: updatedMessageCount,
            lastMessageAt: lastMessage.createdAt || admin.firestore.FieldValue.serverTimestamp(),
            lastMessageSnippet: lastMessage.bodySnippet || lastMessage.bodyPlain?.substring(0, 100) || '',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } else {
          // Create new thread
          const firstMessage = messages[0];
          const newThreadRef = await db
            .collection('tenants')
            .doc(tenantId)
            .collection('emailThreads')
            .add({
              tenantId,
              gmailThreadId,
              subject: thread.subject, // Use same subject for now
              participants: thread.participants, // Use same participants
              participantUserIds: thread.participantUserIds || [],
              lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
              unreadCount: 0,
              messageCount: messages.length,
              status: 'active',
              starred: false,
              labels: thread.labels || [],
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

          console.log(`  Created new thread ${newThreadRef.id} with ${messages.length} messages (Gmail threadId: ${gmailThreadId})`);

          // Move messages to new thread
          for (const message of messages) {
            const messageRef = threadDoc.ref.collection('messages').doc(message.id);
            const messageData = await messageRef.get();
            if (messageData.exists) {
              // Copy message to new thread
              await newThreadRef
                .collection('messages')
                .add(messageData.data()!);

              // Delete from old thread
              await messageRef.delete();
              messagesMoved++;
            }
          }

          // Update new thread with latest message info
          const lastMessage = messages.sort((a, b) => {
            const aTime = a.createdAt?.toMillis() || 0;
            const bTime = b.createdAt?.toMillis() || 0;
            return bTime - aTime;
          })[0];

          await newThreadRef.update({
            lastMessageAt: lastMessage.createdAt || admin.firestore.FieldValue.serverTimestamp(),
            lastMessageSnippet: lastMessage.bodySnippet || lastMessage.bodyPlain?.substring(0, 100) || '',
            lastMessageFrom: lastMessage.from,
            lastMessageFromUserId: lastMessage.fromUserId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }

      // Update original thread's message count
      const updatedMessageCount = firstGroup.length + messagesWithoutGmailId.length;
      await threadDoc.ref.update({
        messageCount: updatedMessageCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      threadsFixed++;
    } else {
      threadsSkipped++;
    }
  }

  console.log(`\n=== Migration Complete ===`);
  console.log(`Threads fixed: ${threadsFixed}`);
  console.log(`Threads skipped: ${threadsSkipped}`);
  console.log(`Messages moved: ${messagesMoved}`);
}

// Run if called directly
if (require.main === module) {
  const tenantId = process.argv[2] || DEFAULT_TENANT_ID;

  fixEmailThreadGroupingForTenant(tenantId)
    .then(() => {
      console.log('Email thread grouping fix complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Email thread grouping fix ERROR', err);
      process.exit(1);
    });
}

