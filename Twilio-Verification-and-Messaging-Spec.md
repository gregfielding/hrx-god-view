# HRX / C1 — Twilio SMS Verification + Messaging Integration Spec (Cursor Implementation)

**Purpose:**  
Replace the development-only mock SMS verification with **real Twilio Verify** OTP for phone validation, while enabling **future transactional messaging** to workers (shift reminders, onboarding texts, updates).

---

## 1️⃣ Overview

- Use **Twilio Verify API** for phone verification (OTP during “Apply” flow).
- Use **Twilio Programmable Messaging** later for worker communications (shift updates, check-ins, announcements).  
- Keep mock SMS active in development for zero-cost testing.  
- Enable production via Firebase environment configuration.

---

## 2️⃣ Required Setup — Prompt the User

Cursor should **prompt the developer** to complete these setup steps before deployment:

1. **Create or log in to a Twilio Account** → https://www.twilio.com/try-twilio  
2. **Upgrade to a paid account** (trial accounts can’t receive OTP from unverified numbers).  
3. **Buy a local long code or toll-free number** for your business (e.g., “C1 Staffing”).  
4. **Register A2P 10DLC** (brand + campaign registration required by carriers).  
   - Brand: C1 Staffing LLC  
   - Campaign use case: “Employment & onboarding notifications”  
5. **Create a Verify Service** in the Twilio Console.  
   - Copy its **Service SID** (looks like `VAxxxxxxxxxxxxxxxx`).  
6. In Firebase CLI, set environment variables:  

```bash
firebase functions:config:set twilio.accountsid="ACxxxxxxxx" twilio.authtoken="xxxxxxxx" twilio.verifyservicesid="VAxxxxxxxx" use.sms_mock="false"
firebase deploy --only functions
```

---

## 3️⃣ Cloud Functions Implementation

**File:** `functions/src/twilio.ts`

```ts
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import twilio from "twilio";

admin.initializeApp();
const db = admin.firestore();

const twilioAccountSid = functions.config().twilio?.accountsid;
const twilioAuthToken = functions.config().twilio?.authtoken;
const verifyServiceSid = functions.config().twilio?.verifyservicesid;
const USE_SMS_MOCK = (functions.config().use?.sms_mock === "true");

const client = twilio(twilioAccountSid, twilioAuthToken);

// 1️⃣ Send OTP
export const sendOtp = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Sign in required");
  const { phoneE164 } = data as { phoneE164: string };
  if (!/^\+[1-9]\d{7,14}$/.test(phoneE164)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid phone format");
  }

  if (USE_SMS_MOCK) {
    functions.logger.info(`MOCK OTP sent to ${phoneE164} code=123456`);
    return { mock: true };
  }

  await client.verify.v2.services(verifyServiceSid).verifications.create({
    to: phoneE164,
    channel: "sms",
  });

  return { ok: true };
});

// 2️⃣ Verify OTP
export const checkOtp = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Sign in required");
  const uid = context.auth.uid;
  const { phoneE164, code } = data as { phoneE164: string; code: string };

  if (USE_SMS_MOCK) {
    if (code !== "123456") throw new functions.https.HttpsError("invalid-argument", "Incorrect code");
  } else {
    const res = await client.verify.v2.services(verifyServiceSid)
      .verificationChecks.create({ to: phoneE164, code });
    if (res.status !== "approved") {
      throw new functions.https.HttpsError("permission-denied", "Verification failed");
    }
  }

  await db.doc(`users/${uid}`).set({
    phoneE164,
    phoneVerified: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // Check for DOB & update workEligibility if both are valid
  const snap = await db.doc(`users/${uid}`).get();
  const dob = snap.get("dob");
  const okDob = !!dob && /^\d{4}-\d{2}-\d{2}$/.test(dob);
  await db.doc(`users/${uid}`).set({
    workEligibility: okDob ? true : admin.firestore.FieldValue.delete(),
  }, { merge: true });

  return { ok: true };
});
```

---

## 4️⃣ Client Flow

### Apply Button Gate

```ts
async function onApply(jobId: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) return openAuthModal();

  const snap = await getDoc(doc(db, "users", uid));
  const u = snap.data();

  const needDOB = !u?.dob;
  const needPhone = !u?.phoneVerified;

  if (needDOB || needPhone || !u?.workEligibility) {
    openEligibilityModal({ needDOB, needPhone });
    return;
  }

  navigate(`/jobs/${jobId}/apply`);
}
```

### Eligibility Modal Steps

1. **Step 1:** Date of Birth (validation: MM/DD/YYYY, 18+).  
2. **Step 2:** Phone Verification.  
   - Input phone → Send Code (calls `sendOtp`)  
   - Input 6-digit code → Verify (calls `checkOtp`)  
   - On success → `workEligibility=true` → proceed.

---

## 5️⃣ Material Design Field Validation

**DOB Field**  
- Label: *Date of Birth*  
- Helper: *Format: MM/DD/YYYY*  
- Error messages:  
  - “Enter a valid date.”  
  - “Date can’t be in the future.”  
  - “You must be at least 18 years old.”

**Phone Field**  
- Label: *Mobile Number*  
- Helper: *Use a number that can receive SMS.*  
- Error: *Enter a valid phone number.*

**Code Field**  
- Label: *Verification Code*  
- Mask: 6 digits  
- Error: *Incorrect code. Please try again.*  
- Resend cooldown: 60s (show countdown)

---

## 6️⃣ Firestore Rules

Keep existing DOB/phone validation rules from `ApplyGate-DOB-Phone-Spec.md`.  
Ensure clients cannot directly set `phoneVerified=true` or `workEligibility=true`.

---

## 7️⃣ Future Add-on: Twilio Messaging Function

Later, add a new function `sendWorkerMessage`:

```ts
export const sendWorkerMessage = functions.https.onCall(async (data, context) => {
  const { to, message } = data;
  await client.messages.create({
    from: "+1XXXXXXXXXX", // your Twilio number
    to,
    body: message,
  });
});
```

Use this for shift notifications, reminders, or onboarding messages.  
Ensure `smsOptIn: true` before sending.

---

## 8️⃣ QA Checklist

- [ ] Twilio Verify Service created & configured.  
- [ ] Firebase functions config set for Twilio credentials.  
- [ ] Mock works locally (`code=123456`).  
- [ ] Real OTP SMS received in production.  
- [ ] DOB + Phone verified sets `workEligibility=true`.  
- [ ] Apply gate works properly.  
- [ ] Firestore Rules prevent tampering.  
- [ ] Opt-out & A2P compliance handled.

---

## 9️⃣ Cursor Action Prompts

Cursor should:  
✅ Prompt developer to **create a Twilio account** and **get Verify Service SID** if not found.  
✅ Ask whether to enable mock mode (`use.sms_mock=true`) for local testing.  
✅ Help set Firebase config vars automatically via terminal commands.  
✅ Offer to generate `.env.local` or `firebase config:set` scripts.  

---

**End of Spec — Twilio Integration for HRX / C1**  
