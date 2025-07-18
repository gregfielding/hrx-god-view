import * as admin from 'firebase-admin';

type RecipientType = 'hrx' | 'customer' | 'agency' | 'user';
type NotificationStatus = 'unread' | 'read' | 'actioned' | 'archived';

interface CreateNotificationOptions {
  recipientType: RecipientType;
  recipientId: string | null;
  type: string;
  message: string;
  actions?: string[];
  status?: NotificationStatus;
  relatedId?: string;
}

export async function createNotification({
  recipientType,
  recipientId,
  type,
  message,
  actions = [],
  status = 'unread',
  relatedId,
}: CreateNotificationOptions) {
  const db = admin.firestore();
  const doc = {
    recipientType,
    recipientId,
    type,
    message,
    actions,
    status,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(relatedId ? { relatedId } : {}),
  };
  await db.collection('notifications').add(doc);
} 