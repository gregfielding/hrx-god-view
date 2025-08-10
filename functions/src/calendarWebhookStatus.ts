import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

/**
 * Get calendar webhook status for a user
 */
export const getCalendarWebhookStatus = onRequest({
  cors: true
}, async (req, res) => {
  try {
    const { userId, tenantId } = req.query;

    if (!userId || !tenantId) {
      res.status(400).json({ error: 'Missing userId or tenantId' });
      return;
    }

    // Get the watch record
    const watchDoc = await db.collection('tenants').doc(tenantId as string).collection('calendarWatches').doc(userId as string).get();
    
    if (!watchDoc.exists) {
      res.json({
        success: true,
        status: {
          active: false
        }
      });
      return;
    }

    const watchData = watchDoc.data();
    
    // Check if the watch is still active and not expired
    const isActive = watchData?.active && watchData?.expiration;
    const isExpired = watchData?.expiration ? new Date(watchData.expiration) < new Date() : false;

    // Get some basic statistics
    const activitiesSnapshot = await db.collection('tenants').doc(tenantId as string).collection('activities')
      .where('source', '==', 'calendar_webhook')
      .where('createdAt', '>=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) // Last 7 days
      .get();

    const eventsProcessed = activitiesSnapshot.size;
    let contactsMatched = 0;

    activitiesSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.matchedContacts && data.matchedContacts.length > 0) {
        contactsMatched += data.matchedContacts.length;
      }
    });

    res.json({
      success: true,
      status: {
        active: isActive && !isExpired,
        watchId: watchData?.channelId,
        expiration: watchData?.expiration,
        lastSync: watchData?.createdAt?.toDate?.() || watchData?.createdAt,
        eventsProcessed,
        contactsMatched,
        error: isExpired ? 'Webhook has expired' : undefined
      }
    });

  } catch (error: any) {
    console.error('Error getting webhook status:', error);
    res.status(500).json({ error: error.message });
  }
});
