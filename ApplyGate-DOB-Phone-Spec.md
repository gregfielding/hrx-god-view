# HRX / C1 — Apply Gate: DOB + Phone Verification (Cursor Implementation Spec)

**Scenario**  
New users can browse jobs immediately after sign‑up. When they click **Apply**, they must first:  
1) **Enter Date of Birth (DOB)** and pass age validation, and  
2) **Verify phone number via SMS OTP** (Firebase Auth).  

Until both are complete, **`workEligibility` must remain `false`**. Once complete, set **`workEligibility = true`** and proceed to the application flow.

---

## 1) Data Model (Firestore)

**Collection:** `users/{uid}`

```ts
type UserProfile = {
  email: string;
  firstName?: string;
  lastName?: string;
  // onboarding gate
  dob?: string;                 // 'YYYY-MM-DD'
  phoneE164?: string;           // '+17025550147'
  phoneVerified?: boolean;      // derived from Firebase Auth link success
  workEligibility: boolean;     // false until dob + phoneVerified true
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

**On account creation (server or client):**
```ts
await setDoc(doc(db, 'users', uid), {
  email,
  workEligibility: false,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
}, { merge: true });
```

---

## 2) Security (Firestore Rules)

- Limit who can read PII (DOB/phone).  
- Allow user to update **only their own** profile.  
- Prevent clients from setting `workEligibility = true` unless DOB + phoneVerified are present and valid.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isSignedIn() { return request.auth != null; }
    function isOwner(uid) { return isSignedIn() && request.auth.uid == uid; }

    match /users/{uid} {
      allow read: if isOwner(uid); // user can read own doc
      allow update, create: if isOwner(uid) && validUserUpdate(uid);
    }

    function validUserUpdate(uid) {
      // Allow general updates by owner
      let after = request.resource.data;
      let before = resource.data;

      // Enforce DOB format 'YYYY-MM-DD' if present
      let dobOk = !('dob' in after) || after.dob.matches('^\\d{4}-\\d{2}-\\d{2}$');

      // Enforce E.164 phone if present (+ and digits 8..15)
      let phoneOk = !('phoneE164' in after) || after.phoneE164.matches('^\\+[1-9]\\d{7,14}$');

      // Prevent client from flipping phoneVerified to true unless they already had it true
      let phoneVerifiedImmutable = !('phoneVerified' in after) || (('phoneVerified' in before) && after.phoneVerified == before.phoneVerified);

      // Work eligibility can only be true if both DOB + phoneVerified present and valid
      let canSetWorkEligible = !('workEligibility' in after) ||
        (
          after.workEligibility == false ||
          (after.workEligibility == true &&
           ('dob' in after || 'dob' in before) &&
           ('phoneVerified' in after || 'phoneVerified' in before) &&
           (('dob' in after) ? after.dob.matches('^\\d{4}-\\d{2}-\\d{2}$') : true) &&
           (('phoneVerified' in after) ? after.phoneVerified == true : before.phoneVerified == true)
          )
        );

      return dobOk && phoneOk && phoneVerifiedImmutable && canSetWorkEligible;
    }
  }
}
```

> **Note:** Client cannot directly set `phoneVerified: true`; do that only after successful Firebase phone-link on the server (or trusted client step) and then compute `workEligibility` server-side.

---

## 3) Client Flow (UI / UX)

### 3.1 Gate on Apply
```ts
async function onApply(jobId: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) { openAuthModal(); return; }

  const snap = await getDoc(doc(db, 'users', uid));
  const u = snap.data() as UserProfile;

  const needDOB = !u?.dob;
  const needPhone = !u?.phoneVerified;
  if (needDOB || needPhone || !u?.workEligibility) {
    openEligibilityModal({ needDOB, needPhone });
    return;
  }

  // Eligible → proceed
  navigate(`/jobs/${jobId}/apply`);
}
```

### 3.2 Eligibility Modal (Material Design)
- Two steps inside a single modal with progress: **DOB** → **Phone**.  
- CTA button label changes: `Continue` → `Verify` → `Finish`.  
- Show **helper text** and **error states** per MD guidelines.

---

## 4) Material Design Field Validation

### 4.1 DOB Field (DatePicker or text with mask)
**Label:** Date of Birth  
**Helper text (default):** “Format: MM/DD/YYYY”  
**Validation:**  
- Required
- Valid date
- Not in the future
- Age ≥ 18 (configurable)
- Age < 100 (sanity guard)

**Error messages (examples):**
- “Enter a valid date.”
- “Date can’t be in the future.”
- “You must be at least 18 years old.”

**Implementation (TS)**
```ts
import dayjs from 'dayjs';

function validateDob(inputMMDDYYYY: string): { ok: boolean; error?: string; iso?: string } {
  const m = dayjs(inputMMDDYYYY, 'MM/DD/YYYY', true);
  if (!m.isValid()) return { ok: false, error: 'Enter a valid date.' };
  if (m.isAfter(dayjs(), 'day')) return { ok: false, error: 'Date can’t be in the future.' };
  const age = dayjs().diff(m, 'year');
  if (age < 18) return { ok: false, error: 'You must be at least 18 years old.' };
  if (age > 100) return { ok: false, error: 'Please enter a valid birth date.' };
  return { ok: true, iso: m.format('YYYY-MM-DD') };
}
```

On **Save DOB**:
```ts
const v = validateDob(dobInput);
if (!v.ok) setDobError(v.error);
else await updateDoc(doc(db, 'users', uid), { dob: v.iso, updatedAt: serverTimestamp() });
```

