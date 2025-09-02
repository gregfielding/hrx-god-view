import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { createEvent } from '../utils/events';
import type { Event } from '../types/recruiter.types';

const db = getFirestore();

/**
 * Triggers when a CRM deal is updated and ready for recruiter handoff
 * Monitors for stage = Closed-Won AND readyForRecruiter = true
 */
export const onOpportunityHandoff = onDocumentUpdated(
  'tenants/{tenantId}/crm_deals/{dealId}',
  async (event) => {
    try {
      const beforeData = event.data?.before.data();
      const afterData = event.data?.after.data();
      
      if (!beforeData || !afterData) {
        console.log('No data available for handoff trigger');
        return;
      }

      const tenantId = event.params.tenantId;
      const dealId = event.params.dealId;

      // Check if handoff conditions are met
      const isHandoffReady = afterData.stage === 'Closed-Won' && 
                           afterData.readyForRecruiter === true;

      // Check if this is a new handoff (wasn't ready before)
      const wasHandoffReady = beforeData.stage === 'Closed-Won' && 
                            beforeData.readyForRecruiter === true;

      if (isHandoffReady && !wasHandoffReady) {
        console.log(`Handoff triggered for deal ${dealId} in tenant ${tenantId}`);

        // Create handoff requested event
        const handoffEvent: Omit<Event, 'createdAt' | 'updatedAt' | 'processed' | 'retryCount' | 'processedAt'> = {
          type: 'crm.handoff.requested',
          tenantId,
          entityType: 'crm_deal',
          entityId: dealId,
          source: 'crm',
          dedupeKey: `handoff:${dealId}`,
          createdBy: 'system',
          updatedBy: 'system',
          searchKeywords: ['handoff', 'crm', 'deal', dealId],
          payload: {
            dealId,
            companyId: afterData.companyId,
            opportunityId: afterData.opportunityId,
            stage: afterData.stage,
            amount: afterData.amount,
            closeDate: afterData.closeDate,
            ownerId: afterData.ownerId,
            // Include any additional deal data needed for handoff
            dealData: afterData
          }
        };

        await createEvent(handoffEvent);
        console.log(`Handoff event created for deal ${dealId}`);
      } else if (isHandoffReady && wasHandoffReady) {
        console.log(`Deal ${dealId} already marked for handoff, skipping event creation`);
      } else {
        console.log(`Deal ${dealId} not ready for handoff: stage=${afterData.stage}, readyForRecruiter=${afterData.readyForRecruiter}`);
      }
    } catch (error) {
      console.error('Error in onOpportunityHandoff:', error);
      throw error;
    }
  }
);
