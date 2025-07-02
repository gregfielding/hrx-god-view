import { CallableContext } from "firebase-functions/lib/common/providers/https";

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { OpenAI } = require('openai');

admin.initializeApp();
const db = admin.firestore();

const openai = new OpenAI({
  apiKey: functions.config().openai.key,
});

exports.analyzeAITraining = functions.https.onCall(
  async (data: any, context: CallableContext) => {
    const { customerId } = data;
    if (!customerId) throw new functions.https.HttpsError('invalid-argument', 'customerId is required');

    // Fetch global training
    const globalSnap = await db.doc('aiTraining/global').get();
    const globalData = globalSnap.exists ? globalSnap.data() : {};

    // Fetch customer-specific training
    const customerSnap = await db.doc(`customers/${customerId}/aiTraining/main`).get();
    const customerData = customerSnap.exists ? customerSnap.data() : {};

    // Build prompt
    const prompt = `
==== HRX-WIDE INSTRUCTIONS ====
Mission: ${(globalData || {}).mission || ''}
Core Values: ${(globalData || {}).coreValues || ''}
Communication Style: ${(globalData || {}).communicationStyle || ''}
...
==== CUSTOMER-SPECIFIC INSTRUCTIONS ====
Mission: ${(customerData || {}).mission || ''}
Core Values: ${(customerData || {}).coreValues || ''}
Communication Style: ${(customerData || {}).communicationStyle || ''}
...
`;

    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'system', content: prompt }]
    });

    return { result: response.choices[0].message.content };
  }
);