---

## 5) Phone Verification (Firebase Auth SMS)

### 5.1 Setup
- Enable **Phone** provider in Firebase Console → Authentication.  
- For web, Firebase uses **reCAPTCHA/Play Integrity** to prevent abuse.

### 5.2 UI
- **Phone Number** (with country selector)  
  - Helper: “Use a mobile number that can receive SMS.”  
  - Mask/format with `libphonenumber-js` or a phone input component.  
  - Validate local format; store **E.164**.
- **Send Code** → Show **6‑digit code** input (one-time password).  
  - Helper: “Enter the 6‑digit code we sent to {phone}.”  
  - Error messages: “Invalid code,” “Too many attempts,” “Number already in use.”  
- Actions: **Resend** (60s cooldown), **Change number**.

### 5.3 Code (link phone to existing email user)
```ts
import {
  getAuth, PhoneAuthProvider, linkWithCredential, RecaptchaVerifier
} from 'firebase/auth';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

let verificationId: string;

export async function startPhoneVerification(e164: string) {
  const auth = getAuth();
  if (!auth.currentUser) throw new Error('Must be signed in');

  // 1) reCAPTCHA (invisible recommended in a modal)
  const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });

  // 2) Send SMS
  const provider = new PhoneAuthProvider(auth);
  verificationId = await provider.verifyPhoneNumber(e164, verifier);
  // Persist phone locally for follow-up
  return verificationId;
}

export async function confirmPhoneCode(code: string, e164: string) {
  const auth = getAuth();
  const cred = PhoneAuthProvider.credential(verificationId, code);
  await linkWithCredential(auth.currentUser!, cred); // links phone provider to current user

  // 3) Persist in Firestore and compute eligibility
  await updateDoc(doc(db, 'users', auth.currentUser!.uid), {
    phoneE164: e164,
    phoneVerified: true,
    updatedAt: serverTimestamp(),
  });

  await recomputeEligibility(auth.currentUser!.uid);
}

async function recomputeEligibility(uid: string) {
  const ref = doc(db, 'users', uid);
  // In client, read current values (or pass known state) then set:
  await updateDoc(ref, { workEligibility: true, updatedAt: serverTimestamp() });
}
```

> **Edge cases**
- **`auth/credential-already-in-use`**: Phone is linked to another account. Prompt user to sign in with that account or contact support.
- **`auth/too-many-requests`**: Lock out and show cooldown UI.
- **Resend SMS**: throttle by 60s; disable button; show countdown.

---

## 6) Material Design Validation for Phone & Code

**Phone field**  
- Helper: “Format example: (702) 555‑0147”  
- Errors: “Enter a valid phone number.”, “This number can’t receive SMS.”, “Too many attempts. Try again later.”

**Code field**  
- Mask: `XXXXXX` (numeric only, 6 digits)  
- Auto‑advance focus if using 6 individual inputs.  
- Errors: “Incorrect code. Please try again.”, “Code expired — request a new one.”

**Resend**  
- Disabled for 60s with countdown: “Resend code in 45s”

---

## 7) UI State Machine (Apply Modal)

```
[Idle] → user clicks Apply
  ↓
[Check profile]
  - if (dob missing) → show DOB step
  - else if (phone !verified) → show Phone step
  - else → proceed to Application

[DOB Step]
  - validate → save → next (Phone step)

[Phone Step]
  - enter phone → Send Code
  - enter code → Verify
    - success → set phoneVerified=true, compute workEligibility
    - failure → show error / allow resend

[Done]
  - if workEligibility=true → continue to Application
```

---

## 8) Optional Server Hardening

For stronger guarantees, move `workEligibility` setting to a **Callable Cloud Function** that:
- Verifies the caller is the user.  
- Checks Firestore `dob` exists & matches pattern.  
- Checks Firebase Auth user has a linked phone factor (`user.providerData` includes `phone`).  
- Then updates `workEligibility=true` server-side.

_Pseudo:_
```ts
exports.setEligibility = onCall(async (req) => {
  const uid = req.auth?.uid;
  // read users/{uid} -> ensure dob exists
  // read auth record -> ensure phone provider linked
  // if both ok -> update users/{uid}.workEligibility = true
});
```

---

## 9) QA Checklist

- [ ] New users created with `workEligibility=false`.  
- [ ] Apply button opens Eligibility modal when DOB or phone missing.  
- [ ] DOB field enforces format + age ≥ 18.  
- [ ] Phone field enforces E.164; 6‑digit code required.  
- [ ] Resend throttled (60s) and shows countdown.  
- [ ] On success, `phoneVerified=true`, `phoneE164` set, `dob` set, and `workEligibility=true`.  
- [ ] Firestore Rules prevent arbitrary `phoneVerified=true` by client.  
- [ ] Accessibility: labels, helper text, error states announced by screen readers.  
- [ ] Analytics events: `apply_blocked_missing_dob`, `apply_blocked_phone_unverified`, `phone_otp_sent`, `phone_otp_verified`, `eligibility_unlocked`.

---

## 10) Notes

- Firebase handles the SMS delivery for **verification**. Use Twilio or a Firebase Extension **only for transactional SMS** (e.g., shift reminders).  
- Respect regional OTP regulations (rate limits, consent).  
- Secure PII exports and backups.

---

**End of Spec** — Apply Gate with DOB + Phone Verification
