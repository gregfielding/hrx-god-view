import { defineSecret } from 'firebase-functions/params';

// Shared Twilio secrets so they can be bound to v2 functions via `secrets: [...]`
// and used consistently across providers/webhooks.
export const TWILIO_ACCOUNT_SID = defineSecret('TWILIO_ACCOUNT_SID');
export const TWILIO_AUTH_TOKEN = defineSecret('TWILIO_AUTH_TOKEN');
export const TWILIO_MESSAGING_PHONE_NUMBER = defineSecret('TWILIO_MESSAGING_PHONE_NUMBER');
export const TWILIO_A2P_CAMPAIGN = defineSecret('TWILIO_A2P_CAMPAIGN');

