/**
 * Inbound SMS → Conversations bridge: findOrCreate, idempotent append, rollups.
 * Run with Firestore emulator for integration tests:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 GCLOUD_PROJECT=your-project npm run test:bridge
 * Without the emulator, the integration tests are skipped.
 */

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import {
  findOrCreateConversationForSms,
  appendConversationMessage,
  updateConversationRollups,
} from '../../messaging/conversations/conversationsModel';

const USE_EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const TEST_TENANT = 'test-tenant-inbound-bridge';
const TEST_WORKER_UID = 'test-worker-uid-001';
const TEST_PHONE = '+15551234567';
const TEST_TWILIO = '+15559876543';
const TOPIC = { type: 'support', label: 'Support' };

function skipWithoutEmulator(this: { skip(): void }) {
  if (!USE_EMULATOR) this.skip();
}

describe('inboundSmsConversationsBridge', () => {
  afterEach(async function () {
    if (!USE_EMULATOR) return;
    // Clean up test data so tests are independent
    const db = admin.firestore();
    const convSnap = await db
      .collection('tenants')
      .doc(TEST_TENANT)
      .collection('conversations')
      .where('channelEndpoints.sms.workerPhoneE164', '==', TEST_PHONE)
      .where('channelEndpoints.sms.twilioNumberE164', '==', TEST_TWILIO)
      .get();
    for (const doc of convSnap.docs) {
      const messages = await doc.ref.collection('messages').get();
      for (const m of messages.docs) await m.ref.delete();
      await doc.ref.delete();
    }
  });

  describe('1) Single inbound SMS (findOrCreate + append + rollup)', () => {
    it('creates conversation and message; rollup has lastMessageDirection and lastMessageChannel', async function () {
      skipWithoutEmulator.call(this);
      const { conversationId, ref } = await findOrCreateConversationForSms({
        tenantId: TEST_TENANT,
        workerUid: TEST_WORKER_UID,
        workerPhoneE164: TEST_PHONE,
        twilioNumberE164: TEST_TWILIO,
        topic: TOPIC,
      });
      expect(conversationId).to.be.a('string');
      expect(conversationId.length).to.be.greaterThan(0);

      const messageSid = 'SM1234567890abcdef';
      const canonicalId = `tw_${messageSid}`;
      const bodyText = 'Hello bridge test';
      const appended = await appendConversationMessage({
        tenantId: TEST_TENANT,
        conversationId,
        messageId: canonicalId,
        channel: 'sms',
        visibility: 'participants',
        sender: { role: 'worker', uid: TEST_WORKER_UID },
        body: { text: bodyText },
        provider: { name: 'twilio', messageId: messageSid },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      expect(appended).to.deep.equal({ created: true });

      await updateConversationRollups({
        tenantId: TEST_TENANT,
        conversationId,
        lastMessageText: bodyText,
        senderUid: TEST_WORKER_UID,
        lastMessageDirection: 'inbound',
        lastMessageChannel: 'sms',
      });

      const convSnap = await ref.get();
      expect(convSnap.exists).to.equal(true);
      const conv = convSnap.data()!;
      expect(conv.status).to.equal('open');
      expect(conv.participantUids).to.include(TEST_WORKER_UID);
      expect(conv.channelEndpoints?.sms?.workerPhoneE164).to.equal(TEST_PHONE);
      expect(conv.channelEndpoints?.sms?.twilioNumberE164).to.equal(TEST_TWILIO);
      expect(conv.lastMessagePreview).to.equal(bodyText);
      expect(conv.lastMessageDirection).to.equal('inbound');
      expect(conv.lastMessageChannel).to.equal('sms');

      const msgRef = ref.collection('messages').doc(canonicalId);
      const msgSnap = await msgRef.get();
      expect(msgSnap.exists).to.equal(true);
      expect(msgSnap.data()!.body?.text).to.equal(bodyText);
    });
  });

  describe('2) Replay same MessageSid (idempotency)', () => {
    it('second append with same messageId returns created: false and does not duplicate', async function () {
      skipWithoutEmulator.call(this);
      const { conversationId } = await findOrCreateConversationForSms({
        tenantId: TEST_TENANT,
        workerUid: TEST_WORKER_UID,
        workerPhoneE164: TEST_PHONE,
        twilioNumberE164: TEST_TWILIO,
        topic: TOPIC,
      });
      const messageSid = 'SMreplay123';
      const canonicalId = `tw_${messageSid}`;

      const first = await appendConversationMessage({
        tenantId: TEST_TENANT,
        conversationId,
        messageId: canonicalId,
        channel: 'sms',
        visibility: 'participants',
        sender: { role: 'worker', uid: TEST_WORKER_UID },
        body: { text: 'First' },
        provider: { name: 'twilio', messageId: messageSid },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      expect(first).to.deep.equal({ created: true });

      const second = await appendConversationMessage({
        tenantId: TEST_TENANT,
        conversationId,
        messageId: canonicalId,
        channel: 'sms',
        visibility: 'participants',
        sender: { role: 'worker', uid: TEST_WORKER_UID },
        body: { text: 'Replay same' },
        provider: { name: 'twilio', messageId: messageSid },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      expect(second).to.deep.equal({ created: false });

      const messagesSnap = await admin
        .firestore()
        .collection('tenants')
        .doc(TEST_TENANT)
        .collection('conversations')
        .doc(conversationId)
        .collection('messages')
        .get();
      expect(messagesSnap.size).to.equal(1);
      expect(messagesSnap.docs[0].id).to.equal(canonicalId);
    });
  });

  describe('3) Second inbound from same worker + Twilio number (reuse conversation)', () => {
    it('findOrCreate returns same conversation for same (workerPhone, twilioNumber)', async function () {
      skipWithoutEmulator.call(this);
      const first = await findOrCreateConversationForSms({
        tenantId: TEST_TENANT,
        workerUid: TEST_WORKER_UID,
        workerPhoneE164: TEST_PHONE,
        twilioNumberE164: TEST_TWILIO,
        topic: TOPIC,
      });
      const second = await findOrCreateConversationForSms({
        tenantId: TEST_TENANT,
        workerUid: TEST_WORKER_UID,
        workerPhoneE164: TEST_PHONE,
        twilioNumberE164: TEST_TWILIO,
        topic: TOPIC,
      });
      expect(second.conversationId).to.equal(first.conversationId);

      await appendConversationMessage({
        tenantId: TEST_TENANT,
        conversationId: first.conversationId,
        messageId: 'tw_SMfirst',
        channel: 'sms',
        visibility: 'participants',
        sender: { role: 'worker', uid: TEST_WORKER_UID },
        body: { text: 'First message' },
        provider: { name: 'twilio', messageId: 'SMfirst' },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await appendConversationMessage({
        tenantId: TEST_TENANT,
        conversationId: second.conversationId,
        messageId: 'tw_SMsecond',
        channel: 'sms',
        visibility: 'participants',
        sender: { role: 'worker', uid: TEST_WORKER_UID },
        body: { text: 'Second message' },
        provider: { name: 'twilio', messageId: 'SMsecond' },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const messagesSnap = await admin
        .firestore()
        .collection('tenants')
        .doc(TEST_TENANT)
        .collection('conversations')
        .doc(first.conversationId)
        .collection('messages')
        .get();
      expect(messagesSnap.size).to.equal(2);
      const ids = messagesSnap.docs.map((d) => d.id).sort();
      expect(ids).to.deep.equal(['tw_SMfirst', 'tw_SMsecond']);
    });
  });
});
