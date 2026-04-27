# Messaging Testing Plan

A structured plan to verify SMS notifications work correctly for applications and assignments.

---

## Deploy Only Messaging-Related Functions

To deploy just the functions that send assignment/hired SMS (URL changes + link shortening):

```bash
firebase deploy --only functions:logAssignmentCreated,functions:logAssignmentUpdated,functions:processSmsOutbound,functions:enqueueSmsOutbound,functions:sendWorkerMessage
```

These cover:
- **logAssignmentCreated** - Sends "your application has been accepted" when assignment is created
- **logAssignmentUpdated** - Sends status updates when assignment changes (placed, confirmed, etc.)
- **processSmsOutbound** - Queue worker that sends SMS (uses TwilioSmsProvider with shortenUrls)
- **enqueueSmsOutbound** - Trigger that enqueues SMS requests
- **sendWorkerMessage** - onCall for manual/recruiter sends

---

## Messaging Flow Overview

| Event | Trigger | Firestore Path | Message Example |
|-------|---------|----------------|-----------------|
| **Application submitted** | `onApplicationCreated` | `tenants/{tenantId}/applications/{applicationId}` (create) | "Thank you for applying to be a {jobTitle}..." |
| **Application status change** | `onApplicationStatusChanged` | `tenants/{tenantId}/applications/{applicationId}` (update) | Screened, hired, rejected, etc. |
| **Assignment created** | `logAssignmentCreated` | `tenants/{tenantId}/assignments/{assignmentId}` (create) | "Your application has been accepted for {jobTitle}..." |

---

## Pre-Flight Checklist (Per User)

Before testing, verify for **each test user** (e.g., Mark):

1. **Phone number**
   - Firestore: `users/{userId}` → `phoneE164` or `phone` present and in E.164 format (e.g. `+19254480579`)
   - UI: Profile → Contact info

2. **Phone verification** (required for SMS by default)
   - Firestore: `users/{userId}` → `phoneVerified === true`
   - UI: User must complete phone verification (OTP) if your flow requires it

3. **Notification settings**
   - Firestore: `users/{userId}` → `notificationSettings.sms.applicationUpdates === true` (or unset = uses default)
   - Default: `smsOptIn !== false && phoneVerified === true`
   - UI: Privacy & Notifications → Application Updates

4. **Twilio**
   - Trial accounts: Recipient number must be in Verified Caller IDs
   - Production: A2P 10DLC / campaign configured

---

## Test Cases

### Test 1: Application Submitted ("Thank you for applying")

**When it fires:** User submits an application via the Jobs Board Apply flow (new application document is created).

**Steps:**
1. Use a test user with verified phone and SMS enabled.
2. Apply to a job via the public Jobs Board (`/c1/jobs-board/...` or Apply flow).
3. Complete and submit the application.

**Expected:**
- Cloud Logs: `New application created: {applicationId}` and `SMS sent for new application {applicationId} to {phone}`.
- Twilio: Message delivered; check Message SID in Twilio Console.
- User receives: "Thank you for applying to be a {jobTitle}... We are currently reviewing applicants..."

**If it fails, check:**
- [ ] `onApplicationCreated` trigger in Cloud Logs (any errors?)
- [ ] User has `phoneE164` or `phone`
- [ ] `phoneVerified === true`
- [ ] `shouldSendNotification(userId, 'applicationUpdates', 'sms')` → logs "SMS disabled" if false
- [ ] Twilio logs for 30007 or other errors

---

### Test 2: Assignment Created ("You've been accepted")

**When it fires:** Recruiter places a worker and clicks "Placed" to offer the position (assignment document is created).

**Steps:**
1. Use a test user with verified phone.
2. As recruiter: Open Job Order → Placements tab → Drag worker to Assignments → Click "Placed" chip.
3. Confirm the assignment is created in Firestore.

**Expected:**
- Cloud Logs: `Assignment created: {assignmentId}` and `SMS sent for assignment {assignmentId} to {phone}`.
- Twilio: Message delivered (watch for 30007).
- User receives: "Your application has been accepted for {jobTitle}... View details and respond: {url}"

**If it fails, check:**
- [ ] `logAssignmentCreated` trigger in Cloud Logs
- [ ] Message Automation Rule for `assignment_created` (Messaging tab) – template and variables
- [ ] `locationPhrase` / `locationName` – do not use raw Firestore IDs
- [ ] Twilio 30007: Use carrier-friendly wording (no "Congratulations", "Click", ALL CAPS)

---

### Test 3: Application Status Change (Screened, Hired, etc.)

**When it fires:** Application status is updated (e.g. screened, hired, rejected).

**Steps:**
1. Create or use an existing application.
2. Change status (e.g. Screened or Hired) from Recruiter UI.
3. Verify the update is written to Firestore.

**Expected:**
- Cloud Logs: `SMS sent for application status change {applicationId} ({oldStatus} → {newStatus}) to {phone}`.
- User receives the appropriate status message (screened, hired, etc.).

**If it fails, check:**
- [ ] `onApplicationStatusChanged` trigger
- [ ] Template for `application_screened`, `application_hired`, etc.
- [ ] Same pre-flight (phone, phoneVerified, notification settings)

---

### Test 4: Team Member Applied – "Thank you" Not Received (Mark's Case)

**Scenario:** Mark applied for a job and did not receive "Thank you for applying."

**Diagnostic steps:**

1. **Confirm application creation**
   - Firestore: `tenants/{tenantId}/applications` – find Mark's application by `userId`.
   - Note `applicationId` and `createdAt`.

2. **Check Cloud Logs around that time**
   - Filter by: `onApplicationCreated` or `New application created`.
   - Look for: `Application {id} has no userId` or `User {id} has no phone number` or `SMS disabled`.

3. **Verify Mark's user document**
   - `users/{markUserId}`:
     - `phoneE164` or `phone` present?
     - `phoneVerified`?
     - `notificationSettings` (or defaults)?

4. **Verify trigger execution**
   - If Mark was placed without applying first, the application may have been created by `resolveApplicationForAssignment` (placementsApi). That uses `.add()` for new applications, which should fire `onDocumentCreated`.
   - If an existing application was updated (status change only), `onApplicationCreated` will not fire – the "thank you" would have been sent when the application was first created.

5. **Twilio**
   - Check Twilio Messaging Logs for Mark's number around the application creation time.
   - Look for undelivered, 30007, or other errors.

---

## Quick Reference: Log Queries

**Cloud Logging (Google Cloud Console):**

```
# Application created
resource.type="cloud_run_revision"
textPayload=~"application created"

# Assignment created
textPayload=~"Assignment created"

# SMS sent
textPayload=~"SMS sent"

# SMS failed
textPayload=~"SMS failed|Failed to send SMS"

# Skip reasons
textPayload=~"skipping SMS|no phone number|SMS disabled"
```

---

## Common Failure Modes

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| No logs for application/assignment | Trigger not deployed or wrong path | `firebase deploy --only functions`; confirm trigger paths |
| "User has no phone number" | Missing `phoneE164` / `phone` | Add and format phone in user profile |
| "SMS disabled" | `phoneVerified` false or notification off | Verify phone (OTP); check `notificationSettings` |
| "Missing required template variables" | Template uses vars not in resolver | Add vars to resolver or simplify template |
| Twilio 30007 | Carrier filtered content | Use factual tone; avoid "Congratulations", "Click", ALL CAPS, doc IDs |
| Trial: only some numbers work | Trial restriction | Add number to Twilio Verified Caller IDs |

---

## Mark Case: Step-by-Step Diagnosis

### What the logs show (13:46 PST)

Your logs indicate **successful sends** for user `3hW0FxmXaFgjL0GF90zVWsC952k2` to `+12135388896`:

1. `Assignment created` → assignment doc created
2. `application_status_change` → application status updated (e.g. to accepted/hired)
3. `SMS sent via Twilio: SMcb1b82375f7fa113cff25abf2fe32321 to +12135388896`
4. `SMS sent for assignment` to `+12135388896`

So both the assignment SMS and the application_status_change SMS were sent from our system.

### Clarifying "Thank you for applying" vs "You've been accepted"

| Message | Trigger | When it fires |
|---------|---------|----------------|
| **"Thank you for applying"** | `onApplicationCreated` | When a **new** application doc is **created** (e.g. Apply flow) |
| **"You've been accepted"** (assignment) | `logAssignmentCreated` | When assignment doc is **created** (Placed button) |
| **Status change** (screened, hired, etc.) | `onApplicationStatusChanged` | When application **status is updated** |

"Thank you for applying" is **not** sent when placing someone. It is sent when the application is first created (usually via Jobs Board Apply).

### Multiple applications and behavior

Mark has two entries: one `submitted`, one `accepted`.

**When you place Mark:**

1. `resolveApplicationForAssignment` runs.
2. It looks for an existing application: `userId`, `jobOrderId`, `shiftId`.
3. **If found** → Updates status to `accepted` → `onApplicationStatusChanged` fires.
4. **If not found** → Creates a **new** application → `onApplicationCreated` fires and sends "Thank you for applying" at the wrong moment (during placement).

So multiple applications can cause:

- "Thank you for applying" to be sent when placing (if a new app is created).
- Confusion about which application triggered which message.

### Checklist for Mark

1. **Confirm Mark's userId**

   - In Firestore, check `users/{userId}` where `phone` or `phoneE164` is `+12135388896`.
   - Compare with `3hW0FxmXaFgjL0GF90zVWsC952k2`.

2. **If Mark did not receive the messages**

   - In Twilio Console, find Message SID `SMcb1b82375f7fa113cff25abf2fe32321`.
   - Check delivery status (delivered, undelivered, 30007, etc.).

3. **When did Mark first apply?**

   - If he applied via Jobs Board, find the application with status `submitted`.
   - `onApplicationCreated` would fire at that moment.
   - In Cloud Logs around that timestamp, look for `New application created` or `SMS sent for new application`.

4. **When did Mark get placed?**

   - The logs at 13:46 are from placement.
   - At that time, `application_status_change` and `assignment` SMS were sent.
   - "Thank you for applying" would not be sent here unless a new application was created.

### Next steps

- Check Twilio for SID `SMcb1b82375f7fa113cff25abf2fe32321` to see if delivery failed.
- If Mark expects "Thank you for applying", confirm he applied via Jobs Board and inspect logs from the first application creation.
- Consider deduplicating or constraining how applications are created when placing, so "Thank you for applying" is not sent during placement.

---

## Verification Script (Optional)

For Mark's case, you can manually inspect Firestore:

```
# Mark's userId (from team or users list)
# Application doc: tenants/{tenantId}/applications where userId == markUserId
# User doc: users/{markUserId} → phoneE164, phoneVerified, notificationSettings
```

Then correlate with Cloud Logs for `applicationId` and timestamps.
